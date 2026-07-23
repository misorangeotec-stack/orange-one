import type { NavItem } from "@/shared/components/layout/types";
import { appName } from "@/apps/appInfo";
import { STEPS } from "./lib/steps";
import type { QueueStep } from "./lib/queues";

const B = "/production-entry";

const ic = {
  dashboard: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>),
  raise: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M12 8v8M8 12h8" /></svg>),
  mine: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>),
  list: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></svg>),
  step: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3 7-7" /><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" /></svg>),
  requests: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M9 15h6M9 11h2" /></svg>),
  masters: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7l8-4 8 4-8 4-8-4z" /><path d="M4 12l8 4 8-4" /><path d="M4 17l8 4 8-4" /></svg>),
  monitor: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l2 5 4-12 2 7h3" /><rect x="2" y="3" width="20" height="18" rx="2" /></svg>),
  settings: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 6.6 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 13.4H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 5 6.6l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10.6 3H11a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8Z" /></svg>),
  account: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.5-6 8-6s8 2 8 6" /></svg>),
};

/** URL path per queue step. */
const QUEUE_PATH: Record<QueueStep, string> = {
  material_handover: "material-handover",
  rm_transfer: "rm-transfer",
  transfer_slip: "transfer-slip",
  production_entry: "production",
  quality_check: "quality",
  mc_testing: "mc-testing",
  pm_handover: "pm-handover",
  pm_transfer: "pm-transfer",
  packing_entry: "packing",
  fg_transfer: "fg-transfer",
};

export function buildProductionNav(opts: {
  isAdmin: boolean;
  canManageMasters: boolean;
  canMonitor: boolean;
  hasRequests: boolean;
  canRaise: boolean;
  queues: Record<QueueStep, boolean>;
}): NavItem[] {
  const nav: NavItem[] = [
    { label: "Dashboard", to: B, icon: ic.dashboard, section: "Workspace" },
    ...(opts.hasRequests ? [{ label: "All Job Cards", to: `${B}/requests`, icon: ic.list }] : []),
    // Generate Batch Card is shown only to users who may raise a job card (Raise
    // Request step owners, or everyone when no owners are configured).
    ...(opts.canRaise
      ? [
          { label: "Generate Batch Card", to: `${B}/requests/new`, icon: ic.raise, section: "Actions" },
          { label: "My Job Cards", to: `${B}/my-requests`, icon: ic.mine },
        ]
      : [{ label: "My Job Cards", to: `${B}/my-requests`, icon: ic.mine, section: "Actions" }]),
    { label: "Master Requests", to: `${B}/master-requests`, icon: ic.requests },
  ];

  let queueUsed = false;
  const queueSteps = STEPS.filter((st) => !st.noQueue);
  for (const st of queueSteps) {
    const step = st.key as QueueStep;
    if (!opts.queues[step]) continue;
    nav.push({ label: st.title, to: `${B}/queues/${QUEUE_PATH[step]}`, icon: ic.step, section: queueUsed ? undefined : "Queues" });
    queueUsed = true;
  }

  let adminUsed = false;
  const admin = (label: string, to: string, icon: JSX.Element) => {
    nav.push({ label, to, icon, section: adminUsed ? undefined : "Administration" });
    adminUsed = true;
  };
  if (opts.canMonitor) admin(`${appName("production-entry")} Control Center`, `${B}/monitoring`, ic.monitor);
  if (opts.canManageMasters) admin("Masters", `${B}/masters`, ic.masters);
  if (opts.isAdmin) admin("Setup", `${B}/settings`, ic.settings);

  nav.push({ label: "My Account", to: "/account", icon: ic.account });
  return nav;
}
