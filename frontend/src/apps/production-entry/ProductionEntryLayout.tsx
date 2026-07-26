import { useMemo } from "react";
import AppShell from "@/shared/components/layout/AppShell";
import type { NotificationItem } from "@/shared/components/layout/types";
import { roleLabel, useSession } from "@/core/platform/session";
import { useOrgPersonById } from "@/core/platform/orgPeople";
import { buildProductionNav } from "./nav";
import { useProductionStore } from "./store";
import { STEPS } from "./lib/steps";
import type { QueueStep } from "./lib/queues";
import type { ProductionNotification } from "./types";

const B = "/production-entry";

const linkFor = (n: ProductionNotification): string =>
  n.entityType === "request" ? `${B}/requests/${n.entityId}` : `${B}/master-requests`;

export default function ProductionEntryLayout() {
  const { user, role, isAdmin } = useSession();
  const s = useProductionStore();
  const orgPersonById = useOrgPersonById();

  const queueSteps = STEPS.filter((st) => !st.noQueue).map((st) => st.key as QueueStep);
  const queues = useMemo(() => {
    const out = {} as Record<QueueStep, boolean>;
    for (const step of queueSteps) out[step] = s.isProcessCoordinator || s.isStepOwner(step) || s.myQueue(step).length > 0;
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s]);

  const anyQueue = queueSteps.some((step) => queues[step]);
  const hasRequests = s.requests.length > 0 || s.isProcessCoordinator || anyQueue;

  const nav = useMemo(
    () =>
      buildProductionNav({
        isAdmin,
        canManageMasters: s.isAnyMasterManager,
        canMonitor: s.isProcessCoordinator,
        hasRequests,
        canRaise: s.canRaise,
        queues,
      }),
    [isAdmin, s.isAnyMasterManager, s.isProcessCoordinator, hasRequests, s.canRaise, queues],
  );

  const notifItems: NotificationItem[] = s.notifications.map((n) => {
    const actor = n.actorId ? s.profileById(n.actorId) ?? orgPersonById(n.actorId) : undefined;
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
