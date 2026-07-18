import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { fetchOrgPeople } from "@/core/platform/orgPeople";
import type { NotificationItem } from "@/shared/components/layout/types";
import { timeAgo } from "@/shared/lib/time";
import { useMyNotifications, TASK_NOTIF_KEY } from "@/apps/task-management/lib/useMyNotifications";
import { notificationText, notificationLink } from "@/apps/task-management/lib/notifyText";
import { markNotificationsRead, markNotificationsUnread } from "@/apps/task-management/data/taskWrites";

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
  onMarkUnread: (ids: string[]) => void;
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

  const nameById = new Map((orgPeople ?? []).map((p) => [p.id, p.name] as const));

  const items: NotificationItem[] = notifications.map((n) => ({
    id: n.id,
    // No tasks array here — the builder falls back to the title carried on the
    // row itself by fetchMyNotifications' embedded join.
    text: notificationText(n, { actorName: nameById.get(n.actorId ?? "") ?? "Someone" }),
    time: timeAgo(n.createdAt),
    unread: !n.readAt,
    to: notificationLink(n),
  }));

  const refresh = () => queryClient.invalidateQueries({ queryKey: [TASK_NOTIF_KEY] });

  const onMarkRead = (ids: string[]) => {
    if (ids.length === 0) return;
    void markNotificationsRead(ids).then(refresh);
  };

  const onMarkUnread = (ids: string[]) => {
    if (ids.length === 0) return;
    void markNotificationsUnread(ids).then(refresh);
  };

  return { items, onMarkRead, onMarkUnread };
}
