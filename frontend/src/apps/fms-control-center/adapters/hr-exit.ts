import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { appName } from "@/apps/appInfo";
import { exitQueryKey, fetchExitData } from "@/apps/hr-exit/data/exitFetch";
import { buildQueueEntries, exitSnapshotFrom } from "@/apps/hr-exit/lib/queues";
import { STAGES, STEPS } from "@/apps/hr-exit/lib/steps";
import { snapshotFrom } from "../lib/buckets";
import type { FmsAdapter } from "./types";

/**
 * HR Exit FMS adapter — the third row on the scoreboard.
 *
 * ── THE LOAD-BEARING RULE ────────────────────────────────────────────────────
 *
 * The counts come from `buildQueueEntries(exitSnapshotFrom(data))` — LITERALLY the
 * same two calls `hr-exit/store.tsx` makes, on the same react-query cache entry. Not
 * "the same rules", not "the same predicates": the same function, the same input.
 *
 * That is the whole reason `exitSnapshotFrom` exists as a named builder rather than
 * an object literal in the store. Hand-write the snapshot a second time here and the
 * two would compute DIFFERENT DUE DATES FROM IDENTICAL DATA the first time someone
 * adds a field to `ExitSnapshot` and updates only one site — which is precisely how
 * HR Recruitment's clocks drifted apart from its own scoreboard. The compiler cannot
 * catch a literal that is merely stale; it can catch a missing argument.
 *
 * ── THE CACHE ENTRY ──────────────────────────────────────────────────────────
 *
 * `exitQueryKey(session.user.id)` matches `hr-exit/store.tsx` exactly — same helper,
 * same REAL session user id, never the impersonated demo persona. Keyed on the persona
 * this would be a SECOND key, so opening the scoreboard would silently re-fetch ~15
 * tables and then bucket a different snapshot. One key, one fetch, one snapshot.
 *
 * RLS does the scoping for free: a coordinator reads every case and so counts
 * everything; an IT clearance owner reads only the cases they owe a row on and so
 * counts only those. The scoreboard never needs to know which.
 *
 * ⚠ An exit case is legitimately owed at SEVERAL STEPS AT ONCE (clearance AND assets
 * AND handover AND the interview…), and each outstanding clearance check is its own
 * entry. So the per-step counts here can exceed the open-case count — that is correct
 * and intended, and `snapshotFrom` counts ENTRIES and never dedupes (see
 * lib/buckets.ts and the note on MasterControlCenter: "the same entry can be waiting
 * at two steps at once").
 *
 * Held / withdrawn / rejected / archived cases contribute NOTHING: `isOpenCase()`
 * excludes them inside `buildQueueEntries`, so a parked exit can never turn up here
 * as a red number.
 */
export const hrExitAdapter: FmsAdapter = {
  key: "hr-exit",
  appId: "hr-exit",
  name: appName("hr-exit"),
  controlCenterPath: "/hr-exit/monitoring",
  status: "live",
  useSnapshot() {
    const session = useSession();
    const userId = session.user?.id ?? null;
    const { data, isLoading, error } = useQuery({
      queryKey: exitQueryKey(userId),
      queryFn: fetchExitData,
      enabled: !!userId,
    });
    // STAGES rolls the fifteen queue steps up into the four the row actually opens to —
    // and it is the SAME list `hr-exit/pages/monitoring/ControlCenter.tsx` hands to
    // StepPipeline, from lib/steps.ts, so the two screens cannot cut the workflow into
    // different shapes. `resignation` is `noQueue`, so `snapshotFrom` drops it: raising
    // the resignation IS the event, and it never holds work.
    const snapshot = useMemo(
      () => (data ? snapshotFrom(buildQueueEntries(exitSnapshotFrom(data)), STEPS, STAGES) : null),
      [data],
    );
    return { snapshot, isLoading, error };
  },
};
