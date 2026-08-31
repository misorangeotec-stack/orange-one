import type { AppManifest } from "../types";
import { appName, appBasePath, appCategory, appSubGroup } from "../appInfo";
import TravelDeskApp from "./TravelDeskApp";

/**
 * Manifest for Travel Desk — the twelfth FMS module, built on the same engine as
 * the others (step owners, per-owner queues, planned-vs-actual due dates,
 * notifications, module-level view/edit grants) with its own `fms_travel_*`
 * schema.
 *
 * What it is for: official travel runs on email and a spreadsheet. Nobody can
 * see what a trip is entitled to before it is booked, so the Domestic Travel
 * Policy's band-wise caps are applied — when they are applied — after the money
 * is spent. Advances are drawn and forgotten. Daily allowance is worked out by
 * hand, differently by different people. And "has this been reimbursed?" has no
 * answer anywhere.
 *
 * ⚠ ONE TRIP CARRIES THE WHOLE JOURNEY. The request, every booked leg, the
 *   advance, the expense claim and the settlement are the SAME ROW — so what was
 *   estimated can be compared with what was spent, what was entitled with what
 *   was booked, and the advance can be netted against the claim. The source PRD
 *   would have made one requisition per service, which is how a trip's cost ends
 *   up being nowhere.
 *
 * PER-USER-GRANTED (not universal) — an admin switches it on for whoever travels
 * and for whoever approves, books and pays. View-only is supported and enforced
 * in the database.
 */
export const travelDeskApp: AppManifest = {
  id: "travel-desk",
  name: appName("travel-desk"),
  description:
    "Request a trip, see what your band entitles you to before you book it, draw an advance, and claim what it cost — with the daily allowance and the policy caps worked out for you.",
  basePath: appBasePath("travel-desk"),
  status: "live",
  category: appCategory("travel-desk"),
  subGroup: appSubGroup("travel-desk"),
  // HR runs New Recruitment (10) → Employee Exit (20) → Travel Desk (30): the
  // order a person meets them, joining before leaving before expensing.
  order: 30,
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 15h18" />
      <path d="M5 15V9a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6 19v-1M18 19v-1" stroke="#FF6A1F" />
    </svg>
  ),
  Component: TravelDeskApp,
};
