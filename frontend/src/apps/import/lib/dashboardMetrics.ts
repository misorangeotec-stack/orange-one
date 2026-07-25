/**
 * Pure derivations for the Import home dashboard — no React, no store hook.
 *
 * Shared with the coordinator Control Center so the two boards CANNOT drift:
 * `queueRollup` is the exact one-pass reduction that used to live inside
 * `pages/monitoring/ControlCenter.tsx`. Everything here takes plain arrays +
 * selectors and returns plain data, so it is trivially memoisable and testable.
 */
import type { Bucket } from "@/shared/lib/dueBuckets";
import { EMPTY_COUNTS, bucketOf, addDaysIso } from "@/shared/lib/dueBuckets";
import type { StepPipelineNode } from "@/shared/components/ui/StepPipeline";
import { STEPS, type StepKey } from "./steps";
import type { QueueEntry, StageEntry } from "./queues";
import type { PurchaseOrder, RequestItem } from "../types";
import { PO_STAGE_LABEL, PO_STAGE_CLASS, LINE_STATUS_LABEL, LINE_STATUS_CLASS } from "./format";

/** The steps that can hold queue work. `request` is `noQueue` — it never enters one. */
export const PIPELINE_STEPS = STEPS.filter((s) => !s.noQueue);

/* -------------------------------------------------------------------------- */
/*  Open-backlog rollup — the single source shared with the Control Center.    */
/* -------------------------------------------------------------------------- */

export interface QueueRollup {
  counts: Record<Bucket, number>;
  nodes: StepPipelineNode<StepKey>[];
}

/**
 * One pass over the open work-items: the four-way bucket totals AND the
 * per-step delayed/today/total the bottleneck rail draws. Lifted verbatim from
 * ControlCenter so the home dashboard's "Delayed / Where it's stuck" can never
 * disagree with the coordinator board or the cross-FMS scoreboard.
 *
 * `total` counts every item at a step regardless of due date (including the
 * far-future ones `bucketOf` returns null for), which is what lets a step's ✓
 * mean "genuinely empty" rather than "nothing due in the next 24 hours".
 */
export function queueRollup(entries: QueueEntry[], todayIso: string): QueueRollup {
  const counts: Record<Bucket, number> = { ...EMPTY_COUNTS };
  const perStep = new Map<StepKey, { delayed: number; today: number; total: number }>();
  for (const st of PIPELINE_STEPS) perStep.set(st.key, { delayed: 0, today: 0, total: 0 });

  for (const e of entries) {
    const b = bucketOf(e.dueIso, todayIso);
    if (b) counts[b]++;
    const rec = perStep.get(e.stepKey);
    if (!rec) continue;
    rec.total++;
    if (b === "delayed") rec.delayed++;
    else if (b === "today") rec.today++;
  }

  const nodes: StepPipelineNode<StepKey>[] = PIPELINE_STEPS.map((st) => ({
    stepKey: st.key,
    index: st.index,
    label: st.short,
    ...perStep.get(st.key)!,
  }));
  return { counts, nodes };
}

/* -------------------------------------------------------------------------- */
/*  Distribution bars — count every LIVE entity, so they survive an empty queue.*/
/* -------------------------------------------------------------------------- */

export interface DistRow {
  key: string;
  label: string;
  count: number;
  /** The status/stage badge class (text + bg) — colours the row's pill. */
  badgeCls: string;
}

/**
 * POs by `currentStage`, in the canonical `PO_STAGE_LABEL` key order so no stage
 * is ever dropped — import POs legitimately sit at `collect_pi`/`advance_payment`
 * (real stages, absent only from the queue rail). Only stages present in the data
 * are returned; a stage with no POs is omitted rather than shown as an empty bar.
 */
export function poStageDistribution(pos: PurchaseOrder[]): DistRow[] {
  const by = new Map<string, number>();
  for (const p of pos) by.set(p.currentStage, (by.get(p.currentStage) ?? 0) + 1);
  return Object.keys(PO_STAGE_LABEL)
    .filter((stage) => (by.get(stage) ?? 0) > 0)
    .map((stage) => ({
      key: stage,
      label: PO_STAGE_LABEL[stage] ?? stage,
      count: by.get(stage)!,
      badgeCls: PO_STAGE_CLASS[stage] ?? "text-grey-2 bg-page",
    }));
}

/** Requisition lines by `LineStatus`, in canonical order; `sourcing` (unused in import) drops out at 0. */
export function lineStatusDistribution(items: RequestItem[]): DistRow[] {
  const by = new Map<string, number>();
  for (const it of items) by.set(it.status, (by.get(it.status) ?? 0) + 1);
  return (Object.keys(LINE_STATUS_LABEL) as (keyof typeof LINE_STATUS_LABEL)[])
    .filter((status) => (by.get(status) ?? 0) > 0)
    .map((status) => ({
      key: status,
      label: LINE_STATUS_LABEL[status],
      count: by.get(status)!,
      badgeCls: LINE_STATUS_CLASS[status],
    }));
}

/* -------------------------------------------------------------------------- */
/*  Throughput windowing — local-date, IST-safe (never raw UTC toISOString).   */
/* -------------------------------------------------------------------------- */

/** The local yyyy-mm-dd `days` before `todayIso` — the inclusive window start. */
export const windowStartIso = (todayIso: string, days: number): string => addDaysIso(todayIso, -days);

/**
 * How many completed entries fall on/after `sinceIso`. Compares on the 10-char
 * date prefix so a mix of date-only and full-datetime `atIso` values compares
 * consistently against a date-only boundary.
 */
export const countInWindow = (entries: StageEntry<unknown>[], sinceIso: string): number =>
  entries.reduce((n, e) => (e.atIso.slice(0, 10) >= sinceIso ? n + 1 : n), 0);

/* -------------------------------------------------------------------------- */
/*  Money — over LIVE POs (INR roll-up; FX omitted to avoid mixing currencies). */
/* -------------------------------------------------------------------------- */

export interface MoneySummary {
  /** Σ total value of live POs (not closed/cancelled), INR. */
  inFlight: number;
  /** Σ outstanding on live POs — import is 100% advance, so this is unpaid PO value. */
  advancePending: number;
  /** Σ (total − outstanding) on live POs, INR. */
  paid: number;
  /** Σ total value of POs that had a Tally booking within the window (deduped by PO). */
  bookedTally: number;
}

const isLivePo = (p: PurchaseOrder): boolean => p.currentStage !== "closed" && p.currentStage !== "cancelled";

export function moneySummary(input: {
  pos: PurchaseOrder[];
  pendingAmount: (po: PurchaseOrder) => number;
  completedTallyEntries: StageEntry<unknown>[];
  poById: (id: string | null) => PurchaseOrder | undefined;
  sinceIso: string;
}): MoneySummary {
  const live = input.pos.filter(isLivePo);
  let inFlight = 0;
  let advancePending = 0;
  let paid = 0;
  for (const p of live) {
    const pending = input.pendingAmount(p);
    inFlight += p.totalValue;
    advancePending += pending;
    paid += Math.max(0, p.totalValue - pending);
  }

  // Dedupe by PO: a PO can be booked as several Tally invoices (one per GRN);
  // summing per booking would multi-count its whole total value.
  const bookedPoIds = new Set<string>();
  for (const e of input.completedTallyEntries) {
    if (e.atIso.slice(0, 10) >= input.sinceIso && e.poId) bookedPoIds.add(e.poId);
  }
  let bookedTally = 0;
  for (const id of bookedPoIds) bookedTally += input.poById(id)?.totalValue ?? 0;

  return { inFlight, advancePending, paid, bookedTally };
}
