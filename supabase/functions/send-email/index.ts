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
// SECRETS (supabase secrets set ... --project-ref icutjkrqkbzwvmnfbzpr):
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

/** A file to hang off the message. `b64` is the raw base64 of the bytes, unwrapped. */
interface Attachment { filename: string; mime: string; b64: string }

/** Base64 must be folded to <=76 chars per line (RFC 2045); Gmail rejects one long line. */
function wrap76(b64: string): string {
  const out: string[] = [];
  for (let i = 0; i < b64.length; i += 76) out.push(b64.slice(i, i + 76));
  return out.join("\r\n");
}

/** Quote a filename for a header parameter without letting a quote break out of it. */
const headerFilename = (name: string) => name.replace(/["\\\r\n]/g, "_");

/**
 * Build the MIME message.
 *
 * Without attachments this is byte-for-byte what it always was: a plain
 * multipart/alternative. With them, that alternative part is nested INSIDE a
 * multipart/mixed — which is the order that matters. Putting the files as extra
 * parts of the alternative would tell the client they are alternative RENDERINGS
 * of the same message, and most clients would show one and silently drop the rest.
 */
function buildRaw(
  to: string,
  replyTo: string | undefined,
  subject: string,
  text: string,
  html: string,
  attachments: Attachment[] = [],
): string {
  const alt = "oo_alt_" + b64url(crypto.getRandomValues(new Uint8Array(9)));
  const altBody =
    `--${alt}\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${text}\r\n` +
    `--${alt}\r\nContent-Type: text/html; charset="UTF-8"\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${html}\r\n` +
    `--${alt}--`;

  if (attachments.length === 0) {
    const headers = [
      `From: ${GMAIL_FROM}`,
      `To: ${to}`,
      replyTo ? `Reply-To: ${replyTo}` : "",
      `Subject: ${encodeHeader(subject)}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${alt}"`,
    ].filter(Boolean).join("\r\n");
    return b64urlStr(`${headers}\r\n\r\n${altBody}`);
  }

  const mixed = "oo_mix_" + b64url(crypto.getRandomValues(new Uint8Array(9)));
  const headers = [
    `From: ${GMAIL_FROM}`,
    `To: ${to}`,
    replyTo ? `Reply-To: ${replyTo}` : "",
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
  ].filter(Boolean).join("\r\n");

  const parts = [
    `--${mixed}\r\nContent-Type: multipart/alternative; boundary="${alt}"\r\n\r\n${altBody}\r\n`,
    ...attachments.map((a) => {
      const fn = headerFilename(a.filename);
      return `--${mixed}\r\n` +
        `Content-Type: ${a.mime}; name="${fn}"\r\n` +
        `Content-Transfer-Encoding: base64\r\n` +
        `Content-Disposition: attachment; filename="${fn}"\r\n\r\n` +
        `${wrap76(a.b64)}\r\n`;
    }),
    `--${mixed}--`,
  ].join("");

  return b64urlStr(`${headers}\r\n\r\n${parts}`);
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

/**
 * "2h" answers freshness at a glance; the date beside it is what a reader can
 * quote and file against. Both, because either alone left a question open.
 *
 * ⚠ MODULE SCOPE, NOT INSIDE A `kind` BRANCH. These lived inside the
 * `master_report_daily` block and were also called from `user_snapshot_daily`,
 * which is a `ReferenceError` waiting for its trigger — it stayed silent only
 * because no one had a `module_visits` row yet, so every module rendered
 * "not opened yet" and `ago()` was never reached. It would have fired the day
 * visit tracking went live, and taken the whole request down with it rather
 * than one row: `compose(row)` is awaited OUTSIDE `sendOne`'s try block, so a
 * throw here escapes the batch loop instead of marking the row failed.
 */
function ago(iso: string): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "never";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}
function onDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" });
}

/**
 * "12 Aug 2026 · 2 days ago" — the date first, because that is what a reader can
 * quote, with the gap after it because that is what makes a stale module obvious.
 *
 * Counted in whole INDIAN days, not in elapsed hours: something opened at 11pm
 * last night is "yesterday" to the person who opened it, and `ago()`'s "14h" is
 * technically true and reads as though it happened today.
 */
function sinceLabel(iso: string): string {
  if (!iso) return "";
  const t = new Date(iso);
  if (!Number.isFinite(t.getTime())) return "";
  const istDay = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(d);
  const days = Math.round(
    (Date.parse(`${istDay(new Date())}T00:00:00Z`) - Date.parse(`${istDay(t)}T00:00:00Z`)) / 86_400_000,
  );
  const gap = days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
  return `${t.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })} · ${gap}`;
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
function emailShell(opts: {
  eyebrow: string; headline: string; inner: string; tag?: string; footer?: string;
  /**
   * Body width in px. 600 is the classic safe email width and stays the DEFAULT,
   * so every existing notification keeps the width it has always had. The Master
   * Report overrides it: it is the one mail here that is a wide TABLE rather than
   * a short message, and at 600px its columns crush together.
   *
   * `max-width:100%` (rather than a hard px cap) lets either width shrink on a
   * phone instead of forcing a sideways scroll — which matters far more at 860.
   */
  width?: number;
}): string {
  const w = opts.width ?? 600;
  return `<div style="margin:0;padding:0;background:${PAGE};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE};">
  <tr><td align="center" style="padding:26px 12px;">
    <table role="presentation" width="${w}" cellpadding="0" cellspacing="0" style="width:${w}px;max-width:100%;background:#ffffff;border:1px solid ${LINE};border-radius:16px;overflow:hidden;">
      <tr><td bgcolor="${NAVY}" style="background:${NAVY};background:linear-gradient(135deg,${NAVY} 0%,${NAVY2} 100%);padding:19px 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="font-family:${FONT};font-size:18px;font-weight:800;color:#ffffff;letter-spacing:.2px;"><span style="color:${ORANGE2};">&#9679;</span>&nbsp; Orange One <span style="color:#AEB9CC;font-weight:600;">Hub</span></td>
          <td align="right" style="font-family:${FONT};font-size:10.5px;font-weight:700;color:#8FA0BC;letter-spacing:1px;text-transform:uppercase;">${esc(opts.tag ?? "Task Management")}</td>
        </tr></table>
      </td></tr>
      <tr><td style="height:3px;line-height:3px;font-size:0;background:${ORANGE};background:linear-gradient(90deg,${ORANGE} 0%,${ORANGE2} 100%);">&nbsp;</td></tr>
      <tr><td style="padding:30px 32px 28px;">
        <div style="font-family:${FONT};font-size:11px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;color:${ORANGE};margin-bottom:9px;">${esc(opts.eyebrow)}</div>
        <div style="font-family:${FONT};font-size:23px;line-height:1.25;font-weight:800;color:${NAVY};margin-bottom:22px;">${esc(opts.headline)}</div>
        ${opts.inner}
      </td></tr>
      <tr><td style="background:${PAGE};border-top:1px solid ${LINE};padding:18px 32px;font-family:${FONT};font-size:12px;line-height:1.6;color:${GREY2};">
        ${opts.footer ?? `<b style="color:${GREY};">Orange One Hub</b> &middot; automated task notification.<br>You're receiving this because you have a task in Orange One. Replies reach the person who acted.`}
      </td></tr>
    </table>
    <div style="font-family:${FONT};font-size:11px;color:${GREY2};padding:14px 0 2px;">&copy; Orange O Tec &middot; Orange One Hub</div>
  </td></tr>
</table>
</div>`;
}

// ---- Import FMS email building blocks -------------------------------------
/** A dark reference chip, e.g. "PO #IMP-1023". */
function docChip(label: string): string {
  return `<div style="margin:0 0 18px;"><span style="display:inline-block;background:${NAVY};color:#ffffff;font-family:${FONT};font-size:12px;font-weight:700;padding:6px 13px;border-radius:999px;letter-spacing:.3px;">${esc(label)}</span></div>`;
}
/** Key/value detail rows; `sub` renders a muted foreign-currency line. */
function detailRows(rows: Array<{ label: string; value: string; sub?: string }>): string {
  if (!rows.length) return "";
  const body = rows.map((r) => `<tr>
    <td style="padding:8px 0;font-family:${FONT};font-size:13px;color:${GREY};vertical-align:top;width:40%;border-bottom:1px solid ${LINE};">${esc(r.label)}</td>
    <td style="padding:8px 0;font-family:${FONT};font-size:14px;color:${NAVY};font-weight:600;text-align:right;border-bottom:1px solid ${LINE};">${esc(r.value)}${r.sub ? `<span style="display:block;font-size:12px;color:${GREY2};font-weight:400;">${esc(r.sub)}</span>` : ""}</td>
  </tr>`).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;">${body}</table>`;
}
/** Compact line-item list. */
function itemList(items: Array<{ name: string; meta?: string; value?: string; sub?: string }>): string {
  if (!items.length) return "";
  const rows = items.map((it) => `<tr>
    <td style="padding:9px 13px;font-family:${FONT};font-size:13.5px;color:${NAVY};border-top:1px solid ${LINE};"><b>${esc(it.name)}</b>${it.meta ? `<span style="color:${GREY};font-weight:400;"> &middot; ${esc(it.meta)}</span>` : ""}</td>
    <td align="right" style="padding:9px 13px;font-family:${FONT};font-size:13.5px;color:${NAVY};font-weight:600;white-space:nowrap;border-top:1px solid ${LINE};">${it.value ? esc(it.value) : ""}${it.sub ? `<span style="display:block;font-size:11.5px;color:${GREY2};font-weight:400;">${esc(it.sub)}</span>` : ""}</td>
  </tr>`).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;background:${PAGE};border:1px solid ${LINE};border-radius:11px;overflow:hidden;">
    <tr><td colspan="2" style="padding:9px 13px;font-family:${FONT};font-size:10.5px;letter-spacing:1px;text-transform:uppercase;color:${GREY2};font-weight:700;">Items</td></tr>
    ${rows}
  </table>`;
}
/** Orange-tinted note/reason box. */
function noteBox(label: string, text: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;"><tr>
    <td style="background:${ORANGE_SOFT};border-radius:10px;padding:13px 16px;font-family:${FONT};">
      <div style="font-size:10.5px;letter-spacing:1px;text-transform:uppercase;color:${ORANGE};font-weight:700;margin-bottom:4px;">${esc(label)}</div>
      <div style="font-size:14px;line-height:1.55;color:${NAVY};">${esc(text)}</div>
    </td>
  </tr></table>`;
}

interface Row {
  // to_user_id is NULL for an EXTERNAL recipient (a customer) — see migration
  // 20260801120300. Nothing in the send path reads it; to_email is what matters.
  id: string; kind: string; to_user_id: string | null; to_email: string | null; to_name?: string | null;
  actor_id: string | null; entity_id: string | null; payload: Record<string, unknown>;
  status: string; attempts: number;
}
interface Composed {
  subject: string; html: string; text: string; replyTo?: string;
  /** Storage objects to attach, resolved to bytes just before sending. */
  files?: { bucket: string; path: string; filename: string; mime: string }[];
}

/**
 * Ceiling on what we will attach, in decoded bytes.
 *
 * Gmail's own limit is far higher, but base64 inflates by ~33% and the whole raw
 * message is held in memory here and posted in one request. Past this we send the
 * same mail with signed links instead — a report that arrives as a link beats a
 * report that silently fails five times and lands in `failed`.
 */
const MAX_ATTACH_BYTES = 10 * 1024 * 1024;
const SIGNED_URL_TTL = 7 * 24 * 60 * 60;

/** Fetch the files for a composed mail, or fall back to signed links. */
async function resolveAttachments(
  c: Composed,
): Promise<{ attachments: Attachment[]; html: string; text: string }> {
  if (!c.files?.length) return { attachments: [], html: c.html, text: c.text };

  const loaded: { filename: string; mime: string; bytes: Uint8Array }[] = [];
  let total = 0;
  for (const f of c.files) {
    const { data, error } = await admin.storage.from(f.bucket).download(f.path);
    if (error || !data) throw new Error(`attachment ${f.path}: ${error?.message ?? "not found"}`);
    const bytes = new Uint8Array(await data.arrayBuffer());
    total += bytes.byteLength;
    loaded.push({ filename: f.filename, mime: f.mime, bytes });
  }

  if (total <= MAX_ATTACH_BYTES) {
    return {
      attachments: loaded.map((f) => ({ filename: f.filename, mime: f.mime, b64: bytesToB64(f.bytes) })),
      html: c.html,
      text: c.text,
    };
  }

  const links: string[] = [];
  for (const f of c.files) {
    const { data } = await admin.storage.from(f.bucket).createSignedUrl(f.path, SIGNED_URL_TTL);
    if (data?.signedUrl) links.push(`<a href="${esc(data.signedUrl)}">${esc(f.filename)}</a>`);
  }
  const mb = Math.round(total / (1024 * 1024));
  const note = links.length
    ? `<p style="font-family:${FONT};font-size:13.5px;color:${GREY};">The files are ${mb} MB, too large to attach, so here are download links (valid 7 days):<br>${links.join("<br>")}</p>`
    : `<p style="font-family:${FONT};font-size:13.5px;color:${GREY};">The files were too large to attach and no download link could be created. Please re-export from the portal.</p>`;
  return {
    attachments: [],
    html: `${c.html}${note}`,
    text: `${c.text}\n\n(Files were ${mb} MB — too large to attach.)`,
  };
}

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
  // Tagged in a task's DESCRIPTION (trg_tasks_description_mentions). Distinct from
  // task_mention above, which is a mention inside a remark: this one fires when the task is
  // created or its description is edited, and quotes the description rather than a comment.
  if (row.kind === "task_description_mention") {
    const description = String(row.payload?.description ?? "").trim();
    const inner = actorRow(actorName, "tagged you in a task")
      + taskCard(title, due ? "&#128197;" : "", due ? `Due ${due}` : "")
      + (description ? quoteCard(description) : "")
      + cta(link);
    return {
      subject: `${actorName} tagged you: ${title}`,
      html: emailShell({ eyebrow: "Mention", headline: "You were tagged in a task", inner }),
      text: `${actorName} tagged you in "${title}"${due ? `\nDue: ${due}` : ""}${description ? `:\n\n${description}` : ""}\n\nOpen: ${link}`,
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
  // ---- the CUSTOMER-FACING mail ------------------------------------------
  // The one message this portal sends outside the company: the customer being
  // told their planned dispatch date. It must come BEFORE the shared FMS
  // renderer, which assumes an internal reader.
  //
  // Three deliberate differences from every internal template:
  //   · no actor row — "A colleague updated a document" is meaningless here;
  //   · no CTA — an external recipient cannot sign in to the portal;
  //   · the footer names Orange O Tec rather than the internal hub.
  // Reply-To still points at whoever recorded the step, so a customer replying
  // reaches the store keeper.
  if (row.kind === "order-to-dispatch_customer_dispatch_plan") {
    const p = (row.payload ?? {}) as Record<string, unknown>;
    const str = (v: unknown, d = "") => (typeof v === "string" && v ? v : d);
    const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
    const customer = str(p.customer, row.to_name ?? "Customer");
    const orderNo = str(p.orderNo, "your order");
    const planned = str(p.plannedDate, "");
    const subject = str(p.subject, `Your order ${orderNo} is planned for dispatch`);
    const headline = planned ? `Planned for dispatch on ${planned}` : "Your order is planned for dispatch";
    const inner =
      docChip(`Order ${orderNo}`) +
      detailRows([
        { label: "Order no.", value: orderNo },
        { label: "Order date", value: str(p.orderDate, "-") },
        { label: "Planned dispatch", value: planned || "-" },
        { label: "Mode", value: str(p.type, "-") },
      ]) +
      itemList(arr(p.items)) +
      (str(p.body) ? noteBox("Message", str(p.body)) : "");
    return {
      subject,
      html: emailShell({
        eyebrow: "Dispatch update",
        headline,
        inner,
        tag: "Orange O Tec",
        footer: `<b style="color:${GREY};">Orange O Tec</b> &middot; dispatch intimation for ${customer}.<br>Replies reach the team member handling your order.`,
      }),
      text: `${headline}\n\nOrder: ${orderNo}\n${str(p.body)}`,
      replyTo,
    };
  }

  // ---- the Outstanding Dashboard's mailed REPORT --------------------------
  // Queued straight from the browser by public.queue_report_email (migration
  // 20260829120000) after the PDF/XLSX have been uploaded to `report-exports`.
  // Unlike every branch above, the body is authored by the sender rather than
  // derived from an entity, and the point of the mail is the files hanging off it.
  if (row.kind === "receivables_collections_report") {
    const p = (row.payload ?? {}) as Record<string, unknown>;
    const str = (v: unknown, d = "") => (typeof v === "string" && v ? v : d);
    const bucket = str(p.bucket, "report-exports");
    const files = (Array.isArray(p.attachments) ? p.attachments : [])
      .map((a) => a as Record<string, unknown>)
      .filter((a) => typeof a.path === "string")
      .map((a) => ({
        bucket,
        path: String(a.path),
        filename: str(a.filename, String(a.path).split("/").pop() ?? "report"),
        mime: str(a.mime, "application/octet-stream"),
      }));

    const headline = str(p.headline, "Your receivables report");
    const body = str(p.body);
    const fileList = files.length
      ? itemList(files.map((f) => ({ name: f.filename, meta: f.mime.includes("pdf") ? "PDF summary" : "Excel workbook" })))
      : "";
    const inner =
      (actorName !== "A colleague" ? actorRow(actorName, "sent you a report") : "") +
      (body ? noteBox("Message", body) : "") +
      fileList;

    return {
      subject: str(p.subject, headline),
      html: emailShell({
        eyebrow: "Receivables",
        headline,
        inner,
        tag: "Outstanding Dashboard",
        footer: `<b style="color:${GREY};">Orange One Hub</b> &middot; receivables report.<br>You're receiving this because a colleague sent it to you. Replies reach the person who sent it.`,
      }),
      text: `${headline}\n\n${body}\n\n${files.map((f) => f.filename).join("\n")}`,
      replyTo,
      files,
    };
  }

  // ---- the MASTER REPORT one-pager ----------------------------------------
  // Queued two ways, rendered one way:
  //   · pg_cron at 08:00 IST (master_report_enqueue_daily) — no attachments;
  //   · a person pressing "Email snapshot" (queue_master_report_email) — may
  //     carry a PDF and a covering note.
  // Both put the same server-computed snapshot in payload.snapshot, so the
  // numbers in the mail cannot be authored by a client.
  //
  // ⚠ THIS IS THE ONE MAIL THAT IS READ AT A GLANCE ON A PHONE. It is a table,
  //   not a card list: a director scans the STATE column for red and stops
  //   there. Everything else is supporting detail.
  if (row.kind === "master_report_daily") {
    const p = (row.payload ?? {}) as Record<string, unknown>;
    const snap = (p.snapshot ?? {}) as Record<string, unknown>;
    const mods = (Array.isArray(snap.modules) ? snap.modules : []) as Record<string, unknown>[];
    const str = (v: unknown, d = "") => (typeof v === "string" && v ? v : d);
    const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);

    const forDate = str(p.for_date);
    const dateLabel = forDate ? ddmmyyyy(forDate) : "";

    // "tracking" is deliberately neutral, not red: it means a view-only module's
    // opens counter has not run long enough to call it dormant — an absence of
    // evidence, not a verdict. Red here would be read as the verdict.
    const STATE_COLOR: Record<string, string> = {
      active: "#0F9D58", quiet: "#B7791F", dormant: "#D64545", tracking: "#4A5B75", error: GREY,
    };
    const STATE_BG: Record<string, string> = {
      active: "#E8F5EC", quiet: "#FDF3E2", dormant: "#FDECEC", tracking: "#EEF2F8", error: PAGE,
    };

    const counts = { active: 0, quiet: 0, dormant: 0, tracking: 0, error: 0 } as Record<string, number>;
    for (const m of mods) counts[str(m.state, "error")] = (counts[str(m.state, "error")] ?? 0) + 1;
    // People-entered only. Rows a cron job generated are counted apart, because
    // a flat total let one person plus a scheduled job read as sixty-six people.
    const newToday = mods.reduce((s, m) => s + num(m.new_today), 0);
    const newSystem = mods.reduce((s, m) => s + num(m.new_today_system), 0);
    const openTotal = mods.reduce((s, m) => s + num(m.open), 0);
    // Only modules with a stored due date contribute; the rest would add zeros
    // that read as "nothing is late" rather than "not measurable here".
    const overdueTotal = mods.reduce((s, m) => s + (m.tracks_due === true ? num(m.overdue) : 0), 0);
    // Modules SOMEONE OPENED today. The only usage signal a read-only module can
    // produce — an entry count for one of those can only ever say zero.
    const openedToday = mods.reduce((s, m) => s + (num(m.visitors_today) > 0 ? 1 : 0), 0);

    // Three numbers across the top. Tables, not flexbox — Outlook ignores flex.
    const tile = (label: string, value: string, color: string, sub = "") => `
      <td width="25%" style="padding:0 3px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE};border:1px solid ${LINE};border-radius:11px;">
          <tr><td align="center" style="padding:12px 4px;font-family:${FONT};">
            <div style="font-size:23px;font-weight:800;color:${color};line-height:1.1;">${esc(value)}</div>
            <div style="font-size:10px;letter-spacing:.5px;text-transform:uppercase;color:${GREY2};font-weight:700;margin-top:4px;">${esc(label)}</div>
            ${sub ? `<div style="font-size:10px;color:${GREY2};font-weight:400;margin-top:2px;">${esc(sub)}</div>` : ""}
          </td></tr>
        </table>
      </td>`;

    const tiles = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;"><tr>
      ${tile("Created today", String(newToday), NAVY, newSystem ? `+${newSystem} auto` : "by people")}
      ${tile("Open", String(openTotal), NAVY)}
      ${tile("Overdue", String(overdueTotal), overdueTotal > 0 ? STATE_COLOR.dormant : NAVY)}
      ${tile("Dormant", String(counts.dormant ?? 0), (counts.dormant ?? 0) > 0 ? STATE_COLOR.dormant : NAVY)}
    </tr></table>`;

    // Banded by state, worst LAST: a reader scanning top-down meets what is
    // working, then what is not, and the dormant block sits together as one
    // list to act on instead of being scattered through the table.
    const STATE_ORDER = ["active", "quiet", "tracking", "dormant", "error"];
    const STATE_BAND: Record<string, string> = {
      active: "In use", quiet: "Worked, but nothing new created",
      tracking: "Measuring", dormant: "Not being used", error: "Could not be counted",
    };
    const ordered = [...mods].sort((a, b) => {
      const d = STATE_ORDER.indexOf(str(a.state, "error")) - STATE_ORDER.indexOf(str(b.state, "error"));
      // Within a band, busiest first — the row a director stops on.
      return d !== 0 ? d : num(b.new_7d) + num(b.visitors_7d) - (num(a.new_7d) + num(a.visitors_7d));
    });

    const bandRow = (state: string, n: number) => `<tr>
      <td colspan="7" style="padding:14px 10px 5px;font-family:${FONT};font-size:10.5px;letter-spacing:.8px;text-transform:uppercase;font-weight:800;color:${STATE_COLOR[state] ?? GREY};">
        ${esc(STATE_BAND[state] ?? state)} <span style="color:${GREY2};font-weight:600;">(${n})</span>
      </td></tr>`;

    let lastBand = "";
    const rowsHtml = ordered.map((m) => {
      const state = str(m.state, "error");
      const band = state === lastBand
        ? ""
        : bandRow(state, ordered.filter((x) => str(x.state, "error") === state).length);
      lastBand = state;
      const tracks = m.tracks_status !== false;
      const tracksDue = m.tracks_due === true;
      const sysN = num(m.new_today_system);
      const dim = state === "dormant";
      const viewOnly = m.usage_from_visits === true;
      const opened = num(m.visitors_7d);
      // The combined signal. A view-only module's last ENTRY is meaningless —
      // the Outstanding Dashboard would report 12 Jul forever while in daily use.
      const sig = str(m.last_signal_at) || str(m.last_activity_at);
      return `${band}<tr>
        <td style="padding:9px 10px;border-top:1px solid ${LINE};font-family:${FONT};font-size:13px;color:${dim ? GREY : NAVY};font-weight:${dim ? 500 : 600};">${esc(str(m.label, str(m.app_id)))}${viewOnly ? `<span style="color:${GREY2};font-size:11px;font-weight:400;"> · view-only</span>` : ""}</td>
        <td align="right" style="padding:9px 6px;border-top:1px solid ${LINE};font-family:${FONT};font-size:13px;color:${NAVY};white-space:nowrap;">${num(m.new_today) || 0}${sysN ? `<span style="color:${GREY2};font-size:11px;"> +${sysN}</span>` : ""}</td>
        <td align="right" style="padding:9px 6px;border-top:1px solid ${LINE};font-family:${FONT};font-size:13px;color:${NAVY};">${tracks ? num(m.open) : "n/a"}</td>
        <td align="right" style="padding:9px 6px;border-top:1px solid ${LINE};font-family:${FONT};font-size:13px;color:${tracksDue && num(m.overdue) > 0 ? STATE_COLOR.dormant : GREY};">${tracksDue ? num(m.overdue) : "n/a"}</td>
        <td align="right" style="padding:9px 6px;border-top:1px solid ${LINE};font-family:${FONT};font-size:13px;color:${opened ? NAVY : GREY2};">${opened || 0}</td>
        <td align="right" style="padding:9px 6px;border-top:1px solid ${LINE};font-family:${FONT};font-size:12.5px;color:${GREY};white-space:nowrap;">${esc(ago(sig))}${onDate(sig) ? `<span style="color:${GREY2};font-size:11px;"> · ${esc(onDate(sig))}</span>` : ""}</td>
        <td align="right" style="padding:9px 10px;border-top:1px solid ${LINE};font-family:${FONT};">
          <span style="display:inline-block;background:${STATE_BG[state] ?? PAGE};color:${STATE_COLOR[state] ?? GREY};font-size:10.5px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;padding:3px 9px;border-radius:999px;">${esc(state)}</span>
        </td>
      </tr>`;
    }).join("");

    const th = (label: string, align = "right") =>
      `<td align="${align}" style="padding:0 6px 7px;font-family:${FONT};font-size:10px;letter-spacing:.7px;text-transform:uppercase;color:${GREY2};font-weight:700;">${esc(label)}</td>`;

    const table = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;">
      <tr>${th("Module", "left")}${th("Created")}${th("Open")}${th("Overdue")}${th("Opened 7d")}${th("Last activity")}${th("State")}</tr>
      ${rowsHtml || `<tr><td colspan="7" style="padding:14px;font-family:${FONT};font-size:13px;color:${GREY};">No modules configured.</td></tr>`}
    </table>
    <div style="font-family:${FONT};font-size:11px;line-height:1.5;color:${GREY2};margin:0 0 18px;">
      Created = entered by a person today (+N generated automatically). Overdue = past a stored due date; a dash means that module has no stored due date.
      Opened 7d = people who opened the module in the last week: ${esc(String(openedToday))} of ${esc(String(mods.length))} modules were opened today.
      A <b>view-only</b> module holds no entries at all (its data is produced elsewhere), so it is judged on Opened rather than on what was created.
    </div>`;

    // ---- Section 2: who can open what ---------------------------------------
    //
    // ⚠ NOT the 57 x 16 grid the PDF carries. Sixteen columns is unreadable in
    //   any mail client, and a grid squeezed to phone width is worse than no
    //   grid. This is the same data reduced to what a reader can act on: how
    //   many modules each person holds, when they last signed in, and — first,
    //   because it is the finding — who holds access and has never signed in.
    //   The full grid stays in the attached PDF.
    const access = (p.access ?? {}) as Record<string, unknown>;
    const users = (Array.isArray(access.users) ? access.users : []) as Record<string, unknown>[];

    const ROLE_LABEL: Record<string, string> = {
      admin: "Admin", hod: "HOD", sub_hod: "Sub-HOD", employee: "Employee",
    };
    const appIdsOf = (u: Record<string, unknown>) => (Array.isArray(u.app_ids) ? u.app_ids as string[] : []);
    const isAdmin = (u: Record<string, unknown>) => str(u.role) === "admin";

    // Grant ids -> readable names. The report's own module list supplies most of
    // them; anything granted that the report does not track (an id retired from
    // master_report_modules, say) is prettified from the id rather than dropped,
    // so a grant can never go unshown just because it is unrecognised.
    const moduleLabel = new Map<string, string>();
    for (const m of mods) moduleLabel.set(str(m.app_id), str(m.label, str(m.app_id)));
    const labelFor = (id: string) =>
      moduleLabel.get(id) ?? id.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    const moduleListOf = (u: Record<string, unknown>) =>
      appIdsOf(u).map(labelFor).sort((a, b) => a.localeCompare(b)).join(", ");

    const neverIn = users.filter((u) => !str(u.last_active_at));
    // Admins excluded: they hold no grants at all, so "granted but never signed
    // in" would be a false accusation against every one of them.
    const grantedNeverIn = neverIn.filter((u) => !isAdmin(u) && appIdsOf(u).length > 0);

    // Never-signed-in first, alphabetical within each group. The list arrives
    // sorted by name; this re-sorts so the people worth acting on are at the
    // top of the section rather than scattered down 57 rows.
    const orderedUsers = [...users].sort((a, b) => {
      const na = str(a.last_active_at) ? 1 : 0;
      const nb = str(b.last_active_at) ? 1 : 0;
      return na !== nb ? na - nb : str(a.name).toLowerCase().localeCompare(str(b.name).toLowerCase());
    });

    const userBand = (label: string, n: number, color: string) => `<tr>
      <td colspan="4" style="padding:14px 10px 5px;font-family:${FONT};font-size:10.5px;letter-spacing:.8px;text-transform:uppercase;font-weight:800;color:${color};">
        ${esc(label)} <span style="color:${GREY2};font-weight:600;">(${n})</span>
      </td></tr>`;

    let userBandDone = "";
    const userRows = orderedUsers.map((u) => {
      const never = !str(u.last_active_at);
      const bandKey = never ? "never" : "seen";
      const band = bandKey === userBandDone
        ? ""
        : never
          ? userBand("Never signed in", neverIn.length, STATE_COLOR.dormant)
          : userBand("Signed in at least once", users.length - neverIn.length, STATE_COLOR.active);
      userBandDone = bandKey;
      const n = appIdsOf(u).length;
      // The module NAMES, not a tick grid: sixteen columns is unreadable in mail,
      // but a wrapped list in one column answers the same question — what can
      // this person actually open — at any width, phone included.
      const list = isAdmin(u)
        ? `<span style="color:${ORANGE};font-weight:700;">Every module</span> <span style="color:${GREY2};">(admin, bypasses access, holds no grants)</span>`
        : n === 0
          ? `<span style="color:${STATE_COLOR.dormant};">nothing granted</span>`
          : `<b style="color:${NAVY};">${n}</b> &middot; ${esc(moduleListOf(u))}`;
      return `${band}<tr>
        <td style="padding:8px 10px;border-top:1px solid ${LINE};font-family:${FONT};font-size:12.5px;color:${NAVY};font-weight:600;vertical-align:top;white-space:nowrap;">${esc(str(u.name, "Unnamed"))}</td>
        <td style="padding:8px 6px;border-top:1px solid ${LINE};font-family:${FONT};font-size:11.5px;color:${GREY};vertical-align:top;">${esc(str(u.department) || "")}<span style="display:block;color:${GREY2};">${esc(ROLE_LABEL[str(u.role)] ?? str(u.role))}</span></td>
        <td style="padding:8px 10px;border-top:1px solid ${LINE};font-family:${FONT};font-size:11.5px;line-height:1.5;color:${GREY};vertical-align:top;">${list}</td>
        <td align="right" style="padding:8px 10px;border-top:1px solid ${LINE};font-family:${FONT};font-size:11.5px;white-space:nowrap;vertical-align:top;color:${never ? STATE_COLOR.dormant : GREY};font-weight:${never ? 700 : 400};">${
          // Relative label plus the real date: "2d" says at a glance whether
          // someone is current, the date is what you can quote and file against.
          never
            ? "never"
            : `${esc(ago(str(u.last_active_at)))}<span style="display:block;color:${GREY2};font-weight:400;">${esc(ddmmyyyy(str(u.last_active_at)))}</span>`
        }</td>
      </tr>`;
    }).join("");

    const accessSection = users.length
      ? `<div style="border-top:1px solid ${LINE};margin:26px 0 0;padding-top:22px;">
      <div style="font-family:${FONT};font-size:11px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;color:${ORANGE};margin-bottom:6px;">Who can open what</div>
      <div style="font-family:${FONT};font-size:17px;line-height:1.3;font-weight:800;color:${NAVY};margin-bottom:6px;">${esc(String(users.length))} users</div>
      ${grantedNeverIn.length
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;"><tr><td style="background:#FDF3E2;border-radius:10px;padding:12px 15px;font-family:${FONT};font-size:13px;line-height:1.55;color:#9A6512;">
             <b>${esc(String(grantedNeverIn.length))} ${grantedNeverIn.length === 1 ? "person holds" : "people hold"} module access but ${grantedNeverIn.length === 1 ? "has" : "have"} never signed in.</b>
             ${esc(grantedNeverIn.slice(0, 12).map((u) => str(u.name)).join(", "))}${grantedNeverIn.length > 12 ? " …" : ""}
           </td></tr></table>`
        : `<div style="font-family:${FONT};font-size:12.5px;color:${GREY};margin:0 0 14px;">${esc(String(neverIn.length))} of ${esc(String(users.length))} have never signed in.</div>`}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;">
        <tr>${th("User", "left")}${th("Department / role", "left")}${th("Modules they can open", "left")}${th("Last sign-in")}</tr>
        ${userRows}
      </table>
      <div style="font-family:${FONT};font-size:11px;line-height:1.5;color:${GREY2};margin:0 0 4px;">
        The number is how many modules are granted, followed by which ones. Admins bypass module access entirely and hold no grants, so they read as <b>every module</b>.
        The same thing as a tick grid is in the attached PDF, which has the width for sixteen columns.
      </div>
    </div>`
      : "";

    const note = str(p.body) ? noteBox("Message", str(p.body)) : "";
    const link = APP_BASE_URL ? `${APP_BASE_URL}/master-report` : "";

    // Attachments are optional here: the cron send has none, a manual send may
    // carry the PDF. Same ownership-checked shape the receivables branch uses.
    const bucket = str(p.bucket, "report-exports");
    const files = (Array.isArray(p.attachments) ? p.attachments : [])
      .map((a) => a as Record<string, unknown>)
      .filter((a) => typeof a.path === "string")
      .map((a) => ({
        bucket,
        path: String(a.path),
        filename: str(a.filename, String(a.path).split("/").pop() ?? "snapshot.pdf"),
        mime: str(a.mime, "application/pdf"),
      }));

    const textRows = mods.map((m) => {
      const tracks = m.tracks_status !== false;
      const sysN = num(m.new_today_system);
      return `${str(m.label, str(m.app_id))}${m.usage_from_visits === true ? " (view-only)" : ""}: `
        + `${num(m.new_today)} new${sysN ? ` (+${sysN} auto)` : ""}, `
        + `${tracks ? `${num(m.open)} open` : "no status"}`
        + `${m.tracks_due === true ? `, ${num(m.overdue)} overdue` : ""}, `
        + `opened by ${num(m.visitors_7d)} in 7d, `
        + `last ${ago(str(m.last_signal_at) || str(m.last_activity_at))}, ${str(m.state, "error")}`;
    }).join("\n");

    /**
     * The subject leads with the finding, not the filename.
     *
     * This report exists to surface two things: modules built and not used, and
     * people given access who never signed in. A subject that reads the same
     * every morning buries both, and a daily mail nobody opens is the same as a
     * daily mail nobody sends. So the two counts decide the wording, and when
     * neither is true it says so plainly rather than inventing a worry.
     *
     * ⚠ Composed from the SAME numbers rendered below. Never recount here: a
     *   subject disagreeing with the table it introduces is worse than a dull
     *   subject. (The personal snapshot learned this the expensive way — see the
     *   note in that branch about payload.subject.)
     */
    const dormantCount = ordered.filter((m) => str(m.state) === "dormant").length;
    const activeCount = ordered.filter((m) => str(m.state) === "active").length;
    // "17 Aug", not "17-08-2026": a subject line is read at a glance in a list.
    const day = onDate(forDate) || dateLabel || "";
    const autoSubject =
      dormantCount > 0
        ? `${dormantCount} module${dormantCount === 1 ? "" : "s"} unused`
          + (grantedNeverIn.length
              ? `, ${grantedNeverIn.length} ${grantedNeverIn.length === 1 ? "person has" : "people have"} never signed in`
              : "")
          + `. ${day}`
        : grantedNeverIn.length > 0
          ? `${grantedNeverIn.length} ${grantedNeverIn.length === 1 ? "person holds" : "people hold"} access but ${grantedNeverIn.length === 1 ? "has" : "have"} never signed in. Orange One, ${day}`
          : `All ${activeCount} module${activeCount === 1 ? "" : "s"} active. Orange One, ${day}`;

    return {
      subject: str(row.payload?.subject as string, autoSubject),
      html: emailShell({
        eyebrow: "Daily snapshot",
        headline: dateLabel ? `Module activity, ${dateLabel}` : "Module activity",
        inner: tiles + table + accessSection + note + cta(link, "Open full report"),
        tag: "Master Report",
        // Wider than every other mail in this file: this one is a table with
        // seven columns, and 600px crushed them together.
        width: 860,
        footer: `<b style="color:${GREY};">Orange One Hub</b> &middot; automated daily module snapshot.<br>"Dormant" means no activity in the configured window: a module built but not being used. "Open over 7 days" counts open items created more than 7 days ago; it is an age, not a deadline.`,
      }),
      text: `Orange One module snapshot${dateLabel ? ` for ${dateLabel}` : ""}\n\n`
        + `${newToday} new today by people${newSystem ? ` (+${newSystem} auto-generated)` : ""}`
        + ` · ${openTotal} open · ${overdueTotal} overdue · ${counts.dormant ?? 0} dormant\n\n`
        + `${textRows}\n\n`
        + (users.length
            ? `USERS (${users.length}): ${neverIn.length} never signed in`
              + `${grantedNeverIn.length ? `, ${grantedNeverIn.length} of those already hold module access` : ""}\n`
              + orderedUsers.map((u) =>
                  `${str(u.last_active_at) ? "" : "[NEVER SIGNED IN] "}${str(u.name)} (${str(u.department) || "no department"}): `
                  + (isAdmin(u) ? "every module (admin)" : moduleListOf(u) || "nothing granted")
                  + `, last in ${str(u.last_active_at) ? ago(str(u.last_active_at)) : "never"}`).join("\n")
              + "\n"
            : "")
        + `${link ? `\nOpen: ${link}` : ""}`,
      replyTo,
      files,
    };
  }

  // ---- the PERSONAL daily snapshot ----------------------------------------
  //
  // One mail per employee about their OWN work. Sibling of master_report_daily
  // above: same server-computed-payload rule, opposite audience.
  //
  // ⚠ THE NUMBERS COME FROM THE SCREEN'S OWN CODE, NOT FROM SQL.
  //   My Work Today aggregates its providers in the BROWSER, and the FMS modules
  //   derive step due dates in TypeScript rather than storing them — so this mail
  //   used to be able to count Task Management and nothing else, and said so.
  //   That is no longer the arrangement: the `work-snapshot` function runs the
  //   app's real queue logic server-side (supabase/worksnapshot/) and puts the
  //   result in `snapshot.tiles` / `snapshot.sources`. Render those verbatim.
  //
  //   DO NOT compute or adjust a figure in this branch. The one job here is that
  //   what the reader sees in the mail is what they see on the screen; arithmetic
  //   done at render time is how those two drifted apart the first three times.
  //   `snapshot.uncounted` names any module not yet wired — say it, never fold it
  //   into a total, because someone reading "0" will think they are clear.
  if (row.kind === "user_snapshot_daily") {
    const p = (row.payload ?? {}) as Record<string, unknown>;
    const snap = (p.snapshot ?? {}) as Record<string, unknown>;
    const str = (v: unknown, d = "") => (typeof v === "string" && v ? v : d);
    const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);

    const u = (snap.user ?? {}) as Record<string, unknown>;
    const tl = (snap.tiles ?? {}) as Record<string, unknown>;
    const sources = (Array.isArray(snap.sources) ? snap.sources : []) as Record<string, unknown>[];
    const modules = (Array.isArray(snap.modules) ? snap.modules : []) as Record<string, unknown>[];

    const dateLabel = ddmmyyyy(str(p.for_date));
    const firstName = str(u.name, "there").split(/\s+/)[0];
    const RED = "#D64545";
    const AMBER = "#B7791F";

    // The four tiles of My Work Today, already bucketed by the same code that
    // buckets the screen (shared/lib/dueBuckets.ts). Read, do not recompute.
    const overdue = num(tl.overdue);
    const dueToday = num(tl.dueToday);
    const next2 = num(tl.next2);
    const noDate = num(tl.noDate);

    const tile = (label: string, value: string, color: string, sub = "") => `
      <td width="25%" style="padding:0 3px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE};border:1px solid ${LINE};border-radius:11px;">
          <tr><td align="center" style="padding:12px 4px;font-family:${FONT};">
            <div style="font-size:23px;font-weight:800;color:${color};line-height:1.1;">${esc(value)}</div>
            <div style="font-size:10px;letter-spacing:.5px;text-transform:uppercase;color:${GREY2};font-weight:700;margin-top:4px;">${esc(label)}</div>
            ${sub ? `<div style="font-size:10px;color:${GREY2};font-weight:400;margin-top:2px;">${esc(sub)}</div>` : ""}
          </td></tr>
        </table>
      </td>`;

    /**
     * The four tiles, in the screen's order and with the screen's labels
     * (MyWorkToday.tsx:90-95). They were suppressed while this mail could only
     * count one module — a tile reading "6 overdue" beside a dashboard reading
     * "11 overdue" is worse than no tile, because the reader trusts whichever
     * they saw last. Now that every wired module is counted by the screen's own
     * code, the same four numbers are the same four numbers.
     *
     * ⚠ Only restore a tile when the payload genuinely covers every module the
     * reader holds. If `snapshot.uncounted` is ever non-empty these totals are a
     * floor, not a total — which is exactly what the note below the table says.
     */
    const tiles = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;"><tr>
      ${tile("Overdue", String(overdue), overdue > 0 ? RED : GREY, "Past its due date")}
      ${tile("Due today", String(dueToday), dueToday > 0 ? AMBER : GREY, "Needs closing today")}
      ${tile("Next 2 days", String(next2), next2 > 0 ? NAVY : GREY, "Tomorrow + day after")}
      ${tile("No date set", String(noDate), noDate > 0 ? GREY : GREY, "Untimed work")}
    </tr></table>`;

    const th2 = (label: string, align = "right") =>
      `<td align="${align}" style="padding:0 6px 7px;font-family:${FONT};font-size:10px;letter-spacing:.7px;text-transform:uppercase;color:${GREY2};font-weight:700;">${esc(label)}</td>`;

    // The "My work" strip from My Control Center: one line per source, with how
    // many items and how many are late.
    //
    // ⚠ NOT the individual rows. A mail listing forty tasks buries the one
    //   number that decides whether to open the screen at all, and the screen
    //   itself groups rather than lists for the same reason.
    const totalItems = num(snap.total_items);
    const sourceRows = sources.map((s) => `<tr>
        <td style="padding:10px;border-top:1px solid ${LINE};font-family:${FONT};font-size:13.5px;font-weight:700;color:${NAVY};">${esc(str(s.module, "Unnamed module"))}</td>
        <td align="right" style="padding:10px 6px;border-top:1px solid ${LINE};font-family:${FONT};font-size:13px;color:${NAVY};white-space:nowrap;">${num(s.items)} item${num(s.items) === 1 ? "" : "s"}</td>
        <td align="right" style="padding:10px;border-top:1px solid ${LINE};font-family:${FONT};white-space:nowrap;">${
          num(s.overdue) > 0
            ? `<span style="display:inline-block;background:#FDECEC;color:${RED};font-size:11px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;padding:3px 10px;border-radius:999px;">${num(s.overdue)} overdue</span>`
            : `<span style="color:${GREY2};font-size:12px;">none overdue</span>`
        }</td>
      </tr>`).join("");

    // Every module the person holds that work-snapshot cannot count YET. Named,
    // not hidden: "your other modules aren't zero, I just can't see them from
    // here." Worked out server-side against the covered list, so this branch
    // cannot get it wrong by disagreeing about a label.
    const uncounted = (Array.isArray(snap.uncounted) ? snap.uncounted : [])
      .map((m) => str((m as Record<string, unknown>)?.label))
      .filter(Boolean);

    const taskTable = sources.length
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 6px;">
          <tr>${th2("My work", "left")}${th2("")}${th2("")}</tr>
          ${sourceRows}
        </table>
        <div style="font-family:${FONT};font-size:11.5px;color:${GREY2};margin:0 0 14px;">${esc(String(totalItems))} items in total.</div>`
      : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;"><tr>
          <td style="background:#E8F5EC;border-radius:10px;padding:14px 16px;font-family:${FONT};font-size:14px;color:#0F7A45;">
            <b>Nothing open.</b> No work is assigned to you right now.
          </td></tr></table>`;

    // Their own modules, and when they last USED each one. Not a scolding: an
    // untouched module is usually a grant nobody needed, which is worth seeing.
    //
    // ⚠ "USED", NOT "OPENED", AND THE DIFFERENCE IS NOT COSMETIC. This column
    //   first shipped reading `module_visits` alone — page opens — and reported
    //   Never for every module, for everybody, because the shell that writes that
    //   table is not live yet. One user saw nine Nevers on a morning she had
    //   already logged 706 task actions. It now reads the later of her last
    //   activity-log entry and her last recorded visit (public.user_module_usage),
    //   so the label has to say what is actually being measured.
    //
    // "Never" rather than "not opened yet": the latter implies a counter that has
    // only just started and will fill in shortly, which is a promise this mail
    // cannot keep.
    const moduleRows = modules.map((m) => {
      const last = str(m.last_opened_at);
      return `<tr>
        <td style="padding:7px 10px;border-top:1px solid ${LINE};font-family:${FONT};font-size:12.5px;color:${NAVY};">${esc(str(m.label, str(m.app_id)))}</td>
        <td align="right" style="padding:7px 10px;border-top:1px solid ${LINE};font-family:${FONT};font-size:12px;white-space:nowrap;color:${last ? GREY : GREY2};">${
          last ? esc(sinceLabel(last)) : "No activity recorded"
        }</td>
      </tr>`;
    }).join("");

    const moduleTable = modules.length
      ? `<div style="border-top:1px solid ${LINE};margin:22px 0 0;padding-top:18px;">
          <div style="font-family:${FONT};font-size:11px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;color:${ORANGE};margin-bottom:8px;">Your modules</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;">
            <tr>${th2("Module", "left")}${th2("You last used")}</tr>
            ${moduleRows}
          </table>
          <div style="font-family:${FONT};font-size:11.5px;line-height:1.6;color:${GREY2};margin:0 0 8px;">
            Counts work you have recorded: a step completed, a row raised, a remark added.
            Time spent only <i>reading</i> a module is not counted yet, so a module you watch daily
            without entering anything will show no activity.
          </div>
        </div>`
      : "";

    /**
     * ⚠ SHOWN ONLY WHEN SOMETHING IS ACTUALLY MISSING.
     *
     * This box used to open with "these are the same figures as My Control
     * Center" on every mail. It was true, and it was removed anyway: a daily
     * reassurance that nothing is wrong is noise on the 364 days nothing is
     * wrong, and it trains the reader to skip the one paragraph that will
     * matter on the day a module drops out of the count.
     *
     * So the box appears only with a real exception in it. Do not put a
     * standing sentence back here.
     */
    const scopeNote = uncounted.length
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 0;"><tr>
      <td style="background:${PAGE};border:1px solid ${LINE};border-radius:10px;padding:13px 15px;font-family:${FONT};font-size:12px;line-height:1.6;color:${GREY};">
        ${esc(uncounted.join(", "))} ${uncounted.length === 1 ? "is" : "are"} <b>not counted here yet</b>, so the totals on My Control Center will be higher than these.
      </td></tr></table>`
      : "";

    const note = str(p.body) ? noteBox("Message", str(p.body)) : "";
    const link = APP_BASE_URL ? `${APP_BASE_URL}/home` : "";
    // The dashboard's own sentence: "N things to deal with today" is
    // delayed + today (MyWorkToday.tsx:298). It was scoped to Task Management
    // while that was all this mail could count; it is unscoped now because the
    // count behind it is the same count.
    const pending = overdue + dueToday;
    const headline = totalItems === 0
      ? "Nothing open on your plate"
      : pending > 0
        ? `${pending} thing${pending === 1 ? "" : "s"} to deal with today`
        : `Nothing late. ${totalItems} item${totalItems === 1 ? "" : "s"} open`;

    return {
      // ⚠ NO EM DASHES ANYWHERE IN THIS BRANCH — subject, headline, tables or
      //   footnotes. Asked for explicitly. Use a comma, a full stop or a middot.
      subject: str(p.subject as string,
        `Your Orange One snapshot${dateLabel ? `, ${dateLabel}` : ""}`),
      html: emailShell({
        eyebrow: `Good morning, ${firstName}`,
        headline,
        inner: tiles + taskTable + note + moduleTable + scopeNote
          + cta(link, "Open My Control Center"),
        tag: "My Snapshot",
        width: 720,
        footer: `<b style="color:${GREY};">Orange One Hub</b> &middot; your personal daily snapshot.<br>You are receiving this because you have a login. Overdue counts tasks past their due date as of today, India time.`,
      }),
      text: `Your Orange One snapshot${dateLabel ? `, ${dateLabel}` : ""}\n\n`
        + `Overdue ${overdue} | Due today ${dueToday} | Next 2 days ${next2} | No date ${noDate}\n\n`
        + (sources.length
            ? sources.map((s) =>
                `- ${str(s.module)}: ${num(s.items)} items, ${num(s.overdue)} overdue`).join("\n")
              + `\n${totalItems} items in total.`
            : "Nothing open.")
        + (uncounted.length
            ? `\n\nNot counted here yet: ${uncounted.join(", ")}. Open the dashboard for those.`
            : "")
        + `${link ? `\nOpen: ${link}` : ""}`,
      files: [],
    };
  }

  // Shared FMS renderer — payload-driven, used by every purchase-family FMS
  // (Import, RM Domestic/procurement, …). The store authors subject/eyebrow/
  // headline/rows/items/note/ctaPath; only the tag + footer wording vary by app.
  if (row.kind.startsWith("import_") || row.kind.startsWith("procurement_") || row.kind.startsWith("sampling_") || row.kind.startsWith("office-supplies_") || row.kind.startsWith("production-entry_") || row.kind.startsWith("order-to-dispatch_") || row.kind.startsWith("asset-maintenance_") || row.kind.startsWith("hr-recruitment_") || row.kind.startsWith("hr-exit_")) {
    const isProc = row.kind.startsWith("procurement_");
    const isSampling = row.kind.startsWith("sampling_");
    // ⚠ "office-supplies_" is the FROZEN outbox prefix, not the app's name. The
    //   module is shown as General Purchase since 29-07-2026; the kind lives in
    //   live email_outbox rows, so it never moves.
    const isSupplies = row.kind.startsWith("office-supplies_");
    const isProduction = row.kind.startsWith("production-entry_");
    const isDispatch = row.kind.startsWith("order-to-dispatch_");
    // Asset Maintenance is the only sender here whose alerts originate from
    // pg_cron rather than from a person, so `actor_id` is often NULL — the shell
    // already renders no actor row in that case, which is the correct reading:
    // the reminder is from the system, not from a colleague.
    const isAsset = row.kind.startsWith("asset-maintenance_");
    // The two HR apps enqueue master-request events ONLY (migrations 20260814120000 /
    // 20260814120100), so anything arriving under these prefixes is master-data
    // governance — not a step alert. The footer wording below accounts for that.
    const isHr = row.kind.startsWith("hr-recruitment_");
    const isExit = row.kind.startsWith("hr-exit_");
    const appLabel = isExit ? "Employee Exit" : isHr ? "New Recruitment" : isAsset ? "Asset Maintenance" : isDispatch ? "Order to Dispatch" : isProduction ? "Production Entry" : isSupplies ? "General Purchase" : isSampling ? "Sampling" : isProc ? "RM Domestic" : "Import";
    const basePath = isExit ? "/hr-exit" : isHr ? "/hr-recruitment" : isAsset ? "/asset-maintenance" : isDispatch ? "/order-to-dispatch" : isProduction ? "/production-entry" : isSupplies ? "/general-purchase" : isSampling ? "/sampling" : isProc ? "/procurement" : "/import";
    const tag = isExit ? "HR · Employee Exit" : isHr ? "HR · New Recruitment" : isAsset ? "Asset Maintenance" : isDispatch ? "Order to Dispatch" : isProduction ? "Production Entry" : isSupplies ? "General Purchase" : isSampling ? "Ink / RM Sampling" : isProc ? "Purchase · RM Domestic" : "Purchase · Import";
    const p = (row.payload ?? {}) as Record<string, unknown>;
    const str = (v: unknown, d = "") => (typeof v === "string" && v ? v : d);
    const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
    const headline = str(p.headline, str(p.text, `${appLabel} update`));
    const eyebrow = str(p.eyebrow, appLabel);
    const ctaPath = str(p.ctaPath, basePath);
    const link = APP_BASE_URL ? `${APP_BASE_URL}${ctaPath}` : "";
    const note = (p.note && typeof p.note === "object") ? (p.note as { label?: string; text?: string }) : null;
    const inner =
      actorRow(actorName, str(p.action, `updated a ${appLabel} document`)) +
      (p.docLabel ? docChip(str(p.docLabel)) : "") +
      detailRows(arr(p.rows)) +
      itemList(arr(p.items)) +
      (note && note.text ? noteBox(str(note.label, "Note"), str(note.text)) : "") +
      cta(link, str(p.ctaLabel, `Open in ${appLabel}`));
    return {
      subject: str(p.subject, `${eyebrow}: ${headline}`),
      html: emailShell({
        eyebrow, headline, inner,
        tag,
        footer: `<b style="color:${GREY};">Orange One Hub</b> &middot; automated ${appLabel} notification.<br>${
          isHr || isExit
            ? `You're receiving this because you own this master, or you raised the request.`
            : `You're receiving this because you're the next actor on this ${appLabel} document.`
        } Replies reach the person who acted.`,
      }),
      text: `${actorName}: ${headline}${p.docLabel ? `\n${str(p.docLabel)}` : ""}\n\nOpen: ${link}`,
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
    // Files are fetched here, not in compose(), so a storage hiccup is a retryable
    // send failure rather than an "unknown kind" skip.
    const { attachments, html, text } = await resolveAttachments(c);
    await gmailSend(token, buildRaw(row.to_email, c.replyTo, c.subject, text, html, attachments));
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
