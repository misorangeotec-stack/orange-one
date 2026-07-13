import type { NavItem } from "@/shared/components/layout/types";

const B = "/hr-recruitment";

/** Inline SVG icon set for the HR sidebar. */
const ic = {
  dashboard: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>
  ),
  requisitions: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>
  ),
  newMrf: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" /></svg>
  ),
  approve: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" /></svg>
  ),
  posting: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l18-8v18l-18-8z" /><path d="M7 12v6" /></svg>
  ),
  candidates: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3.5" /><path d="M2 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5" /><path d="M17 8h5M19.5 5.5v5" /></svg>
  ),
  interview: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /><path d="M8 9h8M8 13h5" /></svg>
  ),
  onboarding: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3 6-6" /><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" /></svg>
  ),
  probation: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 6.6 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 13.4H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 5 6.6l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10.6 3H11a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8Z" /></svg>
  ),
  monitor: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l2 5 4-12 2 7h3" /><rect x="2" y="3" width="20" height="18" rx="2" /></svg>
  ),
  demo: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 2h4M12 2v6l4.5 8a2 2 0 0 1-1.8 3H9.3a2 2 0 0 1-1.8-3L12 8" /></svg>
  ),
  masters: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7l8-4 8 4-8 4-8-4z" /><path d="M4 12l8 4 8-4" /><path d="M4 17l8 4 8-4" /></svg>
  ),
  inbox: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.5 5.5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6l3.5-6.5z" /></svg>
  ),
  account: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.5-6 8-6s8 2 8 6" /></svg>
  ),
};

/**
 * Builds the HR Recruitment sidebar. Capability-driven, exactly like procurement:
 * a queue link appears only for the people who own that step, so nobody sees work
 * they cannot action. Admins see everything.
 *
 * "Master Requests" shows for EVERYONE — it is a review queue for a master's owner
 * (badged with `pendingReviews`, the requests they can actually resolve) and a
 * personal worklist for everyone else, which is why it sits under Actions for them.
 * "Masters" itself is owner/admin-only.
 */
export function buildHrNav(opts: {
  isAdmin: boolean;
  canRaiseMrf: boolean;
  /** Admin, or the owner of at least one master → sees the Masters page. */
  canManageMasters: boolean;
  /** Pending master requests THIS user can resolve — drives the inbox badge. */
  pendingReviews: number;
  canApproveHr: boolean;
  canApproveMgmt: boolean;
  canPostJob: boolean;
  canUploadResumes: boolean;
  canShortlist: boolean;
  canInterview: boolean;
  canOnboard: boolean;
  canReview: boolean;
  canMonitor: boolean;
  /** Real signed-in admin, not in demo mode → show the "Demo mode" entry point. */
  canDemo: boolean;
}): NavItem[] {
  const nav: NavItem[] = [
    { label: "Dashboard", to: B, icon: ic.dashboard, section: "Workspace" },
    { label: "Requisitions", to: `${B}/requisitions`, icon: ic.requisitions },
  ];

  // "Actions" — the things anyone might personally start. The closure owns the
  // section header, so whichever item renders first carries it (an employee who
  // cannot raise an MRF would otherwise push Master Requests with no section and
  // it would silently join Workspace).
  let actionSectionUsed = false;
  const action = (label: string, to: string, icon: JSX.Element) => {
    nav.push({ label, to, icon, section: actionSectionUsed ? undefined : "Actions" });
    actionSectionUsed = true;
  };
  if (opts.canRaiseMrf) action("Raise a Requisition", `${B}/requisitions/new`, ic.newMrf);
  // Non-owners get Master Requests here, as a personal worklist. Owners get it in
  // Administration instead, next to Masters, with the review badge.
  if (!opts.canManageMasters) action("Master Requests", `${B}/master-requests`, ic.inbox);

  // One queue per workflow step, shown only to that step's owner(s); admins see all.
  // "My Queues" is set on the first queue that renders so the header appears once.
  const stepQueues: Array<{ show: boolean; label: string; to: string; icon: JSX.Element }> = [
    { show: opts.canApproveHr || opts.canApproveMgmt, label: "MRF Approvals", to: `${B}/queues/approvals`, icon: ic.approve },
    { show: opts.canPostJob, label: "Job Posting", to: `${B}/queues/posting`, icon: ic.posting },
    { show: opts.canUploadResumes || opts.canShortlist, label: "Candidate Pipeline", to: `${B}/queues/pipeline`, icon: ic.candidates },
    { show: opts.canInterview, label: "Interviews", to: `${B}/queues/interviews`, icon: ic.interview },
    { show: opts.canOnboard, label: "Onboarding", to: `${B}/queues/onboarding`, icon: ic.onboarding },
    { show: opts.canReview, label: "Probation Reviews", to: `${B}/queues/probation`, icon: ic.probation },
  ];
  let queueSectionUsed = false;
  for (const q of stepQueues) {
    if (!q.show) continue;
    nav.push({ label: q.label, to: q.to, icon: q.icon, section: queueSectionUsed ? undefined : "My Queues" });
    queueSectionUsed = true;
  }

  let adminSectionUsed = false;
  const admin = (label: string, to: string, icon: JSX.Element, badge?: number) => {
    nav.push({ label, to, icon, badge, section: adminSectionUsed ? undefined : "Administration" });
    adminSectionUsed = true;
  };
  if (opts.canMonitor) admin("HR FMS Control Center", `${B}/monitoring`, ic.monitor);
  if (opts.canManageMasters) {
    admin("Masters", `${B}/masters`, ic.masters);
    admin("Master Requests", `${B}/master-requests`, ic.inbox, opts.pendingReviews || undefined);
  }
  if (opts.isAdmin) admin("Setup", `${B}/settings`, ic.settings);
  if (opts.canDemo) admin("Demo mode", `${B}/sandbox`, ic.demo);

  nav.push({ label: "My Account", to: "/account", icon: ic.account });
  return nav;
}
