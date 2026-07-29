import type { PoStageRailNode } from "@/shared/components/ui/PoStageRail";
import { stageStepKey } from "../lib/steps";
import type { useImportStore } from "../store";

type Store = ReturnType<typeof useImportStore>;

/**
 * The full Purchase FMS lifecycle as rail stages, in order: the three
 * request-scoped steps (Request → Approval → Generate PO) followed by
 * the PO lifecycle (Share PO … QC Inspection) and the terminal `closed` node.
 *
 * BOTH the Request screen (RequestStepper) and the PO screen (PoStepper) build
 * their rail from THIS list, so the journey reads identically on either side —
 * the Request screen sits its active node in the request half, the PO screen in
 * the PO half with the request half already ticked.
 *
 * `generated` maps to the `po` step for owner captions via `stageStepKey`,
 * matching how the PO stepper has always resolved that node.
 *
 * `purchase_return` and `gate_outward` are marked `branch`: they only exist for a
 * PO whose QC inspection REJECTED something. `buildFlowNodes` drops them for
 * everyone else, so the ordinary rail stays 9 nodes + Closed — which matters
 * because PoStageRail prints `i + 1` in each pending circle, making the node
 * order a user-visible step numbering that has to line up with STEPS[].index.
 */
export const FLOW_STAGES = [
  { key: "request", label: "Request" },
  { key: "approval", label: "Approval" },
  { key: "generated", label: "Generate PO" },
  { key: "share_po", label: "Share PO" },
  { key: "collect_pi", label: "Collect PI" },
  { key: "follow_up", label: "Follow-up" },
  { key: "inward", label: "Inward" },
  { key: "tally", label: "Tally" },
  { key: "qc_inspection", label: "QC Inspection" },
  { key: "purchase_return", label: "Purchase Return", branch: true },
  { key: "gate_outward", label: "Gate Outward", branch: true },
  { key: "closed", label: "Closed" },
] as const;

/** Position of a stage key within FLOW_STAGES (-1 if unknown). */
export const flowIndex = (key: string): number => FLOW_STAGES.findIndex((st) => st.key === key);

/** First PO-scoped node — everything before it is request-side. */
export const SHARE_PO_INDEX = flowIndex("share_po");
export const TALLY_INDEX = flowIndex("tally");
export const QC_INDEX = flowIndex("qc_inspection");

/** The stages actually shown for a PO: the branch nodes only once it has a rejection. */
const visibleStages = (showReturnBranch: boolean) =>
  FLOW_STAGES.filter((st) => showReturnBranch || !("branch" in st && st.branch));

/**
 * Resolve every visible FLOW_STAGES entry to a rail node captioned with the
 * department and people who own that step. Identical resolution to PoStepper:
 * personName (not profileById), because the directory is RLS-scoped to self +
 * downline + same-department peers, so cross-department owners would render blank.
 */
export function buildFlowNodes(s: Store, showReturnBranch = false): PoStageRailNode[] {
  return visibleStages(showReturnBranch).map((st) => {
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
 * Map a PO's `current_stage` onto its index in the VISIBLE node list.
 *
 * A live PO's earliest real stage is share_po (its request half is already done).
 * A PO that closed with an unbooked GRN sits on Tally, and one that closed with a
 * receipt still uninspected sits on QC — in both cases the step is genuinely
 * outstanding even though the stage machine says `closed`, and ticking it would
 * be a lie.
 */
export function poFlowIndex(
  currentStage: string,
  tallyPending: boolean,
  showReturnBranch = false,
  qcPending = false,
): number {
  const stages = visibleStages(showReturnBranch);
  const at = (key: string) => stages.findIndex((st) => st.key === key);
  const closedIndex = stages.length - 1;

  if (currentStage === "closed" && tallyPending) return at("tally");
  if (currentStage === "closed" && qcPending) return at("qc_inspection");
  if (currentStage === "closed" || currentStage === "cancelled") return closedIndex;
  const i = at(currentStage);
  // The lower clamp catches a legacy PO parked on the retired advance_payment
  // stage, and any stage missing from the visible list.
  const sharePoIndex = at("share_po");
  return i < sharePoIndex ? sharePoIndex : i;
}
