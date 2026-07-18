import { useEffect } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/core/platform/supabase";
import { fetchMyNotifications } from "../data/fetchTaskData";
import type { Notification } from "../types";

/**
 * The notification feed's query key.
 *
 * NOTE it is a SIBLING ROOT, not `["taskData", "notifications"]`. The task
 * store's optimistic `patchTaskLocation` does a `setQueriesData<TaskData>` over
 * the whole `["taskData"]` prefix and only guards `if (!prev.tasks) return prev`
 * — that cast is a lie about any non-task payload living under the prefix. A
 * separate root sidesteps the entire class of bug.
 *
 * The cost of that choice: the ~30 existing `invalidateQueries(["taskData"])`
 * calls no longer refresh the bell, so every write that touches notifications
 * has to invalidate this key too. `TASK_NOTIF_KEY` exists so those call sites
 * name the same thing.
 */
export const TASK_NOTIF_KEY = "taskNotifications";

export interface MyNotifications {
  notifications: Notification[];
  isLoading: boolean;
}

/**
 * Flip `readAt` in the cache immediately, before the write round-trips.
 *
 * The bell is unread-only, so this is what makes a clicked row disappear in the
 * same frame instead of a few hundred ms later. Both callers (the task store and
 * the /home hook) go through here so they can't drift.
 *
 * MAPS, never filters. Removing entries would look identical in the bell and
 * silently break the Tagged screen, which derives its whole task set from this
 * same array — read rows included.
 *
 * No rollback needed on failure: the caller invalidates, and the refetch is the
 * server's word on it either way. The realtime subscription also echoes our own
 * UPDATE back and invalidates, which just confirms this patch.
 */
export function markReadOptimistic(queryClient: QueryClient, ids: string[]): void {
  if (ids.length === 0) return;
  const now = new Date().toISOString();
  const target = new Set(ids);
  queryClient.setQueriesData<Notification[]>({ queryKey: [TASK_NOTIF_KEY] }, (prev) =>
    prev?.map((n) => (target.has(n.id) && !n.readAt ? { ...n, readAt: now } : n))
  );
}

/**
 * Loads my notifications and keeps them live.
 *
 * Shared by the task app's store and the portal home screen — same key, so the
 * two share one cache entry, one fetch and one realtime subscription rather than
 * racing each other. Store-free on purpose: `/home` must be able to call this
 * without mounting TaskStoreProvider.
 */
export function useMyNotifications(userId: string | null | undefined): MyNotifications {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: [TASK_NOTIF_KEY, userId ?? null],
    queryFn: () => fetchMyNotifications(userId as string),
    enabled: !!userId,
  });

  // Realtime: a new assignment or @mention lights the bell without a refresh.
  // RLS already scopes the stream to my own rows; the server-side filter keeps
  // the socket quiet regardless. Any event just refetches — the payload is small
  // and this avoids reconciling partial rows (the embedded task title isn't in
  // the change event).
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        () => { void queryClient.invalidateQueries({ queryKey: [TASK_NOTIF_KEY] }); }
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [userId, queryClient]);

  return { notifications: data ?? [], isLoading };
}
