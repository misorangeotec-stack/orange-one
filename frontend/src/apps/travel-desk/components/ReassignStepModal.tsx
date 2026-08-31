import { useMemo } from "react";
import ReassignModal from "@/shared/components/approvals/ReassignModal";
import { useOrgPersonById } from "@/core/platform/orgPeople";
import { useTravelStore } from "../store";
import { stepByKey, type StepKey } from "../lib/steps";
import type { Trip } from "../types";

/**
 * Reassign ONE step of ONE trip to somebody else. The dialog is shared
 * (`shared/components/approvals/ReassignModal`); this file resolves Travel's own
 * answer to "who may receive it?" and turns the store's candidate IDS into names.
 *
 * ⚠ Names are resolved HERE, not in the store. The Travel store has no directory
 *   dependency, and adding one for a single dialog would be the wrong trade — so
 *   `reassignCandidates` returns ids and this maps them through the ORG-WIDE
 *   people list (the RLS-scoped directory would render a cross-department
 *   approver blank, and a cross-department approver is the normal case here).
 *
 * ⚠ Handing it BACK returns the step to the trip's ORIGINAL snapshot approvers.
 *   `approver_manager_ids` is never rewritten by this feature — it is write-once
 *   by design (20261005120700), so a re-org cannot silently re-route a trip
 *   somebody is already waiting on, and "return it" therefore always means the
 *   person the trip was actually raised against.
 */
export default function ReassignStepModal({
  trip,
  step,
  open,
  onClose,
}: {
  trip: Trip | null;
  step: StepKey | null;
  open: boolean;
  onClose: () => void;
}) {
  const s = useTravelStore();
  const personById = useOrgPersonById();
  const name = (id: string) => personById(id)?.name ?? "Unknown user";

  const assignee = trip && step ? s.assigneeOfStep(trip.id, step) : null;
  const candidates = useMemo(
    () =>
      trip && step
        ? s
            .reassignCandidates(step, trip)
            .map((id) => ({ id, name: name(id) }))
            .sort((a, b) => a.name.localeCompare(b.name))
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s, trip, step, personById]
  );

  if (!trip || !step) return null;

  const label = stepByKey(step)?.title ?? step;

  return (
    <ReassignModal
      open={open}
      onClose={onClose}
      docRef={`${trip.tripNo ?? "Trip"} · ${label}`}
      resetKey={`${trip.id}|${step}`}
      candidates={candidates}
      currentHolderName={assignee ? name(assignee) : null}
      defaultOwnerLabel="Whoever normally owns this step"
      setupHref="/travel-desk/settings"
      setupLabel="Setup → Reassignment"
      returnLabel="Return to the usual owner"
      subtitle="This one step leaves your queue and appears in theirs. The rest of the trip is unaffected."
      onReassign={(target, note) => s.reassignStep({ trip, step, assignee: target, note })}
    />
  );
}
