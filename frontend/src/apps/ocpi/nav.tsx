import type { NavItem } from "@/shared/components/layout/types";
import { STEPS } from "./lib/steps";
import type { QueueStep } from "./lib/queues";

const B = "/ocpi";

const ic = {
  dashboard: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>),
  deals: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9h10M7 13h10M7 17h6" /></svg>),
  mine: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.5-6 8-6s8 2 8 6" /></svg>),
  draft: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M12 18v-6M9 15h6" /></svg>),
  add: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M12 8v8M8 12h8" /></svg>),
  step: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3 7-7" /><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" /></svg>),
  machines: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="10" rx="2" /><path d="M6 7V5h12v2" /><path d="M6 17v2h12v-2" /><path d="M9 12h6" /></svg>),
  board: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="M7 15l4-5 3 3 5-7" /></svg>),
  masters: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h16M4 12h16M4 18h10" /></svg>),
  inbox: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h5l2 3h4l2-3h5" /><path d="M5 5h14l2 7v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5z" /></svg>),
  report: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 9v12" /></svg>),
  settings: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 6.6 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 13.4H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 5 6.6l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10.6 3H11a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8Z" /></svg>),
};

/**
 * URL segment per queue step.
 *
 * Kept SHORT and human — a salesperson reads "/ocpi/queues/approve-quotation",
 * not the step key. The keys stay the database's business.
 */
export const QUEUE_PATH: Record<QueueStep, string> = {
  quotation_approval: "approve-quotation",
  order_confirmation: "order-confirmation",
  oc_approval: "approve-oc",
  customer_signoff: "customer-signature",
  management_signoff: "management-signature",
};

export function buildOcpiNav(opts: {
  isAdmin: boolean;
  canRaise: boolean;
  canSetup: boolean;
  queues: Record<QueueStep, boolean>;
  /** Any master owned, or admin — the Masters screen and the request queue. */
  canManageAnyMaster: boolean;
  /** How many master requests are still waiting, for the badge. */
  pendingMasterRequests: number;
}): NavItem[] {
  const nav: NavItem[] = [
    { label: "Dashboard", to: B, icon: ic.dashboard, section: "Workspace" },
    { label: "All Deals", to: `${B}/deals`, icon: ic.deals },
    { label: "My Deals", to: `${B}/mine`, icon: ic.mine },
    // Drafts get their own destination rather than a filter on the list: a draft
    // is private to its author and is the one thing a salesperson comes back to
    // finish, so burying it behind a filter is how it gets forgotten.
    { label: "Drafts", to: `${B}/drafts`, icon: ic.draft },
  ];

  if (opts.canRaise) {
    nav.push({ label: "New Quotation", to: `${B}/new`, icon: ic.add, section: "Actions" });
  }

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

  // The pipeline sits with the reports rather than in Workspace: it is the
  // coordinator's board, not a personal list, and putting it above "All Deals"
  // would make it the first thing a salesperson lands on.
  nav.push(
    { label: "Control Center", to: `${B}/monitoring`, icon: ic.board, section: "Reports" },
    { label: "Deal Register", to: `${B}/reports`, icon: ic.report },
  );

  // Master requests is NOT admin-only: anyone with edit access raises one and
  // wants to see what happened to it. The badge counts what is still waiting.
  if (opts.canRaise || opts.canManageAnyMaster) {
    nav.push({
      label: "Master Requests",
      to: `${B}/master-requests`,
      icon: ic.inbox,
      badge: opts.pendingMasterRequests || undefined,
      // No `section` — it continues the Reports group started above. Repeating
      // the label would print the heading twice.
    });
  }

  if (opts.canManageAnyMaster) {
    nav.push(
      { label: "Masters", to: `${B}/masters`, icon: ic.masters, section: "Administration" },
      { label: "Machines", to: `${B}/machines`, icon: ic.machines },
    );
  }

  if (opts.canSetup) {
    nav.push(

      { label: "Settings", to: `${B}/settings`, icon: ic.settings,
        section: opts.canManageAnyMaster ? undefined : "Administration" },
    );
  }

  return nav;
}
