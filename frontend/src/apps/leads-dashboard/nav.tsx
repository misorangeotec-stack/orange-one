import type { NavItem } from "@/shared/components/layout/types";

const B = "/leads-dashboard";

const ic = {
  overview: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>
  ),
  leads: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h16M4 12h16M4 18h10" /></svg>
  ),
  masters: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></svg>
  ),
  account: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.5-6 8-6s8 2 8 6" /></svg>
  ),
};

/**
 * Leads Dashboard sidebar nav. Everyone with the module (or admin) sees the two
 * Leads items; Masters is admin-only — `roles` is filtered by the shell (Sidebar).
 */
export const leadsNav: NavItem[] = [
  { label: "Overview", to: `${B}`, icon: ic.overview, section: "Leads" },
  { label: "All Leads", to: `${B}/leads`, icon: ic.leads },
  { label: "Masters", to: `${B}/masters`, icon: ic.masters, roles: ["admin"], section: "Administration" },
  { label: "My Account", to: "/account", icon: ic.account, section: "Account" },
];
