import type { NavItem } from "@/shared/components/layout/types";

export const HR_REPORTS_BASE = "/hr-reports";

const ic = {
  scorecard: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  ),
  weekly: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M9 7h6M9 11h6M9 15h3" />
    </svg>
  ),
  compare: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v18" />
      <path d="M5 8 2 13h6zM19 8l-3 5h6z" />
      <path d="M5 8h14" />
    </svg>
  ),
  map: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 5h7v14H3zM14 5h7v14h-7z" />
      <path d="M10 9h4M10 15h4" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  account: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.5-6 8-6s8 2 8 6" />
    </svg>
  ),
};

const B = HR_REPORTS_BASE;

/**
 * The HR Reports sidebar.
 *
 * ⚠ SIBLING PATHS, never nested. The shared Sidebar exact-matches only two-segment
 *   paths (`end={item.to.split("/").length <= 2}`), so a route UNDER another item's
 *   path lights that item's row at the same time and the reader sees two highlighted
 *   rows with no way to tell which page they are on. Hence `/pms-compare` rather than
 *   `/pms-scorecard/compare`.
 *
 * Settings is admin-only and last, the way every other module orders it. Everything
 * above it is visible to every signed-in employee: the app is universal, and what a
 * reader may SEE is decided by the person picker inside each page, not by hiding links.
 */
export function buildHrReportsNav(opts: { isAdmin: boolean }): NavItem[] {
  const nav: NavItem[] = [
    { label: "PMS scorecard", to: B, icon: ic.scorecard, section: "My reports" },
    { label: "Weekly review report", to: `${B}/weekly-review`, icon: ic.weekly },
    { label: "Compare the rules", to: `${B}/compare`, icon: ic.compare, section: "Reference" },
    { label: "What the hub can fill", to: `${B}/weekly-review-fields`, icon: ic.map },
  ];
  if (opts.isAdmin) nav.push({ label: "Settings", to: `${B}/settings`, icon: ic.settings, section: "Administration" });
  nav.push({ label: "My Account", to: "/account", icon: ic.account, section: "Account" });
  return nav;
}
