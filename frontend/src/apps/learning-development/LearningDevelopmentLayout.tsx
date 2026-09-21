import { useMemo } from "react";
import AppShell from "@/shared/components/layout/AppShell";
import type { NotificationItem } from "@/shared/components/layout/types";
import { roleLabel, useSession } from "@/core/platform/session";
import { useOrgPersonById } from "@/core/platform/orgPeople";
import { buildLdNav, B } from "./nav";
import { useLdStore } from "./store";
import { REQUEST_STEPS, type StepKey } from "./lib/steps";
import type { LdNotification } from "./types";

const linkFor = (n: LdNotification): string => {
  switch (n.entityType) {
    case "request":
      return `${B}/requests/${n.entityId}`;
    case "session":
      return `${B}/calendar`;
    default:
      return B;
  }
};

/**
 * Wires the portal session and the L&D store into the shared AppShell.
 *
 * The bell renders `n.text` RAW, so every notification the RPCs write is a whole
 * sentence — "Training need sent back: Name the 4 people, not the team" rather
 * than a code the reader has to decode.
 */
export default function LearningDevelopmentLayout() {
  const { user, role, isAdmin } = useSession();
  const s = useLdStore();
  const orgPersonById = useOrgPersonById();

  const countByStep = useMemo(() => {
    const out: Partial<Record<StepKey, number>> = {};
    for (const e of s.queueEntries) {
      if (!s.canSeeQueue(e.stepKey)) continue;
      out[e.stepKey] = (out[e.stepKey] ?? 0) + 1;
    }
    return out;
  }, [s]);

  const queues = useMemo(() => {
    const out: Partial<Record<StepKey, boolean>> = {};
    for (const key of REQUEST_STEPS) out[key] = s.offersQueue(key);
    return out;
  }, [s]);

  const nav = useMemo(
    () =>
      buildLdNav({
        isAdmin,
        canRaise: s.canRaise,
        isPipelineStaff: s.isPipelineStaff,
        canMonitor: s.canMonitor,
        countByStep,
        queues,
      }),
    [isAdmin, s.canRaise, s.isPipelineStaff, s.canMonitor, countByStep, queues],
  );

  // Who did it: the directory first, the org-wide list as backup — `profiles` is
  // RLS-scoped, so a colleague in another department resolves to nothing there.
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
