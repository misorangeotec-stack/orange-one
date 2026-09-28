/**
 * The named-viewer list (HRREP-1) — read by every page, written only on Settings.
 *
 * `hr_report_viewers` is one row per person who may read EVERYBODY's report. Its RLS
 * lets anyone see their OWN row and an admin see the lot, so the same query answers
 * both "am I a viewer?" for a reader and "who is on the list?" for the Settings screen
 * — a reader simply gets back their own row or nothing.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/core/platform/supabase";

// Untyped alias for a table outside the generated Database types — the standing
// convention here (see asset-maintenance/data/assetFetch.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface ViewerRow {
  user_id: string;
  added_by: string | null;
  added_at: string;
}

const KEY = ["hr-reports", "viewers"];

export function useViewers() {
  return useQuery<ViewerRow[]>({
    queryKey: KEY,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await db.from("hr_report_viewers").select("user_id, added_by, added_at");
      // A reader who is not a viewer and not an admin gets an empty list, not an error.
      // Anything else is real and must surface rather than silently narrowing the page.
      if (error) throw new Error(error.message);
      return (data ?? []) as ViewerRow[];
    },
  });
}

/**
 * Add and remove, one person at a time.
 *
 * ⚠ DELIBERATELY NOT "save the whole list". A Setup screen that replaces the list
 *   wholesale can wipe it: open the tab before the fetch lands, press Save, and an
 *   empty array goes over the top of everybody's permission. Row-at-a-time writes make
 *   that impossible — there is no code path here that can send "nobody".
 */
export function useSetViewer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, on, byUserId }: { userId: string; on: boolean; byUserId: string }) => {
      if (on) {
        const { error } = await db
          .from("hr_report_viewers")
          .upsert({ user_id: userId, added_by: byUserId }, { onConflict: "user_id" });
        if (error) throw new Error(error.message);
      } else {
        // ⚠ PostgREST refuses an unqualified delete, and a rolled-back SQL test never
        //   shows it — the filter is the whole statement, not a nicety.
        const { error } = await db.from("hr_report_viewers").delete().eq("user_id", userId);
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}
