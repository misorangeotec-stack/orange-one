import { useMemo } from "react";
import AppShell from "@/shared/components/layout/AppShell";
import type { NotificationItem } from "@/shared/components/layout/types";
import { roleLabel, useSession } from "@/core/platform/session";
import { useOrgPersonById } from "@/core/platform/orgPeople";
import { buildSuppliesNav } from "./nav";
import { useSuppliesStore } from "./store";
import type { SupplyNotification } from "./types";


const B = "/office-supplies";

const linkFor = (n: SupplyNotification): string => {
  switch (n.entityType) {
    case "request":
      return `${B}/requests/${n.entityId}`;
    case "master_request":
      return `${B}/master-requests`;
    default:
      return B;
  }
};

/**
 * Wires the portal session + supplies store into the shared AppShell. The nav is
 * capability-driven, except for the two items every employee gets (see nav.tsx). The
 * bell renders `n.text` RAW, so every notification we write is a whole sentence.
 */
export default function SuppliesLayout() {
  const { user, role, isAdmin } = useSession();
  const s = useSuppliesStore();
  const orgPersonById = useOrgPersonById();

  // No step-owner clause: first approval belongs to the department's HOD alone.
  const canFirstApprove =
    s.isProcessCoordinator || s.hodDepartmentIds.length > 0 || s.myQueue("first_approval").length > 0;
  const canSecondApprove =
    s.isProcessCoordinator || s.isStepOwner("second_approval") || s.myQueue("second_approval").length > 0;
  const canHandover = s.isProcessCoordinator || s.isStepOwner("handover") || s.myQueue("handover").length > 0;
  const canMonitor = s.isProcessCoordinator;
  const hasRequests =
    s.requests.length > 0 || s.isFulfilmentStaff || s.isProcessCoordinator || s.hodDepartmentIds.length > 0;

  const nav = useMemo(
    () =>
      buildSuppliesNav({
        isAdmin,
        canManageMasters: s.isAnyMasterManager,
        pendingReviews: s.resolvableRequests.length,
        canFirstApprove,
        canSecondApprove,
        canHandover,
        canMonitor,
        hasRequests,
      }),
    [
      isAdmin,
      s.isAnyMasterManager,
      s.resolvableRequests.length,
      canFirstApprove,
      canSecondApprove,
      canHandover,
      canMonitor,
      hasRequests,
    ],
  );

  // Who did it used to be dropped entirely — the bell showed a bare sentence.
  // Directory first, org-wide list as backup: profileById is RLS-scoped, so a
  // colleague in another department resolves to nothing.
  const notifItems: NotificationItem[] = s.notifications.map((n) => {
    const actor = n.actorId ? s.profileById(n.actorId) ?? orgPersonById(n.actorId) : undefined;
    return {
      id: n.id,
      actorName: n.actorId ? actor?.name ?? "Someone" : "System",
      actorColor: actor?.avatarColor,
      // Its own line under the name — these are whole sentences whose subject is
      // the request, not the actor.
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
      user={{ name: user.name, designation: user.designation, color: user.avatarColor, roleLabel: roleLabel(role) }}
      notifications={notifItems}
      onMarkRead={(ids) => {
        void s.markNotificationsRead(ids);
      }}
    />
  );
}
