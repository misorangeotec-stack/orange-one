import { useMemo } from "react";
import AppShell from "@/shared/components/layout/AppShell";
import type { NotificationItem } from "@/shared/components/layout/types";
import { roleLabel, useSession } from "@/core/platform/session";
import { useOrgPersonById } from "@/core/platform/orgPeople";
import { buildComplaintNav } from "./nav";
import { MANAGEMENT_STEPS } from "./lib/steps";
import { useComplaintStore } from "./store";
import { B, creditNotesHref, requestHref } from "./lib/routes";
import type { ComplaintNotification } from "./types";

const linkFor = (n: ComplaintNotification): string =>
  n.entityType === "request"
    ? requestHref(n.entityId)
    : n.entityType === "credit_note"
      ? creditNotesHref({ tab: "all", open: n.entityId })
      : B;

/**
 * Wires the portal session + complaint store into the shared AppShell.
 *
 * Every per-step visibility rule lives in `store.canSeeQueue` — step owners,
 * coordinators, and the per-request assignees (investigator, CAPA owner,
 * resolver, confirmer) who own no step but do most of the work. It lives there so
 * the route guards in ComplaintApp enforce exactly what this sidebar offers,
 * rather than a second copy of six conditions drifting out of step.
 *
 * The bell renders `n.text` RAW, so every notification we write is a whole sentence.
 */
export default function ComplaintLayout() {
  const { user, role, isAdmin } = useSession();
  const s = useComplaintStore();
  const orgPersonById = useOrgPersonById();

  const canPlant = s.canSeeQueue("plant");
  const canService = s.canSeeQueue("service");
  // The compensation approvers sit on the same desk — see pages/queues/ApprovalQueue.
  // ONE management desk: FG approval, RM / other-supplier review, final review
  // and customer compensation all live on the Management Approval page.
  const canApprove =
    MANAGEMENT_STEPS.some((st) => s.canSeeQueue(st)) || s.isStepOwner("cn_approval");
  const canPurchase = s.canSeeQueue("purchase");
  const canRmManagement = s.canSeeQueue("rm_management");
  const canReview = s.canSeeQueue("management_review");
  // No Setup owners: this one appears only for the person management handed a
  // complaint to. See store.canSeeQueue.
  const canAssignee = s.canSeeQueue("assignee");
  const canMonitor = s.canMonitor;

  const hasRequests =
    s.isModuleViewer ||
    s.isProcessCoordinator ||
    s.requests.length > 0 ||
    canPlant ||
    canService ||
    canApprove ||
    canPurchase ||
    canRmManagement ||
    canReview ||
    canAssignee;

  const nav = useMemo(
    () =>
      buildComplaintNav({
        isAdmin,
        canSeeMasters: s.canSeeMasters,
        canPlant,
        canService,
        canApprove,
        canPurchase,
        canRmManagement,
        canReview,
        canAssignee,
        canMonitor,
        canRaise: s.canRaise,
        canEdit: s.canEdit,
        hasRequests,
        canSeeCreditNotes: s.canSeeCreditNotes,
      }),
    [
      isAdmin,
      s.canSeeMasters,
      canPlant,
      canService,
      canApprove,
      canPurchase,
      canRmManagement,
      canReview,
      canAssignee,
      canMonitor,
      s.canRaise,
      s.canEdit,
      hasRequests,
      s.canSeeCreditNotes,
    ],
  );

  const notifItems: NotificationItem[] = s.notifications.map((n) => {
    const actor = n.actorId ? (s.profileById(n.actorId) ?? orgPersonById(n.actorId)) : undefined;
    return {
      id: n.id,
      actorName: n.actorId ? (actor?.name ?? "Someone") : "System",
      actorColor: actor?.avatarColor,
      message: n.text,
      createdAt: n.createdAt,
      unread: !n.readAt,
      to: linkFor(n),
    };
  });

  return (
    <AppShell
      nav={nav}
      role={role}
      user={{
        name: user.name,
        designation: user.designation,
        color: user.avatarColor,
        roleLabel: roleLabel(role),
      }}
      notifications={notifItems}
      onMarkRead={(ids) => {
        void s.markNotificationsRead(ids);
      }}
    />
  );
}
