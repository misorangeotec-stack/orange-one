import type { NavItem } from "@/shared/components/layout/types";

const B = "/leads-dashboard";

const ic = {
  overview: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>
  ),
  leads: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h16M4 12h16M4 18h10" /></svg>
  ),
  account: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.5-6 8-6s8 2 8 6" /></svg>
  ),
};

/** Leads Dashboard sidebar nav. Everyone with the module (or admin) sees both. */
export const leadsNav: NavItem[] = [
  { label: "Overview", to: `${B}`, icon: ic.overview, section: "Leads" },
  { label: "All Leads", to: `${B}/leads`, icon: ic.leads },
  { label: "My Account", to: "/account", icon: ic.account, section: "Account" },
];
