import type { AppManifest } from "../types";
import { appName, appBasePath, appCategory } from "../appInfo";
import KraKpiApp from "./KraKpiApp";

/**
 * Manifest for the KRA / KPI Scorecard (KPI-1) — the client's weekly MIS sheet, rebuilt
 * for every employee: every module and every task / step they work, work done and work
 * done on time, and a score out of 100.
 *
 * WHO SEES WHAT IS DECIDED BY THE SERVER, NOT BY THIS GRANT. Every figure comes from one
 * RPC, `kpi_report`, which checks the caller itself: their own report, their reporting
 * chain's, or anyone's for an admin. That is why the user decided (18-09-2026) the app
 * is UNIVERSAL — everyone opens their own report with no per-person grant — and it is
 * listed in UNIVERSAL_APP_IDS (apps/universal.ts). Customer logins are turned away in
 * KraKpiApp.
 */
export const kraKpiApp: AppManifest = {
  id: "kra-kpi",
  name: appName("kra-kpi"),
  description:
    "Your work done, and done on time, for any week — every module and every task, with a score out of 100.",
  basePath: appBasePath("kra-kpi"),
  status: "live",
  category: appCategory("kra-kpi"),
  order: 15,
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
      <path d="M7.5 16.5v-3M11 16.5v-6M14.5 16.5v-4.5" />
      <path d="m15.5 8.5 1.5 1.5 3-3.5" stroke="#FF6A1F" />
    </svg>
  ),
  Component: KraKpiApp,
};
