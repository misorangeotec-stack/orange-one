import { useMemo } from "react";
import PoStageRail, { type PoStageRailNode } from "@/shared/components/ui/PoStageRail";
import { useOrgPersonById } from "@/core/platform/orgPeople";
import { formatDateDMY } from "@/shared/lib/date";
import { useTravelStore } from "../store";
import { stepActorId, stepCompletedIso } from "../lib/queues";
import type { StepKey } from "../lib/steps";
import { STATUS_STEP, type Trip, type TripStatus } from "../types";

/**
 * The trip's whole journey as one rail — the same rail Purchase, Import, OCPI,
 * Production, Order to Dispatch and HR use. This file is the ADAPTER: it turns
 * ids into names and a status into a position; the drawing lives in the shared
 * `PoStageRail`.
 *
 * ⚠ THIS IS THE FIRST CONSUMER OF `PoStageRail.skipped` IN THE CODEBASE. The
 *   prop has been declared and correctly implemented since the rail was written
 *   ("`skipped` outranks every other state") but a repo-wide search finds no
 *   module setting it. Travel Desk has to: two of its nine steps are skipped by
 *   RULE rather than by choice — bands 1 to 5 need no Director, and most trips
 *   draw no advance — and `done` is POSITIONAL (`i < activeIndex`), so a skipped
 *   step sitting behind the active one would otherwise tick GREEN and claim an
 *   approval that never happened. On a trip that is a claim that a Director
 *   signed off spending they never saw.
 *
 * ⚠ A SKIPPED STEP IS NOT A MISSING STEP. It stays on the rail, greyed and
 *   captioned "Not required", because dropping it would silently renumber every
 *   step after it — and the numbering here is the same numbering Settings uses
 *   for step owners and due dates.
 */
const RAIL: { key: string; label: string; step: StepKey | null }[] = [
  { key: "request",           label: "Requested",        step: "request" },
  { key: "manager_approval",  label: "Manager",          step: "manager_approval" },
  { key: "director_approval", label: "Director",         step: "director_approval" },
  { key: "advance",           label: "Advance",          step: "advance" },
  { key: "booking",           label: "Booking",          step: "booking" },
  { key: "claim",             label: "Claim",            step: "claim" },
  { key: "claim_review",      label: "Claim Approval",   step: "claim_review" },
  { key: "finance_review",    label: "Finance",          step: "finance_review" },
  { key: "settlement",        label: "Settlement",       step: "settlement" },
  { key: "closed",            label: "Closed",           step: null },
];

const idxOfStep = (step: StepKey): number => RAIL.findIndex((s) => s.step === step);

/**
 * Which node the trip is sitting on.
 *
 * ⚠ READ THROUGH THE SAME `STATUS_STEP` MAP THE QUEUES READ, so the rail cannot
 *   say a trip is at Finance while the Finance queue does not hold it.
 *
 * ⚠ A HELD TRIP IS SHOWN WHERE IT STOPPED, not where it would go next —
 *   `holdFromStatus` remembers exactly that. This is one of the three defects
 *   20260905120000 documents: resuming a held request must not reroute it to a
 *   step it had already skipped, and a rail that guessed the next step would be
 *   the first place that lie appeared.
 */
function activeIndex(t: Trip): number {
  if (t.status === "closed") return RAIL.length - 1;
  if (t.status === "draft") return 0;

  const live = STATUS_STEP[t.status];
  if (live) return idxOfStep(live);

  if (t.status === "on_hold" && t.holdFromStatus) {
    const held = STATUS_STEP[t.holdFromStatus as TripStatus];
    if (held) return idxOfStep(held);
  }

  const stamped =
    t.status === "returned" ? t.returnedStage : t.status === "rejected" ? t.rejectedStage : null;
  if (stamped) {
    const i = idxOfStep(stamped as StepKey);
    if (i >= 0) return i;
  }

  // Nothing recorded: the first step that neither completed nor was skipped.
  // Capped below Closed, which only a settled trip may sit on.
  const first = RAIL.findIndex(
    (s) =>
      s.step !== null &&
      !stepCompletedIso(t, s.step) &&
      !(s.step === "manager_approval" && t.managerApprovalSkipped) &&
      !(s.step === "director_approval" && t.directorApprovalSkipped) &&
      !(s.step === "advance" && t.advanceSkipped),
  );
  return first < 0 ? RAIL.length - 2 : first;
}

/** Statuses in which the trip is not moving, and the rail should say so. */
const HALTED: Partial<Record<TripStatus, string>> = {
  on_hold: "On hold",
  returned: "Sent back for clarification",
  rejected: "Rejected",
  cancelled: "Cancelled",
  cancellation_requested: "Cancellation requested",
};

export default function TripStepper({ trip, fit }: { trip: Trip; fit?: boolean }) {
  const s = useTravelStore();
  const personById = useOrgPersonById();

  const active = activeIndex(trip);
  const finished = trip.status === "closed";
  const haltedLabel = HALTED[trip.status];

  const nodes: PoStageRailNode[] = useMemo(() => {
    const name = (id: string | null): string | null => personById(id)?.name ?? null;

    return RAIL.map((st, i) => {
      if (!st.step) {
        return { key: st.key, label: st.label, departments: [], people: [], hasStep: false };
      }

      const skipped =
        (st.step === "manager_approval" && trip.managerApprovalSkipped) ||
        (st.step === "director_approval" && trip.directorApprovalSkipped) ||
        (st.step === "advance" && trip.advanceSkipped);

      if (skipped) {
        return {
          key: st.key,
          label: st.label,
          departments: [],
          people: [],
          hasStep: true,
          skipped: true,
          note:
            st.step === "director_approval"
              ? `Band ${trip.snapBandNo ?? "—"} — §3.2`
              : st.step === "manager_approval"
                ? "Straight to a Director"
                : "No advance drawn",
        };
      }

      const doneAt = stepCompletedIso(trip, st.step);
      const isDone = i < active || (finished && i === active);

      /*
        ⚠ `request` NAMES ITS AUTHOR WHETHER OR NOT IT IS FINISHED. Settings
          usually leaves that step unowned — no owners means anyone with an edit
          grant may raise a trip — so asking the owner list would caption a draft
          "Unassigned" when it plainly belongs to somebody. A returned trip sits
          back here too, and its reader's one question is whose desk it is on.
      */
      const actor = isDone || st.step === "request" ? name(stepActorId(trip, st.step)) : null;

      /*
        ⚠ THE TWO MANAGER STEPS NAME THE TRIP'S OWN APPROVERS, not the Settings
          owner list. Those steps route per-trip to the snapshot taken from
          `user_hods` at submit, so the owner list is at best a co-owner and at
          worst somebody who has nothing to do with this trip. When the snapshot
          is empty — 19 of 60 people have no reporting manager on record — it
          falls through to the configured owners, which is exactly what
          fms_travel_can_act does.
      */
      const pending = (): string[] => {
        const configured = s.ownersOf(st.step as StepKey).map(name).filter(Boolean) as string[];
        if (st.step === "manager_approval" || st.step === "claim_review") {
          const snap = trip.approverManagerIds.map(name).filter(Boolean) as string[];
          if (snap.length) return snap;
        }
        return configured;
      };

      return {
        key: st.key,
        label: st.label,
        departments: [],
        people: actor ? [actor] : pending(),
        hasStep: true,
        note: isDone && doneAt ? formatDateDMY(doneAt) : undefined,
      };
    });
    // `personById` closes over a query result and is rebuilt every render by
    // design, so it is deliberately not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip, active, finished, s.stepOwners]);

  return (
    <div className="space-y-2.5">
      {haltedLabel && (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <span className="rounded-full bg-ryg-red/10 px-2.5 py-0.5 text-[11.5px] font-semibold text-ryg-red">
            {haltedLabel}
          </span>
          <span className="text-[12.5px] text-grey-2">
            {trip.status === "cancelled"
              ? "the rail shows where it stopped"
              : trip.status === "returned"
                ? `back with ${personById(trip.raisedBy)?.name ?? "its author"}${
                    trip.returnedReason ? ` — ${trip.returnedReason}` : ""
                  }`
                : "the rail shows the step it is waiting at — nobody's queue holds it"}
          </span>
        </div>
      )}

      <PoStageRail
        nodes={nodes}
        activeIndex={active}
        finished={finished}
        stopped={trip.status === "cancelled" || trip.status === "rejected"}
        fit={fit}
      />
    </div>
  );
}
