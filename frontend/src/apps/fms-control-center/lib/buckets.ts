/** Rolls bucketed due dates up into a per-FMS snapshot. */
import type { QueueEntry } from "@/apps/procurement/lib/queues";
import type { StepDef } from "@/apps/procurement/lib/steps";
import { EMPTY_COUNTS, bucketOf, todayLocalIso, type Bucket } from "@/shared/lib/dueBuckets";
import type { FmsSnapshot, StepBreak } from "../adapters/types";

// The bucket primitives moved to shared/lib (see dueBuckets.ts). Re-exported so
// this module stays the one import site for everything bucket-related here.
export { bucketOf, todayLocalIso, addDaysIso } from "@/shared/lib/dueBuckets";

/**
 * Roll queue entries up into an FMS snapshot. Steps keep their canonical order
 * (and are all listed, even at zero, so the expanded table doesn't reflow as
 * work moves through the pipeline).
 */
export function snapshotFrom(entries: QueueEntry[], steps: StepDef[], now: Date = new Date()): FmsSnapshot {
  const today = todayLocalIso(now);
  const total: Record<Bucket, number> = { ...EMPTY_COUNTS };
  const byStep = new Map<string, StepBreak>();
  for (const s of steps) byStep.set(s.key, { stepKey: s.key, label: s.short, counts: { ...EMPTY_COUNTS } });

  for (const e of entries) {
    const bucket = bucketOf(e.dueIso, today);
    if (!bucket) continue;
    total[bucket]++;
    const step = byStep.get(e.stepKey);
    if (step) step.counts[bucket]++;
  }

  // Steps that never carry work (e.g. `request`, which has no queue) stay out.
  const used = new Set(entries.map((e) => e.stepKey));
  return { total, steps: steps.filter((s) => used.has(s.key)).map((s) => byStep.get(s.key)!) };
}
