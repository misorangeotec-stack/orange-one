import { useMemo } from "react";
import PoStageRail, { type PoStageRailNode } from "@/shared/components/ui/PoStageRail";
import { useImportStore } from "../store";
import { buildFlowNodes, flowIndex, poFlowIndex } from "./flowNodes";
import type { PurchaseRequest } from "../types";

/**
 * The same full-lifecycle rail as PoStepper, shown at the top of a Request so
 * the whole journey is visible from the moment a requisition is raised — not
 * only once a PO exists.
 *
 * A requisition has many lines at potentially different statuses (and can spawn
 * several POs — one per vendor within the requisition), so the rail sits on the
 * LEAST-ADVANCED open line — the bottleneck — mirroring how the Requests list
 * rolls a request up to one status. Once every open line is on a PO, it drills
 * into those POs and sits on the least-advanced one.
 */
export default function RequestStepper({ request }: { request: PurchaseRequest }) {
  const s = useImportStore();
  // The return branch belongs on this requisition's rail only if one of its POs
  // actually had a QC rejection. Computed here, before the nodes, because the
  // node list and the active index must be measured against the SAME array.
  const showReturnBranch = useMemo(() => {
    const poIds = new Set(
      s.itemsForRequest(request.id)
        .map((l) => s.poItemForLine(l.id)?.poId)
        .filter((id): id is string => !!id),
    );
    return s.qcInspections.some((q) => poIds.has(q.poId) && q.result === "rejected");
  }, [s, request]);

  const nodes: PoStageRailNode[] = useMemo(() => buildFlowNodes(s, showReturnBranch), [s, showReturnBranch]);

  const { activeIndex, finished } = useMemo(() => {
    const lines = s.itemsForRequest(request.id);
    const open = lines.filter((l) => l.status !== "rejected" && l.status !== "cancelled");

    // Cancelled requisition, or nothing live to advance — leave the rail at the
    // start, not ticked.
    if (request.status === "cancelled" || open.length === 0) {
      return { activeIndex: flowIndex("request"), finished: false };
    }
    // Bottleneck order: anything still pre-PO pins the whole rail there. Import
    // has no Sourcing node, so a legacy line still carrying `sourcing` (rows
    // predating the no-sourcing rework) folds into Approval rather than falling
    // through to the PO drill below.
    if (open.some((l) => l.status === "sourcing" || l.status === "approval" || l.status === "on_hold")) {
      return { activeIndex: flowIndex("approval"), finished: false };
    }
    if (open.some((l) => l.status === "approved_pending_po")) return { activeIndex: flowIndex("generated"), finished: false };

    // Every open line is on a PO — sit on the least-advanced PO; finished only
    // when they're all closed AND Tally-booked.
    const pos = open
      .map((l) => s.poItemForLine(l.id))
      .map((pi) => (pi ? s.poById(pi.poId) : undefined))
      .filter((po): po is NonNullable<typeof po> => !!po);
    if (pos.length === 0) return { activeIndex: flowIndex("generated"), finished: false };

    const idx = Math.min(
      ...pos.map((po) =>
        poFlowIndex(
          po.currentStage,
          s.unbookedGrnsForPo(po.id).length > 0,
          showReturnBranch,
          s.uninspectedGrnsForPo(po.id).length > 0,
        ),
      ),
    );
    const allDone = pos.every(
      (po) =>
        po.currentStage === "closed" &&
        s.unbookedGrnsForPo(po.id).length === 0 &&
        s.uninspectedGrnsForPo(po.id).length === 0,
    );
    return { activeIndex: idx, finished: allDone };
  }, [s, request, showReturnBranch]);

  return <PoStageRail nodes={nodes} activeIndex={activeIndex} finished={finished} />;
}
