import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { appName } from "@/apps/appInfo";
import { fetchTravelData, travelQueryKey } from "@/apps/travel-desk/data/travelFetch";
import { buildQueueEntries } from "@/apps/travel-desk/lib/queues";
import { resolveStepSla } from "@/apps/travel-desk/lib/sla";
import { STAGES, STEPS } from "@/apps/travel-desk/lib/steps";
import { snapshotFrom } from "../lib/buckets";
import type { FmsAdapter } from "./types";

/**
 * Travel Desk adapter — a row on the cross-FMS scoreboard.
 *
 * The counts come from `buildQueueEntries(...)` — LITERALLY the same call
 * travel-desk/store.tsx makes, on the same react-query cache entry keyed on the
 * REAL session user id, so the scoreboard can never drift from the app.
 *
 * ⚠ WHAT THIS ROW DOES NOT SHOW:
 *     a DRAFT trip — it owes nobody and is private to its author, so counting it
 *       would report somebody's unfinished thinking as work the business is
 *       waiting on;
 *     an ON HOLD trip — still open, still listed on the module's own Parked
 *       strip, but owing nobody an action today;
 *     a RETURNED trip — the ball is with its author, who sees it under My Trips.
 *   All three fall out of STATUS_STEP simply not answering for them.
 *
 * ⚠ THE SLA MAP IS RESOLVED HERE TOO, from the same config row the app reads.
 *   Passing it is what makes a late trip show as late on the scoreboard;
 *   omitting it would bucket everything as "no date", which reads as "nothing is
 *   outstanding" to a director scanning twelve modules. `resolveStepSla` merges
 *   the stored map over the defaults, so a module nobody has configured still
 *   reports honest dates rather than none.
 *
 *   That matters more here than elsewhere: two of this module's due dates are
 *   not "N days after the previous step" at all — the claim is measured from the
 *   trip's return date, and the advance BACKWARDS from departure — and both are
 *   resolved by lib/queues.ts, which this call goes through.
 */
export const travelDeskAdapter: FmsAdapter = {
  key: "travel-desk",
  appId: "travel-desk",
  name: appName("travel-desk"),
  controlCenterPath: "/travel-desk/monitoring",
  status: "live",
  useSnapshot() {
    const session = useSession();
    const userId = session.user?.id ?? null;
    const { data, isLoading, error } = useQuery({
      queryKey: travelQueryKey(userId),
      queryFn: fetchTravelData,
      enabled: !!userId,
    });
    const snapshot = useMemo(
      () =>
        data
          ? snapshotFrom(buildQueueEntries(data.trips, resolveStepSla(data.stepSla)), STEPS, STAGES)
          : null,
      [data],
    );
    return { snapshot, isLoading, error };
  },
};
