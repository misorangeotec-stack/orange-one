/**
 * HR Recruitment FMS → My Work.
 *
 * Uses `buildQueueEntries(hrSnapshotFrom(data))` — the same two calls the HR store
 * and the FMS Control Center make, on the same cache entry.
 *
 * Ownership is plain step ownership here (no value-band matrix), so it uses the
 * shared `isMineByStepOwners`. Note that RLS ALREADY narrows what an HR user can
 * read — a hiring manager only sees their own requisitions — so this filter
 * tightens "what I can see" down to "what I owe", it does not widen anything.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { appName } from "@/apps/appInfo";
import { fetchHrData, hrQueryKey } from "@/apps/hr-recruitment/data/hrFetch";
import { buildQueueEntries, hrSnapshotFrom } from "@/apps/hr-recruitment/lib/queues";
import { stepByKey } from "@/apps/hr-recruitment/lib/steps";
import { isMineByStepOwners } from "@/shared/lib/fmsOwners";
import type { MyWorkProvider, MyWorkResult, WorkItem } from "../types";

/** Steps that are somebody's decision to make, surfaced as approvals. */
const APPROVAL_STEPS = new Set(["hr_head_approval", "mgmt_approval", "final_decision"]);

function useHrWork(active: boolean): MyWorkResult {
  const { user, isAdmin } = useSession();
  const uid = user?.id ?? null;

  const { data, isLoading, error } = useQuery({
    queryKey: hrQueryKey(uid),
    queryFn: fetchHrData,
    enabled: active && !!uid,
  });

  const items = useMemo<WorkItem[]>(() => {
    if (!data || !uid) return [];
    const owners = data.stepOwners;
    return buildQueueEntries(hrSnapshotFrom(data))
      .filter((e) => isAdmin || isMineByStepOwners(e.stepKey, uid, owners))
      .map((e) => ({
        id: `hr:${e.entityId}:${e.stepKey}`,
        source: "hr",
        sourceLabel: appName("hr-recruitment"),
        ref: e.ref,
        stage: stepByKey(e.stepKey)?.short,
        dueIso: e.dueIso,
        // A candidate row has no page of its own — it opens its requisition.
        to: `/hr-recruitment/requisitions/${
          e.entityType === "requisition" ? e.entityId : e.requisitionId ?? ""
        }`,
        assignment: isMineByStepOwners(e.stepKey, uid, owners) ? ("direct" as const) : ("team" as const),
        isApproval: APPROVAL_STEPS.has(e.stepKey),
      }));
  }, [data, uid, isAdmin]);

  return { items, isLoading, error };
}

export const hrProvider: MyWorkProvider = {
  key: "hr",
  label: appName("hr-recruitment"),
  appId: "hr-recruitment",
  category: "fms",
  unit: "steps",
  tier: 2,
  useMyWork: useHrWork,
};
