/**
 * The scheduled Collection report: build it with nobody logged in, and post it.
 *
 * ── WHY THIS RUNS ON A GITHUB RUNNER AND NOT IN AN EDGE FUNCTION ──────────────────────────────
 *   Measured on the live runtime, 20-Aug-2026, with a throwaway function that burned straight-line
 *   CPU: 1 second returns 200; 3 seconds returns 546 WORKER_RESOURCE_LIMIT; 8 seconds with an
 *   `await` every 200 ms returns 546 as well — the CPU budget is CUMULATIVE and yielding does not
 *   reset it. The documented ceiling is 2 seconds per request.
 *
 *   Drawing this report is 37 seconds of solid CPU: 101 pages of hand-drawn vector PDF over ~250
 *   customers, plus a 1.5 MB workbook. That is not a near miss, and the obvious fallback does not
 *   rescue it either — one salesperson's 18-page extract is already over the limit on its own.
 *   So the drawing happens where there is no such cap, on a runner that has the repository checked
 *   out and can therefore run the app's OWN TypeScript rather than a second implementation of it.
 *
 * ── WHAT DECIDES, AND WHAT MERELY OBEYS ───────────────────────────────────────────────────────
 *   This file decides NOTHING about whether to send. `collections_report_due()` in the database
 *   answers "should anything go out right now, and to whom", checking four separate switches, the
 *   schedule, the grace window and the send log. This file asks once and does what it is told.
 *   The rule an admin edits on the settings screen and the rule the sender obeys are then the same
 *   object, and changing it takes effect at the next tick with no deploy.
 *
 *   It decides nothing about the report's CONTENT either: the period and the defaults come from
 *   reportSpec.ts, and every figure from the same modules the screen calls.
 *
 * ── THE THREE MODES ───────────────────────────────────────────────────────────────────────────
 *   MODE=dry-run    build everything, write the files next to the checkout, send NOTHING and
 *                   upload NOTHING. Prints the KPI strip so it can be read against the screen.
 *                   This is the default, because the default must be the harmless one.
 *   MODE=sample     build, upload, and mail to SAMPLE_TO and nobody else. Does NOT mark the slot
 *                   sent. This is how a change is proved before anyone else sees it.
 *   MODE=scheduled  the real thing: ask the database, obey, mail the list, claim the slot.
 *
 * ⚠ A RUN THAT REACHES NOBODY DELIBERATELY DOES NOT CLAIM THE SLOT — see the migration.
 */

import { loadFromConnectwave } from "@hub/lib/connectwaveFetcher";
import { buildCollectionsReportContext } from "@hub/lib/collectionsReportBuild";
import { buildBoth } from "@hub/lib/collectionsExport";
import type { CollectionsExportContext } from "@hub/lib/collectionsExport";
import { supabase } from "./identityServer";
import { REPORT_KEY, buildReportSpec } from "./reportSpec";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const BUCKET = "report-exports";
/** Generated files are transient; anything older than this is cleared at the end of a real run. */
const KEEP_DAYS = 30;

type Mode = "dry-run" | "sample" | "scheduled";
const MODE = (process.env.MODE ?? "dry-run") as Mode;
const SAMPLE_TO = process.env.SAMPLE_TO ?? "";
const OUT_DIR = process.env.OUT_DIR ?? resolve("collections-report-out");

interface Recipient {
  email: string;
  name?: string | null;
  /** Absent on a book recipient; the rep whose extract this is on a salesperson recipient. */
  salesperson?: string | null;
  /**
   * How many salesperson names this person carries — salesperson recipients only.
   *
   * Anything above 1 is an overseer rather than the rep: credit control tagged with thirteen names
   * receives a rep's own book, which is defensible but is NOT what "send each salesperson their
   * figures" sounds like. It is printed on every run for that reason.
   */
  covers?: number | null;
}

interface DueAnswer {
  due: boolean;
  reason?: string;
  forDate?: string;
  slotIst?: string;
  book?: Recipient[];
  salespersons?: Recipient[];
  unclaimed?: string[];
}

const log = (...a: unknown[]) => console.log(...a);
const ms = (t: number) => `${((Date.now() - t) / 1000).toFixed(1)}s`;
/** Storage keys must be ASCII-safe; the display filename keeps the original text. */
const storageSafe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_");
const mimeOf = (f: string) =>
  f.endsWith(".pdf")
    ? "application/pdf"
    : f.endsWith(".xlsx")
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "application/octet-stream";

/**
 * The IST calendar day, computed the same way the database computes it.
 *
 * A runner is UTC. Using its date would label an 08:00 IST send with the previous day and make the
 * send log's key mean something different from what `collections_report_due` put in it.
 */
const istDate = (): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

// ── Asking the database ─────────────────────────────────────────────────────────────
async function askDue(): Promise<DueAnswer> {
  const { data, error } = await supabase.rpc("collections_report_due", {
    p_report_key: REPORT_KEY,
  });
  if (error) throw new Error(`collections_report_due failed: ${error.message}`);
  return data as DueAnswer;
}

// ── Putting the files somewhere the sender can reach them ───────────────────────────
async function upload(
  prefix: string,
  files: { blob: Blob; filename: string }[],
): Promise<{ path: string; filename: string; mime: string }[]> {
  const out: { path: string; filename: string; mime: string }[] = [];
  for (const f of files) {
    const path = `${prefix}/${storageSafe(f.filename)}`;
    const body = Buffer.from(await f.blob.arrayBuffer());
    const mime = mimeOf(f.filename);
    // `upsert: false` deliberately: the prefix already carries a per-run id, so a collision means
    // two runs are writing the same slot and the second should fail loudly rather than overwrite.
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, body, { contentType: mime, upsert: false });
    if (error) throw new Error(`could not upload ${f.filename}: ${error.message}`);
    out.push({ path, filename: f.filename, mime });
  }
  return out;
}

/**
 * One outbox row per recipient.
 *
 * Inserted directly rather than through `queue_report_email`, because that RPC is the BROWSER's
 * door: it requires `auth.uid()`, checks the caller's Reports access, and insists every attachment
 * path begins with the caller's own user id. None of that is meaningful for a server run, and
 * there is no user to be. The checks it performs are performed instead by
 * `collections_report_due()`, which is stricter — it also demands the arming switch and a schedule.
 */
async function enqueue(
  to: Recipient,
  subject: string,
  headline: string,
  body: string,
  attachments: { path: string; filename: string; mime: string }[],
): Promise<string> {
  const { data, error } = await supabase
    .from("email_outbox")
    .insert({
      kind: "receivables_collections_report",
      to_email: to.email,
      to_name: to.name ?? null,
      subject,
      payload: {
        report_key: REPORT_KEY,
        subject,
        headline,
        body,
        bucket: BUCKET,
        attachments,
      },
    })
    .select("id")
    .single();
  if (error) throw new Error(`could not queue mail to ${to.email}: ${error.message}`);
  return data.id as string;
}

// ── The wording, matched to the mail an admin sends by hand ─────────────────────────
// Same shape as EmailReportDialog: "<title> — as on <dd-mm-yyyy>", and the rep's name appended on
// their own copy. A recipient should not be able to tell from the subject line whether a person
// pressed the button or the clock did.
const BOOK_BODY =
  "Please find the current zero-collection position attached: a PDF summary and a detailed workbook.";
const REP_BODY =
  "Please find your customers' collection position attached: a PDF summary and a detailed workbook. " +
  "Please review the overdue accounts and share your action plan.";

// ── Housekeeping ────────────────────────────────────────────────────────────────────
/**
 * Clear generated files older than KEEP_DAYS.
 *
 * They are worth keeping for a while — "what exactly did Saturday's mail contain" is a real
 * question — and worth clearing after that, because nobody asks it about April and the bucket
 * would otherwise grow by a few megabytes every week forever.
 */
async function sweepOldExports(): Promise<number> {
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86400_000);
  const cutoffKey = `${cutoff.getUTCFullYear()}${String(cutoff.getUTCMonth() + 1).padStart(2, "0")}${String(cutoff.getUTCDate()).padStart(2, "0")}`;
  const { data: days, error } = await supabase.storage.from(BUCKET).list("scheduled", { limit: 1000 });
  if (error || !days) return 0;
  let removed = 0;
  for (const day of days) {
    // Folder names are YYYYMMDD, so a string comparison IS a date comparison.
    if (day.name >= cutoffKey) continue;
    const { data: runs } = await supabase.storage.from(BUCKET).list(`scheduled/${day.name}`, { limit: 1000 });
    for (const run of runs ?? []) {
      const { data: files } = await supabase.storage
        .from(BUCKET)
        .list(`scheduled/${day.name}/${run.name}`, { limit: 1000 });
      const paths = (files ?? []).map((f: { name: string }) => `scheduled/${day.name}/${run.name}/${f.name}`);
      if (!paths.length) continue;
      const { error: delErr } = await supabase.storage.from(BUCKET).remove(paths);
      if (!delErr) removed += paths.length;
    }
  }
  return removed;
}

// ── The run ─────────────────────────────────────────────────────────────────────────
async function main() {
  const t0 = Date.now();
  log(`collections-report · MODE=${MODE} · ${new Date().toISOString()}`);

  if (MODE === "sample" && !SAMPLE_TO) {
    throw new Error("MODE=sample needs SAMPLE_TO — the single address the sample goes to.");
  }

  // ── 1. May anything go out? ──
  let due: DueAnswer = { due: false };
  if (MODE === "scheduled") {
    due = await askDue();
    if (!due.due) {
      log(`nothing to do: ${due.reason}`);
      if (due.unclaimed?.length) {
        log(`⚠ ticked but nobody carries the tag: ${due.unclaimed.join(", ")}`);
      }
      return;
    }
    log(`due for ${due.forDate} (slot ${due.slotIst} IST) · ` +
        `${due.book?.length ?? 0} on the book, ${due.salespersons?.length ?? 0} rep copies`);
    for (const r of due.salespersons ?? []) {
      // Printed for every rep copy on every run, because "who actually receives this" is the
      // question the address book cannot answer at configuration time — a name resolves to whoever
      // carries the tag today. `covers > 1` means the recipient is an overseer receiving one rep's
      // book, which is legitimate but should never be a surprise.
      log(`   ${r.salesperson} → ${r.email}${(r.covers ?? 1) > 1 ? ` (also covers ${r.covers} names)` : ""}`);
    }
    if (due.unclaimed?.length) {
      // Not fatal: the rest of the list should still go out. But it is the failure that otherwise
      // looks exactly like success, so it is said out loud on every run it happens.
      log(`⚠ ticked but nobody carries the tag, so they receive nothing: ${due.unclaimed.join(", ")}`);
    }
  } else {
    // Outside a scheduled run the answer is only informational — but it is still worth printing,
    // because "why did nothing send on Saturday" is answered here.
    try {
      const peek = await askDue();
      log(`(the scheduler would say: ${peek.due ? "due" : peek.reason})`);
    } catch (e) {
      log(`(could not ask the scheduler: ${(e as Error).message})`);
    }
  }

  // ── 2. The book ──
  const tLoad = Date.now();
  const raw = await loadFromConnectwave("");
  log(`loaded ConnectWave in ${ms(tLoad)} · ${raw.cust.length} ledgers`);

  const tSpec = Date.now();
  const spec = await buildReportSpec(raw as never);
  log(`period ${spec.req.periodLabel} · as on ${spec.asOfLabel} · facts in ${ms(tSpec)}`);

  const { ctx, stats } = buildCollectionsReportContext(raw as never, spec.req);
  log(`context · eligible ${stats.eligible} · listed ${stats.listed} · ${stats.salespersons} salespersons`);
  for (const k of ctx.kpis) log(`   ${k.label.padEnd(28)} ${k.value.padEnd(14)} ${k.sub ?? ""}`);

  const subjectBase = `${ctx.meta.title} — as on ${spec.asOfLabel}`;

  // ── 3. Who gets what ──
  // In dry-run there is no list, so build BOTH shapes — the book, and one rep — which is what a
  // reader wants to check anyway.
  const bookRecipients: Recipient[] = MODE === "scheduled" ? (due.book ?? []) : [];
  const repRecipients: Recipient[] = MODE === "scheduled" ? (due.salespersons ?? []) : [];
  const repNames = [...new Set(repRecipients.map((r) => r.salesperson ?? "").filter(Boolean))].sort();

  const dryRepNames = MODE === "scheduled" ? [] : firstRepIn(ctx);
  const namesToDraw = MODE === "scheduled" ? repNames : dryRepNames;
  const drawBook = MODE === "scheduled" ? bookRecipients.length > 0 : true;

  const runId = `${istDate().replace(/-/g, "")}/${MODE}-${Date.now().toString(36)}`;
  const prefix = `scheduled/${runId}`;
  let queued = 0;

  // ── 4. Draw, upload, queue — the book ──
  if (drawBook) {
    const t = Date.now();
    const files = await buildBoth(ctx, { kind: "all" });
    log(`book · ${files.map((f) => `${f.filename} ${(f.blob.size / 1024).toFixed(0)} KB`).join(" · ")} · ${ms(t)}`);
    if (MODE === "dry-run") {
      await writeLocal(files);
    } else {
      const att = await upload(`${prefix}/book`, files);
      const to = MODE === "sample" ? [{ email: SAMPLE_TO, name: "Sample" }] : bookRecipients;
      for (const r of to) {
        const id = await enqueue(r, subjectBase, ctx.meta.title, BOOK_BODY, att);
        queued++;
        log(`  → ${r.email} (${id})`);
      }
    }
  }

  // ── 5. Draw, upload, queue — one extract per salesperson ──
  for (const name of namesToDraw) {
    const t = Date.now();
    const files = await buildBoth(ctx, { kind: "salesperson", name });
    log(`${name} · ${files.map((f) => `${f.filename} ${(f.blob.size / 1024).toFixed(0)} KB`).join(" · ")} · ${ms(t)}`);
    if (MODE === "dry-run") {
      await writeLocal(files);
      continue;
    }
    const att = await upload(`${prefix}/${storageSafe(name)}`, files);
    const to = MODE === "sample"
      ? [{ email: SAMPLE_TO, name: "Sample" }]
      : repRecipients.filter((r) => r.salesperson === name);
    for (const r of to) {
      const id = await enqueue(
        r,
        `${subjectBase} — ${name}`,
        `${ctx.meta.title} — ${name}`,
        REP_BODY,
        att,
      );
      queued++;
      log(`  → ${r.email} (${id})`);
    }
  }

  // ── 6. Claim the slot ──
  if (MODE === "scheduled") {
    const { data: claimed, error } = await supabase.rpc("collections_report_mark_sent", {
      p_report_key: REPORT_KEY,
      p_for_date: due.forDate,
      p_queued: queued,
      p_note: `${stats.listed} listed · ${queued} mails · ${ms(t0)}`,
    });
    if (error) throw new Error(`could not record the send: ${error.message}`);
    log(claimed ? `slot ${due.forDate} claimed` : `slot ${due.forDate} was already claimed`);

    const swept = await sweepOldExports();
    if (swept) log(`cleared ${swept} generated file(s) older than ${KEEP_DAYS} days`);
  }

  log(`\n${queued} mail(s) queued · total ${ms(t0)}`);
}

/** In dry-run the files land next to the checkout so a human can open them. */
async function writeLocal(files: { blob: Blob; filename: string }[]) {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const f of files) {
    writeFileSync(resolve(OUT_DIR, storageSafe(f.filename)), Buffer.from(await f.blob.arrayBuffer()));
  }
  log(`  written to ${OUT_DIR}`);
}

/**
 * A representative salesperson for a dry run: the one carrying the most listed customers, so the
 * sample exercises the widest extract rather than the emptiest.
 */
function firstRepIn(ctx: CollectionsExportContext): string[] {
  const counts = new Map<string, number>();
  for (const r of ctx.rows) {
    const names = r.customer.salesPersons?.length ? r.customer.salesPersons : [r.customer.salesPerson];
    for (const n of names) if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? [best[0]] : [];
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.stack : e);
  process.exit(1);
});
