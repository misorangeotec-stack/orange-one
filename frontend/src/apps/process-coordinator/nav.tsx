import type { NavItem } from "@/shared/components/layout/types";

const B = "/process-coordinator";

const ic = {
  callList: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
    </svg>
  ),
  approvals: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
      <path d="m8.5 12 2.5 2.5L16 9.5" />
    </svg>
  ),
  processes: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="6" r="2" />
      <circle cx="5" cy="18" r="2" />
      <path d="M5 8v8" />
      <path d="M9 6h10M9 12h7M9 18h10" />
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
 * Three items, and that is the whole module. Call List comes first: ringing the
 * people sitting in the due buckets is the coordinator's daily job.
 *
 * `pendingApprovals` drives the badge — the count of master requests still
 * waiting, across every module. It is the one number the coordinator needs
 * before choosing which screen to open, which is exactly what a badge is for.
 */
export const processCoordinatorNav = (opts: { pendingApprovals: number }): NavItem[] => [
  { label: "Pending & Due", to: `${B}/people`, icon: ic.callList, section: "Process Coordinator" },
  {
    label: "Approvals",
    to: `${B}/approvals`,
    icon: ic.approvals,
    badge: opts.pendingApprovals || undefined,
  },
  { label: "Processes", to: `${B}/processes`, icon: ic.processes },
  { label: "My Account", to: "/account", icon: ic.account, section: "Account" },
];
