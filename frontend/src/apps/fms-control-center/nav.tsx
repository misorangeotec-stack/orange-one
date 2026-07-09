import type { NavItem } from "@/shared/components/layout/types";

const B = "/fms-control-center";

const ic = {
  board: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M9 9v11M15 9v11" />
    </svg>
  ),
  account: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.5-6 8-6s8 2 8 6" />
    </svg>
  ),
};

export const fmsControlCenterNav: NavItem[] = [
  { label: "All Processes", to: B, icon: ic.board, section: "Control Center" },
  { label: "My Account", to: "/account", icon: ic.account, section: "Account" },
];
