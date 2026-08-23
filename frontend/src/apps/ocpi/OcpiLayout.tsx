import { useMemo } from "react";
import AppShell from "@/shared/components/layout/AppShell";
import type { NotificationItem } from "@/shared/components/layout/types";
import { roleLabel, useSession } from "@/core/platform/session";
import { useOrgPersonById } from "@/core/platform/orgPeople";
import { buildOcpiNav } from "./nav";
import { useOcpiStore } from "./store";
import { STEPS } from "./lib/steps";
import type { QueueStep } from "./lib/queues";
import { OCPI_MASTER_TYPES, type OcpiNotification } from "./types";

const B = "/ocpi";

/**
 * Where a bell notification lands. Everything in this module is about ONE deal,
 * so every alert deep-links to that deal's page — which carries the rail saying
 * which step is now owed.
 */
const linkFor = (n: OcpiNotification): string =>
  n.entityType === "deal" ? `${B}/deals/${n.entityId}` : B;

export default function OcpiLayout() {
  const { user, role, isAdmin } = useSession();
  const s = useOcpiStore();
  const orgPersonById = useOrgPersonById();

  const queueSteps = STEPS.filter((st) => !st.noQueue).map((st) => st.key as QueueStep);

  const queues = useMemo(() => {
    const out = {} as Record<QueueStep, boolean>;
    for (const step of queueSteps) out[step] = s.canSeeQueue(step);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s]);

  const nav = useMemo(
    () =>
      buildOcpiNav({
        isAdmin,
        canRaise: s.canRaise,
        canSetup: s.canSetup,
        queues,
        canManageAnyMaster: OCPI_MASTER_TYPES.some((m) => s.canManageMaster(m.value)),
        pendingMasterRequests: s.pendingMasterRequests.length,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isAdmin, s.canRaise, s.canSetup, queues, s.masterManagers, s.pendingMasterRequests],
  );

  const notifItems: NotificationItem[] = s.notifications.map((n) => {
    const actor = n.actorId ? orgPersonById(n.actorId) : undefined;
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
