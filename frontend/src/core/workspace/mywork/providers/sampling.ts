/**
 * Sampling FMS → My Work.
 *
 * Uses `buildQueueEntries(samplingSnapshotFrom(...))` — the same two calls the
 * sampling store and the FMS Control Center make, on the same cache entry.
 *
 * A request sits at exactly one open step, derived from its `status` column, so a
 * request can never appear twice here. Sampling has NO approval steps — isApproval
 * is always false.
 *
 * Ownership is NOT step owners alone. Several sampling steps are assigned on the
 * REQUEST — the collector collects, the hand-over recipient receives it and sends
 * it to the lab, whoever the lab handed the result to confirms it, and on outward
 * the chosen sender dispatches while a per-source confirmer confirms receipt.
 * `can_act` in the database and the app's own queues both honour that; this list
 * did not, so anyone who was only ever a per-request assignee saw an empty My Work
 * while the work sat in their sampling queue. `isMineBySampling` below mirrors the SQL.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { appName } from "@/apps/appInfo";
import { fetchSamplingData, samplingQueryKey } from "@/apps/sampling/data/samplingFetch";
import { buildQueueEntries, samplingSnapshotFrom } from "@/apps/sampling/lib/queues";
import { isSourceScoped, stepByKey } from "@/apps/sampling/lib/steps";
import { confirmerSourceOf, outwardSourceOf } from "@/apps/sampling/lib/format";
import { isMineByStepOwners, type StepOwnerRow } from "@/shared/lib/fmsOwners";
import type {
  Confirmer as SamplingConfirmer,
  SamplingRequest,
  StepSourceOwner,
} from "@/apps/sampling/types";
import type { MyWorkProvider, MyWorkResult, WorkItem } from "../types";

/**
 * Mirrors public.fms_sampling_can_act minus the admin / coordinator short-circuits.
 *
 * Every per-request arm the SQL has must be here, or the person sees the work in
 * their sampling queue and NOT in My Work — which is exactly what happened to the
 * two OUTWARD arms (`send_sample`, `confirm_receipt`) until they were added.
 * Three mirrors of this rule exist: the SQL, sampling's own store, and this.
 */
const isMineBySampling = (
  stepKey: string,
  uid: string,
  r: SamplingRequest | undefined,
  owners: StepOwnerRow[],
  sourceOwners: StepSourceOwner[],
  confirmers: SamplingConfirmer[],
): boolean => {
  // OWNERSHIP OF THE THREE OUTWARD STEPS IS PER SOURCE, so the shared flat lookup
  // is wrong for them in both directions: it would find nothing (the server keeps
  // those rows inert) or, fed the union, show a Domestic owner Export work.
  // `isMineByStepOwners` stays untouched — it is shared with HR and General Purchase.
  if (isSourceScoped(stepKey)) {
    if (
      r &&
      sourceOwners.some(
        (o) => o.stepKey === stepKey && o.source === outwardSourceOf(r.receiveVia) && o.employeeIds.includes(uid),
      )
    ) {
      return true;
    }
  } else if (isMineByStepOwners(stepKey, uid, owners)) {
    return true;
  }
  if (!r) return false;
  // ⚠ `stepKey` is a plain `string` here, NOT StepKey — narrowing that union does
  // not break this switch, so retired keys have to be pulled out by hand.
  // `receive_sample` was removed with the step on 08-08-2026.
  switch (stepKey) {
    case "sample_collect":
      return r.collectorId === uid;
    case "sample_received":
    case "sample_to_lab":
      return r.handoverRecipientId === uid;
    case "result_received":
      return r.labResultToId === uid;
    // Outward: the chosen sender dispatches it (the inward collector's twin).
    case "send_sample":
      return !!r.senderId && r.senderId === uid;
    // The person the result is handed over TO closes the request.
    case "result_handover":
      return !!r.resultHandoverToId && r.resultHandoverToId === uid;
    // Receipt confirmers are mapped PER SOURCE — a Domestic confirmer must not be
    // shown an Export dispatch (the server refuses it either way).
    case "confirm_receipt":
      return confirmers.some((c) => c.active && c.userId === uid && c.source === confirmerSourceOf(r.receiveVia));
    default:
      return false;
  }
};

function useSamplingWork(active: boolean): MyWorkResult {
  const { user, isAdmin } = useSession();
  const uid = user?.id ?? null;

  const { data, isLoading, error } = useQuery({
    queryKey: samplingQueryKey(uid),
    queryFn: fetchSamplingData,
    enabled: active && !!uid,
  });

  const items = useMemo<WorkItem[]>(() => {
    if (!data || !uid) return [];
    const owners = data.stepOwners;
    const sourceOwners = data.stepSourceOwners;
    const confirmers = data.confirmers;
    const byId = new Map(data.requests.map((r) => [r.id, r]));
    return buildQueueEntries(samplingSnapshotFrom({ requests: data.requests, stepSla: data.config.stepSla }))
      .filter((e) => isAdmin || isMineBySampling(e.stepKey, uid, byId.get(e.requestId), owners, sourceOwners, confirmers))
      .map((e) => ({
        id: `sampling:${e.requestId}:${e.stepKey}`,
        source: "sampling",
        sourceLabel: appName("sampling"),
        ref: e.ref,
        stage: stepByKey(e.stepKey)?.short,
        dueIso: e.dueIso,
        to: `/sampling/requests/${e.requestId}`,
        // "direct" = named on this request or a step owner; anything an admin sees
        // beyond that is the team's.
        assignment: isMineBySampling(e.stepKey, uid, byId.get(e.requestId), owners, sourceOwners, confirmers)
          ? ("direct" as const)
          : ("team" as const),
        isApproval: false,
      }));
  }, [data, uid, isAdmin]);

  return { items, isLoading, error };
}

export const samplingProvider: MyWorkProvider = {
  key: "sampling",
  label: appName("sampling"),
  appId: "sampling",
  category: "sampling",
  unit: "steps",
  tier: 2,
  useMyWork: useSamplingWork,
};
