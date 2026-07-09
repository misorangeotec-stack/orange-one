import type { AppManifest } from "../types";
import FmsControlCenterApp from "./FmsControlCenterApp";

/**
 * Manifest for the FMS Control Center — the cross-process scoreboard. One row per
 * FMS showing the step-work due today (In Queue / Delayed), tomorrow and the day
 * after; click through to that FMS's own control center.
 *
 * Granted per user in Admin → Module Access, so a process coordinator can watch
 * every process without being an admin of any of them.
 */
export const fmsControlCenterApp: AppManifest = {
  id: "fms-control-center",
  name: "FMS Control Center",
  description: "Pending work across every business process, by the day it falls due — spot delays before they compound.",
  basePath: "/fms-control-center",
  status: "live",
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18" />
      <path d="M9 9v11" />
      <circle cx="15.5" cy="14.5" r="1.6" fill="#FF6A1F" stroke="none" />
    </svg>
  ),
  Component: FmsControlCenterApp,
};
