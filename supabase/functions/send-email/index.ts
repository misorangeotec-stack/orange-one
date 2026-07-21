// send-email — delivers rows from public.email_outbox via the GMAIL API, using
// an OAuth refresh token for the sending mailbox (GMAIL_SENDER, support@orangeotec.com).
// Chosen because this Workspace tenant blocks BOTH app-password SMTP AND
// service-account key creation (org policy iam.managed.disableServiceAccountKeyCreation).
// A user-consented refresh token needs neither: no key file, no domain-wide delegation.
// Internal (Workspace) OAuth apps issue long-lived refresh tokens, so this is stable.
//
// HOW IT IS CALLED
//   * Instantly, per row: the email_outbox AFTER INSERT trigger POSTs { id } here.
//   * Every 3 min, as a safety net: pg_cron POSTs {} → drain all pending/failed.
//   Both send an `x-dispatch-secret` header checked against EMAIL_DISPATCH_SECRET.
//   Deploy with --no-verify-jwt (the shared secret is the gate).
//
// SECRETS (supabase secrets set ... --project-ref coshondiqdhorwvibrwu):
//   EMAIL_DISPATCH_SECRET     shared secret; also in private.email_dispatch_config
//   GMAIL_OAUTH_CLIENT_ID     OAuth client id (Web app) for the sending mailbox
//   GMAIL_OAUTH_CLIENT_SECRET OAuth client secret
//   GMAIL_OAUTH_REFRESH_TOKEN refresh token obtained once by consenting as GMAIL_SENDER
//   GMAIL_SENDER              the mailbox that consented (support@orangeotec.com)
//   GMAIL_FROM                optional From header, default "Orange One <GMAIL_SENDER>"
//   APP_BASE_URL             portal origin for deep links, e.g. https://portal.orangeotec.com
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected by the platform.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-dispatch-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const MAX_ATTEMPTS = 5;
const BATCH = 20;

// ---- env ------------------------------------------------------------------
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DISPATCH_SECRET = Deno.env.get("EMAIL_DISPATCH_SECRET") ?? "";
const CLIENT_ID = Deno.env.get("GMAIL_OAUTH_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("GMAIL_OAUTH_CLIENT_SECRET") ?? "";
const REFRESH_TOKEN = Deno.env.get("GMAIL_OAUTH_REFRESH_TOKEN") ?? "";
const GMAIL_SENDER = Deno.env.get("GMAIL_SENDER") ?? "";
const GMAIL_FROM = Deno.env.get("GMAIL_FROM") ?? (GMAIL_SENDER ? `Orange One <${GMAIL_SENDER}>` : "");
const APP_BASE_URL = (Deno.env.get("APP_BASE_URL") ?? "").replace(/\/+$/, "");

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

// ---- base64 helpers -------------------------------------------------------
function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const b64url = (bytes: Uint8Array) => bytesToB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlStr = (s: string) => b64url(new TextEncoder().encode(s));

// ---- OAuth refresh token → access token -----------------------------------
async function getAccessToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`token refresh failed: ${data.error ?? res.status} ${data.error_description ?? ""}`.trim());
  }
  return data.access_token as string;
}

// ---- MIME + Gmail send ----------------------------------------------------
/** RFC 2047 encoded-word for non-ASCII header values (subjects). */
function encodeHeader(v: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7F]*$/.test(v) ? v : `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(v)))}?=`;
}

function buildRaw(to: string, replyTo: string | undefined, subject: string, text: string, html: string): string {
  const boundary = "oo_" + b64url(crypto.getRandomValues(new Uint8Array(12)));
  const headers = [
    `From: ${GMAIL_FROM}`,
    `To: ${to}`,
    replyTo ? `Reply-To: ${replyTo}` : "",
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].filter(Boolean).join("\r\n");
  const body =
    `--${boundary}\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${text}\r\n` +
    `--${boundary}\r\nContent-Type: text/html; charset="UTF-8"\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${html}\r\n` +
    `--${boundary}--`;
  return b64urlStr(`${headers}\r\n\r\n${body}`);
}

async function gmailSend(token: string, raw: string): Promise<void> {
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`gmail send ${res.status}: ${t.slice(0, 300)}`);
  }
}

// ---- compose --------------------------------------------------------------
function ddmmyyyy(d: string | null | undefined): string {
  if (!d) return "";
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(dt.getUTCDate())}-${p(dt.getUTCMonth() + 1)}-${dt.getUTCFullYear()}`;
}
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}
// ---- brand palette (from vite.config.ts tokens) ---------------------------
const NAVY = "#0B1B40";
const NAVY2 = "#15294F";
const ORANGE = "#FF6A1F";
const ORANGE2 = "#FF8A3D";
const ORANGE_SOFT = "#FFF1E8";
const PAGE = "#F6F9FD";
const LINE = "#E9EEF6";
const GREY = "#64748B";
const GREY2 = "#8A99B0";
const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** Initials for the actor avatar (first + last word). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "";
  const b = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (a + b).toUpperCase() || "•";
}

/** Avatar circle + "Name <action>" row. */
function actorRow(actorName: string, action: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;"><tr>
    <td width="42" style="width:42px;vertical-align:middle;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td width="42" height="42" align="center" valign="middle"
            style="width:42px;height:42px;background:${NAVY};background:linear-gradient(135deg,${NAVY} 0%,${NAVY2} 100%);border-radius:21px;color:#ffffff;font-family:${FONT};font-size:14px;font-weight:700;">${esc(initials(actorName))}</td>
      </tr></table>
    </td>
    <td style="padding-left:13px;vertical-align:middle;font-family:${FONT};font-size:14.5px;color:${NAVY};">
      <b>${esc(actorName)}</b> <span style="color:${GREY};">${esc(action)}</span>
    </td>
  </tr></table>`;
}

/**
 * Bordered task card with an orange left rail and an optional pill.
 * `pillIcon` is an HTML entity string (already safe); `pillLabel` is escaped here.
 */
function taskCard(title: string, pillIcon = "", pillLabel = ""): string {
  const pill = pillLabel
    ? `<div style="margin-top:13px;"><span style="display:inline-block;background:${ORANGE_SOFT};color:${ORANGE};font-family:${FONT};font-size:12px;font-weight:700;padding:6px 12px;border-radius:999px;">${pillIcon ? pillIcon + "&nbsp; " : ""}${esc(pillLabel)}</span></div>`
    : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 26px;"><tr>
    <td style="background:${PAGE};border:1px solid ${LINE};border-left:4px solid ${ORANGE};border-radius:11px;padding:17px 19px;font-family:${FONT};">
      <div style="font-size:10.5px;letter-spacing:1px;text-transform:uppercase;color:${GREY2};font-weight:700;margin-bottom:7px;">Task</div>
      <div style="font-size:17px;line-height:1.35;font-weight:700;color:${NAVY};">${esc(title)}</div>
      ${pill}
    </td>
  </tr></table>`;
}

/** Quoted remark block for mentions. */
function quoteCard(note: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 26px;"><tr>
    <td style="background:${ORANGE_SOFT};border-radius:10px;padding:15px 17px;font-family:${FONT};font-size:14.5px;line-height:1.6;color:${NAVY};">
      <span style="color:${ORANGE};font-size:26px;line-height:0;vertical-align:-8px;">&ldquo;</span>
      <span style="font-style:italic;">${esc(note)}</span>
    </td>
  </tr></table>`;
}

/** Gradient CTA button (bulletproof-ish: bgcolor fallback for Outlook). */
function cta(link: string, label = "Open task"): string {
  if (!link) return "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:2px 0 2px;"><tr>
    <td align="center" bgcolor="${ORANGE}" style="border-radius:11px;background:${ORANGE};background:linear-gradient(135deg,${ORANGE} 0%,${ORANGE2} 100%);">
      <a href="${esc(link)}" target="_blank" style="display:inline-block;padding:14px 32px;font-family:${FONT};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:11px;">${esc(label)} &nbsp;&rarr;</a>
    </td>
  </tr></table>`;
}

/** The full branded email chrome: navy header, accent, body, footer. */
function emailShell(opts: { eyebrow: string; headline: string; inner: string }): string {
  return `<div style="margin:0;padding:0;background:${PAGE};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE};">
  <tr><td align="center" style="padding:26px 12px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border:1px solid ${LINE};border-radius:16px;overflow:hidden;">
      <tr><td bgcolor="${NAVY}" style="background:${NAVY};background:linear-gradient(135deg,${NAVY} 0%,${NAVY2} 100%);padding:19px 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="font-family:${FONT};font-size:18px;font-weight:800;color:#ffffff;letter-spacing:.2px;"><span style="color:${ORANGE2};">&#9679;</span>&nbsp; Orange One <span style="color:#AEB9CC;font-weight:600;">Hub</span></td>
          <td align="right" style="font-family:${FONT};font-size:10.5px;font-weight:700;color:#8FA0BC;letter-spacing:1px;text-transform:uppercase;">Task Management</td>
        </tr></table>
      </td></tr>
      <tr><td style="height:3px;line-height:3px;font-size:0;background:${ORANGE};background:linear-gradient(90deg,${ORANGE} 0%,${ORANGE2} 100%);">&nbsp;</td></tr>
      <tr><td style="padding:30px 32px 28px;">
        <div style="font-family:${FONT};font-size:11px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;color:${ORANGE};margin-bottom:9px;">${esc(opts.eyebrow)}</div>
        <div style="font-family:${FONT};font-size:23px;line-height:1.25;font-weight:800;color:${NAVY};margin-bottom:22px;">${esc(opts.headline)}</div>
        ${opts.inner}
      </td></tr>
      <tr><td style="background:${PAGE};border-top:1px solid ${LINE};padding:18px 32px;font-family:${FONT};font-size:12px;line-height:1.6;color:${GREY2};">
        <b style="color:${GREY};">Orange One Hub</b> &middot; automated task notification.<br>
        You're receiving this because you have a task in Orange One. Replies reach the person who acted.
      </td></tr>
    </table>
    <div style="font-family:${FONT};font-size:11px;color:${GREY2};padding:14px 0 2px;">&copy; Orange O Tec &middot; Orange One Hub</div>
  </td></tr>
</table>
</div>`;
}

interface Row {
  id: string; kind: string; to_user_id: string; to_email: string | null;
  actor_id: string | null; entity_id: string | null; payload: Record<string, unknown>;
  status: string; attempts: number;
}
interface Composed { subject: string; html: string; text: string; replyTo?: string; }

async function compose(row: Row): Promise<Composed | null> {
  const link = row.entity_id ? `${APP_BASE_URL}/task-management/tasks/${row.entity_id}` : "";
  const [{ data: task }, { data: actor }] = await Promise.all([
    row.entity_id ? admin.from("tasks").select("title,due_date").eq("id", row.entity_id).maybeSingle() : Promise.resolve({ data: null }),
    row.actor_id ? admin.from("profiles").select("name,email").eq("id", row.actor_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const title = (task?.title as string) ?? "a task";
  const actorName = (actor?.name as string)?.trim() || "A colleague";
  const replyTo = (actor?.email as string) || undefined;
  const due = ddmmyyyy(task?.due_date as string | null);

  if (row.kind === "task_assigned") {
    const inner = actorRow(actorName, "assigned you a task") + taskCard(title, due ? "&#128197;" : "", due ? `Due ${due}` : "") + cta(link);
    return {
      subject: `New task from ${actorName}: ${title}`,
      html: emailShell({ eyebrow: "New task", headline: "You've been assigned a task", inner }),
      text: `${actorName} assigned you a task: ${title}${due ? `\nDue: ${due}` : ""}\n\nOpen: ${link}`,
      replyTo,
    };
  }
  if (row.kind === "task_mention") {
    const note = String(row.payload?.note ?? "").trim();
    const inner = actorRow(actorName, "mentioned you") + taskCard(title) + (note ? quoteCard(note) : "") + cta(link);
    return {
      subject: `${actorName} mentioned you: ${title}`,
      html: emailShell({ eyebrow: "Mention", headline: "You were mentioned", inner }),
      text: `${actorName} mentioned you on "${title}"${note ? `:\n\n${note}` : ""}\n\nOpen: ${link}`,
      replyTo,
    };
  }
  if (row.kind === "task_recurring_assigned") {
    const rTitle = String(row.payload?.title ?? "a task");
    const recurrence = String(row.payload?.recurrence ?? "Recurring task");
    const listLink = APP_BASE_URL ? `${APP_BASE_URL}/task-management/tasks` : "";
    const inner = actorRow(actorName, "assigned you a recurring task")
      + taskCard(rTitle, "&#128257;", recurrence)
      + cta(listLink, "View my tasks");
    return {
      subject: `New recurring task from ${actorName}: ${rTitle}`,
      html: emailShell({ eyebrow: "Recurring task", headline: "You've been assigned a recurring task", inner }),
      text: `${actorName} assigned you a recurring task: ${rTitle}\n${recurrence}\n\nOpen: ${listLink}`,
      replyTo,
    };
  }
  return null;
}

// ---- outbox row lifecycle -------------------------------------------------
async function claim(row: Row): Promise<boolean> {
  const { data } = await admin.from("email_outbox").update({ status: "sending" })
    .eq("id", row.id).eq("status", row.status).lt("attempts", MAX_ATTEMPTS).select("id").maybeSingle();
  return !!data;
}
async function markSent(row: Row, subject: string) {
  await admin.from("email_outbox").update({ status: "sent", subject, sent_at: new Date().toISOString() }).eq("id", row.id);
}
async function markSkipped(row: Row, reason: string) {
  await admin.from("email_outbox").update({ status: "skipped", last_error: reason }).eq("id", row.id);
}
async function markFailed(row: Row, err: string) {
  await admin.from("email_outbox").update({ status: "failed", attempts: row.attempts + 1, last_error: err.slice(0, 500) }).eq("id", row.id);
}

async function sendOne(token: string, row: Row) {
  if (!row.to_email) return markSkipped(row, "no email on file for recipient");
  const c = await compose(row);
  if (!c) return markSkipped(row, `unknown kind or missing task (${row.kind})`);
  try {
    await gmailSend(token, buildRaw(row.to_email, c.replyTo, c.subject, c.text, c.html));
    await markSent(row, c.subject);
  } catch (e) {
    await markFailed(row, e instanceof Error ? e.message : String(e));
  }
}

// ---- handler --------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "POST only" });
  if (!DISPATCH_SECRET || req.headers.get("x-dispatch-secret") !== DISPATCH_SECRET) {
    return json(401, { error: "bad dispatch secret" });
  }
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN || !GMAIL_SENDER) {
    return json(500, { error: "Gmail OAuth not configured" });
  }

  let id: string | undefined;
  try { id = (await req.json())?.id; } catch { /* empty body => sweep all */ }

  let q = admin.from("email_outbox").select("*").in("status", ["pending", "failed"]).lt("attempts", MAX_ATTEMPTS);
  q = id ? q.eq("id", id) : q.order("created_at", { ascending: true }).limit(BATCH);
  const { data: rows, error } = await q;
  if (error) return json(500, { error: error.message });
  if (!rows?.length) return json(200, { processed: 0, note: "nothing to send" });

  let token: string;
  try { token = await getAccessToken(); }
  catch (e) { return json(502, { error: `auth: ${e instanceof Error ? e.message : String(e)}` }); }

  let processed = 0;
  for (const row of rows as Row[]) {
    if (!(await claim(row))) continue;
    await sendOne(token, row);
    processed++;
  }
  return json(200, { processed });
});
