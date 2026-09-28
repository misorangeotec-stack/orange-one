import type { AppManifest } from "../types";
import { appName, appBasePath, appCategory } from "../appInfo";
import DailyReportApp from "./DailyReportApp";

/**
 * Manifest for the Daily Report — the evening snapshot management and the CFO
 * read: what was sold, collected, paid and purchased today, and what is in the
 * bank.
 *
 * ITS OWN MODULE RATHER THAN A PAGE INSIDE THE MASTER REPORT, for three reasons
 * that are about access rather than tidiness:
 *
 *   · Access is one app_access row per app. Folding this into the Master Report
 *     would force a CFO to hold that module as well — which also hands them the
 *     module-adoption report and the user-access matrix beside it — and would
 *     hand every current Master Report holder the company's daily cash position.
 *   · This module WRITES. Somebody types eleven bank balances into it every
 *     evening, so view-versus-edit is a real distinction here; the Master Report
 *     is read-only apart from an admin settings panel.
 *   · The scheduled send, when it comes, needs its own recipients and its own
 *     hour. Sharing the adoption digest's would leave one of the two lists
 *     permanently wrong.
 *
 * First in Control because it is the most senior read in the group — the
 * operational boards beside it answer "what is due" and "who is stuck"; this one
 * answers "what did the business do".
 */
export const dailyReportApp: AppManifest = {
  id: "daily-report",
  name: appName("daily-report"),
  description:
    "What was sold, collected, paid and purchased today, and what is in the bank — one page, every evening.",
  basePath: appBasePath("daily-report"),
  status: "live",
  category: appCategory("daily-report"),
  order: 5,
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19V5a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
      <path d="M14 3v5h5" />
      <path d="M8 17v-3M12 17v-6M16 17v-4" />
      <circle cx="16" cy="12" r="1.4" fill="#FF6A1F" stroke="none" />
    </svg>
  ),
  Component: DailyReportApp,
};
