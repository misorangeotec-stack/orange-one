import { useMemo } from "react";
import AppShell from "@/shared/components/layout/AppShell";
import type { NotificationItem } from "@/shared/components/layout/types";
import { roleLabel, useSession } from "@/core/platform/session";
import { useOrgPersonById } from "@/core/platform/orgPeople";
import { buildDispatchNav, QUEUE_PATH } from "./nav";
import { useDispatchStore } from "./store";
import { STEPS } from "./lib/steps";
import type { QueueStep } from "./lib/queues";
import type { DispatchNotification } from "./types";

const B = "/order-to-dispatch";

/**
 * Where a bell notification lands. Order alerts deep-link to the order itself
 * rather than to a queue: the reader wants the whole picture, and the order page
 * carries the rail that says which step is now owed.
 */
const linkFor = (n: DispatchNotification): string =>
  n.entityType === "order" ? `${B}/orders/${n.entityId}` : `${B}/master-requests`;

export default function OrderToDispatchLayout() {
  const { user, role, isAdmin } = useSession();
  const s = useDispatchStore();
  const orgPersonById = useOrgPersonById();

  const queueSteps = STEPS.filter((st) => !st.noQueue).map((st) => st.key as QueueStep);

  // A queue appears for its owners and coordinators, and for anyone who happens to
  // have work sitting in it — so a stand-in never loses the link to their own work.
  const queues = useMemo(() => {
    const out = {} as Record<QueueStep, boolean>;
    for (const step of queueSteps) {
      out[step] = s.isProcessCoordinator || s.isStepOwner(step) || s.myQueue(step).length > 0;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s]);

  const anyQueue = queueSteps.some((step) => queues[step]);
  const hasOrders = s.orders.length > 0 || s.isProcessCoordinator || anyQueue;

  const nav = useMemo(
    () =>
      buildDispatchNav({
        isAdmin,
        canManageMasters: s.isAnyMasterManager,
        canMonitor: s.isProcessCoordinator,
        hasOrders,
        canRaise: s.canRaise,
        pendingReviews: s.resolvableRequests.length,
        queues,
      }),
    [isAdmin, s.isAnyMasterManager, s.isProcessCoordinator, hasOrders, s.canRaise, s.resolvableRequests.length, queues],
  );

  const notifItems: NotificationItem[] = s.notifications.map((n) => {
    const actor = n.actorId ? s.profiles.find((p) => p.id === n.actorId) ?? orgPersonById(n.actorId) : undefined;
    return {
      id: n.id,
      actorName: n.actorId ? actor?.name ?? "Someone" : "System",
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
      user={{ name: user.name, designation: user.designation, color: user.avatarColor, roleLabel: roleLabel(role) }}
      notifications={notifItems}
      onMarkRead={(ids) => {
        void s.markNotificationsRead(ids);
      }}
    />
  );
}

export { QUEUE_PATH };
