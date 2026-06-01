import type { NavItem } from "@/shared/components/layout/types";

const B = "/admin";

const ic = {
  checklist: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
  ),
  departments: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-3" /></svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3 3-5 6-5s6 2 6 5" /><circle cx="17.5" cy="9" r="2.4" /><path d="M16 14c3 0 5 2 5 5" /></svg>
  ),
  hierarchy: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="5" rx="1" /><rect x="3" y="16" width="6" height="5" rx="1" /><rect x="15" y="16" width="6" height="5" rx="1" /><path d="M12 8v4M6 16v-2h12v2" /></svg>
  ),
  access: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
  ),
};

/** Admin area sidebar nav (admin-only area, so no per-item role gating needed). */
export const adminNav: NavItem[] = [
  { label: "Checklist", to: `${B}`, icon: ic.checklist, section: "Administration" },
  { label: "Departments", to: `${B}/departments`, icon: ic.departments },
  { label: "Users", to: `${B}/users`, icon: ic.users },
  { label: "Hierarchy", to: `${B}/hierarchy`, icon: ic.hierarchy },
  { label: "Module Access", to: `${B}/access`, icon: ic.access },
];
