import type { NavItem } from "@/shared/components/layout/types";
import { appName } from "@/apps/appInfo";
import {
  B,
  masterRequestsHref,
  mastersHref,
  monitoringHref,
  myRequestsHref,
  newRequestHref,
  queueHref,
  requestsHref,
  settingsHref,
} from "./lib/routes";

const ic = {
  dashboard: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>
  ),
  raise: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M12 8v8M8 12h8" /></svg>
  ),
  mine: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>
  ),
  list: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></svg>
  ),
  acknowledge: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3 7-7" /><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" /></svg>
  ),
  investigation: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.6-3.6" /></svg>
  ),
  capa: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.2-2.2 2.7-2.3Z" /></svg>
  ),
  resolution: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 5 6v6c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></svg>
  ),
  confirmation: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 14a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z" /><path d="m9 10 2 2 4-4" /></svg>
  ),
  close: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" /><path d="m8 12 3 3 5-6" /></svg>
  ),
  approval: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
  ),
  masters: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7l8-4 8 4-8 4-8-4z" /><path d="M4 12l8 4 8-4" /><path d="M4 17l8 4 8-4" /></svg>
  ),
  masterRequests: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7l8-4 8 4-8 4-8-4z" /><path d="M4 12l8 4 8-4" /><path d="M12 17v5M9.5 19.5h5" /></svg>
  ),
  monitor: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l2 5 4-12 2 7h3" /><rect x="2" y="3" width="20" height="18" rx="2" /></svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 6.6 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 13.4H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 5 6.6l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10.6 3H11a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8Z" /></svg>
  ),
  account: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.5-6 8-6s8 2 8 6" /></svg>
  ),
};

/**
 * Builds the Complaint sidebar. Capability-driven, except for "My Complaints",
 * which every granted user gets — their own history is theirs to read whatever
 * their grant.
 *
 * ⚠ NO BRANCH BLOCKS, unlike Sampling. RM and FG run the SAME seven steps and are
 *   handled by the same queues; splitting the sidebar by type would double every
 *   entry and imply two processes where there is one. The type is a column and a
 *   filter on the lists instead.
 *
 * Order: Workspace → Actions → the six step queues in workflow order →
 * Administration. Every item here is routed in ComplaintApp.tsx.
 */
export function buildComplaintNav(opts: {
  isAdmin: boolean;
  canSeeMasters: boolean;
  canPlant: boolean;
  canService: boolean;
  canApprove: boolean;
  canReview: boolean;
  canMonitor: boolean;
  /** False on a view-only grant, and false when Setup restricts who may raise. */
  canRaise: boolean;
  /** False on a view-only grant — every write link is hidden behind it. */
  canEdit: boolean;
  hasRequests: boolean;
}): NavItem[] {
  const nav: NavItem[] = [
    { label: "Dashboard", to: B, icon: ic.dashboard, section: "Workspace" },
    ...(opts.hasRequests ? [{ label: "All Complaints", to: requestsHref(), icon: ic.list }] : []),
    // Raising sits above the queues, which most people only need one of. A
    // view-only user — or one Setup has not made a raiser — keeps My Complaints
    // (their history is still theirs) but loses the raise link, which would only
    // lead to Access Denied.
    ...(opts.canRaise
      ? [{ label: "Raise a Complaint", to: newRequestHref(), icon: ic.raise, section: "Actions" }]
      : []),
    {
      label: "My Complaints",
      to: myRequestsHref(),
      icon: ic.mine,
      section: opts.canRaise ? undefined : "Actions",
    },
  ];

  /** Push into the queue block, heading it on the first surviving item. */
  let queueUsed = false;
  const queue = (label: string, to: string, icon: JSX.Element) => {
    nav.push({ label, to, icon, section: queueUsed ? undefined : "Complaint handling" });
    queueUsed = true;
  };

  if (opts.canPlant) queue("Plant Action", queueHref("plant"), ic.capa);
  if (opts.canService) queue("Service Team", queueHref("service"), ic.resolution);
  if (opts.canApprove) queue("Management Approval", queueHref("approval"), ic.approval);
  if (opts.canReview) queue("Management Review", queueHref("management-review"), ic.close);

  let adminUsed = false;
  const admin = (label: string, to: string, icon: JSX.Element) => {
    nav.push({ label, to, icon, section: adminUsed ? undefined : "Administration" });
    adminUsed = true;
  };
  if (opts.canMonitor) admin(`${appName("complaint")} Control Center`, monitoringHref(), ic.monitor);
  if (opts.canSeeMasters) admin("Masters", mastersHref(), ic.masters);
  if (opts.canSeeMasters) admin("Master Requests", masterRequestsHref(), ic.masterRequests);
  if (opts.isAdmin) admin("Setup", settingsHref(), ic.settings);

  nav.push({ label: "My Account", to: "/account", icon: ic.account });
  return nav;
}
