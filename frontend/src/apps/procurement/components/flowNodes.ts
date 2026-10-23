import type { PoStageRailNode } from "@/shared/components/ui/PoStageRail";
import { stageStepKey } from "../lib/steps";
import type { useProcurementStore } from "../store";

type Store = ReturnType<typeof useProcurementStore>;

/**
 * The full Purchase FMS lifecycle as rail stages, in order: the four
 * request-scoped steps (Request → Sourcing → Approval → Generate PO) followed by
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
 * everyone else, so the ordinary rail stays 11 nodes + Closed — which matters
 * because PoStageRail prints `i + 1` in each pending circle, making the node
 * order a user-visible step numbering that has to line up with STEPS[].index.
 */
export const FLOW_STAGES = [
  { key: "request", label: "Request" },
  { key: "sourcing", label: "Sourcing" },
  { key: "approval", label: "Approval" },
  { key: "generated", label: "Generate PO" },
  { key: "share_po", label: "Share PO" },
  { key: "collect_pi", label: "Collect PI" },
  { key: "advance_payment", label: "Advance" },
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
 *
 * `approvalOwnerIds` overrides the Approval node's people. Every other step has
 * one fixed owner list in `step_owners`, but approval is routed per requisition —
 * by the matrix band for its value. A caller that
 * knows which requisition this rail belongs to (RequestStepper) passes the
 * resolved approvers here; without it the node falls back to the `step_owners`
 * row, which is the *configured* approval team rather than this PR's approver.
 *
 * `doneByIds` (from {@link stageActorIds}) names who ACTUALLY did each stage;
 * PoStageRail shows it in place of the owner list once that node is done.
 */
export function buildFlowNodes(
  s: Store,
  showReturnBranch = false,
  approvalOwnerIds?: string[],
  doneByIds?: Partial<Record<string, string[]>>,
): PoStageRailNode[] {
  const names = (ids: string[]) => [...new Set(ids.map((id) => s.personName(id)).filter((n) => !!n && n !== "—"))];
  return visibleStages(showReturnBranch).map((st) => {
    const stepKey = stageStepKey(st.key);
    // `closed` has no backing step, so it has no owners to show.
    if (!stepKey) {
      return { key: st.key, label: st.label, departments: [], people: [], hasStep: false };
    }
    const done = doneByIds?.[st.key];
    const doneBy = done?.length ? names(done) : undefined;
    if (stepKey === "approval" && approvalOwnerIds) {
      return {
        key: st.key,
        label: st.label,
        // No department chip: these people were picked by amount, not by the
        // department stamped on the static step_owners row.
        departments: [],
        people: approvalOwnerIds.map((id) => s.personName(id)).filter((n) => n !== "—"),
        hasStep: true,
        doneBy,
      };
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
      doneBy,
    };
  });
}

/**
 * Who actually did each stage, per FLOW_STAGES key, across the given
 * requisitions and POs — the same actor columns the "completed" stage lists in
 * lib/queues.ts use. A stage whose rows pre-date their actor column simply has
 * no entry, so the rail falls back to the owner list. `closed` is stamped by the
 * stage machine, not a person, so it never gets one.
 */
export function stageActorIds(s: Store, requestIds: string[], poIds: string[]): Partial<Record<string, string[]>> {
  const reqs = new Set(requestIds);
  const pos = new Set(poIds);
  const lines = s.requestItems.filter((l) => reqs.has(l.requestId));
  const qcs = s.qcInspections.filter((q) => pos.has(q.poId));
  const ids = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];
  return {
    request: ids(requestIds.map((id) => s.requestById(id)?.requesterId)),
    // Request-level stamp first; legacy requisitions were sourced per line.
    sourcing: ids(requestIds.flatMap((id) => {
      const r = s.requestById(id);
      return r?.sourcedBy ? [r.sourcedBy] : lines.filter((l) => l.requestId === id).map((l) => l.sourcedBy);
    })),
    // approver_id is stamped with auth.uid() at the decision; on a line still
    // under decision it is not a decider yet.
    approval: ids(lines.filter((l) => !["sourcing", "approval", "on_hold"].includes(l.status)).map((l) => l.approverId)),
    generated: ids(poIds.map((id) => s.poById(id)?.createdBy)),
    share_po: ids(poIds.map((id) => s.poById(id)?.sharedBy)),
    collect_pi: ids(s.pis.filter((p) => pos.has(p.poId)).map((p) => p.createdBy)),
    advance_payment: ids(s.payments.filter((p) => pos.has(p.poId) && p.kind === "advance").map((p) => p.createdBy)),
    follow_up: ids(s.followups.filter((f) => pos.has(f.poId)).map((f) => f.createdBy)),
    inward: ids(s.grns.filter((g) => pos.has(g.poId)).map((g) => g.receivedBy)),
    tally: ids(s.tallyBookings.filter((t) => pos.has(t.poId)).map((t) => t.bookedBy)),
    qc_inspection: ids(qcs.map((q) => q.inspectedBy)),
    purchase_return: ids(qcs.map((q) => q.returnedBy)),
    gate_outward: ids(qcs.map((q) => q.gateOutBy)),
  };
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
  // The lower clamp catches a legacy PO parked on the retired collect_pi /
  // advance_payment stages, and any stage missing from the visible list.
  const sharePoIndex = at("share_po");
  return i < sharePoIndex ? sharePoIndex : i;
}
