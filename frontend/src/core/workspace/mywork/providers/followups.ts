/**
 * Receivables follow-ups → My Work.
 *
 * DELIBERATELY NOT `useFollowups()`. That hook depends on `useAppData({})`, which
 * pulls the entire receivables payload — the largest single download in the app —
 * only to attach an outstanding figure and resolve salesperson scope. Loading it
 * to draw the home screen would defeat the whole staged-loading strategy.
 *
 * So this reads the follow-up log alone, on the SAME query key `useFollowups` uses,
 * so the cache is still shared with the Hub.
 *
 * The accepted cost: no outstanding/overdue rupee figure on the home row. The
 * customer name, the due date and the link are what make the row actionable; the
 * amount is one click away.
 *
 * SCOPE: this filters to rows the signed-in user themselves logged, which is also
 * how the Hub defines ownership ("whoever logged the most recent follow-up owns
 * the next one"). That is strictly narrower than the Hub's salesperson scope, so
 * it cannot leak another salesperson's customers onto this screen.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { fetchFollowups } from "@/apps/receivables-hub/lib/followupsApi";
import { latestByEntity } from "@/apps/receivables-hub/lib/followupTypes";
import type { MyWorkProvider, MyWorkResult, WorkItem } from "../types";

function useFollowupWork(active: boolean): MyWorkResult {
  const { user } = useSession();
  const uid = user.id;

  const { data, isLoading, error } = useQuery({
    queryKey: ["receivablesFollowups"],
    queryFn: fetchFollowups,
    enabled: active,
  });

  const items = useMemo<WorkItem[]>(() => {
    if (!data) return [];
    const out: WorkItem[] = [];
    // Only the latest row per customer defines an open follow-up — older rows have
    // been superseded and must not each become their own to-do.
    for (const f of latestByEntity(data).values()) {
      if (!f.nextFollowupDate) continue; // no further chase scheduled
      if (f.createdBy !== uid) continue;
      out.push({
        id: `followups:${f.id}:followup`,
        source: "followups",
        sourceLabel: "Receivables",
        ref: f.entityName,
        detail: f.remarks || undefined,
        stage: "Follow up",
        dueIso: f.nextFollowupDate,
        // No per-entity route exists on the follow-ups page yet, so this lands on
        // the worklist. Adding `?entity=` there is a small follow-on change.
        to: "/outstanding-dashboard/followups",
        assignment: "direct" as const,
      });
    }
    return out;
  }, [data, uid]);

  return { items, isLoading, error };
}

export const followupsProvider: MyWorkProvider = {
  key: "followups",
  label: "Receivables",
  appId: "outstanding-dashboard",
  category: "sales",
  unit: "items",
  tier: 1,
  useMyWork: useFollowupWork,
};
