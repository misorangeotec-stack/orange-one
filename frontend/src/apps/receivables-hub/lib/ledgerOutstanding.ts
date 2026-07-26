/**
 * Ledger Outstandings — Tally's "Ledger Outstandings → Pending Bills" report, two screens:
 * a searchable/filterable ledger list, then one ledger's pending bills exactly as Tally shows them.
 *
 * The list reuses the proven keyset v_ledger_detail loader from lib/trialBalance. The per-ledger bills
 * come from the ConnectWave RPC `bill_outstanding_tally_by_id`, which is Tally-exact: pending anchored
 * to the ledger closing, due dates from each bill's OWN credit period (empty → bill date), overdue as
 * of a chosen date, and advance bills carrying their real opening amount/date. See the SQL header.
 *
 * The tenant is always the BARE company guid — never the `~<fy>` sibling. Verified: the bare-tenant RPC
 * reproduces the snapshot's named bills to the paisa even for FY-split companies (carry-forward comes
 * through the ledger master's opening bills, not the sibling book), so no book-looping is needed.
 */
import { getConnectwaveSupabase } from "./connectwaveSupabase";
import { loadTrialBalanceLedgers } from "./trialBalance";

export interface LedgerListRow {
  companyGuid: string;
  tenantId: string;          // `acct_orange::${companyGuid}`
  guid: string;              // Tally ledger guid — the detail route param
  ledger: string;
  grouping: string | null;   // top-level Tally group
  subGroup: string | null;   // immediate parent group (e.g. "Sundry Debtors")
  /** Full ancestor chain, self → parent → … → top-level. Drives the group filter so a ledger can
   *  be found by ANY group it sits under, not only its primary group. */
  groupChain: string[];
  closing: number;           // Dr-positive; the ledger's outstanding shown on the list
}

export interface LedgerBillRow {
  billRef: string | null;    // null → the On Account plug row
  billDate: string | null;   // yyyymmdd
  openingAmount: number;     // Dr-positive; negative = Cr = advance
  pendingAmount: number;     // Dr-positive
  creditPeriod: string | null;
  dueDate: string | null;    // yyyymmdd
  overdueDays: number | null;
  isOnAccount: boolean;
}

interface RawBill {
  bill_ref: string | null;
  bill_date: string | null;
  bill_amount: number | string | null;
  pending_amount: number | string | null;
  credit_period: string | null;
  due_date: string | null;
  overdue_days: number | null;
}

/** The bare company guid a ledger belongs to — the ledger guid is `<company-uuid>-<hexsuffix>`. */
export function companyGuidOfLedger(ledgerGuid: string): string {
  return ledgerGuid.replace(/-[0-9a-f]+$/i, "");
}
export function tenantOfLedger(ledgerGuid: string): string {
  return `acct_orange::${companyGuidOfLedger(ledgerGuid)}`;
}

/** Every ledger for the given companies, flattened for the list screen. */
export async function loadLedgerList(companyGuids: string[]): Promise<LedgerListRow[]> {
  const byCompany = await loadTrialBalanceLedgers(companyGuids);
  const out: LedgerListRow[] = [];
  for (const [companyGuid, rows] of Object.entries(byCompany)) {
    for (const r of rows) {
      out.push({
        companyGuid,
        tenantId: r.tenantId,
        guid: r.guid,
        ledger: r.ledger,
        grouping: r.grouping,
        subGroup: r.subGroup,
        groupChain: r.groupChain,
        closing: r.closing,
      });
    }
  }
  return out;
}

/** Name + group + opening + closing for a single ledger — so the detail screen works on a bookmarked
 *  URL, not only when arrived at from the list. Fast: filtered to one guid on the indexed view.
 *  `opening`/`closing` are Dr-positive (v_ledger_detail sign-flips them). */
export async function loadLedgerMeta(
  tenantId: string,
  ledgerGuid: string,
): Promise<{ ledger: string; grouping: string | null; opening: number; closing: number } | null> {
  const cw = getConnectwaveSupabase();
  const { data, error } = await cw
    .from("v_ledger_detail")
    .select("ledger,grouping,opening,closing")
    .eq("tenant_id", tenantId)
    .eq("guid", ledgerGuid)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as {
    ledger: string; grouping: string | null; opening: number | string | null; closing: number | string | null;
  };
  return {
    ledger: row.ledger,
    grouping: row.grouping,
    opening: Number(row.opening) || 0,
    closing: Number(row.closing) || 0,
  };
}

/** One ledger's pending bills, Tally-exact, as of `asOn` (yyyy-mm-dd). */
export async function loadLedgerBills(
  tenantId: string,
  ledgerGuid: string,
  asOn: string,
): Promise<LedgerBillRow[]> {
  const cw = getConnectwaveSupabase();
  const { data, error } = await cw.rpc("bill_outstanding_tally_by_id", {
    p_tenant: tenantId,
    p_ledger_guid: ledgerGuid,
    p_as_on: asOn,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as RawBill[]).map((r) => ({
    billRef: r.bill_ref,
    billDate: r.bill_date,
    openingAmount: Number(r.bill_amount) || 0,
    pendingAmount: Number(r.pending_amount) || 0,
    creditPeriod: r.credit_period,
    dueDate: r.due_date,
    overdueDays: r.overdue_days,
    isOnAccount: r.bill_ref === null,
  }));
}

/** Column totals — Opening and Pending, matching Tally's grand-total row. */
export function billTotals(bills: LedgerBillRow[]): { opening: number; pending: number } {
  return bills.reduce(
    (a, b) => ({ opening: a.opening + b.openingAmount, pending: a.pending + b.pendingAmount }),
    { opening: 0, pending: 0 },
  );
}
