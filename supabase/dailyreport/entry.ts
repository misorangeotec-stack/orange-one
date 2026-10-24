/**
 * The evening Daily Report (DR-3): build it with nobody logged in, and post it.
 *
 * ── WHY THIS RUNS ON A GITHUB RUNNER AND NOT IN AN EDGE FUNCTION ──────────────────────────────
 *   Measured on the live runtime, 20-Aug-2026: 1 second of straight-line CPU returns 200, 3
 *   seconds returns 546 WORKER_RESOURCE_LIMIT, and 8 seconds with an `await` every 200 ms returns
 *   546 as well — the budget is CUMULATIVE and yielding does not reset it. The ceiling is 2s.
 *
 *   The Collection report is 40s for 101 pages, about 0.4s a page. This report is ~6 pages, and
 *   MEASURED on 28-09-2026 on the desk it draws in 1.6s on a quiet day (7 sale lines) and 1.8-2.0s
 *   on a busy one (259 sale lines, 91 money rows). That is not comfortably over the ceiling — it is
 *   ON it, with no margin, and the budget has to cover the reads as well: parsing a few hundred
 *   register rows of JSON is CPU, and Poppins has to be embedded because built-in Helvetica is
 *   WinAnsi and has no rupee sign, so without Identity-H every money cell comes out a blank box.
 *
 *   ⚠ DO NOT "OPTIMISE" THIS INTO AN EDGE FUNCTION ON THE STRENGTH OF THAT 1.6s. A figure that sits
 *     exactly at the limit fails intermittently, on the busiest days, at 20:30, in front of nobody —
 *     which is strictly worse than a job that cannot fit at all. If someone wants to try it, the
 *     thing to measure first is a December day, not a September one.
 *
 * ── WHAT DECIDES, AND WHAT MERELY OBEYS ───────────────────────────────────────────────────────
 *   This file decides NOTHING about whether to send. `daily_report_email_due()` answers "should
 *   the Daily Report go out right now, and to whom", checking the arming switch, the report's own
 *   switch, the schedule an admin set, the send day, the slot, the grace window and the send log.
 *   This file asks once and does what it is told. So the rule an admin edits and the rule the
 *   sender obeys are one object, and changing either takes effect at the next tick with no deploy.
 *
 *   It decides nothing about the report's CONTENT either, and that is the whole point of DR-3's
 *   first commit: `buildDailyReportInput` is the function `pages/DailyReport.tsx` renders from, so
 *   there is no second definition of the report to drift. Compare
 *   `supabase/collectionsreport/reportSpec.ts`, which had to mirror the screen's period and says at
 *   length what that costs.
 *
 * ── THE THREE MODES ───────────────────────────────────────────────────────────────────────────
 *   MODE=dry-run    build, write the PDF next to the checkout, send NOTHING and upload NOTHING.
 *                   Prints the headline figures so they can be read against the screen. This is
 *                   the default, because the default must be the harmless one.
 *   MODE=sample     build, upload, and mail SAMPLE_TO and nobody else. Does NOT claim the slot.
 *   MODE=scheduled  the real thing: ask the database, obey, mail the list, claim the slot.
 *
 * ⚠ THE BANK BALANCES ARE TYPED BY HAND AND THIS JOB DOES NOT WAIT FOR THEM. Decided 28-09-2026:
 *   a fixed time every evening, whatever has been typed. So completeness is REPORTED — in the log,
 *   in the mail's own body and in the send log — never gated on. A Bank page reading "0 of 11
 *   accounts entered" must not look like a broken report.
 *
 * ⚠ A RUN THAT REACHES NOBODY DELIBERATELY DOES NOT CLAIM THE SLOT — see the migration.
 */

import { loadDailyReport } from "@/apps/daily-report/data/dailyReport";
import { fetchBankAccounts } from "@/apps/daily-report/data/bankAccounts";
import { balanceKey, fetchBankBalances } from "@/apps/daily-report/data/bankBalances";
import { fetchCcLimits } from "@/apps/daily-report/data/ccLimits";
import { buildDailyReportInput, historyFrom } from "@/apps/daily-report/lib/reportInput";
import { dailyReportPdfBlob } from "@/apps/daily-report/lib/exportDailyPdf";
import { salesTotals, bandMoney, tradeTotal, purchaseTotal } from "@/apps/daily-report/lib/aggregate";
import { fmtMoney, dmy, longDate } from "@/apps/daily-report/lib/format";

import { supabase } from "../collectionsreport/identityServer";
import { LOCATION, REPORT_KEY, istDate, pdfFilename } from "./reportSpec";

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const BUCKET = "report-exports";
/** Generated files are transient; anything older than this is cleared at the end of a real run. */
const KEEP_DAYS = 30;

type Mode = "dry-run" | "sample" | "scheduled";
const MODE = (process.env.MODE ?? "dry-run") as Mode;
const SAMPLE_TO = process.env.SAMPLE_TO ?? "";
const OUT_DIR = process.env.OUT_DIR ?? resolve("daily-report-out");
/** Overrides the day being reported. Dry-run and sample only — see `resolveDate`. */
const FOR_DATE = process.env.FOR_DATE ?? "";

interface Recipient {
  email: string;
  name?: string | null;
}

interface DueAnswer {
  due: boolean;
  reason?: string;
  forDate?: string;
  slotIst?: string;
  book?: Recipient[];
  /** scope='salesperson' rows found under this key. They reach nobody; see the migration header. */
  strays?: string[];
  balances?: { expected: number; entered: number };
}

const log = (...a: unknown[]) => console.log(...a);
const ms = (t: number) => `${((Date.now() - t) / 1000).toFixed(1)}s`;
/** Storage keys must be ASCII-safe; the display filename keeps the original text. */
const storageSafe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_");

// ── Asking the database ─────────────────────────────────────────────────────────────
async function askDue(): Promise<DueAnswer> {
  const { data, error } = await supabase.rpc("daily_report_email_due", { p_report_key: REPORT_KEY });
  if (error) throw new Error(`daily_report_email_due failed: ${error.message}`);
  return data as DueAnswer;
}

/**
 * Which day to report on.
 *
 * ⚠ `FOR_DATE` IS REFUSED IN A SCHEDULED RUN, AND THAT IS NOT PEDANTRY. The send log is keyed on
 *   the date the GATE chose; building a different day and then claiming that slot would file
 *   Tuesday's figures under Wednesday, with the log insisting Wednesday was sent. Outside a
 *   scheduled run it is simply how you look at a past evening.
 */
function resolveDate(due: DueAnswer): string {
  if (MODE === "scheduled") {
    if (FOR_DATE) throw new Error("FOR_DATE may not be set on a scheduled run — the gate chooses the day.");
    if (!due.forDate) throw new Error("the gate said due but named no date");
    return due.forDate;
  }
  if (FOR_DATE && !/^\d{4}-\d{2}-\d{2}$/.test(FOR_DATE)) {
    throw new Error(`FOR_DATE must be YYYY-MM-DD (got "${FOR_DATE}")`);
  }
  return FOR_DATE || istDate();
}

// ── Putting the file somewhere the sender can reach it ──────────────────────────────
async function upload(
  prefix: string,
  files: { blob: Blob; filename: string }[],
): Promise<{ path: string; filename: string; mime: string }[]> {
  const out: { path: string; filename: string; mime: string }[] = [];
  for (const f of files) {
    const path = `${prefix}/${storageSafe(f.filename)}`;
    const body = Buffer.from(await f.blob.arrayBuffer());
    const mime = "application/pdf";

    /**
     * ⚠ RETRIED, FOR THE REASON THE COLLECTION REPORT WROTE DOWN ON 29-Aug-2026: a sample run threw
     *   `could not upload …: <none>` — the storage API answering with nothing rather than refusing —
     *   and the identical run seconds later succeeded untouched. A blip, not a fault.
     *
     *   What it cost there was a HALF-DELIVERED report recorded as sent, because the throw escaped
     *   the per-recipient catch while `queued > 0` still claimed the slot. This report has one
     *   attachment and one upload, so a failure here costs the whole run rather than half of it —
     *   which is the better failure, and the retry is still worth having so a blip does not spend
     *   the slot's grace window.
     */
    let lastErr = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      // `upsert: false` deliberately: the prefix carries a per-run id, so a collision means two
      // runs are writing the same slot and the second should fail loudly rather than overwrite.
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, body, { contentType: mime, upsert: false });
      if (!error) { lastErr = ""; break; }

      // "Already exists" on a RETRY is our own previous attempt landing after its response was
      // lost, not the two-runs-racing case — that guard is about the per-run id, which is ours.
      const msg = error.message || "";
      if (attempt > 1 && /exist|duplicate|conflict/i.test(msg)) { lastErr = ""; break; }

      lastErr = msg || "(the storage API returned an error with no message)";
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 1500));
    }
    if (lastErr) throw new Error(`could not upload ${f.filename} after 3 attempts: ${lastErr}`);

    out.push({ path, filename: f.filename, mime });
  }
  return out;
}

/**
 * One outbox row per recipient.
 *
 * ⚠ ONE ROW EACH, BECAUSE `send-email` HAS NO Cc. Several recipients are several outbox rows and
 *   several separate mails; there is no way to put them on one thread.
 *
 * Inserted directly rather than through `queue_report_email`, because that RPC is the BROWSER's
 * door: it requires `auth.uid()`, checks the caller's receivables Reports access, and insists every
 * attachment path begins with the caller's own user id. None of that is meaningful for a server run
 * of a different module's report. What it checks is checked instead by `daily_report_email_due()`,
 * which is stricter — it also demands the arming switch and a schedule.
 */
async function enqueue(
  to: Recipient,
  subject: string,
  headline: string,
  body: { lead: string; bullets: string[] },
  attachments: { path: string; filename: string; mime: string }[],
): Promise<string> {
  const { data, error } = await supabase
    .from("email_outbox")
    .insert({
      // ⚠ THIS EXACT STRING NEEDS A BRANCH IN `send-email/index.ts`. The generic module-prefix list
      //   there does not carry `daily_report_`, so without its own `row.kind === ...` branch the
      //   mail is markSkipped("unknown kind") and vanishes without an error anywhere.
      kind: "daily_report_evening",
      to_email: to.email,
      to_name: to.name ?? null,
      subject,
      payload: {
        report_key: REPORT_KEY,
        subject,
        headline,
        // `body` is the opening sentence; `bullets` is the list. See mailBody().
        body: body.lead,
        bullets: body.bullets,
        bucket: BUCKET,
        attachments,
      },
    })
    .select("id")
    .single();
  if (error) throw new Error(`could not queue mail to ${to.email}: ${error.message}`);
  return data.id as string;
}

// ── Housekeeping ────────────────────────────────────────────────────────────────────
/**
 * Clear generated files older than KEEP_DAYS from THIS report's own folder.
 *
 * ⚠ SCOPED TO `scheduled/daily-report/`, NOT TO `scheduled/`. The Collection report's sweep walks
 *   `scheduled/` wholesale, so pointing this one at the same root would have each job deleting the
 *   other's files on a different retention clock. Two jobs, two folders, two sweeps.
 */
async function sweepOldExports(): Promise<number> {
  const root = `scheduled/${REPORT_KEY}`;
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86400_000);
  const cutoffKey =
    `${cutoff.getUTCFullYear()}${String(cutoff.getUTCMonth() + 1).padStart(2, "0")}` +
    `${String(cutoff.getUTCDate()).padStart(2, "0")}`;
  const { data: days, error } = await supabase.storage.from(BUCKET).list(root, { limit: 1000 });
  if (error || !days) return 0;
  let removed = 0;
  for (const day of days) {
    // Folder names are YYYYMMDD, so a string comparison IS a date comparison.
    if (day.name >= cutoffKey) continue;
    const { data: runs } = await supabase.storage.from(BUCKET).list(`${root}/${day.name}`, { limit: 1000 });
    for (const run of runs ?? []) {
      const { data: files } = await supabase.storage
        .from(BUCKET)
        .list(`${root}/${day.name}/${run.name}`, { limit: 1000 });
      const paths = (files ?? []).map((f: { name: string }) => `${root}/${day.name}/${run.name}/${f.name}`);
      if (!paths.length) continue;
      const { error: delErr } = await supabase.storage.from(BUCKET).remove(paths);
      if (!delErr) removed += paths.length;
    }
  }
  return removed;
}

// ── The wording ─────────────────────────────────────────────────────────────────────
/**
 * What the mail says: one opening sentence, and the day's figures as POINTS.
 *
 * ⚠ THE POINTS ARE AN ARRAY, NOT A NEWLINE-JOINED STRING, AND THAT IS THE CONTRACT.
 *   Joining them here and splitting them again in `send-email` would be two encodings of one list,
 *   and HTML collapses newlines — so any reader of the payload that forgot to split would render a
 *   paragraph of run-together figures. The client rejected exactly that shape for the announcements
 *   on 18-09-2026. `bullets` is the field the receivables branch already takes.
 *
 * ⚠ THE FIGURES ARE IN THE MAIL, NOT ONLY IN THE PDF. This is read on a phone, in the evening, by
 *   someone who wants one answer and may not open an attachment for it. It is also the honest place
 *   to say how complete the hand-typed bank figures were: a thin Bank page in the PDF would
 *   otherwise read as a fault rather than as "nobody has typed them yet".
 *
 * No em dash anywhere in the copy. The house style for outbound mail is the fact first and then
 * pointers, because an em dash reads as machine-written.
 */
function mailBody(
  input: ReturnType<typeof buildDailyReportInput>,
  balances?: { expected: number; entered: number },
): { lead: string; bullets: string[] } {
  const sold = salesTotals(input.sales);
  const received = tradeTotal(bandMoney(input.money, "in"));
  const paid = tradeTotal(bandMoney(input.money, "out"));
  const purchased = purchaseTotal(input.purchases);

  const bullets = [
    `Sales ${fmtMoney(sold.netLacs)}`,
    `Received from customers ${fmtMoney(received)}`,
    `Paid to suppliers ${fmtMoney(paid)}`,
    `Purchased ${fmtMoney(purchased)}`,
  ];

  // ⚠ COUNTED OFF THE GATE'S ANSWER WHERE THERE IS ONE, so the mail, the run log and the send log
  //   all quote the same figure. The local count is the fallback for a dry run or a sample, which
  //   never ask the gate for a decision.
  const expected = balances?.expected ?? input.accounts.length;
  const entered = balances?.entered ?? 0;
  if (expected > 0 && entered < expected) {
    bullets.push(
      `Bank balances: ${entered} of ${expected} accounts were entered when this was sent, ` +
        "so the bank page and the credit facility are incomplete.",
    );
  }
  bullets.push("The attached PDF carries the full day: what sold, money in, money out and the bank.");

  return { lead: `The day's figures for ${longDate(input.date)}.`, bullets };
}

// ── The run ─────────────────────────────────────────────────────────────────────────
async function main() {
  const t0 = Date.now();
  log(`daily-report · MODE=${MODE} · ${new Date().toISOString()}`);

  if (MODE === "sample" && !SAMPLE_TO) {
    throw new Error("MODE=sample needs SAMPLE_TO — the single address the sample goes to.");
  }

  // ── 1. May anything go out? ──
  let due: DueAnswer = { due: false };
  if (MODE === "scheduled") {
    due = await askDue();
    if (!due.due) {
      log(`nothing to do: ${due.reason}`);
      if (due.strays?.length) {
        log(`⚠ salesperson rows on this report's list reach nobody: ${due.strays.join(", ")}`);
      }
      return;
    }
    log(`due for ${due.forDate} (slot ${due.slotIst} IST) · ${due.book?.length ?? 0} recipient(s)`);
    for (const r of due.book ?? []) log(`   → ${r.email}`);
    if (due.balances) {
      log(`   bank balances typed: ${due.balances.entered} of ${due.balances.expected}`);
    }
    if (due.strays?.length) {
      // Not fatal, but it is the failure that otherwise looks exactly like success: a row sitting
      // in the list looking configured, receiving nothing, for ever.
      log(`⚠ salesperson rows on this report's list reach nobody: ${due.strays.join(", ")}`);
    }
  } else {
    // Informational outside a scheduled run, but still worth printing: "why did nothing send last
    // night" is answered here.
    try {
      const peek = await askDue();
      log(`(the scheduler would say: ${peek.due ? "due" : peek.reason})`);
    } catch (e) {
      log(`(could not ask the scheduler: ${(e as Error).message})`);
    }
  }

  const date = resolveDate(due);

  // ── 2. The day ──
  // Four reads against ConnectWave plus three against the portal, exactly the set the screen makes,
  // through the same functions. Run together: they do not depend on each other.
  const tLoad = Date.now();
  const [data, accounts, balances, ccLimits] = await Promise.all([
    loadDailyReport(date),
    fetchBankAccounts(),
    fetchBankBalances(historyFrom(date), date),
    fetchCcLimits(date, date),
  ]);
  log(`read ${date} in ${ms(tLoad)} · ${data.sales.length} sale lines, ${data.money.length} money rows, ` +
      `${data.purchases.length} purchase lines, ${accounts.length} bank accounts`);
  if (!data.rulesLoaded) {
    // The screen says this out loud too. It changes how every sale line is typed, so a run that
    // could not read the ruleset is worth a line in the log rather than a silent difference.
    log("⚠ sale_type_rule could not be read; product lines will read as their fallback type");
  }

  // ── 3. The report, built by the screen's own function ──
  const input = buildDailyReportInput({ date, loc: LOCATION, data, accounts, balances, ccLimits });
  // `balanceKey`, not a template of its own: the map's key format is that function's business,
  // and a second spelling of it here would read "0 of 11" for ever without erroring.
  const entered = input.accounts.filter((a) => balances.has(balanceKey(a.id, date))).length;
  log(`bank balances typed: ${entered} of ${input.accounts.length}`);

  const tDraw = Date.now();
  const blob = await dailyReportPdfBlob(input);
  const filename = pdfFilename(date);
  log(`${filename} ${(blob.size / 1024).toFixed(0)} KB · ${ms(tDraw)}`);

  // The headline, printed so a run can be read against the screen without opening the PDF.
  const sold = salesTotals(input.sales);
  log(`headline · sales ${fmtMoney(sold.netLacs)} · in ${fmtMoney(tradeTotal(bandMoney(input.money, "in")))}` +
      ` · out ${fmtMoney(tradeTotal(bandMoney(input.money, "out")))}` +
      ` · purchased ${fmtMoney(purchaseTotal(input.purchases))}`);

  if (MODE === "dry-run") {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(resolve(OUT_DIR, storageSafe(filename)), Buffer.from(await blob.arrayBuffer()));
    log(`written to ${OUT_DIR} · nothing uploaded, nothing sent`);
    log(`\ntotal ${ms(t0)}`);
    return;
  }

  // ── 4. Upload, then queue ──
  let queued = 0;
  const failures: string[] = [];
  try {
    const runId = `${Date.now().toString(36)}`;
    const prefix = `scheduled/${REPORT_KEY}/${date.replace(/-/g, "")}/${runId}`;
    const att = await upload(prefix, [{ blob, filename }]);

    const subject = `Daily Report — ${dmy(date)}`;
    const headline = `Daily Report · ${longDate(date)}`;
    const body = mailBody(input, due.balances);

    const to: Recipient[] = MODE === "sample"
      ? [{ email: SAMPLE_TO, name: "Sample" }]
      : (due.book ?? []);

    for (const r of to) {
      // One bad address must not cost everyone else their report.
      try {
        const id = await enqueue(r, subject, headline, body, att);
        queued++;
        log(`  → ${r.email} (${id})`);
      } catch (e) {
        failures.push(`${r.email}: ${(e as Error).message}`);
        log(`  ✗ ${r.email}: ${(e as Error).message}`);
      }
    }
  } finally {
    // ── 5. Claim the slot ──
    // `mark_sent` refuses a zero count, so a run that reached nobody does not burn the slot.
    if (MODE === "scheduled" && queued > 0) {
      const note = `${queued} mail(s) · ${ms(t0)}` +
        (failures.length ? ` · ${failures.length} FAILED: ${failures.join("; ")}` : "");
      const { data: claimed, error } = await supabase.rpc("daily_report_email_mark_sent", {
        p_report_key: REPORT_KEY,
        p_for_date: due.forDate,
        p_queued: queued,
        p_note: note.slice(0, 2000),
        p_balances_entered: due.balances?.entered ?? entered,
        p_balances_expected: due.balances?.expected ?? input.accounts.length,
      });
      if (error) {
        // Said loudly and NOT rethrown from a finally — that would replace whatever real error is
        // already on its way out with this one, hiding the actual cause.
        log(`⚠ could not record the send: ${error.message} — a retry may double-send`);
      } else {
        log(claimed ? `slot ${due.forDate} claimed` : `slot ${due.forDate} was already claimed`);
      }
    }
  }

  if (MODE === "scheduled") {
    const swept = await sweepOldExports();
    if (swept) log(`cleared ${swept} generated file(s) older than ${KEEP_DAYS} days`);
  }

  log(`\n${queued} mail(s) queued · total ${ms(t0)}`);
  if (failures.length) {
    // Non-zero exit so Actions shows it red and somebody looks — but only AFTER the slot has been
    // claimed above, so looking does not turn into everyone being mailed twice.
    throw new Error(`${failures.length} recipient(s) failed: ${failures.join("; ")}`);
  }
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.stack : e);
  process.exit(1);
});
