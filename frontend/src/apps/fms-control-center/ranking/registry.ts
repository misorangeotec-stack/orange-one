/**
 * Which FMS the monthly ranking scores (CC-1).
 *
 * ⚠ THIS FILE IS CHECKED AGAINST THE CONTROL CENTER AT BUILD TIME.
 *   supabase/ranking/build.mjs reads `adapters/registry.ts` and refuses to build if
 *   an adapter there is neither in RANKED_MODULES nor in NOT_SCORED below. So a new
 *   FMS added to the Control Center can never silently drop out of the ranking:
 *   somebody has to wire its scorer, or write down why not.
 *
 * Scored here is not the same as counted tonight. An admin switches whole modules
 * in or out of the ranking from the Control Center (`fms_rank_modules`) — the
 * switch the user asked for on 18-09-2026 for modules not in use yet. This file
 * says what CAN be scored; the switch says what IS.
 */
import type { AnyScorer } from "./types";
import { assetMaintenanceScorer } from "./modules/assetMaintenance";
import { hrRecruitmentScorer } from "./modules/hrRecruitment";
import { importScorer } from "./modules/import";
import { learningDevelopmentScorer } from "./modules/learningDevelopment";
import { ocpiScorer } from "./modules/ocpi";
import { officeSuppliesScorer } from "./modules/officeSupplies";
import { orderToDispatchScorer } from "./modules/orderToDispatch";
import { productionEntryScorer } from "./modules/productionEntry";
import { purchaseScorer } from "./modules/purchase";
import { samplingScorer } from "./modules/sampling";
import { travelDeskScorer } from "./modules/travelDesk";

/** Keyed by the Control Center adapter key, in the Control Center's own order. */
export const RANKED_MODULES: Record<string, AnyScorer> = {
  purchase: purchaseScorer,
  import: importScorer,
  hr: hrRecruitmentScorer,
  "travel-desk": travelDeskScorer,
  "office-supplies": officeSuppliesScorer,
  sampling: samplingScorer,
  "production-entry": productionEntryScorer,
  "order-to-dispatch": orderToDispatchScorer,
  "asset-maintenance": assetMaintenanceScorer,
  ocpi: ocpiScorer,
  "learning-development": learningDevelopmentScorer,
};

/**
 * Control Center adapters that deliberately have no scorer, and why. Every entry
 * needs a reason a reader can act on — "not wired yet" and "decided against" must
 * never look the same.
 */
export const NOT_SCORED: Record<string, string> = {
  "hr-exit":
    "Never used: 0 cases ever (18-09-2026), and the user switched it out of the ranking. " +
    "Its Completed-tab builder still lives inside its React store (store.tsx completedFor) and " +
    "must be moved into lib/ — as HR Recruitment's was — before it can be scored. Its clearance " +
    "checks marked N/A also record no actor.",
};
