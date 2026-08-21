/**
 * collectionsRange.ts — day-level collection facts for an arbitrary From→To date range.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────────────────
 * Everything the Collection Performance report reads is bucketed by MONTH: the ConnectWave
 * snapshot stores each customer's sales and receipts as a month→totals jsonb, and the opening
 * balance is derived by winding today's outstanding back one month at a time. That is why the
 * report's "Custom" period could only ever offer month pickers — putting date boxes on top of a
 * monthly engine would silently round the user's dates to whole months.
 *
 * The raw vouchers are day-level though (tally_voucher_line: ~260k dated lines back to Apr-2024),
 * so a date range IS answerable — just not from the snapshot. `collection_range_facts` aggregates
 * them server-side into one row per ledger, which is the only shape that is affordable here:
 * pulling the vouchers themselves, or querying per customer, is a multi-second job.
 *
 * ── What it costs ─────────────────────────────────────────────────────────────────────────
 * ONE query, ~270ms, and only when the Custom period is selected. The four presets never touch
 * this file and are unchanged in speed.
 *
 * ── How it lines up with the monthly path ─────────────────────────────────────────────────
 * The RPC classifies vouchers exactly as collection_refresh does and computes movement with
 * exactly movementOf's formula, so Receipts and Sales tie to the rupee — a three-whole-month
 * range reproduces the "Last 3 Months" preset across all 1,831 ledgers, zero mismatches.
 *
 * Opening and Collection % may differ, and where they do this path is the correct one: the
 * monthly path only knows credit notes / debit notes / journals / cheque returns as a yearly
 * total that it apportions across months by weight, whereas this reads them on their real dates.
 * See the factsForRange header for the measured size of that gap.
 *
 * Live (Tally) only. The pipeline source has no equivalent bulk day-level table, so it keeps
 * whole-month pickers — see CollectionPerformanceReport.
 */
import { getConnectwaveSupabase } from "./connectwaveSupabase";
import type { RangeFacts } from "./collections";

/** One row of the RPC. Numerics arrive from PostgREST as strings or numbers depending on size. */
interface RangeRow {
  tenant_id: string;
  ledger_id: string;
  w_receipts: number | string | null;
  w_sales: number | string | null;
  w_credit_notes: number | string | null;
  w_debit_notes: number | string | null;
  w_journals: number | string | null;
  w_cheque_returns: number | string | null;
  prior_receipts: number | string | null;
  prior_sales: number | string | null;
  mv_since_from: number | string | null;
  mv_since_prior_from: number | string | null;
}

const num = (v: number | string | null | undefined): number => Number(v ?? 0) || 0;

/** "2026-04-05" → "20260405". The RPC compares yyyymmdd text, which orders correctly. */
export const isoToYmd = (iso: string): string => iso.replace(/-/g, "").slice(0, 8);

/** Shift an ISO date by whole days. UTC arithmetic throughout — these are calendar dates, not
 *  instants, and local-midnight maths would slip a day either side of a DST boundary. */
export const addDaysIso = (iso: string, days: number): string => {
  const t = new Date(`${iso}T00:00:00Z`).getTime();
  if (Number.isNaN(t)) return iso;
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
};

/**
 * How far behind the as-on date the books are considered COMPLETE.
 *
 * This is a business convention, not a measured lag, and the distinction matters. The mirror
 * genuinely carries vouchers dated today and yesterday — but entries are still being posted
 * against those days, so a figure read today can move tomorrow. Two days back is where Ritesh
 * Bhai considers a day closed (decided 21-08-2026).
 *
 * ⚠ It is a LABEL ONLY. Nothing computes against it: the report's window still ends on the as-on
 *   date and every figure is unchanged. If you ever find this constant inside `lastNDays` or a
 *   filter, something has gone wrong — that would silently restate every number on the report.
 */
export const DATA_LAG_DAYS = 2;

/**
 * The date the data is described as complete to: `asOfIso` minus `DATA_LAG_DAYS` calendar days.
 * Calendar, not working, days — deliberately, so the answer never depends on a holiday list.
 *
 * Returns "" for an empty input rather than a fabricated date. `asOfDate` is `?? ""` at both
 * assembly sites, so a cold load reaches here blank; every caller must skip the line on "" or the
 * page prints "Data updated till Invalid Date", which is worse than printing nothing.
 */
export function dataUpdatedTillISO(asOfIso: string): string {
  if (!asOfIso) return "";
  const till = addDaysIso(asOfIso, -DATA_LAG_DAYS);
  // addDaysIso hands back its input unchanged on an unparseable date; that would silently label
  // the as-on date itself as the completeness date, overstating freshness by two days.
  return till === asOfIso ? "" : till;
}

/**
 * The "Last N Days" window ending on (and including) `asOfIso`.
 *
 * N days INCLUSIVE of the end date, so 15 days ending 07-08 runs 24-07 → 07-08, not 23-07. The
 * start is clamped to the data horizon so an early-in-the-data as-of date can't ask for vouchers
 * that were never mirrored.
 */
export function lastNDays(asOfIso: string, n: number, horizonIso: string): { fromIso: string; toIso: string } | null {
  if (!asOfIso || n < 1) return null;
  const from = addDaysIso(asOfIso, -(n - 1));
  return { fromIso: horizonIso && from < horizonIso ? horizonIso : from, toIso: asOfIso };
}

/**
 * The prior window for a date range: the SAME NUMBER OF DAYS immediately before `fromIso`,
 * ending the day before it. A 79-day window is compared against the previous 79 days.
 *
 * Returns null when that run would start before `horizonIso` (where the data itself begins) —
 * a partial prior period would make Prior % look better or worse than it was, so the report
 * shows "—" instead, exactly as the monthly path does at the start of the FY.
 */
export function priorRange(
  fromIso: string,
  toIso: string,
  horizonIso: string,
): { fromIso: string; toIso: string } | null {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  const horizon = new Date(horizonIso).getTime();
  if (Number.isNaN(from) || Number.isNaN(to) || Number.isNaN(horizon) || to < from) return null;

  const spanDays = Math.round((to - from) / 86_400_000) + 1;   // inclusive of both ends
  const priorTo = from - 86_400_000;
  const priorFrom = priorTo - (spanDays - 1) * 86_400_000;
  if (priorFrom < horizon) return null;

  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { fromIso: iso(priorFrom), toIso: iso(priorTo) };
}

/**
 * ledgerId → its day-level facts for the range. Keyed by ledger_id alone, matching
 * buildLedgerBalances and the rest of the engine (ledger_id embeds the company guid, so it is
 * unique across the seven books — verified; the += is belt-and-braces).
 *
 * `priorFromIso` null means "no prior period", and the RPC then returns 0 for both prior figures.
 *
 * `horizonIso` is the END OF THE AS-OF MONTH — deliberately NOT the as-of date. Opening balance is
 * the canonical outstanding wound back through `mvSinceFrom`, so that wind-back has to cover every
 * voucher the outstanding itself reflects. The monthly path winds back through whole month buckets
 * including the current one, so stopping at the as-of date would drop the rest of this month (50
 * debtor lines on 07-08-2026) and Opening would silently disagree with the presets.
 */
export async function fetchRangeFacts(
  fromIso: string,
  toIso: string,
  priorFromIso: string | null,
  horizonIso: string,
): Promise<Map<string, RangeFacts>> {
  const sb = getConnectwaveSupabase();
  const { data, error } = await sb.rpc("collection_range_facts", {
    p_from: isoToYmd(fromIso),
    p_to: isoToYmd(toIso),
    p_prior_from: priorFromIso ? isoToYmd(priorFromIso) : null,
    p_horizon: isoToYmd(horizonIso),
  });
  if (error) throw error;

  const out = new Map<string, RangeFacts>();
  for (const r of (data ?? []) as RangeRow[]) {
    const prev = out.get(r.ledger_id);
    const next: RangeFacts = {
      receipts:         num(r.w_receipts)       + (prev?.receipts ?? 0),
      sales:            num(r.w_sales)          + (prev?.sales ?? 0),
      creditNotes:      num(r.w_credit_notes)   + (prev?.creditNotes ?? 0),
      debitNotes:       num(r.w_debit_notes)    + (prev?.debitNotes ?? 0),
      journals:         num(r.w_journals)       + (prev?.journals ?? 0),
      chequeReturns:    num(r.w_cheque_returns) + (prev?.chequeReturns ?? 0),
      priorReceipts:    num(r.prior_receipts)   + (prev?.priorReceipts ?? 0),
      priorSales:       num(r.prior_sales)      + (prev?.priorSales ?? 0),
      mvSinceFrom:      num(r.mv_since_from)    + (prev?.mvSinceFrom ?? 0),
      mvSincePriorFrom: num(r.mv_since_prior_from) + (prev?.mvSincePriorFrom ?? 0),
    };
    out.set(r.ledger_id, next);
  }
  return out;
}
