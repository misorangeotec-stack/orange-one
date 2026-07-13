import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { fetchHrData, hrQueryKey } from "@/apps/hr-recruitment/data/hrFetch";
import { buildQueueEntries, hrSnapshotFrom } from "@/apps/hr-recruitment/lib/queues";
import { STAGES, STEPS } from "@/apps/hr-recruitment/lib/steps";
import { snapshotFrom } from "../lib/buckets";
import type { FmsAdapter } from "./types";

/**
 * HR Recruitment FMS adapter — the second row on the scoreboard.
 *
 * Counts come from `buildQueueEntries`, the exact function HR's own store calls to
 * build its queues. Not "the same rules", not "the same predicates" — literally the
 * same call, on the same react-query cache entry. That is the whole reason the queue
 * model exists: compute the numbers a second way and the scoreboard and the queue
 * pages will drift, and a scoreboard that disagrees with the page it links to is
 * worse than no scoreboard.
 *
 * The query key matches `hr-recruitment/store.tsx` exactly (same helper, same REAL
 * session user id), so react-query serves both from one cache entry: no second copy
 * of the reads, and the data is already warm if the user has opened HR this session.
 *
 * RLS does the scoping for free: a coordinator sees every requisition and so counts
 * everything; a hiring manager sees only theirs and so counts only theirs. The
 * scoreboard never needs to know which.
 */
export const hrAdapter: FmsAdapter = {
  key: "hr",
  name: "HR Recruitment FMS",
  controlCenterPath: "/hr-recruitment/monitoring",
  status: "live",
  useSnapshot() {
    const session = useSession();
    const userId = session.user?.id ?? null;
    const { data, isLoading, error } = useQuery({
      queryKey: hrQueryKey(userId),
      queryFn: fetchHrData,
      enabled: !!userId,
    });
    // `hrSnapshotFrom` — not a hand-copied object literal. This used to list the fields
    // out by hand, in parallel with the store doing the same, so the scoreboard could
    // silently omit one and compute different due dates from identical data.
    //
    // STAGES rolls the eighteen steps up into the four the row actually opens to. The step
    // detail is still there underneath — and it is the SAME grouping HR's own Control
    // Center strip uses, from the same list, so the two screens cannot cut the workflow
    // into different shapes.
    const snapshot = useMemo(
      () => (data ? snapshotFrom(buildQueueEntries(hrSnapshotFrom(data)), STEPS, STAGES) : null),
      [data],
    );
    return { snapshot, isLoading, error };
  },
};
