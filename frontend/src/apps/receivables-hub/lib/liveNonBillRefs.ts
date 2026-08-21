/**
 * liveNonBillRefs.ts — drop the "bills" that were never bills. (RC-7)
 *
 * VAMA showed **1 open past-due bill**: ref `ADV`, ₹17.00 L pending, Due Days 25, and
 * Received −₹8.50 L. It is not a bill. Two real RTGS payments went OUT to VAMA on 27-07-2026 and
 * both were tagged in Tally to a reference literally named `ADV` — the first `New Ref`, the second
 * `Agst Ref`. An `Agst Ref` is meant to CLEAR a reference, so it should carry the opposite sign;
 * both were Dr, so the second doubled the reference instead of clearing it.
 *
 * Tally is not being corrected, so the report recognises the shape instead. The signal is
 * `public.v_non_bill_ref` in ConnectWave: references whose EVERY `New Ref` was raised by a cash
 * voucher (Receipt / Payment / Contra). Cash vouchers move money; they cannot raise a receivable.
 *
 * ⚠ THE RULE'S DIRECTION IS THE WHOLE DESIGN, and the obvious direction is wrong. Selecting FOR
 *   sales vouchers and dropping the rest was measured against all 3,493 open past-due bills and
 *   would have removed ₹76 L of real money — 60 paper invoices, because the voucher type
 *   'GST SALES- PAPER' is simply MISSING from v_voucher_type_nature, plus 5 genuine debit notes.
 *   The classifier has holes, and a drop-by-default rule reads a hole as "not a sale". So the view
 *   selects only what it can positively prove is cash, and everything it cannot classify stays.
 *   DEFAULT = KEEP = never hide money. Keep it that way.
 *
 * WHAT LEAVES: Overdue **and** Outstanding, not just Overdue — "if there is an outstanding bill,
 * show it; if there is no bill, show nothing" (Ritesh Bhai, 21-08-2026). An outstanding figure with
 * no bill behind it is the mismatch that made this look broken in the first place. VAMA has no
 * invoice at all, so VAMA leaves the report rather than showing ₹17 L against zero bills.
 *
 * ⚠ Money really did leave the building. Tally still carries VAMA at ₹17,00,000 Dr and this report
 *   now says nothing about it. That is the accepted trade, not an oversight — chasing advances paid
 *   out needs its own screen.
 *
 * Measured against the LIVE view once it was applied, 21-08-2026 (850 view rows, 49 of them
 * matching a snapshot bill):
 *   14 bills removed · ₹1,22,07,282 off Outstanding · 14 customers
 *   10 of those are past due · ₹1,01,34,928 off Overdue
 *   35 CREDITS matched and deliberately KEPT (−₹1,91,49,520) — see the debit-only note below
 *   0 customers whose Outstanding rises · 0 sales-raised references anywhere in the view
 *
 * Every removed reference was raised by `BANK RECEIPT`, `BANK PAYMENT` or `BANK PAYMENT-CHQ.R`.
 *
 * FAIL-SOFT, deliberately. If the view is absent (not yet applied) or unreachable, this logs and
 * changes NOTHING — the report behaves exactly as it did before. That is what makes the deploy
 * order forgiving: shipping the frontend first is inert rather than broken.
 */
import { getConnectwaveSupabase } from "./connectwaveSupabase";
import type { AgingBuckets, Customer, CustomerDetail, SaleType } from "./types";

/** One row of `public.v_non_bill_ref`. */
interface NonBillRefRow {
  ledger_id: string;
  bill_ref: string;
  origin_voucher_type: string;
}

/** What was actually removed, for the caller to log. A silent 0 is the symptom of a broken read. */
export interface NonBillRefResult {
  /** Bill lines dropped. */
  bills: number;
  /** ₹ taken out of Outstanding. */
  outstanding: number;
  /** ₹ taken out of Overdue (≤ outstanding — a reference that is not yet due was never overdue). */
  overdue: number;
  /** Customers touched. */
  customers: number;
  /** True when the view could not be read, so nothing was applied. */
  degraded: boolean;
}

/** Which aging bucket an overdue bill sits in. Same edges as liveOtherPayments.bucketOf. */
function bucketOf(overdueDays: number): keyof AgingBuckets | null {
  if (overdueDays <= 0) return null;
  if (overdueDays <= 30) return "0_30";
  if (overdueDays <= 60) return "31_60";
  if (overdueDays <= 90) return "61_90";
  if (overdueDays <= 120) return "91_120";
  if (overdueDays <= 180) return "121_180";
  return "180_plus";
}

/** Same bands as connectwaveFetcher.categorizeRisk / liveOtherPayments.categorize. */
function categorize(maxOD: number, util: number): Customer["risk"] {
  if (maxOD > 180 || util > 100) return "critical";
  if (maxOD > 90 || util > 75) return "high";
  if (maxOD > 30 || util > 50) return "medium";
  return "low";
}

const PAGE = 1000;

/**
 * Read every non-bill reference. Paged with an explicit ORDER BY.
 *
 * ⚠ The `.order()` is load-bearing, not tidiness. A `.range()` without one lets Postgres return
 *   rows in any order per page, which silently duplicates and drops rows across page boundaries —
 *   the bug that once duplicated 2,064 rows in `connectwaveFetcher.fetchAll` and the one that hid
 *   ₹1.72 cr of Other Payments. Do not remove it.
 */
async function fetchNonBillRefs(): Promise<NonBillRefRow[]> {
  const sb = getConnectwaveSupabase();
  const out: NonBillRefRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("v_non_bill_ref")
      .select("ledger_id,bill_ref,origin_voucher_type")
      .order("ledger_id", { ascending: true })
      .order("bill_ref", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as NonBillRefRow[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/**
 * Strip non-bill references out of a live snapshot, in place.
 *
 * The caller must not discard the return value — it is the only way to see whether this ran.
 */
export async function applyNonBillRefsToLive(
  cust: Customer[],
  inv: Record<string, CustomerDetail>,
): Promise<NonBillRefResult> {
  const empty: NonBillRefResult = {
    bills: 0, outstanding: 0, overdue: 0, customers: 0, degraded: false,
  };

  let rows: NonBillRefRow[];
  try {
    rows = await fetchNonBillRefs();
  } catch (e) {
    // Absent view or unreachable database. Change nothing: the report reads exactly as it did
    // before RC-7, which is wrong in a known way rather than wrong in a new one.
    console.warn(
      "[liveNonBillRefs] could not read v_non_bill_ref — advances raised by cash vouchers will " +
      "still show as overdue bills (RC-7). Has non_bill_refs_view.sql been applied to ConnectWave?",
      e,
    );
    return { ...empty, degraded: true };
  }
  if (!rows.length) return empty;

  // Keyed by the Tally ledger GUID, which IS `c.id` on a live Customer — no name matching, no
  // company/location bridge. See the header of liveOtherPayments for why that matters.
  const refsByLedger = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = refsByLedger.get(r.ledger_id);
    if (set) set.add(r.bill_ref);
    else refsByLedger.set(r.ledger_id, new Set([r.bill_ref]));
  }

  const res: NonBillRefResult = { ...empty };

  for (const c of cust) {
    const refs = refsByLedger.get(c.id);
    if (!refs) continue;

    const detail = inv[c.id];
    const bills = detail?.invoices ?? [];
    // ⚠ DEBIT SIDE ONLY. `pending > 0` is not a tidy-up, it is the difference between a fix and a
    //   ₹94 L error, measured over the whole snapshot before this shipped.
    //
    //   The view matches 30 snapshot references. 11 are debits — the phantom "bills" this exists to
    //   remove. The other **19 are CREDITS totalling −₹94,02,878**: `M/C ADV`, `REC 20.06.2026`,
    //   `ON ACCOUNT` and friends, all raised by a BANK RECEIPT. Those are advances the customer
    //   genuinely PAID US. They are equally "not a bill", but deleting them would raise 17
    //   customers' Outstanding by ₹94 L and un-credit money that is sitting in our bank.
    //
    //   "Not a bill" cuts two ways and only one of them is a phantom. A debit with no invoice
    //   behind it overstates what we are owed; a credit with no invoice behind it is real money and
    //   already has a home — the report shows it as "On Account (paid, tagged to no bill)".
    //   So: drop the debits, leave the credits exactly where they are.
    const doomed = bills.filter((b) => refs.has(b.billRefName) && (b.pending || 0) > 0);
    if (!doomed.length) continue;

    let outDrop = 0;
    let odDrop = 0;
    for (const b of doomed) {
      const pending = b.pending || 0;
      outDrop += pending;

      // A reference that is not yet past due was never in the overdue total, so it must not be
      // clawed back out of a bucket it never entered.
      const bucket = bucketOf(b.overdueDays || 0);
      if (bucket) {
        odDrop += pending;
        c.agingBuckets[bucket] = Math.max(0, c.agingBuckets[bucket] - pending);
        const byType = c.agingBucketsByType?.[b.voucherType as SaleType];
        if (byType) byType[bucket] = Math.max(0, byType[bucket] - pending);
      }
    }

    c.outstanding -= outDrop;
    c.overdue = Math.max(0, c.overdue - odDrop);
    // `overdueGross` must move with `overdue`, or the gross − on-account bridge every page renders
    // stops adding up by exactly this amount. Same reasoning as liveOtherPayments.settle.
    if (c.overdueGross != null) c.overdueGross = Math.max(0, c.overdueGross - odDrop);

    // The per-type splits are what the sale-type filters and the Dashboard cards read. Leaving them
    // untouched would make the totals disagree with their own breakdown.
    for (const b of doomed) {
      const type = b.voucherType as SaleType;
      const pending = b.pending || 0;
      if (c.outstandingByType && type in c.outstandingByType)
        c.outstandingByType[type] -= pending;
      if ((b.overdueDays || 0) > 0 && c.overdueByType && type in c.overdueByType)
        c.overdueByType[type] = Math.max(0, c.overdueByType[type] - pending);
    }

    // Drop the lines themselves, so the drill-down and the bill pages cannot show what the totals
    // no longer count. Identity, not `refs` — a credit sharing the reference name must survive.
    const gone = new Set(doomed);
    if (detail) detail.invoices = bills.filter((b) => !gone.has(b));

    // maxOverdueDays / utilization / risk follow the bills that remain — a customer whose only
    // "overdue" line was an advance is not a risk case.
    const remaining = (detail?.invoices ?? []).filter((b) => b.pending > 0);
    c.maxOverdueDays = remaining.reduce((m, b) => Math.max(m, b.overdueDays || 0), 0);
    c.utilization = c.creditLimit > 0 ? Math.round((c.outstanding / c.creditLimit) * 1000) / 10 : 0;
    c.risk = categorize(c.maxOverdueDays, c.utilization);

    res.bills += doomed.length;
    res.outstanding += outDrop;
    res.overdue += odDrop;
    res.customers += 1;
  }

  return res;
}
