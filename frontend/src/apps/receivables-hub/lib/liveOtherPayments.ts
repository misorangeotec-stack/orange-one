/**
 * liveOtherPayments.ts — apply the manual (non-Tally) Other Payments to the LIVE (Tally) snapshot.
 *
 * Other Payments are real money the customer paid outside Tally, so they must land on every screen,
 * not just the pipeline ones. The live snapshot comes from ConnectWave (Tally's own numbers), which
 * by definition has never seen them — so we net them in here, applying the SAME waterfall the
 * pipeline uses (scripts/process_data.py):
 *
 *   1. a row that names a bill settles THAT bill (capped at the bill's pending);
 *   2. whatever is left over is applied FIFO across the customer's open bills, oldest due first —
 *      because where we have bill-wise detail a payment must drop BOTH outstanding AND overdue;
 *   3. only rupees with no bill left to settle stay on account (they reduce the headline only).
 *
 * SOURCE: the ext_other_payments master in ConnectWave, keyed by the Tally ledger GUID — the same
 * GUID a live Customer already carries as `c.id`. So the payments and the customers line up with no
 * lookup at all.
 *
 * WHY THAT MATTERS (2026-07-17). This file used to read the OTHER project (receivables) and bridge
 * the two sides on (name, company, location). Building that bridge meant fetching the whole
 * customers table — in ONE request. PostgREST caps a request at 1000 rows and there are 1,788
 * customers, so 788 of them were silently absent from the bridge and every Other Payment belonging
 * to them was dropped with no error: ₹1,72,39,898 of ₹5,76,27,920 (10 of 22 customers) vanished,
 * and every one of those customers' outstanding read high. Worse, the request carried no ORDER BY,
 * so WHICH 1000 came back was arbitrary — the same customer could be right on one load and wrong on
 * the next, and a load that happened to exclude all 22 made the report tie to Tally EXACTLY, which
 * is precisely how this was found. Keying on the GUID deletes the lookup, so the failure mode
 * cannot recur. (Same bug class as the .range()-without-.order() incident documented in
 * connectwaveFetcher.fetchAll — that one duplicated 2,064 rows.)
 *
 * Two silent-failure modes died with that bridge and must not come back:
 *   - a company missing from ext_company_map used to drop ALL its Other Payments (this file no
 *     longer knows what a company IS — it only reads GUIDs);
 *   - a `toPipelineCompany()` substring heuristic that looked for "ORANGE O TEC" inside "O-tec".
 * If you ever find yourself matching a customer by NAME in here, stop: that is the bug.
 */
import { fetchOtherPaymentRows, type OtherPaymentRow } from "./musterApi";
import type { AgingBuckets, Customer, CustomerDetail, OtherPaymentTransaction } from "./types";

/** Which aging bucket an overdue bill sits in (same edges as AgingBuckets). */
function bucketOf(overdueDays: number): keyof AgingBuckets | null {
  if (overdueDays <= 0) return null;
  if (overdueDays <= 30) return "0_30";
  if (overdueDays <= 60) return "31_60";
  if (overdueDays <= 90) return "61_90";
  if (overdueDays <= 120) return "91_120";
  if (overdueDays <= 180) return "121_180";
  return "180_plus";
}

/**
 * Net the Other Payments into a live snapshot, in place.
 * Returns the total applied (₹) — 0 when the master is empty or unreachable.
 *
 * NOTE the caller must not discard the return value: it is the ONLY way to see how much landed.
 * (connectwaveFetcher logs it. Before 2026-07-17 it was thrown away, which is why the netting could
 * silently apply nothing for weeks without anyone noticing.)
 */
export async function applyOtherPaymentsToLive(
  cust: Customer[],
  inv: Record<string, CustomerDetail>,
): Promise<number> {
  // Fail-soft: an unreachable master must not break the whole report. It DOES mean every outstanding
  // reads high, so the caller logs the applied total — a 0 here is visible, not mysterious.
  let opRows: OtherPaymentRow[];
  try {
    opRows = await fetchOtherPaymentRows();
  } catch (e) {
    console.error("[liveOtherPayments] could not read ext_other_payments — NO Other Payments were " +
      "applied, so every outstanding figure reads high:", e);
    return 0;
  }
  if (!opRows.length) return 0;

  // Group by the Tally GUID. No name matching, no company/location, no cross-project lookup: the
  // payment carries the ledger GUID and `c.id` IS that GUID.
  const byLedger = new Map<string, OtherPaymentRow[]>();
  for (const r of opRows) {
    const list = byLedger.get(r.ledger_id);
    if (list) list.push(r);
    else byLedger.set(r.ledger_id, [r]);
  }
  // The waterfall is order-sensitive (residue pays the oldest bill first), so fix the order rather
  // than inherit whatever the database happened to return.
  for (const list of byLedger.values()) {
    list.sort((a, b) => (a.payment_date ?? "").localeCompare(b.payment_date ?? "") || a.id - b.id);
  }

  let totalApplied = 0;

  for (const c of cust) {
    const rows = byLedger.get(c.id);
    if (!rows?.length) continue;

    const detail = inv[c.id];
    // Oldest due first — the same order the pipeline's FIFO walks.
    const bills = (detail?.invoices ?? [])
      .slice()
      .sort((a, b) => (a.dueDate || a.date || "").localeCompare(b.dueDate || b.date || ""));
    const byRef = new Map(bills.map((b) => [b.billRefName, b]));

    const txns: OtherPaymentTransaction[] = [];
    let total = 0;
    let residue = 0;
    // How much of `total` comes out of OVERDUE rather than merely out of outstanding. Recorded (not
    // discarded) because the Collection Report needs it to put a PAST month's Pending on the same
    // basis as this month's — see Customer.otherPaymentsOverdueAdj.
    let overdueAdj = 0;

    // (1) rows that name a bill settle that bill
    for (const r of rows) {
      const amt = Math.abs(Number(r.amount) || 0);
      if (amt <= 0) continue;
      total += amt;
      // Storage → display shape: allocation_type/remarks are the column names, type/remark are what
      // every report reads. Mapping here is what keeps OtherPaymentTransaction (and its readers)
      // untouched by this change.
      txns.push({
        date: r.payment_date, amount: amt, type: r.allocation_type ?? "",
        refInvoice: r.ref_invoice, paymentRef: r.payment_ref, remark: r.remarks,
      });

      const ref = (r.ref_invoice ?? "").trim();
      const named = ref ? byRef.get(ref) : undefined;
      // Exact, not `.includes("AGST")`. The loose test existed to survive free-text typos from the
      // feed sheet ("Agst Ref", "AGST. REF"); allocation_type is now pinned by a DB check
      // constraint, the muster-write validator and the UI Select, so anything outside the two
      // allowed values cannot exist — and a silent mismatch becomes impossible rather than unlikely.
      const isAgainst = r.allocation_type === "AGST REF";
      if (named && isAgainst && named.pending > 0) {
        const applied = Math.min(amt, named.pending);
        named.pending -= applied;
        named.otherPaymentAdj = (named.otherPaymentAdj ?? 0) + applied;
        overdueAdj += settle(c, named.overdueDays, applied);
        residue += amt - applied;
      } else {
        residue += amt;
      }
    }

    // (2) the residue pays down the customer's remaining open bills, oldest first
    for (const b of bills) {
      if (residue <= 0) break;
      if (b.pending <= 0) continue;
      const applied = Math.min(residue, b.pending);
      b.pending -= applied;
      b.otherPaymentAdj = (b.otherPaymentAdj ?? 0) + applied;
      overdueAdj += settle(c, b.overdueDays, applied);
      residue -= applied;
    }

    // (3) headline always drops by the full amount; anything still unallocated is on account.
    // That unconditional drop is what makes the Dashboard's build-up panel exact: summed across
    // every customer, (Tally's outstanding) − (Other Payments) = (the outstanding we show).
    c.outstanding -= total;
    c.otherPayments = total;
    // Applied = landed on a real bill; OnAccount = had no bill left to settle. These only feed the
    // consolidation sums today, but a screen reading them would otherwise quietly see 0 in Live mode.
    c.otherPaymentsApplied = total - residue;
    c.otherPaymentsOnAccount = residue;
    // ≤ otherPaymentsApplied: money can land on a bill that was not yet due, which reduces
    // outstanding but never touched overdue.
    c.otherPaymentsOverdueAdj = overdueAdj;
    c.advanceBreakdown = { ...c.advanceBreakdown, otherPayment: residue };
    if (c.outstanding < 0) c.advanceBalance = -c.outstanding;
    if (detail) detail.otherPaymentTransactions = txns;

    // maxOverdueDays / risk follow the bills that are still open
    const stillOpen = bills.filter((b) => b.pending > 0);
    c.maxOverdueDays = stillOpen.reduce((m, b) => Math.max(m, b.overdueDays || 0), 0);
    c.utilization = c.creditLimit > 0 ? Math.round((c.outstanding / c.creditLimit) * 1000) / 10 : 0;
    c.risk = categorize(c.maxOverdueDays, c.utilization);
    totalApplied += total;
  }

  return totalApplied;
}

/**
 * Take a settled amount out of the customer's overdue total and its aging bucket.
 * Returns how much actually came OUT OF OVERDUE — which is not `applied`: a bill that isn't due yet
 * was never in the overdue total, and the clamps below can absorb the rest. The caller totals this
 * into c.otherPaymentsOverdueAdj; do not assume it equals `applied`.
 */
function settle(c: Customer, overdueDays: number, applied: number): number {
  const b = bucketOf(overdueDays);
  if (!b) return 0;                     // not yet due → it was never in overdue/aging
  const removed = Math.min(applied, c.overdue);
  c.overdue = Math.max(0, c.overdue - applied);
  c.agingBuckets[b] = Math.max(0, c.agingBuckets[b] - applied);
  return removed;
}

/** Same bands as useAppData.categorizeRisk / connectwaveFetcher.categorizeRisk. */
function categorize(maxOD: number, util: number): Customer["risk"] {
  if (maxOD > 180 || util > 100) return "critical";
  if (maxOD > 90 || util > 75) return "high";
  if (maxOD > 30 || util > 50) return "medium";
  return "low";
}
