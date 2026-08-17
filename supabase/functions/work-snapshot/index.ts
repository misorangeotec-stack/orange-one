// work-snapshot — computes what one person actually owes, using the portal's OWN
// queue logic, and queues the daily personal snapshot mail.
//
// WHY IT EXISTS
//   My Work Today builds its numbers in the browser: every FMS step's due date is
//   derived in TypeScript from working-day SLAs and never stored, so SQL cannot
//   see it. The snapshot mail could therefore only count Task Management, and it
//   kept disagreeing with the screen. `_shared/workSnapshot.bundle.js` is the
//   screen's real logic compiled for Deno (built by supabase/worksnapshot/build.mjs);
//   this function runs it.
//
// HOW IT IS CALLED
//   * { userId }            → returns that person's snapshot as JSON. Used by the
//                             admin preview and for checking a figure against a
//                             real screen. Caller must be that user or an admin.
//   * { enqueue: true }     → computes for every eligible user and writes
//                             email_outbox rows. pg_cron POSTs this once a day.
//   Both accept an `x-dispatch-secret` header (EMAIL_DISPATCH_SECRET) as the
//   server path, matching send-email. Deploy with --no-verify-jwt.
//
// ⚠ DATA LOADED ONCE, FILTERED PER PERSON. The bundle reads with the service-role
//   key, so row-level security does NOT narrow it — the ownership filters inside
//   the bundle are the only thing standing between one user and everyone's work.
//   Never return `Datasets` to a caller; only ever the computed snapshot.
//
// ⚠ THIS RUNTIME IS UTC AND CANNOT BE MOVED. A `TZ` secret has no effect and
//   `Deno.env.set` throws NotSupported — both tried here. Every due date in this
//   system is a LOCAL calendar day, so the clock is corrected inside the bundle
//   (supabase/worksnapshot/istWorkingDays.ts) rather than by the environment.
//   assertIstClock() checks that correction is live before any figure is emitted;
//   POST { clock: true } reports it.

import { istToday, resolvedTz } from "../_shared/istClock.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  COVERED_APP_IDS,
  DELIBERATELY_UNCOVERED,
  assertIstClock,
  computeSnapshot,
  loadDatasets,
  todayIso,
} from "../_shared/workSnapshot.bundle.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-dispatch-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const DISPATCH_SECRET = Deno.env.get("EMAIL_DISPATCH_SECRET") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

interface Person {
  id: string;
  name: string;
  email: string | null;
  isAdmin: boolean;
  appIds: string[];
}

/**
 * Who exists, who is an admin, and what each person can open.
 *
 * `hasModule` in the browser is `isAdmin || moduleAccess.includes(appId)`
 * (core/platform/session.tsx). An admin therefore holds every module, which is why
 * their app list is filled in rather than read from `app_access` — admins usually
 * hold no grants at all.
 */
async function loadPeople(): Promise<Person[]> {
  const [profiles, roles, access] = await Promise.all([
    admin.from("profiles").select("id,name,email"),
    admin.from("user_roles").select("user_id,role"),
    admin.from("app_access").select("user_id,app_id"),
  ]);
  for (const r of [profiles, roles, access]) {
    if (r.error) throw new Error(r.error.message);
  }

  const adminIds = new Set(
    (roles.data ?? []).filter((r) => String(r.role) === "admin").map((r) => r.user_id as string),
  );
  const byUser = new Map<string, string[]>();
  for (const a of access.data ?? []) {
    const list = byUser.get(a.user_id as string) ?? [];
    list.push(a.app_id as string);
    byUser.set(a.user_id as string, list);
  }

  return (profiles.data ?? []).map((p) => {
    const isAdmin = adminIds.has(p.id as string);
    return {
      id: p.id as string,
      name: (p.name as string) ?? "",
      email: (p.email as string) ?? null,
      isAdmin,
      appIds: isAdmin ? [...COVERED_APP_IDS] : byUser.get(p.id as string) ?? [],
    };
  });
}

/** Only the modules this build can actually count, and only ones they hold. */
const countableFor = (p: Person): string[] =>
  COVERED_APP_IDS.filter((id: string) => p.appIds.includes(id));

/**
 * One person's snapshot, merged with what SQL already answers well — their profile
 * and their module list with their own open counts (public.user_snapshot).
 * `sources` is REPLACED by the computed one: SQL's version only ever knew about
 * Task Management, and two arrays under one name is how the mail drifted before.
 */
async function snapshotFor(person: Person, data: unknown) {
  const computed = computeSnapshot(data, person.id, person.isAdmin, countableFor(person));

  const { data: sqlSnap, error } = await admin.rpc("user_snapshot", { p_user_id: person.id });
  if (error) throw new Error(`user_snapshot(${person.id}): ${error.message}`);

  const base = (sqlSnap ?? {}) as Record<string, unknown>;
  const modules = (Array.isArray(base.modules) ? base.modules : []) as Record<string, unknown>[];

  /**
   * Modules they hold that produce work but this build cannot count. Named out
   * loud rather than folded into a total: an under-reported number that looks
   * complete is worse than a smaller report saying what it left out.
   *
   * ⚠ ONLY WORK SOURCES COUNT AS MISSING. The first version listed every module
   *   not wired here, which swept in New Customer Onboarding and Outstanding
   *   Dashboard — neither of which is on My Work Today either, because neither
   *   has a queue of things owed by a person. Saying "not counted" about those
   *   invents a gap: the mail's totals and the screen's totals already agree.
   *   With every provider now wired, this is empty, and the note disappears.
   */
  const missing = new Set(Object.keys(DELIBERATELY_UNCOVERED));
  const uncounted = modules
    .map((m) => ({ appId: String(m.app_id ?? ""), label: String(m.label ?? m.app_id ?? "") }))
    .filter((m) => missing.has(m.appId));

  return {
    generated_at: new Date().toISOString(),
    for_date: computed.forDate,
    user: base.user ?? { id: person.id, name: person.name, email: person.email },
    modules,
    tiles: computed.tiles,
    total_items: computed.totalItems,
    sources: computed.sources,
    items: computed.items,
    covered_app_ids: computed.coveredAppIds,
    uncounted,
    // Kept as a cross-check: SQL's own Task Management count. If this ever
    // disagrees with the "tasks" source row, one of the two filters has drifted.
    tasks_sql: base.tasks ?? null,
  };
}

// ── the subject line ──────────────────────────────────────────────────────────

/**
 * What this mail is about TODAY, in the order that matters.
 *
 * A daily mail lives or dies in the inbox list. A subject that reads the same
 * every morning ("Your work today") tells the reader nothing until they open it,
 * which is how a daily report stops being opened. So the subject leads with the
 * single most pressing fact and changes when that fact changes.
 *
 * ⚠ IT MUST BE ABLE TO SAY NOTHING IS WRONG. "0 overdue" every morning trains
 *   people to see a number and feel behind; "You're clear today" is a different
 *   message and is worth sending. The empty case is the whole reason this is
 *   adaptive rather than a template with counts poured into it.
 *
 * ⚠ EVERY FIGURE COMES FROM THE SNAPSHOT. Do not compute one here — the subject
 *   and the tiles disagreeing would be the same failure as the mail and the
 *   screen disagreeing, just smaller and harder to spot.
 */
function subjectFor(snapshot: {
  for_date: string;
  total_items: number;
  tiles: { overdue: number; dueToday: number };
}): string {
  const { overdue, dueToday } = snapshot.tiles;
  // "17 Aug" — short enough to survive an inbox column, unambiguous in a thread.
  const day = new Date(`${snapshot.for_date}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", timeZone: "UTC",
  });

  // ⚠ NO EM DASHES. Asked for explicitly, subject and body alike. Commas and
  //   full stops only — and the same rule applies in send-email's renderer.
  if (overdue > 0) {
    const tail = dueToday > 0 ? `, ${dueToday} due today` : "";
    return `${overdue} overdue${tail}. Your work today, ${day}`;
  }
  if (dueToday > 0) {
    return `${dueToday} due today. Your work, ${day}`;
  }
  if (snapshot.total_items > 0) {
    return `Nothing late. ${snapshot.total_items} open today, ${day}`;
  }
  return `You're clear today, ${day}`;
}

// ── modes ─────────────────────────────────────────────────────────────────────

/**
 * One person's snapshot. With `sendTo`, it is also mailed there — the test-send
 * behind the admin screen, and the only way to read the real thing without
 * waiting for 9 AM or borrowing someone's inbox.
 *
 * ⚠ `sendTo` addresses the mail elsewhere but the CONTENT is still that person's
 * work, so the same admin-or-self check gates it. Do not relax that into "any
 * signed-in user may preview any user".
 */
async function preview(userId: string, sendTo: string | null) {
  const people = await loadPeople();
  const person = people.find((p) => p.id === userId);
  if (!person) return json(404, { error: "no such user" });

  const data = await loadDatasets(countableFor(person));
  const snapshot = await snapshotFor(person, data);

  let queued = false;
  if (sendTo) {
    const { error } = await admin.from("email_outbox").insert({
      kind: "user_snapshot_daily",
      // Deliberately NOT to_user_id: this is a test copy, and stamping it with the
      // subject's id would make the daily run think they had already been mailed.
      to_email: sendTo,
      to_name: person.name,
      // The REAL subject with a [Test] prefix, not a subject of its own — a
      // preview that does not preview the subject line is missing the half of
      // the mail that decides whether it gets opened.
      subject: `[Test] ${subjectFor(snapshot)}`,
      // ⚠ NO `body`. It renders as a MESSAGE box inside the mail, which reads as
      // a note to the recipient rather than as a test marker — and it says
      // something only the sender needs to know. The [Test] in the subject line
      // is where that belongs; the body of the mail must look exactly like the
      // real thing, or a preview is not previewing anything.
      payload: {
        snapshot,
        for_date: snapshot.for_date,
        subject: `[Test] ${subjectFor(snapshot)}`,
      },
    });
    if (error) return json(500, { error: error.message });
    queued = true;
  }

  return json(200, { snapshot, queued });
}

/**
 * The daily run: compute for everyone eligible and queue their mail.
 *
 * `dryRun` does everything except the insert and reports exactly who WOULD be
 * mailed, with their figures and subject lines. It exists because the only other
 * way to prove this path works is to mail forty real people — so the automated
 * path would otherwise stay untested until the morning it ran for real. The two
 * switches are still honoured in a dry run: "it would have sent nothing because
 * the feature is off" is the answer, not something to skip past.
 */
async function enqueue(forDate: string | null, dryRun: boolean) {
  const [{ data: settings, error: sErr }, { data: gate, error: gErr }] = await Promise.all([
    admin.from("user_snapshot_settings").select("*").eq("id", true).maybeSingle(),
    admin.rpc("email_module_enabled", { p_module: "user-snapshot" }),
  ]);
  if (sErr) throw new Error(sErr.message);
  if (gErr) throw new Error(gErr.message);

  // A dry run reports the gates rather than obeying them — the point is to see
  // what the morning would produce, including on a day the feature is still off.
  if (!settings?.enabled && !dryRun) {
    return json(200, { queued: 0, reason: "user snapshot is switched off" });
  }
  if (gate !== true && !dryRun) {
    return json(200, { queued: 0, reason: "email module 'user-snapshot' is off" });
  }

  const date = forDate ?? todayIso();
  const include: string[] | null = settings?.include_users ?? null;
  const skipWhenEmpty: boolean = settings?.skip_when_empty ?? true;

  // Idempotent by (user, date): re-running the cron, or a manual retry, must not
  // mail anyone twice.
  const { data: already, error: aErr } = await admin
    .from("email_outbox")
    .select("to_user_id")
    .eq("kind", "user_snapshot_daily")
    .contains("payload", { for_date: date });
  if (aErr) throw new Error(aErr.message);
  const sent = new Set((already ?? []).map((r) => r.to_user_id as string));

  const people = (await loadPeople()).filter(
    (p) =>
      !!p.email &&
      !sent.has(p.id) &&
      (!include || include.includes(p.id)) &&
      countableFor(p).length > 0,
  );

  // One pass over the data for everybody — the reason this is a function and not
  // a per-user query. Forty people across three modules is three reads, not 120.
  const needed = [...new Set(people.flatMap(countableFor))];
  const data = await loadDatasets(needed);

  let queued = 0;
  let skipped = 0;
  const would: { name: string; email: string | null; subject: string; items: number }[] = [];

  for (const person of people) {
    const snapshot = await snapshotFor(person, data);
    if (skipWhenEmpty && snapshot.total_items === 0) {
      skipped++;
      continue;
    }
    const subject = subjectFor(snapshot);

    if (dryRun) {
      would.push({ name: person.name, email: person.email, subject, items: snapshot.total_items });
      continue;
    }

    const { error } = await admin.from("email_outbox").insert({
      kind: "user_snapshot_daily",
      to_user_id: person.id,
      to_email: person.email,
      to_name: person.name,
      // ⚠ Same function the test send uses. Two subject lines built two ways is
      // how a preview stops previewing.
      subject,
      // ⚠ AND IN THE PAYLOAD, WHICH IS THE ONE THAT REACHES THE READER.
      //   send-email NEVER reads `email_outbox.subject` — it renders from the
      //   payload and falls back to a generic line when `payload.subject` is
      //   missing. Setting the column alone looked completely correct in the
      //   database and shipped five people a mail headed "Your Orange One
      //   snapshot" instead of "23 overdue, 14 due today". The test send always
      //   set payload.subject, so the two paths disagreed exactly where nothing
      //   was checking. Set both, always.
      payload: { snapshot, for_date: date, subject },
    });
    if (error) throw new Error(`queue ${person.id}: ${error.message}`);
    queued++;
  }

  return json(200, {
    dryRun,
    queued,
    skipped,
    for_date: date,
    modules: needed,
    ...(dryRun
      ? {
          wouldSend: would.length,
          gates: { enabled: settings?.enabled === true, emailModule: gate === true },
          recipients: would,
        }
      : {}),
  });
}

// ── handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    // Diagnostic door: what clock is this actually running on, and did setting it
    // fail? Cheaper than a throwaway probe function, and it stays useful.
    if (body.clock === true) {
      return json(200, {
        runtimeTz: resolvedTz(), // expected "UTC": the correction lives in the bundle
        istToday: istToday(),
        bundleToday: todayIso(),
      });
    }

    assertIstClock();
    const server =
      !!DISPATCH_SECRET && req.headers.get("x-dispatch-secret") === DISPATCH_SECRET;

    if (body.enqueue === true) {
      if (!server) return json(401, { error: "enqueue requires the dispatch secret" });
      return await enqueue(
        typeof body.forDate === "string" ? body.forDate : null,
        body.dryRun === true,
      );
    }

    const userId = typeof body.userId === "string" ? body.userId : "";
    if (!userId) return json(400, { error: "pass { userId } or { enqueue: true }" });

    if (!server) {
      // Yourself or an admin. The raw datasets never leave this function, but a
      // computed snapshot is still someone's private workload.
      const authHeader = req.headers.get("Authorization") ?? "";
      if (!authHeader) return json(401, { error: "sign in first" });
      const caller = createClient(SUPABASE_URL, ANON, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      });
      const { data: who } = await caller.auth.getUser();
      const callerId = who?.user?.id ?? "";
      if (!callerId) return json(401, { error: "sign in first" });
      if (callerId !== userId) {
        const { data: isAdmin } = await admin.rpc("is_admin", { _user_id: callerId });
        if (isAdmin !== true) return json(403, { error: "admins only" });
      }
    }

    const sendTo = typeof body.sendTo === "string" && body.sendTo.includes("@") ? body.sendTo : null;
    return await preview(userId, sendTo);
  } catch (e) {
    return json(500, { error: String((e as Error)?.message ?? e) });
  }
});
