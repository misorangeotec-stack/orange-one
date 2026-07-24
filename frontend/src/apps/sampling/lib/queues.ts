/**
 * The single source of truth for Sampling FMS queue membership and due dates.
 *
 * Pure: takes a snapshot, returns plain data, knows nothing about the signed-in
 * user. Both the per-step queue pages and the cross-FMS Control Center consume
 * these, so their counts cannot drift.
 *
 * Membership is STATUS-DRIVEN (the RPCs set `status`), so the two-path route is
 * native: an outward request is submitted straight into `awaiting_send` and never
 * appears in the receive queue — no special-casing here.
 */
import type { QueueEntryBase } from "@/shared/lib/fmsQueue";
import { dueIsoFrom, type StepSlaMap } from "./sla";
import type { StepBranch, StepKey } from "./steps";
import type { SamplingRequest } from "../types";

export interface SamplingSnapshot {
  requests: SamplingRequest[];
  stepSla: StepSlaMap;
}

/** THE ONE snapshot builder — the adapter and the store both go through it. */
export function samplingSnapshotFrom(data: { requests: SamplingRequest[]; stepSla: StepSlaMap }): SamplingSnapshot {
  return { requests: data.requests, stepSla: data.stepSla };
}

export interface QueueEntry extends QueueEntryBase<StepKey> {
  entityType: "request";
  requestId: string;
}

/** Still someone's work — a held / closed / cancelled request leaves every queue. */
export const isOpenRequest = (r: SamplingRequest): boolean => openStep(r) !== null;

/**
 * Which branch a request runs on — the request-side twin of `StepDef.branches`.
 *
 * `=== false`, never `!r.labTestingRequired`: on an INWARD request NULL means a
 * legacy row raised before the gate existed, which ran the lab path.
 */
export const requestBranch = (r: SamplingRequest): StepBranch =>
  r.direction === "outward" ? "outward" : r.labTestingRequired === false ? "no_lab" : "lab";

/** The single step a request currently owes, from its status. */
export function openStep(r: SamplingRequest): StepKey | null {
  switch (r.status) {
    case "awaiting_receipt":
      return "receive_sample";
    case "awaiting_send":
      return "send_sample";
    case "awaiting_confirm":
      return "confirm_receipt";
    case "awaiting_testing":
      return "testing";
    case "awaiting_result":
      return "result";
    case "awaiting_handover":
      return "result_handover";
    case "awaiting_collect":
      return "sample_collect";
    case "awaiting_sample_received":
      return "sample_received";
    case "awaiting_sample_to_lab":
      return "sample_to_lab";
    // Both passes of lab_process share this status — see lib/steps.ts.
    case "awaiting_lab_process":
      return "lab_process";
    case "awaiting_result_received":
      return "result_received";
    default:
      return null;
  }
}

/**
 * The anchor completion timestamp that starts a step's SLA clock.
 *
 * `testing` is the convergence point of the two paths, so its anchor depends on
 * `direction` — receive_sample (inward) or confirm_receipt (outward). The fallback
 * to `submittedAt` in samplingDueIso keeps a step that never applied from being
 * born overdue.
 */
function stepAnchorCompletedIso(r: SamplingRequest, step: StepKey): string | null {
  switch (step) {
    case "receive_sample":
    case "send_sample":
    case "sample_collect":
      return r.submittedAt;
    case "confirm_receipt":
      return r.sentAt;
    case "sample_received":
    case "sample_to_lab":
      return r.collectedAt;
    case "lab_process":
      return r.labSentAt;
    case "result_received":
      return r.labCompletedAt;
    case "testing":
      return r.direction === "inward" ? r.receivedAt : r.confirmedAt;
    case "result":
      return r.testedAt;
    case "result_handover":
      return r.resultedAt;
    default:
      return null;
  }
}

/**
 * A request's due date for one step = its anchor's completion + N working days.
 *
 * ONE exception: once the lab has given a tentative result date, THAT is when
 * `lab_process` is due. Capturing it is the whole point of the step's first pass —
 * leaving a generic SLA in the Due column would show every sample at the lab as
 * overdue the next day, and would hide the date the lab actually committed to.
 */
export function samplingDueIso(snap: SamplingSnapshot, r: SamplingRequest, step: StepKey): string | null {
  if (step === "lab_process" && r.labTentativeDate) return r.labTentativeDate.slice(0, 10);
  const sla = snap.stepSla[step];
  if (!sla) return null;
  const from = stepAnchorCompletedIso(r, step) ?? r.submittedAt;
  return dueIsoFrom(from, sla);
}

/* -------------------------------------------------------------------------- */
/*  Completed entries — the "what I did here" side of a stage                  */
/* -------------------------------------------------------------------------- */

export interface StageEntry<T> {
  /** The underlying row's id. Every step here is request-scope, so this is the request. */
  id: string;
  stepKey: StepKey;
  requestId: string;
  /** Human reference, for display and search. */
  ref: string;
  /** Who completed the step. Null = unknown. */
  actorId: string | null;
  /** When the step completed. */
  atIso: string;
  /** When it was last corrected, if ever. */
  editedAtIso: string | null;
  editedById: string | null;
  /** Null when the entry may still be corrected; otherwise why it cannot be. */
  lockReason: string | null;
  /** The row itself, so the page can render its own columns without a second lookup. */
  row: T;
}

/**
 * Every rule below mirrors its `fms_sampling_<step>_editable()` counterpart in the
 * DB (migration 20260724120200). The server is the gate; these exist so the UI can
 * grey a button and SAY WHY.
 *
 * `on_hold` locks everything, and that is MECHANICAL: `fms_sampling_resume_status`
 * decides where a held request resumes by reading the very timestamps an edit
 * touches. Resume first, then edit.
 */
const heldOrTerminal = (r: SamplingRequest, what: string): string | null => {
  if (r.status === "on_hold") return `This request is on hold — take it off hold before editing its ${what}.`;
  if (r.status === "cancelled") return `This request was cancelled — its ${what} can no longer be changed.`;
  return null;
};

/** Editable while inward + received + still awaiting testing. */
export function receiptLockReason(r: SamplingRequest): string | null {
  const t = heldOrTerminal(r, "sample receipt");
  if (t) return t;
  if (r.status !== "awaiting_testing") return "Testing has already been recorded — the sample receipt can no longer be changed.";
  return null;
}

/** Editable while outward + sent + still awaiting confirmation. */
export function sendLockReason(r: SamplingRequest): string | null {
  const t = heldOrTerminal(r, "sample dispatch");
  if (t) return t;
  if (r.status !== "awaiting_confirm") return "Receipt has already been confirmed — the sample dispatch can no longer be changed.";
  return null;
}

/** Editable while outward + confirmed + still awaiting testing. */
export function confirmLockReason(r: SamplingRequest): string | null {
  const t = heldOrTerminal(r, "receipt confirmation");
  if (t) return t;
  if (r.status !== "awaiting_testing") return "Testing has already been recorded — the receipt confirmation can no longer be changed.";
  return null;
}

/** Editable while tested + still awaiting the result. */
export function testingLockReason(r: SamplingRequest): string | null {
  const t = heldOrTerminal(r, "testing entry");
  if (t) return t;
  if (r.status !== "awaiting_result") return "The result has already been recorded — the testing entry can no longer be changed.";
  return null;
}

/** Editable while the result is recorded but the handover isn't yet. */
export function resultLockReason(r: SamplingRequest): string | null {
  const t = heldOrTerminal(r, "result");
  if (t) return t;
  if (r.status !== "awaiting_handover") return "The result has already been handed over — it can no longer be changed.";
  return null;
}

/**
 * Result handover is the LAST step, so nothing downstream can lock it — a closed
 * request's handover deliberately STAYS editable (a product decision, safe: this
 * app has no derived stage machine). Only held / cancelled lock it.
 */
export function handoverLockReason(r: SamplingRequest): string | null {
  return heldOrTerminal(r, "result handover");
}

/**
 * Editable while collected but the recipient hasn't acted yet — on EITHER branch,
 * so the two statuses the collect step can hand off to are both allowed.
 */
export function collectLockReason(r: SamplingRequest): string | null {
  const t = heldOrTerminal(r, "sample collection");
  if (t) return t;
  if (r.status !== "awaiting_sample_received" && r.status !== "awaiting_sample_to_lab") {
    return "The sample has already been received — the collection can no longer be changed.";
  }
  return null;
}

/** Editable while the sample is with the lab and the lab hasn't finished. */
export function sampleToLabLockReason(r: SamplingRequest): string | null {
  const t = heldOrTerminal(r, "sample receipt");
  if (t) return t;
  if (r.status !== "awaiting_lab_process") return "The lab has already finished — this entry can no longer be changed.";
  return null;
}

/**
 * The lab process is editable for as long as it is open — that covers correcting a
 * tentative date during pass 1 — and stays correctable until the result is confirmed
 * received. Which of the two an edit actually touches is decided by `labCompletedAt`
 * in the modal; the server has a separate predicate for each pass.
 */
export function labProcessLockReason(r: SamplingRequest): string | null {
  const t = heldOrTerminal(r, "lab process");
  if (t) return t;
  if (r.status !== "awaiting_lab_process" && r.status !== "awaiting_result_received") {
    return "The result has already been received — the lab process can no longer be changed.";
  }
  return null;
}

/**
 * Result received is the LAST step of the lab branch, so nothing downstream can
 * lock it — a closed request's receipt deliberately STAYS editable (mirrors the
 * sample-received and result-handover rules). Only held / cancelled lock it.
 */
export function resultReceivedLockReason(r: SamplingRequest): string | null {
  return heldOrTerminal(r, "result receipt");
}

/**
 * Sample received is the LAST step of the no-lab branch, so nothing downstream
 * can lock it — a closed request's receipt deliberately STAYS editable (mirrors
 * the result-handover rule). Only held / cancelled lock it.
 */
export function sampleReceivedLockReason(r: SamplingRequest): string | null {
  return heldOrTerminal(r, "sample receipt");
}

const entryOf = (
  stepKey: StepKey,
  r: SamplingRequest,
  actorId: string | null,
  atIso: string,
  lockReason: string | null,
): StageEntry<SamplingRequest> => ({
  id: r.id,
  stepKey,
  requestId: r.id,
  ref: r.reqNo,
  actorId,
  atIso,
  editedAtIso: r.editedAt,
  editedById: r.editedBy,
  lockReason,
  row: r,
});

export const completedReceiveEntries = (data: SamplingSnapshot): StageEntry<SamplingRequest>[] =>
  data.requests
    .filter((r) => !!r.receivedAt)
    .map((r) => entryOf("receive_sample", r, r.receivedBy, r.receivedAt!, receiptLockReason(r)));

export const completedSendEntries = (data: SamplingSnapshot): StageEntry<SamplingRequest>[] =>
  data.requests
    .filter((r) => !!r.sentAt)
    .map((r) => entryOf("send_sample", r, r.sentBy, r.sentAt!, sendLockReason(r)));

export const completedConfirmEntries = (data: SamplingSnapshot): StageEntry<SamplingRequest>[] =>
  data.requests
    .filter((r) => !!r.confirmedAt)
    .map((r) => entryOf("confirm_receipt", r, r.confirmedBy, r.confirmedAt!, confirmLockReason(r)));

export const completedTestingEntries = (data: SamplingSnapshot): StageEntry<SamplingRequest>[] =>
  data.requests
    .filter((r) => !!r.testedAt)
    .map((r) => entryOf("testing", r, r.testedBy, r.testedAt!, testingLockReason(r)));

export const completedResultEntries = (data: SamplingSnapshot): StageEntry<SamplingRequest>[] =>
  data.requests
    .filter((r) => !!r.resultedAt)
    .map((r) => entryOf("result", r, r.resultedBy, r.resultedAt!, resultLockReason(r)));

export const completedHandoverEntries = (data: SamplingSnapshot): StageEntry<SamplingRequest>[] =>
  data.requests
    .filter((r) => !!r.handedOverAt)
    .map((r) => entryOf("result_handover", r, r.handedOverBy, r.handedOverAt!, handoverLockReason(r)));

export const completedCollectEntries = (data: SamplingSnapshot): StageEntry<SamplingRequest>[] =>
  data.requests
    .filter((r) => !!r.collectedAt)
    .map((r) => entryOf("sample_collect", r, r.collectedBy, r.collectedAt!, collectLockReason(r)));

export const completedSampleReceivedEntries = (data: SamplingSnapshot): StageEntry<SamplingRequest>[] =>
  data.requests
    .filter((r) => !!r.sampleReceivedAt)
    .map((r) => entryOf("sample_received", r, r.sampleReceivedBy, r.sampleReceivedAt!, sampleReceivedLockReason(r)));

export const completedSampleToLabEntries = (data: SamplingSnapshot): StageEntry<SamplingRequest>[] =>
  data.requests
    .filter((r) => !!r.labSentAt)
    .map((r) => entryOf("sample_to_lab", r, r.labSentBy, r.labSentAt!, sampleToLabLockReason(r)));

/**
 * `labCompletedAt`, NOT `labStartedAt`: a request that has only had its tentative
 * date recorded is still work owed, so it belongs in the queue's Pending tab. Keying
 * this on pass 1 would move it to Completed with the testing still to come.
 */
export const completedLabProcessEntries = (data: SamplingSnapshot): StageEntry<SamplingRequest>[] =>
  data.requests
    .filter((r) => !!r.labCompletedAt)
    .map((r) => entryOf("lab_process", r, r.labCompletedBy, r.labCompletedAt!, labProcessLockReason(r)));

export const completedResultReceivedEntries = (data: SamplingSnapshot): StageEntry<SamplingRequest>[] =>
  data.requests
    .filter((r) => !!r.resultReceivedAt)
    .map((r) => entryOf("result_received", r, r.resultReceivedBy, r.resultReceivedAt!, resultReceivedLockReason(r)));

/** Every open work-item, one per (current step, request). */
export function buildQueueEntries(snap: SamplingSnapshot): QueueEntry[] {
  const out: QueueEntry[] = [];
  for (const r of snap.requests) {
    const step = openStep(r);
    if (!step) continue;
    out.push({
      stepKey: step,
      entityType: "request",
      entityId: r.id,
      ref: r.reqNo,
      dueIso: samplingDueIso(snap, r, step),
      requestId: r.id,
    });
  }
  return out;
}
