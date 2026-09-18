/**
 * Purchase RM Domestic — scored steps (CC-1).
 *
 * Closed: the module's own Completed-tab builders, so a step here is a row a
 * person can find on that screen. The unit is therefore the DOCUMENT recorded —
 * each PI, each advance, each Tally booking, each inspection — while an overdue
 * open step is one per PO, as My Work Today lists it. The two agree whenever a PO
 * has one of each, which is nearly always.
 *
 * Due dates, all the module's own:
 *  · sourcing / approval — `requestDueIso` for the requisition.
 *  · PO generation      — the earliest `lineDueIso(…, "po")` of the PO's own lines,
 *                         which is what `requestDueIso` computes over the desk.
 *  · share, PI, advance — `poDueIso`, whose anchor rule works for a closed PO.
 *  · follow-up          — `poDueIso` (the vendor's promised dispatch date). The step
 *                         closes at the FIRST follow-up that records a dispatch;
 *                         the rest are notes, not steps.
 *  · Tally, QC, return, gate out — one item at a time (`grnTallyDueIso` …), the same
 *                         helpers `poDueIso` now reads for a PO's oldest item.
 *  · Inward             — untimed by design; counts for nobody.
 *
 * Open: `purchaseWorkItems`, My Work Today's rule — the value-band approval matrix
 * with its handover override, and step owners for everything else. A requisition
 * whose every line under decision is on hold is `held`: nobody's work today.
 *
 * Known limits, from the module's own records:
 *  · A rejection stamps no decision time; the Completed tab shows the line's
 *    creation time instead. Such a decision is `no_time`.
 *  · Re-saving sourcing re-stamps who sourced it and when, with no edit marker, so a
 *    re-saved requisition reads as sourced at the re-save.
 */
import { fetchProcurementData, type ProcurementData } from "@/apps/procurement/data/procFetch";
import {
  buildProcIndex,
  completedAdvanceEntries,
  completedApprovalRequestEntries,
  completedFollowupEntries,
  completedGateOutwardEntries,
  completedGrnEntries,
  completedPiEntries,
  completedPoGenEntries,
  completedPurchaseReturnEntries,
  completedQcEntries,
  completedShareEntries,
  completedSourcingRequestEntries,
  completedTallyEntries,
  grnQcDueIso,
  grnTallyDueIso,
  inspectionGateOutDueIso,
  inspectionReturnDueIso,
  lineDueIso,
  lineInApproval,
  linesOf,
  poDueIso,
  requestDueIso,
  type StageEntry,
} from "@/apps/procurement/lib/queues";
import { stepByKey } from "@/apps/procurement/lib/steps";
import type { RequestItem } from "@/apps/procurement/types";
import { purchaseWorkItems } from "@/core/workspace/mywork/items/purchase";
import type { ClosedStep, DropReason, ModuleScorer, OpenStep } from "../types";
import { perDataset } from "../memo";
import { parseItems } from "../workItems";

const indexOf = perDataset(buildProcIndex);

const label = (k: string) => stepByKey(k)?.title ?? k;
const earliest = (xs: (string | null)[]): string | null =>
  xs.filter((x): x is string => !!x).sort()[0] ?? null;

export const purchaseScorer: ModuleScorer<ProcurementData> = {
  key: "purchase",
  appId: "procurement",
  load: () => fetchProcurementData(),

  closed(data) {
    const idx = indexOf(data);
    const out: ClosedStep[] = [];
    const poById = new Map(data.pos.map((p) => [p.id, p]));
    const requestById = new Map(data.requests.map((r) => [r.id, r]));
    const grnById = new Map(data.grns.map((g) => [g.id, g]));

    const add = (
      e: StageEntry<unknown>,
      entityId: string,
      dueIso: string | null,
      drop?: DropReason,
    ) =>
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
    for (const e of completedSourcingRequestEntries(data, idx)) {
      add(e, e.row.id, requestDueIso(data, idx, e.row, "sourcing"));
    }
    for (const e of completedApprovalRequestEntries(data, idx)) {
      // The builder falls back to the line's creation time for a rejection, which
      // stamps no decision time of its own. That is not when anybody decided it.
      const stamped = linesOf(idx, e.row.id).some((l) => l.approvedAt === e.atIso);
      add(e, e.row.id, requestDueIso(data, idx, e.row, "approval"), stamped ? undefined : "no_time");
    }
    for (const e of completedPoGenEntries(data)) {
      const lines = (idx.poItemsByPo.get(e.poId) ?? [])
        .map((it) => idx.requestItemById.get(it.requestItemId))
        .filter((l): l is RequestItem => !!l);
      const req = lines[0] ? requestById.get(lines[0].requestId) : undefined;
      add(e, req?.id ?? e.poId, earliest(lines.map((l) => lineDueIso(data, l, "po"))));
    }

    // ── PO scope ────────────────────────────────────────────────────────────
    for (const e of completedShareEntries(data, idx)) add(e, e.poId, poDue(e.poId, "share_po"));
    for (const e of completedPiEntries(data, idx)) add(e, e.poId, poDue(e.poId, "collect_pi"));
    for (const e of completedAdvanceEntries(data, idx)) add(e, e.poId, poDue(e.poId, "advance_payment"));

    // Only the follow-up that recorded the dispatch closes the step.
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
    const idx = indexOf(data);
    return parseItems(purchaseWorkItems(data, uid, false)).map(({ entityId, stepKey, item }): OpenStep => {
      const underDecision = stepKey === "approval" ? linesOf(idx, entityId).filter(lineInApproval) : [];
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
