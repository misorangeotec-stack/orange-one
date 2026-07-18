import { useMemo } from "react";
import AppShell from "@/shared/components/layout/AppShell";
import type { NotificationItem } from "@/shared/components/layout/types";
import { roleLabel, useSession } from "@/core/platform/session";
import { timeAgo } from "@/shared/lib/time";
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

  const canFirstApprove =
    s.isProcessCoordinator ||
    s.isStepOwner("first_approval") ||
    s.hodDepartmentIds.length > 0 ||
    s.myQueue("first_approval").length > 0;
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
    />
  );
}
