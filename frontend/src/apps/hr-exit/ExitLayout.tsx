import { useMemo } from "react";
import AppShell from "@/shared/components/layout/AppShell";
import type { NotificationItem } from "@/shared/components/layout/types";
import { roleLabel, useSession } from "@/core/platform/session";
import { timeAgo } from "@/shared/lib/time";
import { useEffectiveIdentity } from "@/shared/sandbox/useEffectiveIdentity";
import { useSandbox } from "@/shared/sandbox/SandboxContext";
import PersonaSwitcher from "@/shared/sandbox/PersonaSwitcher";
import DemoBanner from "@/shared/sandbox/DemoBanner";
import { buildExitNav } from "./nav";
import { usePersonas } from "./sandbox/personas";
import { useExitStore } from "./store";
import type { ExitNotification } from "./types";


const B = "/hr-exit";

/** Deep-link a bell notification to the thing it is about. */
const linkFor = (n: ExitNotification): string => {
  switch (n.entityType) {
    case "case":
    case "clearance":
    case "asset":
    case "handover":
    case "interview":
    case "settlement":
    case "document":
      return `${B}/exits/${n.entityId}`;
    case "master_request":
      return `${B}/master-requests`;
    default:
      return B;
  }
};

/**
 * Wires the portal session + exit store into the shared AppShell. The nav is
 * capability-driven, except for the two items every employee gets (see nav.tsx).
 *
 * The bell renders `n.text` RAW — no actor prefix, no verb assembled here — so every
 * notification we write must stand on its own as a whole sentence.
 */
export default function ExitLayout() {
  const { user, role, isAdmin } = useEffectiveIdentity();
  // The REAL signed-in admin, never the persona — only they may ENTER demo mode.
  const { isAdmin: realAdmin } = useSession();
  const { active: demoActive } = useSandbox();
  const personas = usePersonas();
  const s = useExitStore();

  // A reporting manager owns `manager_review` PER CASE, never in the step-owner table,
  // so "do I have approvals?" cannot be answered by ownership alone — it is answered by
  // whether anything is actually sitting in their queue.
  const canApprove =
    s.isProcessCoordinator ||
    s.isStepOwner("hr_verification") ||
    s.isStepOwner("hr_head_approval") ||
    s.myQueue("manager_review").length > 0;

  // The IT / Admin / Travel-Desk people own NO workflow step — they own one row of a
  // checklist. `ownsClearanceItem` is true for them (a live master item, or a
  // materialised row on some case), and without it the queue they owe work in would
  // simply not be in their sidebar. `myQueue` catches the rest.
  const canClear =
    s.isProcessCoordinator ||
    s.isStepOwner("clearance") ||
    s.ownsClearanceItem ||
    s.myQueue("clearance").length > 0;

  // Exit staff and coordinators get the list even on day one, when there is nothing in
  // it — it is their workspace. Everyone else gets it only once RLS actually hands them
  // a row, because a link to a permanently empty table is noise, not a feature.
  const hasCases = s.cases.length > 0 || s.isExitStaff || s.isProcessCoordinator;

  // ⭐ The Exit Interviews queue. Gated on the SAME predicate as the RLS policy on
  // fms_exit_interviews — admin ∨ coordinator ∨ HR-confidential — and DELIBERATELY NOT
  // on `myQueue('exit_interview').length > 0` the way Approvals and Clearance are.
  // Those two let a reporting manager in because a manager owns their steps per-case;
  // the reporting manager is exactly who must never reach this one.
  const canInterview = s.canReadConfidential;

  // ⭐ The Settlement queue. Same rule, same reason: the RLS predicate on
  // fms_exit_settlements (minus the leaver's own after-approval clause, which is one case
  // on My Resignation and not a work queue) — admin ∨ coordinator ∨ finance staff. NOT
  // `myQueue(...).length > 0`, which would let the reporting manager in.
  const canSettle = s.isProcessCoordinator || s.isFinanceStaff;

  // ⭐ The Closure queue. NOT gated the way the two above are, and deliberately so: closure
  // carries no money and no interview content — just letters, dates and the signed
  // acknowledgement coming back. So it follows Approvals and Clearance: own the step,
  // coordinate the process, or actually have rows in it.
  const canClose =
    s.isProcessCoordinator ||
    s.isStepOwner("documents") ||
    s.isStepOwner("archive") ||
    s.myQueue("documents").length > 0 ||
    s.myQueue("archive").length > 0;

  // ⭐ The Control Center. Exactly `isProcessCoordinator` — the same predicate as
  // RequireMonitor in ExitApp.tsx, so the link can never lead somewhere that AccessDenies.
  const canMonitor = s.isProcessCoordinator;

  const nav = useMemo(
    () =>
      buildExitNav({
        isAdmin,
        // Owner of ANY master, not just an admin — the Masters page is theirs too.
        canManageMasters: s.isAnyMasterManager,
        // Badge only what THIS user can actually resolve: an Exit Reasons owner must not
        // see a count for payroll-head requests the RPC will refuse them on.
        pendingReviews: s.resolvableRequests.length,
        canApprove,
        canClear,
        canInterview,
        canSettle,
        canClose,
        canMonitor,
        hasCases,
        canDemo: realAdmin && !demoActive,
      }),
    [
      isAdmin,
      realAdmin,
      demoActive,
      s.isAnyMasterManager,
      s.resolvableRequests.length,
      canApprove,
      canClear,
      canInterview,
      canSettle,
      canClose,
      canMonitor,
      hasCases,
    ],
  );

  const notifItems: NotificationItem[] = s.notifications.map((n) => ({
    id: n.id,
    text: n.text,
    time: timeAgo(n.createdAt),
    unread: !n.readAt,
    to: linkFor(n),
  }));

  return (
    <AppShell
      nav={nav}
      role={role}
      user={{ name: user.name, designation: user.designation, color: user.avatarColor, roleLabel: roleLabel(role) }}
      notifications={notifItems}
      onMarkRead={(ids) => {
        void s.markNotificationsRead(ids);
      }}
      roleSwitcher={demoActive ? <PersonaSwitcher personas={personas} /> : undefined}
      banner={demoActive ? <DemoBanner /> : undefined}
    />
  );
}
