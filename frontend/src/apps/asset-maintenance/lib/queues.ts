/**
 * The single source of truth for Asset Maintenance FMS queue membership and due
 * dates.
 *
 * Pure: takes a snapshot, returns plain data, knows nothing about the signed-in
 * user. The per-step queue pages, this app's Control Center, the cross-FMS
 * scoreboard and the My Work provider all consume these, so their counts cannot
 * drift. "Mine vs All" is applied by the PAGE, never here — the Control Center
 * must count everyone's work.
 *
 * Membership is STATUS-DRIVEN (the RPCs set `status`), and the chain is strictly
 * linear, so a job sits at exactly one open step at a time.
 *
 * ⚠ THE QUEUE IS OF JOBS, NOT ASSETS. An asset with four tracks can legitimately
 *   appear four times — four separate obligations, four separate deadlines. The
 *   `ref` is therefore the job number plus what is due, not the asset name alone,
 *   or a coordinator cannot tell two rows for the same car apart.
 */
import type { QueueEntryBase } from "@/shared/lib/fmsQueue";
import { dueIsoFrom, type StepSlaMap } from "./sla";
import type { StepKey } from "./steps";
import type { Asset, JobStatus, ServiceJob } from "../types";

/** Every step that owns a queue (all but the origin `service_due`). */
export type QueueStep = Exclude<StepKey, "service_due">;

export interface AssetSnapshot {
  jobs: ServiceJob[];
  stepSla: StepSlaMap;
  /** Only for labelling — membership and dates never depend on it. */
  assetById: Map<string, Asset>;
  typeNameById: Map<string, string>;
}

/** THE ONE snapshot builder — the store, the adapter and My Work all go through it. */
export function assetSnapshotFrom(data: {
  jobs: ServiceJob[];
  stepSla: StepSlaMap;
  assets: Asset[];
  scheduleTypes: { id: string; name: string }[];
}): AssetSnapshot {
  return {
    jobs: data.jobs,
    stepSla: data.stepSla,
    assetById: new Map(data.assets.map((a) => [a.id, a])),
    typeNameById: new Map(data.scheduleTypes.map((t) => [t.id, t.name])),
  };
}

export interface QueueEntry extends QueueEntryBase<StepKey> {
  entityType: "job";
  jobId: string;
  assetId: string;
}

/* -------------------------------------------------------------------------- */
/*  Per-step accessors — the one place a step maps to its columns.            */
/* -------------------------------------------------------------------------- */

/** The step's own completion timestamp (`*At`). */
const AT: Record<QueueStep, (j: ServiceJob) => string | null> = {
  schedule: (j) => j.scAt,
  service_done: (j) => j.sdAt,
  verify_close: (j) => j.vcAt,
};

/** Who completed the step (`*By`). */
const BY: Record<QueueStep, (j: ServiceJob) => string | null> = {
  schedule: (j) => j.scBy,
  service_done: (j) => j.sdBy,
  verify_close: (j) => j.vcBy,
};

/**
 * The moment a step's SLA clock starts.
 *
 * ⚠ `service_done` anchors on the JOB'S DUE DATE — the day the service actually
 *   falls due — not on the scheduling step before it. See lib/sla.ts for why.
 *   Paired with `days: 0`, that makes the service due exactly when it is due.
 */
const ANCHOR_AT: Record<QueueStep, (j: ServiceJob) => string | null> = {
  schedule: (j) => j.createdAt,
  service_done: (j) => j.dueDate,
  verify_close: (j) => j.sdAt,
};

/** status → the single step a job currently owes. */
const STATUS_STEP: Partial<Record<JobStatus, QueueStep>> = {
  awaiting_schedule: "schedule",
  awaiting_service: "service_done",
  awaiting_verification: "verify_close",
};

/** Edit-lock rules per step — mirror the `fms_asset_<pfx>_editable()` predicates. */
const LOCK: Record<QueueStep, { open: JobStatus; what: string; nextWhat: string }> = {
  schedule:     { open: "awaiting_service",      what: "scheduling details", nextWhat: "the service record" },
  service_done: { open: "awaiting_verification", what: "service record",     nextWhat: "the verification" },
  verify_close: { open: "closed",                what: "verification",       nextWhat: "" },
};

/** The step's own completion timestamp / actor — for the detail progress panel. */
export const stepDoneAt = (step: QueueStep, j: ServiceJob): string | null => AT[step](j);
export const stepDoneBy = (step: QueueStep, j: ServiceJob): string | null => BY[step](j);

/** Still someone's work — held / closed / cancelled / skipped leaves every queue. */
export const isOpenJob = (j: ServiceJob): boolean => STATUS_STEP[j.status] !== undefined;

/** The single step a job currently owes, from its status. */
export function openStep(j: ServiceJob): QueueStep | null {
  return STATUS_STEP[j.status] ?? null;
}

/** A job's due date for one step = its anchor + the step's rule. */
export function jobDueIso(snap: AssetSnapshot, j: ServiceJob, step: QueueStep): string | null {
  const sla = snap.stepSla[step];
  if (!sla) return null;
  const from = ANCHOR_AT[step](j) ?? j.createdAt;
  return dueIsoFrom(from, sla);
}

/**
 * How a job reads in a list: the job number, then what is due on which asset.
 *
 * Built here rather than in each page because four different screens render it,
 * and an asset with several tracks is otherwise indistinguishable from itself.
 */
export function jobRef(snap: AssetSnapshot, j: ServiceJob): string {
  const asset = snap.assetById.get(j.assetId);
  const type = j.scheduleTypeId ? snap.typeNameById.get(j.scheduleTypeId) : null;
  const who = asset ? `${asset.assetNo} ${asset.name}` : "asset";
  return type ? `${j.jobNo} · ${type} · ${who}` : `${j.jobNo} · ${who}`;
}

/**
 * Is the underlying obligation already breached? True once the job's own due
 * date has passed with the service still unrecorded.
 *
 * DISTINCT from a step being late. A step SLA asks "is this person slow?"; this
 * asks "has the insurance lapsed / has the service been missed?" — which is the
 * question the whole module exists to answer, and the one that goes on the
 * dashboard in red.
 */
export function isOverdue(j: ServiceJob, todayIso: string): boolean {
  if (!j.dueDate) return false;
  if (j.status === "closed" || j.status === "cancelled" || j.status === "skipped") return false;
  if (j.sdAt) return false;
  return j.dueDate < todayIso;
}

/* -------------------------------------------------------------------------- */
/*  Completed entries — the "what I did here" side of a stage                  */
/* -------------------------------------------------------------------------- */

export interface StageEntry<T> {
  id: string;
  stepKey: StepKey;
  jobId: string;
  ref: string;
  actorId: string | null;
  atIso: string;
  lockReason: string | null;
  row: T;
}

/**
 * Every rule below mirrors its `fms_asset_<pfx>_editable()` counterpart in the
 * DB. The server is the gate; these exist so the UI can grey a button and SAY WHY.
 * `on_hold`, `cancelled` and `skipped` lock everything.
 */
export function lockReasonFor(step: QueueStep, j: ServiceJob): string | null {
  const { open, what, nextWhat } = LOCK[step];
  if (j.status === "on_hold") return `This job is on hold — take it off hold before editing its ${what}.`;
  if (j.status === "cancelled") return `This job was cancelled — its ${what} can no longer be changed.`;
  if (j.status === "skipped") return `This service was skipped — its ${what} can no longer be changed.`;
  // Verification is the last step; nothing downstream can contradict it, so it
  // stays correctable after the job closes.
  if (step === "verify_close") return j.status === "closed" ? null : "This job is not closed yet.";
  if (j.status !== open) {
    return `${nextWhat.charAt(0).toUpperCase()}${nextWhat.slice(1)} has already been recorded — the ${what} can no longer be changed.`;
  }
  return null;
}

/** Every completed entry for one step — what the stage view's Completed tab renders. */
export function completedFor(snap: AssetSnapshot, step: QueueStep): StageEntry<ServiceJob>[] {
  const at = AT[step];
  const by = BY[step];
  return snap.jobs
    .filter((j) => !!at(j))
    .map((j) => ({
      id: j.id,
      stepKey: step,
      jobId: j.id,
      ref: jobRef(snap, j),
      actorId: by(j),
      atIso: at(j) as string,
      lockReason: lockReasonFor(step, j),
      row: j,
    }));
}

/** Every open work-item, one per (current step, job). */
export function buildQueueEntries(snap: AssetSnapshot): QueueEntry[] {
  const out: QueueEntry[] = [];
  for (const j of snap.jobs) {
    const step = openStep(j);
    if (!step) continue;
    out.push({
      stepKey: step,
      entityType: "job",
      entityId: j.id,
      ref: jobRef(snap, j),
      dueIso: jobDueIso(snap, j, step),
      jobId: j.id,
      assetId: j.assetId,
    });
  }
  return out;
}
