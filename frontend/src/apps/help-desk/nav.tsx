import type { NavItem } from "@/shared/components/layout/types";
import { QUEUE_STEPS, stepByKey, type StepKey } from "./lib/steps";

export const B = "/help-desk";

const ic = {
  dashboard: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>),
  ask: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /><path d="M12 8v4M12 15h.01" /></svg>),
  mine: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.5-6 8-6s8 2 8 6" /></svg>),
  all: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9h10M7 13h10M7 17h6" /></svg>),
  step: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3 7-7" /><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" /></svg>),
  board: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="M7 15l4-5 3 3 5-7" /></svg>),
  report: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 9v12" /></svg>),
  masters: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h16M4 12h16M4 18h10" /></svg>),
  inbox: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h5l2 3h4l2-3h5" /><path d="M5 5h14l2 7v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5z" /></svg>),
  settings: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 6.6 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 13.4H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 5 6.6l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10.6 3H11a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8Z" /></svg>),
};

/**
 * URL segment per queue step.
 *
 * Kept SHORT and human — an employee reads "/help-desk/queues/waiting-on-me",
 * not the step key. The keys stay the database's business.
 */
export const QUEUE_PATH: Record<StepKey, string> = {
  raise: "raise",
  acknowledge: "to-acknowledge",
  awaiting_info: "waiting-on-me",
  resolve: "to-resolve",
  confirm: "confirm",
};

/**
 * What each queue is CALLED in the sidebar.
 *
 * ⚠ TWO OF THESE ARE READ BY AN ORDINARY EMPLOYEE, NOT BY HR, and they are named
 *   for that reader. `awaiting_info`'s step title is "Waiting on the Employee",
 *   which is how the DESK thinks of it; the person who actually holds that queue
 *   is the employee, and to them it is "HR is waiting on you". Likewise
 *   `confirm`. Printing the desk's wording to the employee is how a queue gets
 *   ignored.
 */
const QUEUE_LABEL: Partial<Record<StepKey, string>> = {
  awaiting_info: "HR is waiting on you",
  confirm: "Confirm a resolution",
};

export function buildHelpNav(opts: {
  isAdmin: boolean;
  canRaise: boolean;
  isDeskStaff: boolean;
  queues: Partial<Record<StepKey, boolean>>;
  countByStep: Partial<Record<StepKey, number>>;
  canManageMasters: boolean;
  canSetup: boolean;
}): NavItem[] {
  const nav: NavItem[] = [
    { label: "Dashboard", to: B, icon: ic.dashboard, section: "Workspace" },
    // Everyone's own list, always offered. This is the screen a plain employee
    // opens, and it is the only one most of them will ever use.
    { label: "My Tickets", to: `${B}/mine`, icon: ic.mine },
  ];

  if (opts.canRaise) {
    nav.push({ label: "Raise a Ticket", to: `${B}/new`, icon: ic.ask, section: "Actions" });
  }

  // The whole ticket list is for the desk. An employee who lands on it sees only
  // their own rows anyway (RLS), so the link is hidden rather than misleading.
  if (opts.isDeskStaff) {
    nav.push({ label: "All Tickets", to: `${B}/tickets`, icon: ic.all });
  }

  let queueUsed = false;
  for (const step of QUEUE_STEPS) {
    if (!opts.queues[step]) continue;
    nav.push({
      label: QUEUE_LABEL[step] ?? stepByKey(step)?.title ?? step,
      to: `${B}/queues/${QUEUE_PATH[step]}`,
      icon: ic.step,
      badge: opts.countByStep[step] || undefined,
      section: queueUsed ? undefined : "Queues",
    });
    queueUsed = true;
  }

  if (opts.isDeskStaff) {
    nav.push(
      { label: "Control Center", to: `${B}/monitoring`, icon: ic.board, section: "Reports" },
      { label: "Reports", to: `${B}/reports`, icon: ic.report },
    );
  }

  // Asking for a category is open to anyone the sidebar offers it to — the RLS
  // policy already refuses an insert that is not your own.
  nav.push({
    label: "Ticket Categories",
    to: opts.canManageMasters ? `${B}/masters` : `${B}/master-requests`,
    icon: opts.canManageMasters ? ic.masters : ic.inbox,
    section: "Administration",
  });

  if (opts.canManageMasters) {
    nav.push({ label: "Category Requests", to: `${B}/master-requests`, icon: ic.inbox });
  }

  if (opts.canSetup) {
    nav.push({ label: "Settings", to: `${B}/settings`, icon: ic.settings });
  }

  return nav;
}
