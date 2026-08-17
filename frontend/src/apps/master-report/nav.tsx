import type { NavItem } from "@/shared/components/layout/types";

const B = "/master-report";

const ic = {
  report: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19V5a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
      <path d="M14 3v5h5M8 13h3M8 17h6" />
    </svg>
  ),
  account: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.5-6 8-6s8 2 8 6" />
    </svg>
  ),
};

export const masterReportNav: NavItem[] = [
  { label: "Daily Snapshot", to: B, icon: ic.report, section: "Master Report" },
  { label: "My Account", to: "/account", icon: ic.account, section: "Account" },
];
