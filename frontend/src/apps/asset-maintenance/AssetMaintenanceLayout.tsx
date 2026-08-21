import { useMemo } from "react";
import AppShell from "@/shared/components/layout/AppShell";
import type { NotificationItem } from "@/shared/components/layout/types";
import { roleLabel, useSession } from "@/core/platform/session";
import { useOrgPersonById } from "@/core/platform/orgPeople";
import { buildAssetNav, QUEUE_PATH } from "./nav";
import { useAssetStore } from "./store";
import { STEPS } from "./lib/steps";
import type { QueueStep } from "./lib/queues";
import type { AssetNotification } from "./types";

const B = "/asset-maintenance";

/**
 * Where a bell notification lands. Job alerts deep-link to the JOB, which carries
 * the rail saying which step is now owed; asset alerts go to the asset.
 */
const linkFor = (n: AssetNotification): string => {
  if (n.entityType === "job") return `${B}/jobs/${n.entityId}`;
  if (n.entityType === "asset") return `${B}/assets/${n.entityId}`;
  return `${B}/master-requests`;
};

export default function AssetMaintenanceLayout() {
  const { user, role, isAdmin } = useSession();
  const s = useAssetStore();
  const orgPersonById = useOrgPersonById();

  const queueSteps = STEPS.filter((st) => !st.noQueue).map((st) => st.key as QueueStep);

  // A queue appears for its owners and coordinators, and for an asset's custodian
  // once they actually have work in it — they own no step, yet may record the
  // schedule and the service on their own assets. `canSeeQueue` says all three.
  const queues = useMemo(() => {
    const out = {} as Record<QueueStep, boolean>;
    for (const step of queueSteps) {
      out[step] = s.canSeeQueue(step);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s]);

  const nav = useMemo(
    () =>
      buildAssetNav({
        isAdmin,
        canManageMasters: s.canSeeMasters,
        canMonitor: s.canMonitor,
        canRaise: s.canRaise,
        queues,
      }),
    [isAdmin, s.canSeeMasters, s.canMonitor, s.canRaise, queues],
  );

  const notifItems: NotificationItem[] = s.notifications.map((n) => {
    // A reminder is announced by pg_cron, which has no session user — so a null
    // actor is expected here and reads as "System", not as a missing name.
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

export { QUEUE_PATH };
