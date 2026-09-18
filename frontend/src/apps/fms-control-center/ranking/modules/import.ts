/**
 * Purchase RM Import — scored steps (CC-1). Purchase's twin; read ./purchase.ts
 * for the unit (one closed step per document recorded) and the known limits.
 *
 * Where it differs:
 *  · No Sourcing and no Advance Payment in its step list: a line is born at
 *    Approval, and advances are legacy rows no queue ever asked for.
 *  · Approval and the PO desk are due on the earliest `lineDueIso` of the
 *    requisition's own lines. The module's `requestApprovalDueIso` and
 *    `requestPoDueIso` read only lines still OPEN at that step, so once decided they
 *    answer "today" and "none"; over the decided lines they compute exactly what
 *    they showed while the step was open.
 *  · Approvals are owned by the matrix's approvers (no value bands any more) —
 *    `importWorkItems` applies that, and the handover override.
 */
import { fetchImportData, type ImportData } from "@/apps/import/data/importFetch";
import {
  buildImportIndex,
  completedApprovalRequestEntries,
  completedFollowupEntries,
  completedGateOutwardEntries,
  completedGrnEntries,
  completedPiEntries,
  completedPoGenEntries,
  completedPurchaseReturnEntries,
  completedQcEntries,
  completedShareEntries,
  completedTallyEntries,
  grnQcDueIso,
  grnTallyDueIso,
  inspectionGateOutDueIso,
  inspectionReturnDueIso,
  lineDueIso,
  lineInApproval,
  poDueIso,
  type StageEntry,
} from "@/apps/import/lib/queues";
import { stepByKey } from "@/apps/import/lib/steps";
import type { RequestItem } from "@/apps/import/types";
import { importWorkItems } from "@/core/workspace/mywork/items/import";
import type { ClosedStep, DropReason, ModuleScorer, OpenStep } from "../types";
import { parseItems } from "../workItems";

const label = (k: string) => stepByKey(k)?.title ?? k;
const earliest = (xs: (string | null)[]): string | null =>
  xs.filter((x): x is string => !!x).sort()[0] ?? null;

export const importScorer: ModuleScorer<ImportData> = {
  key: "import",
  appId: "import",
  load: () => fetchImportData(),

  closed(data) {
    const idx = buildImportIndex(data);
    const out: ClosedStep[] = [];
    const poById = new Map(data.pos.map((p) => [p.id, p]));
    const grnById = new Map(data.grns.map((g) => [g.id, g]));
    const linesByRequest = new Map<string, RequestItem[]>();
    for (const l of data.requestItems) {
      const list = linesByRequest.get(l.requestId);
      if (list) list.push(l);
      else linesByRequest.set(l.requestId, [l]);
    }

    const add = (e: StageEntry<unknown>, entityId: string, dueIso: string | null, drop?: DropReason) =>
      out.push({
        stepId: `${e.id}:${e.stepKey}`,
        entityId,
        ref: e.ref,
        stepKey: e.stepKey,
        stepLabel: label(e.stepKey),
        roundNo: 0,
        dueIso,
        actorId: e.actorId,
        doneAtIso: e.atIso,
        drop,
      });
    const poDue = (poId: string, step: Parameters<typeof poDueIso>[3]) => {
      const po = poById.get(poId);
      return po ? poDueIso(idx, data, po, step) : null;
    };

    // ── Requisition scope ───────────────────────────────────────────────────
    for (const e of completedApprovalRequestEntries(data, idx)) {
      const decided = (linesByRequest.get(e.row.id) ?? []).filter((l) => !!l.approvedAt || l.status === "rejected");
      // A rejection stamps no decision time; the builder shows the line's creation.
      const stamped = decided.some((l) => l.approvedAt === e.atIso);
      add(e, e.row.id, earliest(decided.map((l) => lineDueIso(data, l, "approval"))), stamped ? undefined : "no_time");
    }
    for (const e of completedPoGenEntries(data)) {
      const lines = (idx.poItemsByPo.get(e.poId) ?? [])
        .map((it) => idx.requestItemById.get(it.requestItemId))
        .filter((l): l is RequestItem => !!l);
      add(e, lines[0]?.requestId ?? e.poId, earliest(lines.map((l) => lineDueIso(data, l, "po"))));
    }

    // ── PO scope ────────────────────────────────────────────────────────────
    for (const e of completedShareEntries(data, idx)) add(e, e.poId, poDue(e.poId, "share_po"));
    for (const e of completedPiEntries(data, idx)) add(e, e.poId, poDue(e.poId, "collect_pi"));

    const firstDispatch = new Map<string, StageEntry<unknown>>();
    for (const e of completedFollowupEntries(data, idx)) {
      if (e.row.dispatchStatus !== "dispatched") continue;
      const prev = firstDispatch.get(e.poId);
      if (!prev || e.atIso < prev.atIso) firstDispatch.set(e.poId, e);
    }
    for (const e of firstDispatch.values()) add(e, e.poId, poDue(e.poId, "follow_up"));

    for (const e of completedGrnEntries(data, idx)) add(e, e.poId, null); // Inward: untimed
    for (const e of completedTallyEntries(data, idx)) {
      const g = e.row.grnId ? grnById.get(e.row.grnId) : undefined;
      add(e, e.poId, g ? grnTallyDueIso(data, g) : null);
    }
    for (const e of completedQcEntries(data)) {
      const g = grnById.get(e.row.grnId);
      add(e, e.poId, g ? grnQcDueIso(idx, data, g) : null);
    }
    for (const e of completedPurchaseReturnEntries(data)) add(e, e.poId, inspectionReturnDueIso(data, e.row));
    for (const e of completedGateOutwardEntries(data)) add(e, e.poId, inspectionGateOutDueIso(data, e.row));

    return out;
  },

  openFor(data, uid) {
    return parseItems(importWorkItems(data, uid, false)).map(({ entityId, stepKey, item }): OpenStep => {
      const underDecision =
        stepKey === "approval" ? data.requestItems.filter((l) => l.requestId === entityId && lineInApproval(l)) : [];
      const held = underDecision.length > 0 && underDecision.every((l) => l.status === "on_hold");
      return {
        stepId: `${entityId}:${stepKey}`,
        entityId,
        ref: item.ref,
        stepKey,
        stepLabel: label(stepKey),
        roundNo: 0,
        dueIso: item.dueIso,
        drop: held ? "held" : undefined,
      };
    });
  },
};
