import { useMemo } from "react";
import PoStageRail, { type PoStageRailNode } from "@/shared/components/ui/PoStageRail";
import { useProcurementStore } from "../store";
import { buildFlowNodes, poFlowIndex, stageActorIds } from "./flowNodes";
import type { PurchaseOrder } from "../types";

/**
 * Horizontal lifecycle stepper for a PO, captioned with the department and
 * people responsible for each stage.
 *
 * It renders the FULL Purchase flow (Request → Sourcing → Approval → Generate PO
 * → Share PO … Tally): for any existing PO the four request-side nodes are
 * already done, so the rail sits somewhere in the PO half. RequestStepper shows
 * the same rail from the request side. Rendering lives in the shared
 * PoStageRail, which Import uses too.
 */
export default function PoStepper({ po }: { po: PurchaseOrder }) {
  const s = useProcurementStore();
  // Tally is genuinely done only once every goods receipt has its invoice; an
  // unbooked GRN means the step is still open even on a PO that closed early.
  const tallyPending = s.unbookedGrnsForPo(po.id).length > 0;
  // Same rule one step later: a booked receipt still owing QC keeps that node open.
  const qcPending = s.uninspectedGrnsForPo(po.id).length > 0;
  // The return branch is only part of this PO's journey if QC actually rejected
  // something — otherwise those two nodes never existed for it.
  const showReturnBranch = s.qcInspections.some((q) => q.poId === po.id && q.result === "rejected");

  // Done nodes name who actually did them: this PO's own actors, plus the
  // request-side actors of the requisition(s) its lines came from.
  const doneByIds = useMemo(() => {
    const requestIds = [
      ...new Set(
        s.poItemsForPo(po.id)
          .map((pi) => s.lineById(pi.requestItemId)?.requestId)
          .filter((id): id is string => !!id),
      ),
    ];
    return stageActorIds(s, requestIds, [po.id]);
  }, [s, po.id]);

  const nodes: PoStageRailNode[] = useMemo(
    () => buildFlowNodes(s, showReturnBranch, undefined, doneByIds),
    [s, showReturnBranch, doneByIds],
  );

  return (
    <PoStageRail
      nodes={nodes}
      activeIndex={poFlowIndex(po.currentStage, tallyPending, showReturnBranch, qcPending)}
      // A 'closed' PO has finished its final stage — the last node is DONE
      // (green check), not in progress. But a PO that closed with Tally or QC
      // still pending isn't truly finished: poFlowIndex sits it on that node (in
      // progress), so it must NOT be flagged finished. (Cancelled stays
      // highlighted, not ticked.)
      finished={po.currentStage === "closed" && !tallyPending && !qcPending}
    />
  );
}
