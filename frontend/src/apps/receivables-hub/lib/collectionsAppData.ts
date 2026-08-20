/**
 * The datasets the Collection report reads, assembled without React.
 *
 * WHY THIS IS SO SHORT, WHEN `useAppData` IS 1,349 LINES
 *   The report calls `useAppData({})` — with NO filters. That matters more than it looks, because
 *   the expensive middle of that hook is filter machinery, and every bit of it is a no-op on an
 *   empty filter set:
 *
 *     customers                        company / location / risk filters — all skipped
 *     saleTypeList                      "" → [], so no sale type is selected
 *     projectedCustomers                returns `customers` UNCHANGED on the first line when
 *                                       saleTypeList is empty — the ~110-line sale-type
 *                                       projection never runs
 *     segmented/consolidatedCustomers   segment, balance, blocked, salesperson and category
 *                                       filters — all skipped
 *
 *   So for this caller the whole chain collapses to: map the `blocked` flag, consolidate ledgers
 *   by customer name, and read off the salesperson list. That is what is below, and it is why this
 *   file is not a reimplementation of the hook — it is the hook's own path for this one caller,
 *   with the branches that cannot be taken removed.
 *
 * ⚠ IF A SERVER-SIDE CALLER EVER NEEDS FILTERS, DO NOT ADD THEM HERE.
 *   The moment a sale type or a company is selected, the projection above is live and this file
 *   would be wrong in a way that produces plausible numbers rather than an error — the worst kind.
 *   Lift the real chain out of `useAppData` instead, and make both sides call it.
 *
 * ⚠ AND IT READS CONNECTWAVE. The legacy receivables project no longer exists; see CLAUDE.md.
 *   `blocked` is therefore the mirror's own flag, never the old credit-limit sentinel.
 */

import { consolidateByName } from "./appDataCore";
import type {
  ConsolidatedCustomer, Customer, CustomerDetail, CustomerGroupMap, DashboardData,
} from "./types";

/** What `loadFromConnectwave` hands back. Named here so the server entry need not import the hook. */
export interface RawCollectionsData {
  dash: DashboardData | null;
  cust: Customer[];
  inv: Record<string, CustomerDetail>;
  grp: CustomerGroupMap;
}

/** Exactly the seven things `CollectionPerformanceReport` destructures out of `useAppData`. */
export interface CollectionsAppData {
  allCustomers: Customer[];
  consolidatedCustomers: ConsolidatedCustomer[];
  customerDetail: Record<string, CustomerDetail>;
  customerGroupMap: CustomerGroupMap;
  dashboard: DashboardData | null;
  salesPersonOptions: string[];
}

export function buildCollectionsAppData(raw: RawCollectionsData): CollectionsAppData {
  // The ConnectWave branch of useAppData's `allCustomers`. The other branch (creditLimit === 1)
  // belongs to the dead pipeline source and is deliberately not reachable from here.
  const allCustomers: Customer[] = raw.cust.map((c) => ({ ...c, blocked: c.blocked === true }));

  const consolidatedCustomers = consolidateByName(allCustomers);

  const salesPersonOptions = [
    ...new Set(
      consolidatedCustomers
        .flatMap((c) => c.salesPersons ?? (c.salesPerson ? [c.salesPerson] : []))
        .filter(Boolean),
    ),
  ].sort();

  return {
    allCustomers,
    consolidatedCustomers,
    customerDetail: raw.inv,
    customerGroupMap: raw.grp,
    dashboard: raw.dash,
    salesPersonOptions,
  };
}
