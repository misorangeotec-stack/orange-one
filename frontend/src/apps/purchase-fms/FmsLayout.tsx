import { useMemo, useState } from "react";
import AppShell from "@/shared/components/layout/AppShell";
import type { NotificationItem } from "@/shared/components/layout/types";
import { useSession, ALL_ROLES } from "@/core/platform/session";
import { useFmsStore, activeStage, entryStatus } from "./mock/store";
import { stageByKey } from "./config/stages";
import { isOwner } from "./lib/owner";
import { fmsNav } from "./nav";
import { dateLabel } from "@/shared/lib/time";

const roleLabel = (role: string) => ALL_ROLES.find((r) => r.value === role)?.label ?? role;

/**
 * Wires the portal session + Purchase FMS data into the shared AppShell. Mock
 * notifications surface the entries currently awaiting the signed-in user (or, for
 * admins, every entry awaiting action) — the turn-based hand-off in action.
 */
export default function FmsLayout() {
  const { user, role, isAdmin } = useSession();
  const { entries, ownerForStep } = useFmsStore();
  const [readIds, setReadIds] = useState<Set<string>>(new Set());

  const notifications = useMemo<NotificationItem[]>(() => {
    return entries
      .filter((e) => entryStatus(e) === "in_progress")
      .filter((e) => {
        const active = activeStage(e);
        return active && (isAdmin || isOwner(ownerForStep(active.key), user.id));
      })
      .map((e) => {
        const active = activeStage(e);
        const def = active ? stageByKey(active.key) : undefined;
        return {
          id: e.id,
          text: (
            <span>
              <b className="font-semibold text-navy">{e.code}</b> is awaiting{" "}
              <b className="font-semibold text-navy">{def?.title ?? "the next step"}</b>
            </span>
          ),
          time: active?.plannedDate ? `Planned ${dateLabel(active.plannedDate)}` : "",
          unread: !readIds.has(e.id),
          to: `/purchase-fms/entries/${e.id}`,
        };
      });
  }, [entries, isAdmin, ownerForStep, user.id, readIds]);

  return (
    <AppShell
      nav={fmsNav}
      role={role}
      user={{ name: user.name, designation: user.designation, color: user.avatarColor, roleLabel: roleLabel(role) }}
      notifications={notifications}
      onMarkRead={(ids) => setReadIds((prev) => new Set([...prev, ...ids]))}
    />
  );
}
