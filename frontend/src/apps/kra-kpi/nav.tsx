import type { NavItem } from "@/shared/components/layout/types";
import { appBasePath } from "../appInfo";

const B = appBasePath("kra-kpi");

const ic = {
  scorecard: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
      <path d="M7.5 16.5v-3M11 16.5v-6M14.5 16.5v-4.5" />
    </svg>
  ),
  team: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
      <circle cx="17" cy="9" r="2.6" />
      <path d="M16 13.6c2.9.2 5 2.2 5 5.4" />
    </svg>
  ),
  account: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.5-6 8-6s8 2 8 6" />
    </svg>
  ),
};

export const kraKpiNav: NavItem[] = [
  { label: "Scorecard", to: B, icon: ic.scorecard, section: "KRA / KPI" },
  // Everyone's figures side by side (KPI-2) — for admins and for HODs over their own team.
  // kpi_team enforces the same rule on the server, whatever this menu shows.
  { label: "Team", to: `${B}/team`, icon: ic.team, roles: ["admin", "hod", "sub_hod"] },
  { label: "My Account", to: "/account", icon: ic.account, section: "Account" },
];
