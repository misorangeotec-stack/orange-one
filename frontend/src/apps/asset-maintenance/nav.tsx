import type { NavItem } from "@/shared/components/layout/types";
import { STEPS } from "./lib/steps";
import type { QueueStep } from "./lib/queues";

const B = "/asset-maintenance";

const ic = {
  dashboard: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>),
  register: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9h10M7 13h10M7 17h6" /></svg>),
  add: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M12 8v8M8 12h8" /></svg>),
  calendar: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 11h18" /></svg>),
  jobs: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a4 4 0 0 0 5 5l-9.6 9.6a2.1 2.1 0 0 1-3-3z" /><path d="M18 2l4 4" /></svg>),
  step: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3 7-7" /><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" /></svg>),
  requests: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M9 15h6M9 11h2" /></svg>),
  report: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 9v12" /></svg>),
  masters: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7l8-4 8 4-8 4-8-4z" /><path d="M4 12l8 4 8-4" /><path d="M4 17l8 4 8-4" /></svg>),
  monitor: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l2 5 4-12 2 7h3" /><rect x="2" y="3" width="20" height="18" rx="2" /></svg>),
  settings: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 6.6 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 13.4H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 5 6.6l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10.6 3H11a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8Z" /></svg>),
  account: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.5-6 8-6s8 2 8 6" /></svg>),
};

/** URL path per queue step. */
export const QUEUE_PATH: Record<QueueStep, string> = {
  schedule: "schedule",
  service_done: "service",
  verify_close: "verify",
};

export function buildAssetNav(opts: {
  isAdmin: boolean;
  canManageMasters: boolean;
  canMonitor: boolean;
  canRaise: boolean;
  queues: Record<QueueStep, boolean>;
}): NavItem[] {
  const nav: NavItem[] = [
    { label: "Dashboard", to: B, icon: ic.dashboard, section: "Workspace" },
    { label: "Asset Register", to: `${B}/assets`, icon: ic.register },
    // The forward view is a first-class destination here, not a report: "what is
    // coming" is the question this module exists to answer.
    { label: "What's Coming", to: `${B}/calendar`, icon: ic.calendar },
    { label: "Service Jobs", to: `${B}/jobs`, icon: ic.jobs },
    ...(opts.canRaise
      ? [{ label: "Add Asset", to: `${B}/assets/new`, icon: ic.add, section: "Actions" as const }]
      : []),
    { label: "Master Requests", to: `${B}/master-requests`, icon: ic.requests, section: opts.canRaise ? undefined : "Actions" },
  ];

  let queueUsed = false;
  for (const st of STEPS.filter((x) => !x.noQueue)) {
    const step = st.key as QueueStep;
    if (!opts.queues[step]) continue;
    nav.push({
      label: st.title,
      to: `${B}/queues/${QUEUE_PATH[step]}`,
      icon: ic.step,
      section: queueUsed ? undefined : "Queues",
    });
    queueUsed = true;
  }

  let adminUsed = false;
  const admin = (label: string, to: string, icon: JSX.Element) => {
    nav.push({ label, to, icon, section: adminUsed ? undefined : "Administration" });
    adminUsed = true;
  };
  admin("Reports", `${B}/reports`, ic.report);
  // Just "Control Center", not "<app name> Control Center": the other FMS apps
  // prefix theirs to distinguish it from the cross-FMS one, but "Asset
  // Maintenance Control Center" overflows the sidebar and renders truncated
  // ("Asset Maintenance Control …"), which is worse than the ambiguity it avoids.
  if (opts.canMonitor) admin("Control Center", `${B}/monitoring`, ic.monitor);
  if (opts.canManageMasters) admin("Masters", `${B}/masters`, ic.masters);
  if (opts.isAdmin) admin("Setup", `${B}/settings`, ic.settings);

  nav.push({ label: "My Account", to: "/account", icon: ic.account });
  return nav;
}
