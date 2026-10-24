import type { AppManifest } from "../types";
import { appName, appBasePath, appCategory } from "../appInfo";
import HrReportsApp from "./HrReportsApp";

/**
 * Manifest for HR Reports (HRREP-1) — the HR instruments the client writes by hand,
 * rendered from live data: the weighted PMS scorecard and the weekly review report.
 *
 * UNIVERSAL, and for the same reason the KRA / KPI Scorecard is. Every employee opens
 * their OWN report with no per-person grant, and what they may see beyond that is
 * decided page-side by lib/scope.ts and server-side by RLS — the grant would add
 * nothing except an admin ticking 67 boxes before anybody could read their own figures.
 * Customer logins are turned away in HrReportsApp.
 *
 * ⚠ It is NOT the KRA / KPI Scorecard, though both score a person out of 100. KPI-1
 *   weights by VOLUME — every task and step counts once, so the busiest row dominates.
 *   This one weights by the DECLARED IMPORTANCE written on an HR sheet, where a line
 *   worth 10% outweighs five hundred tasks. Same person, same week, two different marks,
 *   both correct. "Compare the rules" inside the app exists to show exactly that.
 */
export const hrReportsApp: AppManifest = {
  id: "hr-reports",
  name: appName("hr-reports"),
  description:
    "Your KPI sheet and your weekly review, filled in from live data — and every box the hub cannot fill yet, with the reason.",
  basePath: appBasePath("hr-reports"),
  status: "live",
  category: appCategory("hr-reports"),
  order: 45,
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 3.5h10a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5z" />
      <path d="M9 8h6M9 11.5h6M9 15h3" />
      <path d="m14.5 16.5 1.5 1.5 3-3.5" stroke="#FF6A1F" />
    </svg>
  ),
  Component: HrReportsApp,
};
