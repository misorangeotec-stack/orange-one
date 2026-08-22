/**
 * reportEmail.ts — mail a generated report, with the files attached.
 *
 * THE ROUTE THE BYTES TAKE
 *   browser builds PDF + XLSX
 *     -> uploads both to storage `report-exports/<uid>/<batch>/`
 *     -> calls rpc queue_report_email(...) which inserts ONE email_outbox row per recipient
 *     -> an AFTER INSERT trigger pings the send-email Edge Function
 *     -> that function downloads the files with the service role and attaches them.
 *
 * WHY IT IS NOT JUST "POST THE FILE TO THE FUNCTION"
 *   `send-email` is deployed --no-verify-jwt and gated by a shared dispatch secret, so the
 *   browser must never call it — holding that secret client-side would let anyone send mail as
 *   support@orangeotec.com. And `email_outbox` has RLS on with no policies, so a client cannot
 *   insert either. The SECURITY DEFINER RPC is the only door, and it re-checks Reports access,
 *   the module switch, and that every attachment path belongs to the caller.
 *
 * WHAT CAN STILL GO WRONG, AND WHAT IT LOOKS LIKE
 *   The RPC raises (rather than returning quietly) when that REPORT's switch is off, so the UI can
 *   tell an admin exactly which report to turn on. Queuing succeeding is NOT delivery: the row goes
 *   out via Gmail moments later, or sits in email_outbox with `status` and `last_error` saying why.
 *
 * ── THE SWITCH IS PER REPORT, NOT PER MODULE ────────────────────────────────────────
 * `report_email_settings` is keyed on the reportCatalog id — the same id that decides who may
 * OPEN the report (profiles.receivables_allowed_reports). One vocabulary for both questions, so
 * the access screen and the emailing screen cannot drift apart. No row means off, so a report
 * added tomorrow mails nobody until an admin says so.
 */

import { supabase } from "@/core/platform/supabase";

export const REPORT_EXPORTS_BUCKET = "report-exports";

export interface OutgoingFile {
  blob: Blob;
  filename: string;
}

export interface ReportRecipient {
  email: string;
  name?: string;
}

export interface QueueReportEmailInput {
  /** The reportCatalog id this mail carries, e.g. "zero-collections". Gates the send. */
  reportKey: string;
  recipients: ReportRecipient[];
  subject: string;
  headline: string;
  body: string;
  files: OutgoingFile[];
}

const mimeOf = (filename: string): string =>
  filename.endsWith(".pdf")
    ? "application/pdf"
    : filename.endsWith(".xlsx")
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : filename.endsWith(".zip")
        ? "application/zip"
        : "application/octet-stream";

/** Storage keys must be ASCII-safe; the display filename keeps the original text. */
const storageSafe = (name: string) => name.replace(/[^A-Za-z0-9._-]+/g, "_");

/**
 * Upload one batch of files and queue one mail per recipient.
 *
 * The files are uploaded ONCE and shared by every recipient's row — the sender resolves paths at
 * send time, so mailing eight salespeople the same pair does not upload it eight times.
 *
 * Returns the queued outbox ids. Throws with a readable message on the first failure; the caller
 * surfaces it. Partial success is possible (some rows queued, then a raise) and is reported as
 * such rather than rolled back: a queued mail has already been handed to the sender.
 */
export async function queueReportEmail(input: QueueReportEmailInput): Promise<string[]> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("You are not signed in.");
  if (!input.recipients.length) throw new Error("Add at least one recipient.");
  if (!input.files.length) throw new Error("Nothing to attach.");

  // One folder per send, so a retry never collides with the previous attempt and the
  // per-user prefix the storage policy enforces stays the first segment.
  const batch = crypto.randomUUID();
  const attachments: { path: string; filename: string; mime: string }[] = [];

  for (const f of input.files) {
    const path = `${uid}/${batch}/${storageSafe(f.filename)}`;
    const mime = mimeOf(f.filename);
    const { error } = await supabase.storage
      .from(REPORT_EXPORTS_BUCKET)
      .upload(path, f.blob, { contentType: mime, upsert: false });
    if (error) throw new Error(`Could not upload ${f.filename}: ${error.message}`);
    attachments.push({ path, filename: f.filename, mime });
  }

  const ids: string[] = [];
  for (const r of input.recipients) {
    const { data, error } = await supabase.rpc("queue_report_email", {
      p_report_key: input.reportKey,
      p_to_email: r.email,
      p_to_name: r.name ?? null,
      p_subject: input.subject,
      p_headline: input.headline,
      p_body: input.body,
      p_attachments: attachments,
    });
    if (error) {
      // The RPC raises a plain sentence for the cases a user can act on (not signed in, no
      // Reports access, this report's emailing switched off), so pass it through rather than
      // wrapping it in something vaguer.
      throw new Error(error.message);
    }
    if (typeof data === "string") ids.push(data);
  }
  return ids;
}

/**
 * Every report's email switch, as `{ [reportKey]: enabled }`.
 *
 * Reports with no row are simply absent, which reads as off everywhere — the same polarity as
 * the report grants. Callers should use `?? false` rather than treating a missing key as unknown.
 */
export async function fetchReportEmailSettings(): Promise<Record<string, boolean>> {
  const { data, error } = await supabase
    .from("report_email_settings")
    .select("report_key, enabled");
  if (error) throw new Error(error.message);
  const out: Record<string, boolean> = {};
  for (const r of data ?? []) out[r.report_key] = r.enabled;
  return out;
}

/** Admin-only write. The RPC re-checks is_admin, so this is a convenience, not the control. */
export async function setReportEmailEnabled(reportKey: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_report_email_enabled", {
    p_report_key: reportKey,
    p_enabled: enabled,
  });
  if (error) throw new Error(error.message);
}

// ── When it goes out, and to whom ───────────────────────────────────────────────────
//
// ⚠ NOTHING READS EITHER OF THESE YET (RC-2). The job that would send on a schedule does not exist:
//   the report is built in the browser, so there is nothing for a scheduler to call at 08:00.
//   These are stored so the distribution list can be set up and CHECKED — particularly that
//   every salesperson resolves to a real address — before anything is capable of posting it.

export type ReportEmailFrequency = "off" | "daily" | "weekly" | "monthly";

export interface ReportEmailSchedule {
  frequency: ReportEmailFrequency;
  /**
   * The days a weekly schedule fires on, 0 = Sunday, sorted. Only meaningful when frequency is
   * "weekly", and never empty when it is.
   *
   * A SET rather than one day, so "every Tuesday and Saturday" is expressible — the rhythm the
   * collection report is actually wanted on. The database keeps its older single `day_of_week`
   * column in step with the first of these; nothing here writes it directly.
   */
  daysOfWeek: number[];
  /** 1..28. Only meaningful when frequency is "monthly". */
  dayOfMonth: number | null;
  /** IST, as typed. The scheduler converts to UTC; the screen never has to. */
  hourIst: number;
  minuteIst: number;
}

/** What an unscheduled report looks like: paused, at a sensible hour if it is ever started. */
export const NO_SCHEDULE: ReportEmailSchedule = {
  frequency: "off",
  daysOfWeek: [],
  dayOfMonth: null,
  hourIst: 8,
  minuteIst: 0,
};

/**
 * One line of a report's distribution list.
 *
 * `book` carries an address and receives the CONSOLIDATED report. `salesperson` carries a NAME,
 * never an address: who that name reaches is decided at send time from
 * `profiles.receivables_salespersons`, so a rep whose address changes, or who loses the tag,
 * cannot keep receiving a book from a copy frozen here.
 */
export interface ReportRecipientRow {
  scope: "book" | "salesperson";
  email?: string | null;
  name?: string | null;
  salesperson?: string | null;
  enabled: boolean;
}

export async function fetchReportEmailSchedule(reportKey: string): Promise<ReportEmailSchedule> {
  const { data, error } = await supabase
    .from("report_email_schedule")
    .select("frequency, day_of_week, days_of_week, day_of_month, hour_ist, minute_ist")
    .eq("report_key", reportKey)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return NO_SCHEDULE;
  return {
    frequency: data.frequency as ReportEmailFrequency,
    // `days_of_week` is the column to read. The fall back to the older single day covers a row
    // written before migration 20260921120000 by a client that has not reloaded — the migration
    // backfilled the stored rows, but the old RPC overload is still callable.
    daysOfWeek:
      data.days_of_week && data.days_of_week.length
        ? [...data.days_of_week].sort((a, b) => a - b)
        : data.day_of_week !== null && data.day_of_week !== undefined
          ? [data.day_of_week]
          : [],
    dayOfMonth: data.day_of_month,
    hourIst: data.hour_ist,
    minuteIst: data.minute_ist,
  };
}

export async function saveReportEmailSchedule(
  reportKey: string,
  s: ReportEmailSchedule,
): Promise<void> {
  // The int[] overload. The RPC sorts and de-duplicates, and writes the older single-day column
  // as the first of these, so nothing downstream has to know both shapes exist.
  const { error } = await supabase.rpc("set_report_email_schedule", {
    p_report_key: reportKey,
    p_frequency: s.frequency,
    p_days_of_week: s.daysOfWeek,
    p_day_of_month: s.dayOfMonth,
    p_hour_ist: s.hourIst,
    p_minute_ist: s.minuteIst,
  });
  if (error) throw new Error(error.message);
}

export async function fetchReportEmailRecipients(reportKey: string): Promise<ReportRecipientRow[]> {
  const { data, error } = await supabase
    .from("report_email_recipients")
    .select("scope, email, name, salesperson, enabled")
    .eq("report_key", reportKey);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    scope: r.scope as "book" | "salesperson",
    email: r.email,
    name: r.name,
    salesperson: r.salesperson,
    enabled: r.enabled,
  }));
}

/** Replaces the whole list. The screen edits a list and saves a list — see the RPC's comment. */
export async function saveReportEmailRecipients(
  reportKey: string,
  rows: ReportRecipientRow[],
): Promise<void> {
  const { error } = await supabase.rpc("set_report_email_recipients", {
    p_report_key: reportKey,
    // Widened to the generated `Json` shape: an interface has no index signature, so TS will not
    // accept it as JSON directly. The RPC reads the four keys by name and ignores anything else.
    p_recipients: rows.map((r) => ({
      scope: r.scope,
      email: r.email ?? null,
      name: r.name ?? null,
      salesperson: r.salesperson ?? null,
      enabled: r.enabled,
    })),
  });
  if (error) throw new Error(error.message);
}

/* ────────────────────────────────────────────────────────────────────────────────────
 * IS THE SCHEDULE ACTUALLY LIVE?
 *
 * Read from the database, never asserted in the component. The delivery panel used to carry a
 * hard-coded "saved but not yet active" warning, written when the report could only be built in
 * a browser. The runner shipped, the warning did not move, and for a while the screen told an
 * admin their armed, working schedule was inert — the most expensive kind of stale copy, because
 * it invites someone to go looking for a fault that is not there.
 *
 * `collections_report_due()` is the same call the sender makes, so whatever this panel says is by
 * construction what the runner will do at the next tick.
 * ──────────────────────────────────────────────────────────────────────────────────── */

/** Healthy states where "not due" is the correct answer and nothing is wrong. "no schedule is
 *  set" is deliberately NOT here: that one is answered by the form directly below the banner. */
const BENIGN_REASONS = [/^not a send day/i, /^not yet/i, /^already sent/i];

export interface ScheduledSendStatus {
  /** true when the whole chain is armed and a schedule exists — the panel's headline. */
  live: boolean;
  /** The gate's own words, shown as-is when something is switched off. */
  reason: string | null;
  /** Set when the gate is answering "yes" at this very moment. */
  dueNow: boolean;
  /** How many addresses the next send resolves to, when the gate is willing to say. */
  bookCount: number | null;
  repCount: number | null;
  /** Ticked salespeople that no portal user carries — they are built for and reach nobody. */
  unclaimed: string[];
  /** Last slot actually served, from the send log. */
  lastSentFor: string | null;
  lastSentAt: string | null;
}

export async function fetchScheduledSendStatus(reportKey: string): Promise<ScheduledSendStatus> {
  const [gate, log] = await Promise.all([
    supabase.rpc("collections_report_due", { p_report_key: reportKey }),
    supabase
      .from("collections_report_send_log")
      .select("sent_for_date, run_at")
      .eq("report_key", reportKey)
      .order("run_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (gate.error) throw new Error(gate.error.message);

  const g = (gate.data ?? {}) as {
    due?: boolean; reason?: string;
    book?: unknown[]; salespersons?: unknown[]; unclaimed?: string[];
  };
  const reason = g.reason ?? null;

  // "Off" is a reason that names a switch; every other reason is just today's calendar. Anything
  // unrecognised is treated as NOT live, so a future gate condition surfaces rather than hides.
  const live = g.due === true || (!!reason && BENIGN_REASONS.some((r) => r.test(reason)));

  return {
    live,
    reason,
    dueNow: g.due === true,
    bookCount: g.book?.length ?? null,
    repCount: g.salespersons?.length ?? null,
    unclaimed: g.unclaimed ?? [],
    lastSentFor: log.data?.sent_for_date ?? null,
    lastSentAt: log.data?.run_at ?? null,
  };
}
