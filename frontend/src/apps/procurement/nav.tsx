import type { NavItem } from "@/shared/components/layout/types";

const B = "/procurement";

/** Inline SVG icon set for the procurement sidebar. */
const ic = {
  dashboard: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>
  ),
  requests: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>
  ),
  newRequest: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" /></svg>
  ),
  masters: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7l8-4 8 4-8 4-8-4z" /><path d="M4 12l8 4 8-4" /><path d="M4 17l8 4 8-4" /></svg>
  ),
  source: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M6 12h12M10 18h4" /></svg>
  ),
  approve: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" /></svg>
  ),
  po: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h6" /><path d="M14 16l2 2 3-3" /></svg>
  ),
  orders: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></svg>
  ),
  inbox: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.5 5.5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6l3.5-6.5z" /></svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 6.6 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 13.4H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 5 6.6l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10.6 3H11a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8Z" /></svg>
  ),
  account: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.5-6 8-6s8 2 8 6" /></svg>
  ),
  monitor: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l2 5 4-12 2 7h3" /><rect x="2" y="3" width="20" height="18" rx="2" /></svg>
  ),
  demo: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 2h4M12 2v6l4.5 8a2 2 0 0 1-1.8 3H9.3a2 2 0 0 1-1.8-3L12 8" /></svg>
  ),
};

/**
 * Builds the procurement sidebar nav. Grows as the workflow phases land. The
 * Masters + Master Requests items show for admins and any assigned master
 * manager (`canManageMasters`). `pendingRequests` drives the inbox badge.
 */
export function buildProcurementNav(opts: {
  canManageMasters: boolean;
  isAdmin: boolean;
  canSource: boolean;
  isApprover: boolean;
  canGeneratePo: boolean;
  canSharePo: boolean;
  canCollectPi: boolean;
  canAdvancePayment: boolean;
  canFollowup: boolean;
  canInward: boolean;
  canTally: boolean;
  canFinalPayment: boolean;
  canMonitor: boolean;
  /** Real signed-in admin, not in demo mode → show the "Demo mode" entry point. */
  canDemo: boolean;
  pendingRequests: number;
}): NavItem[] {
  const nav: NavItem[] = [
    { label: "Dashboard", to: `${B}`, icon: ic.dashboard, section: "Workspace" },
    { label: "Purchase Requests", to: `${B}/requests`, icon: ic.requests },
    { label: "Purchase Orders", to: `${B}/pos`, icon: ic.orders },
    { label: "New Request", to: `${B}/requests/new`, icon: ic.newRequest, section: "Actions" },
  ];

  // One queue per workflow step — each shown only to that step's owner(s); admins see all.
  // "My Queues" is set on the first queue that renders so the section header appears once.
  const stepQueues: Array<{ show: boolean; label: string; to: string; icon: JSX.Element }> = [
    { show: opts.canSource, label: "Sourcing Queue", to: `${B}/queues/sourcing`, icon: ic.source },
    { show: opts.isApprover, label: "Approvals", to: `${B}/queues/approvals`, icon: ic.approve },
    { show: opts.canGeneratePo, label: "PO Workbench", to: `${B}/po/workbench`, icon: ic.po },
    { show: opts.canSharePo, label: "Share PO", to: `${B}/queues/share`, icon: ic.orders },
    { show: opts.canCollectPi, label: "Collect PI", to: `${B}/queues/collect-pi`, icon: ic.orders },
    { show: opts.canAdvancePayment, label: "Advance", to: `${B}/queues/advance`, icon: ic.orders },
    { show: opts.canFollowup, label: "Follow-up", to: `${B}/queues/follow-up`, icon: ic.orders },
    { show: opts.canInward, label: "Inward", to: `${B}/queues/inward`, icon: ic.orders },
    { show: opts.canTally, label: "Tally", to: `${B}/queues/tally`, icon: ic.orders },
    { show: opts.canFinalPayment, label: "Final Pay", to: `${B}/queues/final-pay`, icon: ic.orders },
  ];
  let queueSectionUsed = false;
  for (const q of stepQueues) {
    if (!q.show) continue;
    nav.push({ label: q.label, to: q.to, icon: q.icon, section: queueSectionUsed ? undefined : "My Queues" });
    queueSectionUsed = true;
  }

  if (opts.canMonitor) {
    nav.push({ label: "Purchase FMS Control Center", to: `${B}/monitoring`, icon: ic.monitor, section: "Administration" });
  }
  if (opts.canManageMasters) {
    nav.push(
      { label: "Masters", to: `${B}/masters`, icon: ic.masters, section: opts.canMonitor ? undefined : "Administration" },
      { label: "Master Requests", to: `${B}/master-requests`, icon: ic.inbox, badge: opts.pendingRequests || undefined }
    );
  }
  if (opts.isAdmin) {
    nav.push({ label: "Setup", to: `${B}/settings`, icon: ic.settings, section: opts.canManageMasters || opts.canMonitor ? undefined : "Administration" });
  }
  if (opts.canDemo) {
    nav.push({ label: "Demo mode", to: `${B}/sandbox`, icon: ic.demo, section: opts.canManageMasters || opts.canMonitor || opts.isAdmin ? undefined : "Administration" });
  }

  nav.push({ label: "My Account", to: "/account", icon: ic.account });
  return nav;
}
