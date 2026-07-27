import type { PoStageRailNode } from "@/shared/components/ui/PoStageRail";
import { stageStepKey } from "../lib/steps";
import type { useImportStore } from "../store";

type Store = ReturnType<typeof useImportStore>;

/**
 * The full Import Purchase FMS lifecycle as rail stages, in order: the three
 * request-scoped steps (Request → Approval → Generate PO) followed by the PO
 * lifecycle (Share PO … Tally) and the terminal `closed` node.
 *
 * BOTH the Request screen (RequestStepper) and the PO screen (PoStepper) build
 * their rail from THIS list, so the journey reads identically on either side —
 * the Request screen sits its active node in the request half, the PO screen in
 * the PO half with the request half already ticked.
 *
 * No Sourcing / Collect PI / Advance node: those steps do not exist in Import
 * (lines are born at `approval`, and share_po advances straight to follow_up).
 * The eight nodes line up 1:1 with `STEPS[].index`, so the number in a rail
 * circle matches the step number shown on the dashboard pipeline and in
 * Setup → Step Owners.
 *
 * `generated` maps to the `po` step for owner captions via `stageStepKey`,
 * matching how the PO stepper has always resolved that node.
 */
export const FLOW_STAGES = [
  { key: "request", label: "Request" },
  { key: "approval", label: "Approval" },
  { key: "generated", label: "Generate PO" },
  { key: "share_po", label: "Share PO" },
  { key: "follow_up", label: "Follow-up" },
  { key: "inward", label: "Inward" },
  { key: "tally", label: "Tally" },
  { key: "closed", label: "Closed" },
] as const;

/** Position of a stage key within FLOW_STAGES (-1 if unknown). */
export const flowIndex = (key: string): number => FLOW_STAGES.findIndex((st) => st.key === key);

/** First PO-scoped node — everything before it is request-side. */
export const SHARE_PO_INDEX = flowIndex("share_po");
export const TALLY_INDEX = flowIndex("tally");
export const CLOSED_INDEX = FLOW_STAGES.length - 1;

/**
 * Resolve every FLOW_STAGES entry to a rail node captioned with the department
 * and people who own that step. personName (not profileById), because the
 * directory is RLS-scoped to self + downline + same-department peers, so
 * cross-department owners would render blank.
 */
export function buildFlowNodes(s: Store): PoStageRailNode[] {
  return FLOW_STAGES.map((st) => {
    const stepKey = stageStepKey(st.key);
    // `closed` has no backing step, so it has no owners to show.
    if (!stepKey) {
      return { key: st.key, label: st.label, departments: [], people: [], hasStep: false };
    }
    const owner = s.stepOwnerFor(stepKey);
    return {
      key: st.key,
      label: st.label,
      departments: (owner?.departmentIds ?? [])
        .map((id) => s.departmentById(id)?.name)
        .filter((n): n is string => !!n),
      people: (owner?.employeeIds ?? [])
        .map((id) => s.personName(id))
        .filter((n) => n !== "—"),
      hasStep: true,
    };
  });
}

/**
 * Map a PO's `current_stage` onto its FLOW_STAGES index. A live PO's earliest
 * real stage is share_po (its request half is already done); a PO that closed
 * with an unbooked GRN sits on Tally (its Tally step is genuinely outstanding).
 *
 * The lower clamp also absorbs a legacy PO parked on the retired `collect_pi` /
 * `advance_payment` stages: flowIndex returns -1, so it renders on Share PO.
 */
export function poFlowIndex(currentStage: string, tallyPending: boolean): number {
  if (currentStage === "closed" && tallyPending) return TALLY_INDEX;
  if (currentStage === "closed" || currentStage === "cancelled") return CLOSED_INDEX;
  const i = flowIndex(currentStage);
  return i < SHARE_PO_INDEX ? SHARE_PO_INDEX : i;
}
