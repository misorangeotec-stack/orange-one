/**
 * ADVANCES NOT APPLIED — money a customer has paid that no open invoice has absorbed (RC-18).
 *
 * Pure: no React, no fetch. The page builds its rows here from `useAppData`'s scoped customers and
 * bills, then explains each row once the voucher lines behind it arrive (lib/onAccountEntries).
 *
 * ── Why this is NOT `Customer.onAccount` ──
 * The snapshot's `on_account` is CAPPED at the ledger's gross overdue by collection_refresh():
 * `least(credit on named refs + untagged, max(0, overdue))`. That is the right number for the
 * Collection Report, which only asks how much credit offsets overdue. It is the wrong number for
 * this report, which asks how much money is waiting to be placed against an invoice. Measured
 * 17-09-2026: capped 161 customers · ₹13.73 Cr; uncapped 250 · ₹29.61 Cr. The cap hid 87 customers
 * holding ₹15.00 Cr — ₹4.86 Cr of it received on account by a single customer with no open bill.
 * The client chose the uncapped figure; the capped one stays on every row as a tie-back column.
 *
 * ── The figure, per ledger ──
 *   On a named ref   Σ −pending over bills with a CREDIT balance (M/C ADV, ON ACCOUNT, an over-paid
 *                    bill). Each one names itself, so it needs no lookup.
 *   Untagged         max(0, Σ pending − outstanding): what the ledger has received beyond its bills.
 *                    Mirrors collection_refresh's guard exactly — a DEBIT bill with no bill date AND
 *                    no due date is left out of the sum (orphan debits; ₹25.6 L on 9 of these
 *                    customers), because it makes the bills run ahead of the ledger for the opposite
 *                    reason and would hide real credit.
 *   Manual           the part of Untagged that is a manual Other Payment with no bill left to settle
 *                    (liveOtherPayments' residue). Tally never saw it, so no voucher can explain it.
 *   Unapplied credit On a named ref + Untagged.
 *
 * ⚠ The caller must pass `useAppData()`'s bills UNFILTERED. A sale-type filter strips bills from
 *   `customerDetail`, which silently inflates Σ pending − outstanding.
 */
import type { Customer, CustomerDetail, Invoice } from "./types";
import { isUnset } from "./nameMasters";
import { displayableEntries, entryLabel, type OnAccountEntry } from "./onAccountEntries";

/** The salesperson value that marks a group company. Its balances get their own section. */
export const RELATED_PARTY = "RELATED PARTY";
export const NO_SALESPERSON = "No salesperson";

/** Half a paisa. Anything above it is real money — ₹0.50 on two ledgers today is not noise. */
export const PAISA = 0.005;

/** Rupees to the paisa, so float residue from long sums never reads as money. */
const toPaise = (n: number) => Math.round(n * 100) / 100;

/**
 * A bill this money could be settled against — the same test Customer Detail uses to list a bill
 * (`amount > 0`), narrowed to the ones still owing. The 10 zero-amount "bills" with no date that sit
 * on credit customers are orphan debits, not invoices, and that page does not show them either.
 */
export function isOpenBill(inv: Invoice): boolean {
  return inv.billType !== "Agst Ref" && inv.amount > 0 && inv.pending > 0;
}

export interface CreditOnRef {
  ref: string;
  /** ISO yyyy-mm-dd; "" when Tally carried no date. */
  date: string;
  amount: number;
}

export interface AdvanceRow {
  ledgerId: string;
  customer: string;
  company: string;
  location: string;
  /** "" when unset. `OTHERS` is a real salesperson, not an unset one. */
  salesPerson: string;
  /** "" when unset. */
  collectionTeam: string;
  relatedParty: boolean;
  unapplied: number;
  namedRef: number;
  /** Includes `manual`. */
  untagged: number;
  manual: number;
  /** untagged − manual: the part voucher lines in Tally might explain. */
  tallyUntagged: number;
  namedRefCredits: CreditOnRef[];
  openBills: Invoice[];
  openPending: number;
  outstanding: number;
  /** The capped snapshot figure the Collection Report shows. Tie-back only. */
  onAccount: number;
}

/** Every scoped customer holding unapplied credit, largest first. */
export function buildAdvanceRows(
  customers: Customer[],
  detail: Record<string, CustomerDetail>,
): AdvanceRow[] {
  const out: AdvanceRow[] = [];
  for (const c of customers) {
    const bills = detail[c.id]?.invoices ?? [];
    let pendingGuarded = 0;
    let namedRef = 0;
    const namedRefCredits: CreditOnRef[] = [];
    for (const b of bills) {
      const p = b.pending || 0;
      if (p < 0) {
        namedRef -= p;
        namedRefCredits.push({ ref: b.billRefName || b.number, date: b.date, amount: -p });
      }
      // The orphan-debit guard, as collection_refresh applies it (see the header).
      if (p > 0 && !b.date && !b.dueDate) continue;
      pendingGuarded += p;
    }
    namedRef = toPaise(namedRef);
    const untagged = Math.max(0, toPaise(pendingGuarded - (c.outstanding || 0)));
    const residue = c.otherPaymentsOnAccount ?? 0;
    const manual = residue > PAISA ? toPaise(Math.min(residue, untagged)) : 0;
    const tallyUntagged = toPaise(untagged - manual);
    const unapplied = toPaise(namedRef + untagged);
    if (unapplied <= PAISA) continue;

    const openBills = bills.filter(isOpenBill);
    const salesPerson = isUnset(c.salesPerson) ? "" : c.salesPerson.trim();
    out.push({
      ledgerId: c.id,
      customer: c.name,
      company: c.company,
      location: c.location,
      salesPerson,
      collectionTeam: isUnset(c.collectionTeam) ? "" : c.collectionTeam,
      relatedParty: salesPerson === RELATED_PARTY,
      unapplied,
      namedRef,
      untagged,
      manual,
      tallyUntagged,
      namedRefCredits: namedRefCredits.sort((a, b) => a.date.localeCompare(b.date)),
      openBills: openBills.slice().sort((a, b) => (a.dueDate || a.date).localeCompare(b.dueDate || b.date)),
      openPending: toPaise(openBills.reduce((s, b) => s + b.pending, 0)),
      outstanding: c.outstanding || 0,
      onAccount: c.onAccount ?? 0,
    });
  }
  return out.sort((a, b) => b.unapplied - a.unapplied || a.customer.localeCompare(b.customer));
}

/** The group a row is listed under. */
export function salespersonGroup(row: AdvanceRow): string {
  return row.salesPerson || NO_SALESPERSON;
}

export interface SalespersonGroup { name: string; rows: AdvanceRow[] }

/**
 * Rows grouped by salesperson, keeping their incoming order inside each group. Largest group first,
 * "No salesperson" LAST so a customer who lost their tag is never buried mid-page. The screen and the
 * Excel file both call this, so they cannot list the groups in different orders.
 */
export function groupBySalesperson(rows: AdvanceRow[]): SalespersonGroup[] {
  const by = new Map<string, AdvanceRow[]>();
  for (const r of rows) {
    const g = salespersonGroup(r);
    const list = by.get(g);
    if (list) list.push(r);
    else by.set(g, [r]);
  }
  const total = (list: AdvanceRow[]) => list.reduce((s, r) => s + r.unapplied, 0);
  return [...by].map(([name, list]) => ({ name, rows: list })).sort((a, b) =>
    Number(a.name === NO_SALESPERSON) - Number(b.name === NO_SALESPERSON)
    || total(b.rows) - total(a.rows)
    || a.name.localeCompare(b.name));
}

// ── Explaining a row ─────────────────────────────────────────────────────────

export type ReceiptsStatus =
  | "All named"
  | "Partly named"
  | "Opening balance only"
  | "Doesn't reconcile"
  | "Manual payment"
  | "No untagged money"
  | "Loading…";

export type ExplainKind = "manual" | "entry" | "unexplained" | "rounding" | "namedRef";

export interface ExplainLine {
  kind: ExplainKind;
  /** ISO yyyy-mm-dd, or "" for a balancing line. */
  date: string;
  label: string;
  amount: number;
}

export interface Explanation {
  status: ReceiptsStatus;
  /**
   * What makes up the row's figure. Sums to `row.unapplied` to the paisa once the entries have
   * loaded. While they are loading, the Tally-untagged part is absent — `loading` says so.
   */
  lines: ExplainLine[];
  loading: boolean;
  /** ₹ of the Tally-untagged part that named voucher lines account for. */
  namedInTally: number;
}

export const LINE_LABELS = {
  manual: "Manual Other Payment on account (recorded outside Tally)",
  partly: "Not explained by the entries above — opening balance, no receipt detail in Tally",
  noReconcile: "Tally's entries don't reconcile to this balance, so none are listed",
  opening: "Opening balance, no receipt detail in Tally",
  rounding: "Rounding",
} as const;

/**
 * Explain one row. `entriesByLedger` is undefined while the lookup is in flight.
 *
 * The voucher lines go through `displayableEntries` UNCHANGED, overshoot guard included: when the
 * named credits add up to MORE than the untagged figure the reconstruction is what is wrong, so none
 * are listed and the whole amount is one labelled line. Do not "improve" that into listing them.
 */
export function explainRow(
  row: AdvanceRow,
  entriesByLedger: Map<string, OnAccountEntry[]> | undefined,
): Explanation {
  const lines: ExplainLine[] = [];
  if (row.manual > PAISA) {
    lines.push({ kind: "manual", date: "", label: LINE_LABELS.manual, amount: row.manual });
  }

  let status: ReceiptsStatus;
  let namedInTally = 0;
  let loading = false;

  if (row.tallyUntagged <= PAISA) {
    status = row.manual > PAISA ? "Manual payment" : "No untagged money";
  } else if (!entriesByLedger) {
    status = "Loading…";
    loading = true;
  } else {
    const entries = entriesByLedger.get(row.ledgerId);
    const credits = (entries ?? []).filter((e) => e.amount > 0);
    const { shown, unexplained } = displayableEntries(entries, row.tallyUntagged);
    if (!shown.length) {
      status = credits.length ? "Doesn't reconcile" : "Opening balance only";
      lines.push({
        kind: "unexplained",
        date: "",
        label: credits.length ? LINE_LABELS.noReconcile : LINE_LABELS.opening,
        amount: row.tallyUntagged,
      });
    } else {
      for (const e of shown) {
        lines.push({ kind: "entry", date: e.date, label: entryLabel(e), amount: e.amount });
        namedInTally += e.amount;
      }
      const rest = toPaise(unexplained);
      if (rest >= 1) {
        status = "Partly named";
        lines.push({ kind: "unexplained", date: "", label: LINE_LABELS.partly, amount: rest });
      } else {
        status = "All named";
        // displayableEntries lets the named lines run up to ₹1 past the figure, so the balancing
        // line can be negative. Shown either way: the lines must add up to the row.
        if (Math.abs(rest) > PAISA) {
          lines.push({ kind: "rounding", date: "", label: LINE_LABELS.rounding, amount: rest });
        }
      }
    }
  }

  for (const cr of row.namedRefCredits) {
    lines.push({ kind: "namedRef", date: cr.date, label: `On named ref · ${cr.ref}`, amount: cr.amount });
  }
  return { status, lines, loading, namedInTally: toPaise(namedInTally) };
}
