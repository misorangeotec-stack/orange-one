/**
 * An FMS bell's own loader: the newest unread notifications for ONE person, in one
 * small request (PERF-1, 06-10-2026).
 *
 * WHY ITS OWN QUERY. The bell used to ride inside each module's whole-module
 * download (fetchDispatchData, fetchProductionData, fetchProcurementData) and so
 * paid for every notification ever sent, read or not: up to 8,552 rows for one
 * person in Order to Dispatch, every row in the table for an admin (the admin
 * write policy lets them read everyone's), and every row again for the nightly
 * ranking / KPI / morning-mail jobs, which reuse those downloads and never look at
 * the bell. Taken out here, the module downloads stop carrying it entirely.
 *
 * WHY 100. The bell shows UNREAD rows only and its count stops at "99+"
 * (NotificationsBell.tsx), so the newest 100 unread render exactly what all of
 * them did. "Mark all as read" therefore clears on the server by person
 * (markAllBellRead), not by the ids on screen, or the count would sit at "99+";
 * it stops at the newest row shown, so nothing unseen is cleared.
 *
 * ⚠ NOT PERSISTED. Keep "fmsBell" OUT of main.tsx's PERSISTED_QUERY_ROOTS: a list
 *   restored from yesterday would show rows already read on another device.
 *
 * In use (PERF-2, 10-10-2026): Order to Dispatch. Production and Purchase keep
 * their bell inside their module download until their own turn.
 *
 * ⚠ ONLY FOR BELLS THAT SHOW UNREAD AND NOTHING ELSE. Task Management's
 *   notifications drive its Tagged screen from READ rows too; they do not belong
 *   here (see the note in NotificationsBell.tsx).
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/core/platform/supabase";

/** The generated Database type does not take a table name as a variable. */
const db = supabase as unknown as SupabaseClient;

export type FmsBellTable =
  | "fms_dispatch_notifications"
  | "fms_production_notifications"
  | "fms_purchase_notifications";

/** Enough to fill the bell's "99+" count. */
export const BELL_LIMIT = 100;

export const FMS_BELL_QK = ["fmsBell"] as const;
export const fmsBellKey = (table: FmsBellTable, userId: string | null) => [...FMS_BELL_QK, table, userId] as const;

/** Newest first; `id` breaks ties so the order never shuffles between loads. */
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
export async function fetchUnreadBell(table: FmsBellTable, userId: string): Promise<any[]> {
  const { data, error } = await db
    .from(table)
    .select("*")
    .eq("user_id", userId)
    .is("read_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(BELL_LIMIT);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function markBellRead(table: FmsBellTable, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await db
    .from(table)
    .update({ read_at: new Date().toISOString() })
    .in("id", ids)
    .is("read_at", null);
  if (error) throw new Error(error.message);
}

/**
 * Every unread row of this person, including the ones beyond the newest 100 -
 * but only up to `upTo`, the newest notification the bell was showing.
 *
 * ⚠ THE `upTo` BOUND IS NOT OPTIONAL CARE. Without it, a notification created
 *   after the bell last loaded would be marked read by a click that never showed
 *   it, and the person would never learn of it. Today's bell (ids on screen) could
 *   not do that, so this must not either.
 */
export async function markAllBellRead(table: FmsBellTable, userId: string, upTo: string | null): Promise<void> {
  let q = db
    .from(table)
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("read_at", null);
  if (upTo) q = q.lte("created_at", upTo);
  const { error } = await q;
  if (error) throw new Error(error.message);
}

/**
 * The bell for one module and one person.
 *
 * Refreshes when the module opens (stale after a minute, like the rest of the hub)
 * and whenever the module's store calls `refreshFmsBells` after a save, so a
 * notification someone else's action created shows up at the same moments it did
 * when it rode the module download.
 *
 * `map` must be a stable, module-level function.
 */
/** One shared empty list, so a bell with no data yet does not hand out a new array every render. */
const NONE: never[] = [];

export function useFmsBell<T extends { id: string; createdAt?: string }>(
  table: FmsBellTable,
  userId: string | null,
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  map: (row: any) => T,
  enabled = true,
) {
  const qc = useQueryClient();
  const key = fmsBellKey(table, userId);
  const q = useQuery({
    queryKey: key,
    queryFn: async () => (await fetchUnreadBell(table, userId as string)).map(map),
    enabled: enabled && !!userId,
    staleTime: 60_000,
    // One small request. Today the bell refreshed with every module refresh,
    // including the Dashboard's on tab focus and the Call List's; this keeps
    // switching back to the tab as a moment a new notification appears.
    refetchOnWindowFocus: true,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: key }).catch(() => {});

  /**
   * Optimistic: the row leaves the bell before the write round-trips (the bell relies
   * on it). A failed write is not thrown: the callers fire and forget (`void`), and
   * the refresh that always follows puts any row that is still unread back, so the
   * bell ends up telling the truth either way.
   */
  const markRead = async (ids: string[]) => {
    const gone = new Set(ids);
    // A refresh already in flight (after a save) must not land after this and
    // briefly put the row back.
    await qc.cancelQueries({ queryKey: key });
    qc.setQueryData<T[]>(key, (prev) => prev?.filter((n) => !gone.has(n.id)));
    try {
      await markBellRead(table, ids);
    } catch {
      /* the refresh below restores the truth */
    } finally {
      void refresh();
    }
  };

  const markAllRead = async () => {
    if (!userId) return;
    // Newest first, so [0] is the newest notification the person was shown.
    const upTo = qc.getQueryData<T[]>(key)?.[0]?.createdAt ?? null;
    await qc.cancelQueries({ queryKey: key });
    qc.setQueryData<T[]>(key, []);
    try {
      await markAllBellRead(table, userId, upTo);
    } catch {
      /* the refresh below restores the truth */
    } finally {
      void refresh();
    }
  };

  return { notifications: q.data ?? (NONE as T[]), isLoading: q.isLoading, markRead, markAllRead, refresh };
}

/** After a save in a module: pick up any notification the save produced for someone. */
export const refreshFmsBells = (qc: ReturnType<typeof useQueryClient>, table: FmsBellTable) =>
  qc.invalidateQueries({ queryKey: [...FMS_BELL_QK, table] }).catch(() => {});
