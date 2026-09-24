/**
 * Every source of work the home screen aggregates, in display order.
 *
 * Adding one is deliberately small: write a provider file exposing a `useMyWork`
 * hook that returns `WorkItem[]`, then add it here. Nothing else changes — the
 * KPIs, the worklist, the per-source strip and the access gating all derive from
 * this list.
 *
 * NOT here, on purpose:
 *  - `fms-control-center` — it is a lens on other apps' work, not a source of its
 *    own. Including it would double-count everything.
 *  - `leads-dashboard` — `app_leads` has no due date, no status and no pending
 *    assignment. There is nothing a lead can be "overdue" for. It stays a menu
 *    entry only, until a next-follow-up-date exists on leads.
 */
import type { MyWorkProvider } from "./types";
import { tasksProvider } from "./providers/tasks";
// Receivables follow-ups: written and working, but held back from release.
// `providers/followups.ts` reads `latestByEntity` from the Hub's followupTypes,
// and that change currently sits in the same working file as the in-flight
// ConnectWave company-mapping work. Shipping one would drag in the other.
// To re-enable once that lands: uncomment both lines below.
// import { followupsProvider } from "./providers/followups";
import { purchaseProvider } from "./providers/purchase";
import { importProvider } from "./providers/import";
import { hrProvider } from "./providers/hr";
import { hrExitProvider } from "./providers/hrExit";
import { officeSuppliesProvider } from "./providers/officeSupplies";
import { samplingProvider } from "./providers/sampling";
import { productionEntryProvider } from "./providers/production-entry";
import { orderToDispatchProvider } from "./providers/order-to-dispatch";
import { assetMaintenanceProvider } from "./providers/asset-maintenance";
import { travelDeskProvider } from "./providers/travel-desk";
import { learningDevelopmentProvider } from "./providers/learning-development";

export const myWorkProviders: MyWorkProvider[] = [
  tasksProvider,
  // followupsProvider,
  purchaseProvider,
  importProvider,
  hrProvider,
  hrExitProvider,
  officeSuppliesProvider,
  samplingProvider,
  productionEntryProvider,
  orderToDispatchProvider,
  assetMaintenanceProvider,
  travelDeskProvider,
  /*
   * ⚠ THE ONLY UNIVERSAL PROVIDER HERE. Every other one is narrowed by
   *   `hasModule(appId)`; Learning & Development is open to the whole company,
   *   so this one fetches for all 67 people. What it hands each of them back is
   *   almost always their OWN obligation — an invitation to answer, an
   *   assignment to hand in, feedback to give — never HR's pipeline. See
   *   ./items/learning-development.ts, which is where that line is drawn.
   */
  learningDevelopmentProvider,
];
