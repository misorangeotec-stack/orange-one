import type { NavItem } from "@/shared/components/layout/types";

const B = "/hr-exit";

/** Inline SVG icon set for the HR Exit sidebar. */
const ic = {
  dashboard: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>
  ),
  resign: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8" /><path d="M17 8l4 4-4 4" /><path d="M21 12H10" /></svg>
  ),
  myExit: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>
  ),
  cases: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7z" /><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /><path d="M4 12h16" /></svg>
  ),
  approvals: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3 7-7" /><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" /></svg>
  ),
  clearance: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /><path d="M9 13l2 2 4-4" /></svg>
  ),
  interview: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
  ),
  settlement: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" /></svg>
  ),
  closure: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h11l5 5v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" /><path d="M14 4v5h5" /><path d="M8 15l2.5 2.5L16 12" /></svg>
  ),
  masters: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7l8-4 8 4-8 4-8-4z" /><path d="M4 12l8 4 8-4" /><path d="M4 17l8 4 8-4" /></svg>
  ),
  inbox: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.5 5.5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6l3.5-6.5z" /></svg>
  ),
  demo: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 2h4M12 2v6l4.5 8a2 2 0 0 1-1.8 3H9.3a2 2 0 0 1-1.8-3L12 8" /></svg>
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
 * Builds the HR Exit sidebar. Capability-driven, exactly like the other two FMS
 * apps — with one deliberate exception.
 *
 * "Raise an Exit / Resign", "My Resignation" and "Master Requests" show for EVERYONE.
 * They are the only ungated items in any FMS nav, and the first two are the point of this
 * app being `universal` (apps/universal.ts): an ordinary employee who owns no step, is
 * nobody's manager and works in no clearance department must still be able to resign.
 * That person sees exactly those three entries plus My Account — everything else is
 * somebody's queue, and RLS would hand them zero rows anyway.
 *
 * "Master Requests" is one page with two audiences: a REVIEW QUEUE for a master's owner
 * (badged with `pendingReviews` — only what THEY can resolve) and a personal worklist for
 * everyone else, which is why it sits under Actions for them and under Administration,
 * next to Masters, for an owner. "Masters" itself is owner/admin-only.
 *
 * Every item here is routed in ExitApp.tsx. Nothing is ever stubbed: a nav item that leads
 * to "page not found" is worse than a missing one — and an earlier phase shipped a queue
 * page that was built and unreachable, which is the same bug from the other end.
 */
export function buildExitNav(opts: {
  isAdmin: boolean;
  /**
   * Admin, or the owner of at least one master → sees the Masters page.
   *
   * ⚠ NOT admin-only, and that is the whole point of M8: an Exit Reasons owner opens
   *   Masters, edits Reasons, and reads the other four tabs read-only. RLS agrees.
   */
  canManageMasters: boolean;
  /** Pending master requests THIS user can resolve — drives the inbox badge. */
  pendingReviews: number;
  /** Real signed-in admin, not already in demo mode → show the "Demo mode" entry point. */
  canDemo: boolean;
  /** Owns one of the three approval gates, or coordinates the process. */
  canApprove: boolean;
  /**
   * Owns the `clearance` step — OR ANY SINGLE CLEARANCE CHECK.
   *
   * That second half is the entire point. The IT person, the Admin and the Travel
   * Desk own NO WORKFLOW STEP AT ALL; they own one row of a checklist. Gate this on
   * step ownership alone and the people the clearance step exists to chase have no
   * way into it — the queue they owe work in is simply not in their sidebar.
   */
  canClear: boolean;
  /**
   * ⭐ May read the EXIT-INTERVIEW CONTENT: admin ∨ coordinator ∨ HR-confidential (the
   * owner of hr_verification / hr_head_approval / exit_interview).
   *
   * ⚠ THIS IS **NOT** `canClear` OR "owns any step". The IT person owns `clearance` and
   *   the Admin owns `asset_return`; both are exit staff, both have a queue in this
   *   sidebar, and neither may see a word of an exit interview. Neither may the
   *   reporting manager. The queue is gated on the SAME predicate as the RLS policy on
   *   fms_exit_interviews, so a nav item can never lead somewhere RLS then empties.
   */
  canInterview: boolean;
  /**
   * ⭐ May read the SETTLEMENT: admin ∨ coordinator ∨ finance staff (the owner of
   * leave_verification / payroll_inputs / fnf_generate / fnf_approve / fnf_payment).
   *
   * ⚠ Same shape of rule as `canInterview`, and for the same reason: it is NOT "owns any
   *   step" and it is NOT "has rows in my queue". The REPORTING MANAGER owns their steps
   *   per-case — and a manager has no business anywhere near a subordinate's F&F. The
   *   leaver's own after-approval read is a read of ONE case on My Resignation, not a
   *   work queue, so it is deliberately not a door into this page.
   */
  canSettle: boolean;
  /**
   * ⭐ The CLOSURE queue — issuing the letters, chasing the signed acknowledgement back,
   * and the archive.
   *
   * ⚠ NOT gated like `canInterview` / `canSettle`, and the difference is deliberate:
   *   closure is NOT confidential. Nothing on that screen is a rupee or a word of anyone's
   *   exit interview — it is letters and dates. So it follows Approvals and Clearance: you
   *   get the queue if you own the step, coordinate the process, or actually have rows in
   *   it. RLS hands zero rows to anyone with no business there.
   */
  canClose: boolean;
  /**
   * ⭐ The HR Exit Control Center — admin ∨ process coordinator (`isProcessCoordinator`),
   * the SAME predicate as `RequireMonitor` in ExitApp.tsx.
   *
   * It is also the home of the SHEET-PARITY EXPORT, and that is deliberate: two of that
   * export's eleven stages read RLS-gated satellites, and only an admin or a coordinator
   * can read both. Gate the nav item any wider and the link would lead to a page that
   * AccessDenies — or, worse, to an export full of honest-looking zeroes.
   */
  canMonitor: boolean;
  /** Has at least one case they may read — the reporting managers, HR, everyone with a case. */
  hasCases: boolean;
}): NavItem[] {
  const nav: NavItem[] = [
    { label: "Dashboard", to: B, icon: ic.dashboard, section: "Workspace" },
    // Shown to anyone RLS actually gives a case to. A plain employee with no exit on
    // record sees no list link — an empty table is not a feature.
    ...(opts.hasCases ? [{ label: "Exit Cases", to: `${B}/exits`, icon: ic.cases }] : []),
    // The ungated items. Every signed-in user gets these, always.
    { label: "Raise an Exit / Resign", to: `${B}/exits/new`, icon: ic.resign, section: "Actions" },
    { label: "My Resignation", to: `${B}/my-exit`, icon: ic.myExit },
  ];

  // Non-owners get Master Requests here, as a personal worklist ("what happened to the
  // reason I asked for?"). Owners get it in Administration instead, next to Masters,
  // with the review badge — see below.
  if (!opts.canManageMasters) {
    nav.push({ label: "Master Requests", to: `${B}/master-requests`, icon: ic.inbox });
  }

  // The "Queues" heading belongs to whichever queue comes first — an empty section
  // header over nothing is how a sidebar starts lying about what you own.
  let queueSectionUsed = false;
  const queue = (label: string, to: string, icon: JSX.Element) => {
    nav.push({ label, to, icon, section: queueSectionUsed ? undefined : "Queues" });
    queueSectionUsed = true;
  };
  if (opts.canApprove) queue("Approvals", `${B}/queues/approvals`, ic.approvals);
  if (opts.canClear) queue("Clearance", `${B}/queues/clearance`, ic.clearance);
  // HR / the HR Head / the coordinators only. See `canInterview` above.
  if (opts.canInterview) queue("Exit Interviews", `${B}/queues/interview`, ic.interview);
  // Payroll / accounts / the coordinators only. See `canSettle` above — never the manager.
  if (opts.canSettle) queue("Settlement", `${B}/queues/settlement`, ic.settlement);
  // ⭐ The terminal queue. Not confidential — see `canClose`.
  if (opts.canClose) queue("Closure", `${B}/queues/closure`, ic.closure);

  let adminSectionUsed = false;
  const admin = (label: string, to: string, icon: JSX.Element, badge?: number) => {
    nav.push({ label, to, icon, badge, section: adminSectionUsed ? undefined : "Administration" });
    adminSectionUsed = true;
  };
  if (opts.canMonitor) admin("Exit FMS Control Center", `${B}/monitoring`, ic.monitor);
  if (opts.canManageMasters) {
    admin("Masters", `${B}/masters`, ic.masters);
    // Badge only what THIS user can actually resolve — an Exit Reasons owner must not
    // see a count for the payroll-head requests they will be refused on.
    admin("Master Requests", `${B}/master-requests`, ic.inbox, opts.pendingReviews || undefined);
  }
  if (opts.isAdmin) admin("Setup", `${B}/settings`, ic.settings);
  // Entering demo mode is for the REAL admin — a persona must not be able to re-enter
  // and nest demos inside itself.
  if (opts.canDemo) admin("Demo mode", `${B}/sandbox`, ic.demo);

  nav.push({ label: "My Account", to: "/account", icon: ic.account });
  return nav;
}
