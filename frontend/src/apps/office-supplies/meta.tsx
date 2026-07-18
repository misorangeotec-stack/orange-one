import type { AppManifest } from "../types";
import { appName } from "../appInfo";
import SuppliesApp from "./SuppliesApp";

/**
 * Manifest for the Office Supplies Purchase FMS — the fourth FMS module, built on the
 * same engine pattern as Purchase FMS, HR Recruitment and HR Exit (step owners,
 * planned-vs-actual due dates, per-owner queues, notifications, master governance) with
 * its own `fms_supplies_*` schema.
 *
 * Raise a request → (conditionally) first approval by the department HOD → second
 * approval by Management → final confirmation / handover. Computer & Tech Accessories
 * take both approvals; Stationery, Office Maintenance and every Services/Maintenance
 * request go straight to handover.
 *
 * It is a UNIVERSAL app (apps/universal.ts): every signed-in user reaches it with no
 * per-user grant, because any employee must be able to raise a supply request. The nav
 * and RLS are what scope it — a person with no ownership sees only their own requests.
 */
export const officeSuppliesApp: AppManifest = {
  id: "office-supplies",
  name: appName("office-supplies"),
  description:
    "Office-supply requisitions end to end: raise a request, first and second approval for computer & tech accessories, straight-to-handover for stationery, maintenance and services, and delivery tracking.",
  basePath: "/office-supplies",
  status: "live",
  category: "fms",
  subGroup: "Purchase",
  order: 30,
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7l8-4 8 4v10l-8 4-8-4V7z" />
      <path d="M4 7l8 4 8-4" stroke="#FF6A1F" />
      <path d="M12 11v10" stroke="#FF6A1F" />
    </svg>
  ),
  Component: SuppliesApp,
};
