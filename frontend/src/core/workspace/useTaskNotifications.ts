import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { fetchOrgPeople } from "@/core/platform/orgPeople";
import type { NotificationItem } from "@/shared/components/layout/types";
import { useMyNotifications, markReadOptimistic, TASK_NOTIF_KEY } from "@/apps/task-management/lib/useMyNotifications";
import { notificationMessage, notificationLink } from "@/apps/task-management/lib/notifyText";
import { markNotificationsRead } from "@/apps/task-management/data/taskWrites";

/**
 * Task notifications for the PORTAL home screen's bell.
 *
 * `/home` deliberately showed an inert bell for a long time, because there is no
 * cross-app notification feed — only per-app ones. This wires up the task app's
 * feed specifically: being assigned a task is the notification people actually
 * need to see before they've picked an app to open.
 *
 * It reaches into the task app for its *data* and *presentation* modules but
 * never its store — mounting TaskStoreProvider here would block the home screen
 * on the whole task payload, which is exactly what the staged loading in
 * mywork/providers/tasks.ts exists to avoid. Same precedent, same shape: that
 * provider already imports fetchTaskData from core.
 *
 * Because it reuses the task app's query key, /home and the task app share one
 * cache entry, one fetch and one realtime subscription.
 */
export function useTaskNotifications(): {
  items: NotificationItem[];
  onMarkRead: (ids: string[]) => void;
} {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const { notifications } = useMyNotifications(user?.id);

  // Org-wide names, NOT the RLS-scoped directory: an assigner in another
  // department is missing from the directory and would render as "Someone".
  // Same key + staleTime every other consumer uses, so the cache is shared.
  const { data: orgPeople } = useQuery({
    queryKey: ["orgPeople"],
    queryFn: fetchOrgPeople,
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  const personById = new Map((orgPeople ?? []).map((p) => [p.id, p] as const));

  const items: NotificationItem[] = notifications.map((n) => {
    const actor = n.actorId ? personById.get(n.actorId) : undefined;
    return {
      id: n.id,
      actorName: actor?.name ?? "Someone",
      actorColor: actor?.avatarColor,
      // No tasks array here — the builder falls back to the title carried on the
      // row itself by fetchMyNotifications' embedded join.
      message: notificationMessage(n, {}),
      createdAt: n.createdAt,
      unread: !n.readAt,
      to: notificationLink(n),
    };
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: [TASK_NOTIF_KEY] });

  const onMarkRead = (ids: string[]) => {
    if (ids.length === 0) return;
    // Same optimistic patch the task store uses, so a clicked row leaves the
    // bell here too rather than waiting on the round-trip.
    markReadOptimistic(queryClient, ids);
    void markNotificationsRead(ids).then(refresh);
  };

  return { items, onMarkRead };
}
