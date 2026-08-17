/**
 * appDataCore.ts — the React-free half of useAppData.
 *
 * `consolidateByName` and the risk banding it depends on used to live inside useAppData.ts,
 * which imports react and @tanstack/react-query. That is fine in the browser and fatal
 * anywhere else: the scheduled-report runner has to rebuild a report server-side (Deno, no
 * DOM, no React) and produce the SAME numbers the screen shows, so every step of the
 * calculation has to be importable without dragging a rendering library in behind it.
 *
 * Nothing here is new logic — it is the same code, moved. useAppData.ts re-exports it, so
 * every existing `import { consolidateByName } from "@hub/lib/useAppData"` keeps working.
 */
import type {
  AdvanceBreakdown, AgingBuckets, ConsolidatedCustomer, Customer, RiskCategory,
} from "./types";
import { utilizationPct } from "./receivables";

/**
 * The single risk-band rule for the whole hub.
 *
 * connectwaveFetcher.ts used to carry a byte-identical copy under a "keep in sync" comment.
 * It now imports this one — a rule that decides whether a customer reads as `critical` is
 * exactly the kind of thing that must not have two homes, least of all once it is also being
 * evaluated on a server and mailed to a director.
 */
export function categorizeRisk(maxOD: number, util: number): RiskCategory {
  if (maxOD > 180 || util > 100) return "critical";
  if (maxOD > 90  || util > 75)  return "high";
  if (maxOD > 30  || util > 50)  return "medium";
  return "low";
}

/**
 * Merge a customer's per-company/per-location LEDGER rows into one row per customer NAME.
 *
 * ⚠ Order matters when this is combined with salesperson scoping. useAppData filters the RAW
 * ledgers by salesperson FIRST and consolidates AFTER (see the chokepoint in useAppData.ts).
 * Consolidating first and scoping second gives different totals for any customer whose ledgers
 * sit under more than one salesperson — a small number of real accounts. Server-side callers
 * must reproduce the scope-then-consolidate order, not the reverse.
 *
 * ⚠ The spread of `...entries[0]` means any field NOT explicitly summed below carries only the
 * FIRST ledger's value — notably monthlyReceipts / lastReceiptDate / openingBalance. This is
 * long-standing and deliberate; lib/collections.ts documents it as "the consolidateByName trap"
 * and works from raw ledgers for exactly that reason.
 */
export function consolidateByName(customers: Customer[]): ConsolidatedCustomer[] {
  const groups = new Map<string, Customer[]>();
  for (const c of customers) {
    if (!groups.has(c.name)) groups.set(c.name, []);
    groups.get(c.name)!.push(c);
  }
  return Array.from(groups.values()).map((entries) => {
    const numSum = (key: keyof Customer) =>
      entries.reduce((s, c) => s + ((c[key] as number) ?? 0), 0);

    const outstanding   = numSum("outstanding");
    const creditLimit   = Math.max(...entries.map((c) => c.creditLimit ?? 0));
    const maxOverdueDays = Math.max(...entries.map((c) => c.maxOverdueDays));
    const utilization   = utilizationPct({ outstanding, creditLimit });
    const risk = categorizeRisk(maxOverdueDays, utilization);

    const proposedCreditLimit3M = numSum("proposedCreditLimit3M");
    const proposedCreditLimitAI = numSum("proposedCreditLimitAI");
    const proposedCreditLimit3MDeltaPct = creditLimit > 0
      ? Math.round((proposedCreditLimit3M - creditLimit) / creditLimit * 1000) / 10
      : null;
    const proposedCreditLimitAIDeltaPct = creditLimit > 0
      ? Math.round((proposedCreditLimitAI - creditLimit) / creditLimit * 1000) / 10
      : null;

    const proposedConstituents = entries.map((c) => ({
      customerId:   c.id,
      customerName: c.name,
      company:      c.company,
      location:     c.location,
      creditLimit:  c.creditLimit,
      proposedAI:   c.proposedCreditLimitAI,
      deltaPct:     c.proposedCreditLimitAIDeltaPct,
      proposed3M:   c.proposedCreditLimit3M,
      delta3MPct:   c.proposedCreditLimit3MDeltaPct,
      reason:       c.proposedCreditLimitReason,
    }));

    const agingBuckets = entries.reduce((acc, c) => {
      for (const k of Object.keys(c.agingBuckets ?? {}) as (keyof AgingBuckets)[])
        acc[k] = (acc[k] ?? 0) + (c.agingBuckets[k] ?? 0);
      return acc;
    }, {} as AgingBuckets);

    const sumByType = (
      field: "salesByType" | "receiptsByType" | "creditNotesByType" | "outstandingByType" | "overdueByType" | "openingBalanceByType"
    ) =>
      entries.reduce((acc, c) => {
        for (const t of Object.keys(c[field] ?? {}))
          acc[t] = (acc[t] ?? 0) + ((c[field] as Record<string, number>)?.[t] ?? 0);
        return acc;
      }, {} as Record<string, number>);

    // A consolidated row is "blocked" if ANY constituent carries the blocked
    // sentinel (credit limit == 1 in at least one company/location).
    const blocked = entries.some((c) => c.blocked === true);

    return {
      ...entries[0],
      blocked,
      sales:                   numSum("sales"),
      receipts:                numSum("receipts"),
      otherPayments:           numSum("otherPayments"),
      otherPaymentsApplied:    numSum("otherPaymentsApplied"),
      otherPaymentsOnAccount:  numSum("otherPaymentsOnAccount"),
      creditNotes:             numSum("creditNotes"),
      debitNotes:              numSum("debitNotes"),
      journalDr:               numSum("journalDr"),
      journalCr:               numSum("journalCr"),
      journalAdjustments:      numSum("journalAdjustments"),
      openingBalanceAdjustment: numSum("openingBalanceAdjustment"),
      checkReturns:            numSum("checkReturns"),
      paymentsOut:             numSum("paymentsOut"),
      // Both sides of the Overdue bridge roll up by plain addition, because the DB capped
      // On Account PER LEDGER before we ever saw it. That is what makes customer-level,
      // group-level and ledger-level totals agree without a second code path.
      overdueGross:            numSum("overdueGross"),
      onAccount:               numSum("onAccount"),
      outstanding,
      overdue:                 numSum("overdue"),
      openingBalance:          numSum("openingBalance"),
      remainingOpeningBalance: numSum("remainingOpeningBalance"),
      obReceiptsApplied:       numSum("obReceiptsApplied"),
      obCreditNotesApplied:    numSum("obCreditNotesApplied"),
      advanceBalance:          numSum("advanceBalance"),
      advanceBreakdown: {
        onAccount:     entries.reduce((s, c) => s + (c.advanceBreakdown?.onAccount     ?? 0), 0),
        agstRefExcess: entries.reduce((s, c) => s + (c.advanceBreakdown?.agstRefExcess ?? 0), 0),
        creditNotes:   entries.reduce((s, c) => s + (c.advanceBreakdown?.creditNotes   ?? 0), 0),
        otherPayment:  entries.reduce((s, c) => s + (c.advanceBreakdown?.otherPayment  ?? 0), 0),
      } as AdvanceBreakdown,
      creditLimit,
      maxOverdueDays,
      creditPeriod:            Math.max(...entries.map((c) => c.creditPeriod)),
      utilization,
      risk,
      agingBuckets,
      proposedCreditLimit3M,
      proposedCreditLimitAI,
      proposedCreditLimit3MDeltaPct,
      proposedCreditLimitAIDeltaPct,
      proposedConstituents,
      salesByType:        sumByType("salesByType")        as Customer["salesByType"],
      receiptsByType:     sumByType("receiptsByType")     as Customer["receiptsByType"],
      creditNotesByType:  sumByType("creditNotesByType")  as Customer["creditNotesByType"],
      outstandingByType:  sumByType("outstandingByType")  as Customer["outstandingByType"],
      overdueByType:      sumByType("overdueByType")      as Customer["overdueByType"],
      openingBalanceByType: sumByType("openingBalanceByType") as Customer["openingBalanceByType"],
      companies:               [...new Set(entries.map((c) => c.company))].sort(),
      locations:               [...new Set(entries.map((c) => c.location))].sort(),
      constituentIds:          entries.map((c) => c.id),
      salesPersons:            [...new Set(entries.map((c) => c.salesPerson).filter(Boolean))].sort(),
      categories:              [...new Set(entries.map((c) => c.category).filter(Boolean))].sort(),
    } as ConsolidatedCustomer;
  });
}
