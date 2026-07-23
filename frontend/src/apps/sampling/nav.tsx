import type { NavItem } from "@/shared/components/layout/types";
import { appName } from "@/apps/appInfo";

const B = "/sampling";

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
  inbound: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M5 21h14" /></svg>
  ),
  outbound: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21V9" /><path d="M7 14l5-5 5 5" /><path d="M5 3h14" /></svg>
  ),
  confirm: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3 7-7" /><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" /></svg>
  ),
  testing: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3h6" /><path d="M10 3v6l-4.8 7.9A2 2 0 0 0 7 20h10a2 2 0 0 0 1.8-3.1L14 9V3" /></svg>
  ),
  result: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M9 15l2 2 4-4" /></svg>
  ),
  masters: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7l8-4 8 4-8 4-8-4z" /><path d="M4 12l8 4 8-4" /><path d="M4 17l8 4 8-4" /></svg>
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
 * Builds the Sampling sidebar. Capability-driven, except for the two items every
 * granted user always gets ("Raise a Request", "My Requests"). Every item here is
 * routed in SamplingApp.tsx.
 */
export function buildSamplingNav(opts: {
  isAdmin: boolean;
  canManageMasters: boolean;
  canReceive: boolean;
  canCollect: boolean;
  canSampleReceived: boolean;
  canSend: boolean;
  canConfirm: boolean;
  canTest: boolean;
  canResult: boolean;
  canHandover: boolean;
  canMonitor: boolean;
  hasRequests: boolean;
}): NavItem[] {
  const nav: NavItem[] = [
    { label: "Dashboard", to: B, icon: ic.dashboard, section: "Workspace" },
    ...(opts.hasRequests ? [{ label: "All Requests", to: `${B}/requests`, icon: ic.list }] : []),
    { label: "Raise a Request", to: `${B}/requests/new`, icon: ic.raise, section: "Actions" },
    { label: "My Requests", to: `${B}/my-requests`, icon: ic.mine },
  ];

  let queueUsed = false;
  const queue = (label: string, to: string, icon: JSX.Element) => {
    nav.push({ label, to, icon, section: queueUsed ? undefined : "Queues" });
    queueUsed = true;
  };
  if (opts.canReceive) queue("Sample Received", `${B}/queues/receive`, ic.inbound);
  if (opts.canCollect) queue("Sample Collect", `${B}/queues/collect`, ic.inbound);
  if (opts.canSampleReceived) queue("Handover Received", `${B}/queues/received`, ic.confirm);
  if (opts.canSend) queue("Sample Sent", `${B}/queues/send`, ic.outbound);
  if (opts.canConfirm) queue("Receipt Confirmed", `${B}/queues/confirm`, ic.confirm);
  if (opts.canTest) queue("Testing", `${B}/queues/testing`, ic.testing);
  if (opts.canResult) queue("Result", `${B}/queues/result`, ic.result);
  if (opts.canHandover) queue("Result Handover", `${B}/queues/handover`, ic.confirm);

  let adminUsed = false;
  const admin = (label: string, to: string, icon: JSX.Element) => {
    nav.push({ label, to, icon, section: adminUsed ? undefined : "Administration" });
    adminUsed = true;
  };
  if (opts.canMonitor) admin(`${appName("sampling")} Control Center`, `${B}/monitoring`, ic.monitor);
  if (opts.canManageMasters) admin("Masters", `${B}/masters`, ic.masters);
  if (opts.isAdmin) admin("Setup", `${B}/settings`, ic.settings);

  nav.push({ label: "My Account", to: "/account", icon: ic.account });
  return nav;
}
