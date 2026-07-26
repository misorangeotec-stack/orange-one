/**
 * Generic, app-agnostic derivations for a per-FMS home dashboard.
 *
 * Every FMS (procurement, import, office-supplies, sampling, production-entry, …)
 * exposes the same primitives — a list of open `(step, entity)` queue entries
 * each with a `dueIso`, a set of "completed" stage entries each with an `atIso`,
 * and a canonical `STEPS` list — so the KPI rollup, throughput windowing and
 * status/stage distributions can be computed here once and fed to the shared
 * presentational cards in `@/shared/components/dashboard/`.
 *
 * Nothing here imports an app's store or types: callers pass plain arrays +
 * accessors. That keeps this a leaf module every FMS can share without a cycle.
 */
import type { Bucket } from "./dueBuckets";
import { EMPTY_COUNTS, bucketOf, addDaysIso } from "./dueBuckets";
import type { StepPipelineNode } from "@/shared/components/ui/StepPipeline";

/** The minimum of a `StepDef` the rollup reads (matches `StepDefBase`). */
export interface RollupStep<K extends string> {
  key: K;
  index: number;
  short: string;
}

/** The minimum of a `QueueEntry` the rollup reads (matches `QueueEntryBase`). */
export interface RollupEntry<K extends string> {
  stepKey: K;
  dueIso: string | null;
}

export interface QueueRollup<K extends string> {
  counts: Record<Bucket, number>;
  nodes: StepPipelineNode<K>[];
}

/**
 * One pass over the open work-items → the four-way bucket totals AND the
 * per-step delayed/today/total the "Where it's stuck" rail draws. Shared by every
 * FMS home dashboard AND its coordinator Control Center, so the two boards can
 * never drift. `total` counts every item at a step regardless of due date
 * (including far-future ones `bucketOf` returns null for), which is what lets a
 * step's ✓ mean "genuinely empty".
 */
export function queueRollup<K extends string>(
  entries: RollupEntry<K>[],
  pipelineSteps: RollupStep<K>[],
  todayIso: string,
): QueueRollup<K> {
  const counts: Record<Bucket, number> = { ...EMPTY_COUNTS };
  const perStep = new Map<K, { delayed: number; today: number; total: number }>();
  for (const st of pipelineSteps) perStep.set(st.key, { delayed: 0, today: 0, total: 0 });

  for (const e of entries) {
    const b = bucketOf(e.dueIso, todayIso);
    if (b) counts[b]++;
    const rec = perStep.get(e.stepKey);
    if (!rec) continue;
    rec.total++;
    if (b === "delayed") rec.delayed++;
    else if (b === "today") rec.today++;
  }

  const nodes: StepPipelineNode<K>[] = pipelineSteps.map((st) => ({
    stepKey: st.key,
    index: st.index,
    label: st.short,
    ...perStep.get(st.key)!,
  }));
  return { counts, nodes };
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
export const countInWindow = (entries: { atIso: string }[], sinceIso: string): number =>
  entries.reduce((n, e) => (e.atIso.slice(0, 10) >= sinceIso ? n + 1 : n), 0);

/* -------------------------------------------------------------------------- */
/*  Distribution bars.                                                          */
/* -------------------------------------------------------------------------- */

export interface DistRow {
  key: string;
  label: string;
  count: number;
  /** The status/stage badge class (text + bg) — colours the row's pill. */
  badgeCls: string;
}

/**
 * Count `items` by `getKey`, then emit one row per key in `order` that has a
 * non-zero count (keys absent from the data are omitted, so the card never shows
 * an empty bar). `label`/`cls` resolve the display text and badge class.
 */
export function distribution<T>(
  items: T[],
  getKey: (t: T) => string,
  order: string[],
  label: (k: string) => string,
  cls: (k: string) => string,
): DistRow[] {
  const by = new Map<string, number>();
  for (const it of items) {
    const k = getKey(it);
    by.set(k, (by.get(k) ?? 0) + 1);
  }
  return order.filter((k) => (by.get(k) ?? 0) > 0).map((k) => ({
    key: k,
    label: label(k),
    count: by.get(k)!,
    badgeCls: cls(k),
  }));
}

/* -------------------------------------------------------------------------- */
/*  Needs-attention row.                                                        */
/* -------------------------------------------------------------------------- */

export interface AttentionRow {
  key: string;
  ref: string;
  href: string;
  stageShort: string;
  detail: string;
  dueIso: string | null;
  /** Pre-formatted value (e.g. "₹1,234"), or null for no-money FMS. */
  value: string | null;
}
