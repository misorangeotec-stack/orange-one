/**
 * The Customer Onboarding bell, mounted in the hub's topbar.
 *
 * ⚠ IT READS ITS OWN TINY QUERY, NOT THE MODULE STORE — on purpose.
 *   CustomerOnboardingProvider is mounted on /customer-onboarding/* only, so
 *   that the hub's other forty pages never pay for the module's snapshot. A bell
 *   fed by that store would therefore only appear on the pages you are already
 *   looking at, which is the one place you do not need to be told. This reads
 *   ONE table, scoped by RLS to `user_id = auth.uid()` — a handful of rows,
 *   indexed, and shared by every hub page through one cache entry.
 *
 * ⚠ IT RENDERS NOTHING WHEN THERE IS NOTHING. Most hub users have no part in
 *   customer onboarding; a bell that is permanently empty is furniture. It
 *   appears the moment they receive their first notification and disappears
 *   again only if every row is somehow removed.
 *
 * The dropdown itself is the shared, app-agnostic NotificationsBell — the same
 * one the portal and the five FMS apps use, sitting next to UserMenu which is
 * also a portal component. It is unread-only by design; reading a row clears it.
 */
import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import NotificationsBell from "@/shared/components/layout/NotificationsBell";
import type { NotificationItem } from "@/shared/components/layout/types";
import { useSession } from "@/core/platform/session";
import { useOrgPersonById } from "@/core/platform/orgPeople";
import { supabase } from "@/core/platform/supabase";
import { markNotificationsRead } from "@hub/data/customerOnboarding/customerWrites";
import { CUSTOMER_QK } from "@hub/data/customerOnboarding/customerFetch";
import { detailHref } from "@hub/lib/customerOnboarding/routes";

const db = supabase as any;

/** Own key, deliberately OUTSIDE CUSTOMER_QK's prefix — see the note in refresh(). */
const BELL_QK = ["customerOnboardingBell"] as const;

interface BellRow {
  id: string;
  entity_id: string;
  text: string;
  actor_id: string | null;
  read_at: string | null;
  created_at: string;
}

async function fetchBell(): Promise<BellRow[]> {
  const { data, error } = await db
    .from("fms_customer_notifications")
    .select("id, entity_id, text, actor_id, read_at, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as BellRow[];
}

export default function CustomerBell() {
  const { user } = useSession();
  const personById = useOrgPersonById();
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: BELL_QK,
    queryFn: fetchBell,
    enabled: !!user?.id,
    staleTime: 60 * 1000,
    // Someone verifying a batch of requests in another tab should surface here
    // within a minute, without a websocket.
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const items = useMemo<NotificationItem[]>(
    () =>
      (data ?? []).map((n) => {
        const actor = personById(n.actor_id);
        return {
          id: n.id,
          actorName: n.actor_id ? (actor?.name ?? "Someone") : "System",
          actorColor: actor?.avatarColor,
          message: n.text,
          createdAt: n.created_at,
          unread: n.read_at === null,
          to: detailHref(n.entity_id),
        };
      }),
    [data, personById],
  );

  const onMarkRead = useCallback(
    (ids: string[]) => {
      // Patch the cache FIRST so the row vanishes on the click, not on the
      // round-trip — the bell is unread-only, so a lagging list re-renders the
      // row the user just dismissed.
      queryClient.setQueryData<BellRow[]>(BELL_QK, (prev) =>
        (prev ?? []).map((n) => (ids.includes(n.id) ? { ...n, read_at: new Date().toISOString() } : n)),
      );
      void markNotificationsRead(ids)
        .then(() => {
          // The module's own snapshot carries the same rows for the "For you"
          // card, and it is a DIFFERENT key — so it needs telling separately.
          void queryClient.invalidateQueries({ queryKey: CUSTOMER_QK });
        })
        .catch(() => {
          // A failed mark-read is not worth a toast in the topbar; the next
          // refetch puts the row back and the user can try again.
          void queryClient.invalidateQueries({ queryKey: BELL_QK });
        });
    },
    [queryClient],
  );

  if (items.length === 0) return null;

  return <NotificationsBell items={items} onMarkRead={onMarkRead} />;
}
