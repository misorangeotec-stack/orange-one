/**
 * The single source of truth for Production Entry FMS queue membership and due
 * dates.
 *
 * Pure: takes a snapshot, returns plain data, knows nothing about the signed-in
 * user. Both the per-step queue pages and the cross-FMS Control Center consume
 * these, so their counts cannot drift.
 *
 * Membership is STATUS-DRIVEN (the RPCs set `status`), and the chain is strictly
 * linear, so a job card sits at exactly one open step at a time.
 */
import type { QueueEntryBase } from "@/shared/lib/fmsQueue";
import { dueIsoFrom, type StepSlaMap } from "./sla";
import type { StepKey } from "./steps";
import type { ProductionRequest, ProductionStatus } from "../types";

/** Every step that owns a queue (all but the origin `issue_slip`). */
export type QueueStep = Exclude<StepKey, "issue_slip">;

export interface ProductionSnapshot {
  requests: ProductionRequest[];
  stepSla: StepSlaMap;
}

/** THE ONE snapshot builder — the adapter and the store both go through it. */
export function productionSnapshotFrom(data: { requests: ProductionRequest[]; stepSla: StepSlaMap }): ProductionSnapshot {
  return { requests: data.requests, stepSla: data.stepSla };
}

export interface QueueEntry extends QueueEntryBase<StepKey> {
  entityType: "request";
  requestId: string;
}

/* -------------------------------------------------------------------------- */
/*  Per-step accessors — the one place a step maps to its columns.            */
/* -------------------------------------------------------------------------- */

/** The step's own completion timestamp (`*_at`). */
const AT: Record<QueueStep, (r: ProductionRequest) => string | null> = {
  material_handover: (r) => r.mhAt,
  rm_transfer: (r) => r.rmtAt,
  quality_check: (r) => r.qcAt,
  additional_issue_slip: (r) => r.aisAt,
  transfer_slip: (r) => r.tsAt,
  production_entry: (r) => r.peAt,
  mc_testing: (r) => r.mcAt,
  pm_transfer: (r) => r.pmtAt,
  packing_entry: (r) => r.pkAt,
  ready_to_dispatch: (r) => r.rtdAt,
  fg_transfer: (r) => r.fgAt,
};

/** Who completed the step (`*_by`). */
const BY: Record<QueueStep, (r: ProductionRequest) => string | null> = {
  material_handover: (r) => r.mhBy,
  rm_transfer: (r) => r.rmtBy,
  quality_check: (r) => r.qcBy,
  additional_issue_slip: (r) => r.aisBy,
  transfer_slip: (r) => r.tsBy,
  production_entry: (r) => r.peBy,
  mc_testing: (r) => r.mcBy,
  pm_transfer: (r) => r.pmtBy,
  packing_entry: (r) => r.pkBy,
  ready_to_dispatch: (r) => r.rtdBy,
  fg_transfer: (r) => r.fgBy,
};

/** The anchor whose completion starts a step's SLA clock — the previous step. */
const ANCHOR_AT: Record<QueueStep, (r: ProductionRequest) => string | null> = {
  material_handover: (r) => r.submittedAt,
  rm_transfer: (r) => r.mhAt,
  quality_check: (r) => r.rmtAt,
  additional_issue_slip: (r) => r.qcActualDate,
  transfer_slip: (r) => r.qcAt,
  production_entry: (r) => r.tsAt,
  mc_testing: (r) => r.peAt,
  pm_transfer: (r) => r.mcAt,
  packing_entry: (r) => r.pmtAt,
  ready_to_dispatch: (r) => r.pkAt,
  fg_transfer: (r) => r.rtdAt,
};

/** status → the single step a card currently owes. */
const STATUS_STEP: Partial<Record<ProductionStatus, QueueStep>> = {
  awaiting_material_handover: "material_handover",
  awaiting_rm_transfer: "rm_transfer",
  awaiting_quality: "quality_check",
  awaiting_additional_issue_slip: "additional_issue_slip",
  awaiting_transfer_slip: "transfer_slip",
  awaiting_production: "production_entry",
  awaiting_mc_testing: "mc_testing",
  awaiting_pm_transfer: "pm_transfer",
  awaiting_packing: "packing_entry",
  awaiting_ready_to_dispatch: "ready_to_dispatch",
  awaiting_fg_transfer: "fg_transfer",
};

/** Edit-lock rules per step — mirror the `fms_production_<step>_editable()` predicates. */
const LOCK: Record<QueueStep, { open: ProductionStatus; what: string; nextWhat: string }> = {
  material_handover: { open: "awaiting_rm_transfer", what: "material handover", nextWhat: "the RM transfer to production" },
  rm_transfer: { open: "awaiting_quality", what: "RM transfer to production", nextWhat: "quality checking" },
  quality_check: { open: "awaiting_transfer_slip", what: "quality checking", nextWhat: "the log book entry" },
  additional_issue_slip: { open: "awaiting_material_handover", what: "additional issue slip", nextWhat: "the material handover" },
  transfer_slip: { open: "awaiting_production", what: "log book entry", nextWhat: "production entry" },
  production_entry: { open: "awaiting_mc_testing", what: "production entry", nextWhat: "M/C testing" },
  mc_testing: { open: "awaiting_pm_transfer", what: "M/C testing", nextWhat: "the packing-material transfer" },
  pm_transfer: { open: "awaiting_packing", what: "packing-material transfer", nextWhat: "the packing entry" },
  packing_entry: { open: "awaiting_ready_to_dispatch", what: "packing entry", nextWhat: "ready to dispatch" },
  ready_to_dispatch: { open: "awaiting_fg_transfer", what: "ready to dispatch", nextWhat: "the finished-good transfer" },
  fg_transfer: { open: "closed", what: "finished-good transfer", nextWhat: "" },
};

/** The step's own completion timestamp / actor — for the detail progress panel. */
export const stepDoneAt = (step: QueueStep, r: ProductionRequest): string | null => AT[step](r);
export const stepDoneBy = (step: QueueStep, r: ProductionRequest): string | null => BY[step](r);

/** Still someone's work — a held / closed / cancelled card leaves every queue. */
export const isOpenRequest = (r: ProductionRequest): boolean => STATUS_STEP[r.status] !== undefined;

/** The single step a card currently owes, from its status. */
export function openStep(r: ProductionRequest): QueueStep | null {
  return STATUS_STEP[r.status] ?? null;
}

/** A card's due date for one step = its anchor's completion + N working days. */
export function productionDueIso(snap: ProductionSnapshot, r: ProductionRequest, step: QueueStep): string | null {
  // The Log Book Entry has NO due date — it is entered without dates and never
  // runs overdue. (Downstream steps still anchor on its completion timestamp.)
  if (step === "transfer_slip") return null;
  // A QC rejection sets an explicit +2-day re-test due that overrides the SLA —
  // it carries onto both the additional issue slip and the returning quality check.
  if ((step === "quality_check" || step === "additional_issue_slip") && r.qcRetestDue) return r.qcRetestDue;
  const sla = snap.stepSla[step];
  if (!sla) return null;
  const from = ANCHOR_AT[step](r) ?? r.submittedAt;
  return dueIsoFrom(from, sla);
}

/**
 * When the card ENTERED this step — i.e. the previous step's completion.
 *
 * The twin of `stepDoneAt`, exposed for the cycle-time report. There is no
 * `entered_at` column anywhere in this FMS; a step's start is only ever derivable as
 * its anchor's completion, and `ANCHOR_AT` above is already that map. Anything
 * measuring how long a card sat at a step reads THIS, so a second hand-rolled copy of
 * the chain cannot drift away from the one the due dates use.
 *
 * ⚠ `additional_issue_slip` returns `qcActualDate` — a DATE, not a timestamp. That is
 * right for a due date and wrong for a duration (it drops the time of day and can land
 * after `aisAt`). See cycleTime.ts, which substitutes `qcAt` for that one leg.
 */
export const stepStartedAt = (step: QueueStep, r: ProductionRequest): string | null => ANCHOR_AT[step](r);

/* -------------------------------------------------------------------------- */
/*  Completed entries — the "what I did here" side of a stage                  */
/* -------------------------------------------------------------------------- */

export interface StageEntry<T> {
  id: string;
  stepKey: StepKey;
  requestId: string;
  ref: string;
  actorId: string | null;
  atIso: string;
  editedAtIso: string | null;
  editedById: string | null;
  lockReason: string | null;
  row: T;
}

/**
 * Every rule below mirrors its `fms_production_<step>_editable()` counterpart in
 * the DB. The server is the gate; these exist so the UI can grey a button and SAY
 * WHY. `on_hold` locks everything.
 */
export function lockReasonFor(step: QueueStep, r: ProductionRequest): string | null {
  const { open, what, nextWhat } = LOCK[step];
  if (r.status === "on_hold") return `This job card is on hold — take it off hold before editing its ${what}.`;
  if (r.status === "cancelled") return `This job card was cancelled — its ${what} can no longer be changed.`;
  // The finished-good transfer is the last step; nothing downstream can lock it.
  if (step === "fg_transfer") return null;
  if (r.status !== open) return `${nextWhat[0].toUpperCase()}${nextWhat.slice(1)} has already been recorded — the ${what} can no longer be changed.`;
  return null;
}

/** Every completed entry for one step — what the stage view renders. */
export function completedFor(snap: ProductionSnapshot, step: QueueStep): StageEntry<ProductionRequest>[] {
  const at = AT[step];
  const by = BY[step];
  return snap.requests
    .filter((r) => !!at(r))
    .map((r) => ({
      id: r.id,
      stepKey: step,
      requestId: r.id,
      ref: r.reqNo,
      actorId: by(r),
      atIso: at(r)!,
      editedAtIso: r.editedAt,
      editedById: r.editedBy,
      lockReason: lockReasonFor(step, r),
      row: r,
    }));
}

/**
 * The statuses a QC-REJECTED lot passes through while its Additional Issue Slip
 * top-up loops back — additional slip → material handover → RM transfer — before it
 * returns to `awaiting_quality` for the re-test. Throughout this window the lot is
 * NOT actionable in Quality Check (its additional raw material hasn't been
 * transferred to production yet).
 */
export const AIS_LOOP_STATUSES: ProductionStatus[] = [
  "awaiting_additional_issue_slip",
  "awaiting_material_handover",
  "awaiting_rm_transfer",
];

/** True while a rejected lot is mid-top-up loop (see AIS_LOOP_STATUSES) — visible
 *  in Quality Check for tracking, but approve/reject must stay blocked until the
 *  additional RM is transferred to production and it returns to `awaiting_quality`. */
export const isAisLoopBlocked = (r: ProductionRequest): boolean =>
  r.qcStatus === "rejected" && AIS_LOOP_STATUSES.includes(r.status);

/**
 * Cards shown as READ-ONLY tracking rows in a step's Pending list for visibility,
 * even though the card's actionable step is elsewhere. Quality Check keeps a
 * rejected lot in view for the whole top-up loop so the QC team doesn't lose it
 * while it's re-issued, handed over and re-transferred.
 */
export function trackingRequestsFor(snap: ProductionSnapshot, step: QueueStep): ProductionRequest[] {
  if (step !== "quality_check") return [];
  return snap.requests.filter(isAisLoopBlocked);
}

/** Every open work-item, one per (current step, request). */
export function buildQueueEntries(snap: ProductionSnapshot): QueueEntry[] {
  const out: QueueEntry[] = [];
  for (const r of snap.requests) {
    const step = openStep(r);
    if (!step) continue;
    out.push({
      stepKey: step,
      entityType: "request",
      entityId: r.id,
      ref: r.reqNo,
      dueIso: productionDueIso(snap, r, step),
      requestId: r.id,
    });
  }
  return out;
}
