import type { AppManifest } from "../types";
import { appName } from "../appInfo";
import ReceivablesHubApp from "./ReceivablesHubApp";

/**
 * Manifest for the Receivables Hub (a.k.a. Outstanding Dashboard).
 * Keeps the id "outstanding-dashboard" from the original launcher placeholder so
 * any existing app_access grants keyed to that id keep working.
 */
export const receivablesHubApp: AppManifest = {
  id: "outstanding-dashboard",
  name: appName("outstanding-dashboard"),
  description: "Receivables, risk register, aging, and salesperson collections across companies.",
  basePath: "/outstanding-dashboard",
  status: "live",
  category: "sales",
  order: 10,
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="20" x2="20" y2="20" />
      <rect x="6" y="11" width="3" height="6" rx="0.5" />
      <rect x="11" y="7" width="3" height="10" rx="0.5" />
      <rect x="16" y="13" width="3" height="4" rx="0.5" stroke="#FF6A1F" />
    </svg>
  ),
  Component: ReceivablesHubApp,
};
