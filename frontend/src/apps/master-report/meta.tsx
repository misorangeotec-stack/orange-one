import type { AppManifest } from "../types";
import { appName, appBasePath, appCategory } from "../appInfo";
import MasterReportApp from "./MasterReportApp";

/**
 * Manifest for the Master Report — the director's daily read on whether each
 * module is actually being USED.
 *
 * Deliberately distinct from the FMS Control Center, which sits beside it in the
 * same category. That one asks "what work is due today"; this one asks "is this
 * module alive at all" — a question nothing answered before, and the reason two
 * fully-built modules sat at zero entries without anyone noticing.
 *
 * Granted per user in Admin -> Module Access, so a director can hold it without
 * being made an admin (there is no "director" role; admins bypass module checks
 * and see it anyway).
 */
export const masterReportApp: AppManifest = {
  id: "master-report",
  name: appName("master-report"),
  description:
    "Which modules are being used, which are going quiet, and which have stopped — one row per module, refreshed daily.",
  basePath: appBasePath("master-report"),
  status: "live",
  category: appCategory("master-report"),
  order: 20,
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19V5a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
      <path d="M14 3v5h5" />
      <path d="M8 13h3" />
      <path d="M8 17h6" />
      <circle cx="16.5" cy="13" r="1.6" fill="#FF6A1F" stroke="none" />
    </svg>
  ),
  Component: MasterReportApp,
};
