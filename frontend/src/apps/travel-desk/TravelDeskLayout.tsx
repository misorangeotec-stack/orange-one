import { useMemo } from "react";
import AppShell from "@/shared/components/layout/AppShell";
import type { NotificationItem } from "@/shared/components/layout/types";
import { roleLabel, useSession } from "@/core/platform/session";
import { useOrgPersonById } from "@/core/platform/orgPeople";
import { buildTravelNav } from "./nav";
import { useTravelStore } from "./store";
import { STEPS, MENU_HIDDEN_DEFAULT } from "./lib/steps";
import type { QueueStep } from "./lib/queues";
import type { TravelNotification } from "./types";

const B = "/travel-desk";


/**
 * Where a bell notification lands. Everything in this module is about ONE trip —
 * a leg, a claim line and a comment all belong to one — so every alert
 * deep-links to that trip's page, which carries the rail saying which step is
 * now owed.
 */
const linkFor = (n: TravelNotification): string =>
  n.entityType === "trip" ? `${B}/trips/${n.entityId}` : B;

export default function TravelDeskLayout() {
  const { user, role, isAdmin } = useSession();
  const s = useTravelStore();
  const orgPersonById = useOrgPersonById();

  const queueSteps = STEPS.filter((st) => !st.noQueue).map((st) => st.key as QueueStep);

  // Settings → Menu queues decides which queues the left menu shows. Hidden
  // ones are only out of the menu: the page, the work and the URL stay.
  const menuHidden = useMemo(
    () => new Set(s.config.menuHiddenQueues ?? MENU_HIDDEN_DEFAULT),
    [s.config.menuHiddenQueues],
  );

  const queues = useMemo(() => {
    const out = {} as Record<QueueStep, boolean>;
    for (const step of queueSteps) out[step] = s.canSeeQueue(step) && !menuHidden.has(step);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, menuHidden]);

  const nav = useMemo(
    () =>
      buildTravelNav({
        isAdmin,
        canRaise: s.canRaise,
        canSetup: s.canSetup,
        queues,
        canManageAnyMaster: s.canManageAnyMaster,
        pendingMasterRequests: s.pendingMasterRequests.length,
        showCancellations: !menuHidden.has("cancellations"),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isAdmin, s.canRaise, s.canSetup, queues, s.canManageAnyMaster, s.pendingMasterRequests, menuHidden],
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
