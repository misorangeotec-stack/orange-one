import type { NavItem } from "@/shared/components/layout/types";
import { REQUEST_STEPS, STEPS, type StepKey } from "./lib/steps";

export const B = "/learning-development";

const ic = {
  dashboard: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>),
  calendar: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>),
  raise: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M12 8v8M8 12h8" /></svg>),
  mine: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>),
  list: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></svg>),
  step: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3 7-7" /><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" /></svg>),
  settings: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 6.6 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 13.4H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 5 6.6l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10.6 3H11a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8Z" /></svg>),
  report: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 9v12" /></svg>),
  account: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.5-6 8-6s8 2 8 6" /></svg>),
};

/** URL path per step queue — keyed off the step key so the two cannot drift. */
export const QUEUE_PATH: Record<string, string> = {
  need_resubmit: "sent-back",
  need_validation: "validation",
  proposal: "proposal",
  hr_head_approval: "hr-approval",
  mgmt_approval: "management-approval",
  trainer_finalization: "trainer",
  session_scheduling: "scheduling",
};

/**
 * The sidebar.
 *
 * ⚠ THIS MODULE IS UNIVERSAL, so the nav is doing work no other FMS's nav does:
 *   it is the only thing standing between a warehouse operator and a screenful of
 *   HR's approval queues. Everybody gets the Training Calendar and their own
 *   requests; the pipeline, the queues and Setup appear only for the people who
 *   own them. RLS is the real boundary — this is so the sidebar never offers a
 *   screen that then refuses you.
 *
 * ⚠ THE MANAGEMENT APPROVAL QUEUE IS HIDDEN WHEN THE RULE SAYS "NEVER" — but
 *   that decision is the store's `offersQueue`, not this file's. Offering a
 *   permanently empty gate teaches people the module is broken; hiding one that
 *   holds live work is worse. Both readers take the same answer.
 */
export function buildLdNav(opts: {
  isAdmin: boolean;
  canRaise: boolean;
  isPipelineStaff: boolean;
  canMonitor: boolean;
  /** Per step, how many rows this person can see waiting there. */
  countByStep: Partial<Record<StepKey, number>>;
  /**
   * Which queues to offer — the store's `offersQueue`, already folding in the
   * conditional-gate rule. The nav does NOT re-derive it: the dashboard reads the
   * same predicate, and the two disagreed once already.
   */
  queues: Partial<Record<StepKey, boolean>>;
}): NavItem[] {
  const nav: NavItem[] = [
    { label: "Dashboard", to: B, icon: ic.dashboard, section: "Workspace" },
    { label: "Training Calendar", to: `${B}/calendar`, icon: ic.calendar },
    // Everybody's own page: invitations to answer, assignments owed, hours done.
    // For most of the company this is the only L&D screen they will ever open.
    { label: "My Learning", to: `${B}/my-learning`, icon: ic.mine },
  ];

  if (opts.canRaise) {
    nav.push({ label: "Raise a Training Need", to: `${B}/requests/new`, icon: ic.raise, section: "Actions" });
    nav.push({ label: "My Requests", to: `${B}/my-requests`, icon: ic.mine });
  } else {
    nav.push({ label: "My Requests", to: `${B}/my-requests`, icon: ic.mine, section: "Actions" });
  }

  if (opts.isPipelineStaff) {
    nav.push({ label: "All Requests", to: `${B}/requests`, icon: ic.list });
    nav.push({ label: "All Sessions", to: `${B}/sessions`, icon: ic.calendar });
    nav.push({ label: "Annual Plan", to: `${B}/plan`, icon: ic.list });
    nav.push({ label: "Reports", to: `${B}/reports`, icon: ic.report });
  }

  let queueUsed = false;
  for (const key of REQUEST_STEPS) {
    if (!opts.queues[key]) continue;
    const count = opts.countByStep[key] ?? 0;
    const def = STEPS.find((s) => s.key === key);
    nav.push({
      label: def?.title ?? key,
      to: `${B}/queues/${QUEUE_PATH[key]}`,
      icon: ic.step,
      badge: count || undefined,
      section: queueUsed ? undefined : "Queues",
    });
    queueUsed = true;
  }

  if (opts.isAdmin) {
    nav.push({ label: "Setup", to: `${B}/settings`, icon: ic.settings, section: "Administration" });
  }

  nav.push({ label: "My Account", to: "/account", icon: ic.account });
  return nav;
}
