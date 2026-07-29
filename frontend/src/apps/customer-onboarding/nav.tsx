/**
 * Sidebar for the standalone New Customer Onboarding app.
 *
 * Mirrors what the Outstanding Dashboard's CollapsibleMenu used to show for this
 * module, with the same visibility rules — a back-office queue appears for its
 * step owners and for coordinators, so the sidebar never advertises work the
 * reader cannot do. Authorization itself is RLS plus the RPCs; this only decides
 * what is worth showing.
 */
import type { NavItem } from "@/shared/components/layout/types";
import { STEPS, type StepKey } from "@hub/lib/customerOnboarding/steps";
import {
  homeHref, newHref, mineHref, allHref, queueHref, settingsHref,
} from "@hub/lib/customerOnboarding/routes";

const ic = {
  dashboard: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>),
  raise: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="4" /><path d="M3 20c0-3.5 3-5.5 6-5.5" /><path d="M17 12v6M14 15h6" /></svg>),
  mine: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>),
  list: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></svg>),
  step: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3 7-7" /><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" /></svg>),
  settings: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 6.6 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 13.4H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 5 6.6l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10.6 3H11a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8Z" /></svg>),
};

export function buildOnboardingNav(opts: {
  isAdmin: boolean;
  canRaise: boolean;
  /** Which back-office queues this person should see. */
  queues: Record<string, boolean>;
}): NavItem[] {
  const nav: NavItem[] = [
    { label: "Dashboard", to: homeHref(), icon: ic.dashboard, section: "Workspace" },
  ];

  if (opts.canRaise) {
    nav.push({ label: "New Customer", to: newHref(), icon: ic.raise, section: "Actions" });
    nav.push({ label: "My Requests", to: mineHref(), icon: ic.mine });
  } else {
    nav.push({ label: "My Requests", to: mineHref(), icon: ic.mine, section: "Actions" });
  }

  // `submission` is the raiser's own step and has no back-office queue page —
  // a reworked request is reached from My Requests, not from a queue.
  let queueSection = false;
  for (const st of STEPS) {
    if (st.key === "submission") continue;
    if (!opts.queues[st.key]) continue;
    nav.push({
      label: st.title,
      to: queueHref(st.key as StepKey),
      icon: ic.step,
      ...(queueSection ? {} : { section: "Queues" }),
    });
    queueSection = true;
  }

  nav.push({ label: "All Requests", to: allHref(), icon: ic.list, section: "Records" });

  if (opts.isAdmin) {
    nav.push({ label: "Settings", to: settingsHref(), icon: ic.settings, section: "Admin" });
  }

  return nav;
}
