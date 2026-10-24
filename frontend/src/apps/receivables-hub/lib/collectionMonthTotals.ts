/**
 * collectionMonthTotals.ts — the Salesperson Collection Report's month figures, as totals.
 *
 * Fund Flow's "Customer Collections" receipt line is LINKED to that report (user, 24-Oct-2026):
 * its Target is the report's Planned, its Received the report's Received, and its Due the report's
 * Due, for the same month — group-wide and per company. This module computes those three totals.
 *
 * ⚠ KEEP IN STEP WITH pages/SalespersonCollectionReport.tsx → `metricsForMonth`, `planCarrier`,
 *   `otherPaymentsByCustomerMonth`, `otherPaymentsCumByCustomerMonth`, `filteredCustomers` and
 *   `baseRows`. This is that logic specialised to the report's DEFAULT view, which is the view the
 *   Fund Flow figure means:
 *     - every company, location, salesperson and collection team
 *     - Customer Segment = Active (any sales / receipts / credit notes / other payments in the FY,
 *       judged on the customer's combined name — see the report's segment note)
 *     - categories: nothing ticked = everybody except Legal
 *     - no sale-type filter, so every share is 1 and nothing is projected
 *   A change to how that report counts Received, Due or Planned must be made here too, or the two
 *   screens will disagree.
 *
 * Pure: hand it what `useAppData({})` and `useCollectionPlan(months)` return.
 */
import { creditsOfLedger } from "./agingReport";
import { matchesCategory } from "./customerCategory";
import { isoToMonthLabel, monthLabelToEndDate } from "./months";
import type { Customer, CustomerDetail } from "./types";

export interface CollectionFig { target: number; received: number; due: number }

export interface CollectionMonthTotals {
  month: string;
  total: CollectionFig;
  byCompany: { company: string; fig: CollectionFig }[];
  /** Customers counted, for the "based on N customers" note. */
  customers: number;
}

const KEY_SEP = "|||";
const ledgerKeyOf = (c: Customer): string => `${c.name}${KEY_SEP}${c.company}${KEY_SEP}${c.location}`;

export function collectionMonthTotals(args: {
  month: string; // "Oct-26"
  allCustomers: Customer[];
  customerDetail: Record<string, CustomerDetail>;
  /** dashboard.asOfDate — the live figures' "as on" date. */
  asOfDate: string;
  /** The FY's month labels in order (dashboard.trend); the last is the as-of month. */
  months: string[];
  isLive: boolean;
  plannedFor: (month: string, type: "customer", name: string) => number;
}): CollectionMonthTotals {
  const { month, allCustomers, customerDetail, asOfDate, months, isLive, plannedFor } = args;
  const asOfMonth = months.length ? months[months.length - 1] : "";

  // filteredCustomers at the report's defaults: Legal off, then the Active segment.
  let d = allCustomers.filter((c) => matchesCategory(c, []));
  const act = new Map<string, number>();
  for (const c of d) {
    act.set(c.name, (act.get(c.name) ?? 0) + c.sales + c.receipts + c.creditNotes + (c.otherPayments ?? 0));
  }
  d = d.filter((c) => (act.get(c.name) ?? 0) > 0);

  // planCarrier: each plan lands on exactly ONE ledger of that name — the one with the largest
  // gross due, ties by ledger key — so a name with three ledgers is not counted three times.
  const carrier = new Map<string, Customer>();
  for (const c of d) {
    const a = carrier.get(c.name);
    const da = a ? a.overdueGross ?? a.overdue ?? 0 : -Infinity;
    const db = c.overdueGross ?? c.overdue ?? 0;
    if (!a || db > da || (db === da && ledgerKeyOf(c) < ledgerKeyOf(a))) carrier.set(c.name, c);
  }
  const plannedById = new Map<string, number>();
  for (const [name, c] of carrier) {
    const amt = plannedFor(month, "customer", name);
    if (amt) plannedById.set(c.id, amt);
  }

  const monthEnd = month ? monthLabelToEndDate(month) : null;
  const asOf = new Date(asOfDate);
  const byCompany = new Map<string, CollectionFig>();
  const total: CollectionFig = { target: 0, received: 0, due: 0 };
  let counted = 0;

  for (const c of d) {
    const det = customerDetail[c.id];
    const mt = det?.trend.find((t) => t.month === month);
    let op = 0;
    for (const t of det?.otherPaymentTransactions ?? []) {
      if (t.date && isoToMonthLabel(t.date) === month) op += t.amount;
    }
    const received = (mt?.receipts ?? 0) * 100_000 + op;

    let openDue: number;
    let outstanding: number;
    let pendingGross: number;
    if (month === asOfMonth) {
      outstanding = c.outstanding;
      let dueSoon = 0;
      for (const inv of det?.invoices ?? []) {
        if (inv.pending > 0 && (inv.overdueDays ?? 0) <= 0) {
          const dd = new Date(inv.dueDate);
          if (monthEnd && dd > asOf && dd <= monthEnd) dueSoon += inv.pending;
        }
      }
      pendingGross = (c.overdueGross ?? c.overdue) + dueSoon;
      const onAccount = isLive ? Math.min(creditsOfLedger(c, det).total, pendingGross) : 0;
      openDue = pendingGross - onAccount;
    } else {
      outstanding = (mt?.outstanding ?? 0) * 100_000;
      openDue = (mt?.overdue ?? 0) * 100_000;
      if (isLive && monthEnd) {
        let cum = 0;
        const end = monthEnd.getTime();
        for (const t of det?.otherPaymentTransactions ?? []) {
          const dt = t.date ? new Date(t.date).getTime() : NaN;
          if (Number.isNaN(dt) || dt <= end) cum += Math.abs(t.amount);
        }
        if (cum > 0) {
          outstanding -= cum;
          const opTotal = c.otherPayments ?? 0;
          const ratio = opTotal > 1e-9 ? (c.otherPaymentsOverdueAdj ?? 0) / opTotal : 0;
          openDue = Math.max(0, openDue - cum * ratio);
        }
      }
      pendingGross = openDue;
    }
    const planned = plannedById.get(c.id) ?? 0;

    // baseRows: the report lists (and totals) only ledgers with something to show.
    if (!(Math.round(outstanding) !== 0 || Math.round(pendingGross + received) !== 0 || planned !== 0)) continue;

    const due = openDue + received;
    counted++;
    total.target += planned; total.received += received; total.due += due;
    const k = c.company || "(Blank)";
    const f = byCompany.get(k) ?? { target: 0, received: 0, due: 0 };
    f.target += planned; f.received += received; f.due += due;
    byCompany.set(k, f);
  }

  return {
    month,
    total,
    byCompany: [...byCompany.entries()].map(([company, fig]) => ({ company, fig })).sort((a, b) => a.company.localeCompare(b.company)),
    customers: counted,
  };
}
