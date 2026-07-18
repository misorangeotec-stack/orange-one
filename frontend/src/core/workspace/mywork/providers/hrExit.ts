/**
 * HR Exit FMS → My Work.
 *
 * Uses `buildQueueEntries(exitSnapshotFrom(data))` — the same two calls the exit
 * store and the FMS Control Center make, on the same cache entry.
 *
 * ⚠ OWNERSHIP HERE IS NOT PURELY STEP-BASED. A clearance row carries its own
 * `ownerIds` — WHO owes THAT SPECIFIC CHECK (IT owes the laptop, Finance owes the
 * advance, and so on). Falling back to the `clearance` step's owner list would put
 * every department's outstanding check on every clearance owner's home screen. So
 * a row's own `ownerIds` wins whenever it is present; step owners are the fallback
 * for the steps that have no per-row owner.
 *
 * One exit case is legitimately owed at several steps at once, and each outstanding
 * clearance check is its own entry — so a case can appear more than once here. That
 * is correct: they are separate units of work.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { appName } from "@/apps/appInfo";
import { exitQueryKey, fetchExitData } from "@/apps/hr-exit/data/exitFetch";
import { buildQueueEntries, exitSnapshotFrom, type QueueEntry } from "@/apps/hr-exit/lib/queues";
import { stepByKey } from "@/apps/hr-exit/lib/steps";
import { stepOwnerIdsFor } from "@/shared/lib/fmsOwners";
import type { StepOwnerRow } from "@/shared/lib/fmsOwners";
import type { MyWorkProvider, MyWorkResult, WorkItem } from "../types";

/** Steps that are somebody's decision to make, surfaced as approvals. */
const APPROVAL_STEPS = new Set(["manager_review", "hr_verification", "hr_head_approval", "fnf_approve"]);

/** Per-row owners win over step owners — see the header note. */
const ownersOf = (e: QueueEntry, stepOwners: StepOwnerRow[]): string[] =>
  e.ownerIds && e.ownerIds.length ? e.ownerIds : stepOwnerIdsFor(e.stepKey, stepOwners);

function useHrExitWork(active: boolean): MyWorkResult {
  const { user, isAdmin } = useSession();
  const uid = user?.id ?? null;

  const { data, isLoading, error } = useQuery({
    queryKey: exitQueryKey(uid),
    queryFn: fetchExitData,
    enabled: active && !!uid,
  });

  const items = useMemo<WorkItem[]>(() => {
    if (!data || !uid) return [];
    const stepOwners = data.stepOwners;
    return buildQueueEntries(exitSnapshotFrom(data))
      .filter((e) => isAdmin || ownersOf(e, stepOwners).includes(uid))
      .map((e) => ({
        // A clearance check is its own work-item, so the check id has to be part
        // of the key — otherwise four open checks on one case collapse into one row.
        id: `hr-exit:${e.checkId ?? e.entityId}:${e.stepKey}`,
        source: "hr-exit",
        sourceLabel: appName("hr-exit"),
        ref: e.ref,
        stage: stepByKey(e.stepKey)?.short,
        dueIso: e.dueIso,
        to: `/hr-exit/exits/${e.caseId}`,
        assignment: ownersOf(e, stepOwners).includes(uid) ? ("direct" as const) : ("team" as const),
        isApproval: APPROVAL_STEPS.has(e.stepKey),
      }));
  }, [data, uid, isAdmin]);

  return { items, isLoading, error };
}

export const hrExitProvider: MyWorkProvider = {
  key: "hr-exit",
  label: appName("hr-exit"),
  appId: "hr-exit",
  category: "fms",
  unit: "steps",
  tier: 2,
  useMyWork: useHrExitWork,
};
