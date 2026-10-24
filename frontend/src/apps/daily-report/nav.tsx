import type { NavItem } from "@/shared/components/layout/types";

const B = "/daily-report";

const ic = {
  report: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19V5a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
      <path d="M14 3v5h5M8 12h7M8 16h4" />
    </svg>
  ),
  balances: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10h18M5 10V7l7-4 7 4v3" />
      <path d="M6 10v7M10 10v7M14 10v7M18 10v7M3 21h18" />
    </svg>
  ),
  accounts: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18M7 15h4" />
    </svg>
  ),
  mail: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  ),
  account: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.5-6 8-6s8 2 8 6" />
    </svg>
  ),
};

/**
 * `badge` on Bank balances is filled in by the layout from
 * daily_report_balance_status(), not hard-coded here.
 *
 * It is the most useful of the three places incompleteness shows: the chip on
 * the entry screen only helps someone already there, and the red KPI tile only
 * helps someone reading the report. The badge is what reaches the person who
 * opens neither — which is usually the person who has to type the number.
 */
export const dailyReportNav = (missingToday: number): NavItem[] => [
  { label: "Daily Report", to: B, icon: ic.report, section: "Daily Report" },
  {
    label: "Bank balances",
    to: `${B}/bank-balances`,
    icon: ic.balances,
    badge: missingToday > 0 ? missingToday : undefined,
  },
  { label: "Bank accounts", to: `${B}/bank-accounts`, icon: ic.accounts, section: "Setup" },
  // ⚠ A SIBLING PATH, NOT A CHILD OF ANYTHING. The sidebar exact-matches two-segment paths, so a
  //   nested item would light its parent up as well as itself.
  { label: "Email", to: `${B}/email`, icon: ic.mail },
  { label: "My Account", to: "/account", icon: ic.account, section: "Account" },
];
