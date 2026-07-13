/** Rolls bucketed due dates up into a per-FMS snapshot. */
import type { QueueEntryBase, StepDefBase } from "@/shared/lib/fmsQueue";
import { EMPTY_COUNTS, bucketOf, todayLocalIso, type Bucket } from "@/shared/lib/dueBuckets";
import type { FmsSnapshot, StageBreak, StepBreak } from "../adapters/types";

// The bucket primitives moved to shared/lib (see dueBuckets.ts). Re-exported so
// this module stays the one import site for everything bucket-related here.
export { bucketOf, todayLocalIso, addDaysIso } from "@/shared/lib/dueBuckets";

/**
 * Roll queue entries up into an FMS snapshot. Steps keep their canonical order and are
 * ALL listed, even at zero, so the expanded table doesn't reflow as work moves through
 * the pipeline.
 *
 * That is what the comment always promised, and what the code did not do. It used to
 * filter the step list down to the keys that happened to carry an entry *right now* —
 * inferring "this step never holds work" from "this step is momentarily empty". So a
 * real step with an empty queue silently vanished from the breakdown, the table reflowed
 * exactly as the comment swore it wouldn't, and a coordinator could not tell "nothing is
 * stuck here" apart from "this step doesn't exist".
 *
 * The structural fact now lives where it belongs — on the step (`noQueue`), declared once
 * by each FMS — instead of being guessed from the data each render.
 */
export function snapshotFrom(
  entries: readonly QueueEntryBase[],
  steps: readonly StepDefBase[],
  /**
   * Optional stages. Given them, the snapshot also carries a per-stage roll-up so the row
   * can open to four readable lines instead of eighteen. Omit them (Purchase does) and the
   * snapshot is exactly what it was.
   */
  stages?: readonly { label: string; keys: readonly string[] }[],
  now: Date = new Date(),
): FmsSnapshot {
  const today = todayLocalIso(now);
  const total: Record<Bucket, number> = { ...EMPTY_COUNTS };
  const byStep = new Map<string, StepBreak>();
  const queueSteps = steps.filter((s) => !s.noQueue);
  for (const s of queueSteps) byStep.set(s.key, { stepKey: s.key, label: s.short, counts: { ...EMPTY_COUNTS } });

  for (const e of entries) {
    const bucket = bucketOf(e.dueIso, today);
    if (!bucket) continue;
    total[bucket]++;
    const step = byStep.get(e.stepKey);
    if (step) step.counts[bucket]++;
  }

  const stepList = queueSteps.map((s) => byStep.get(s.key)!);
  return { total, steps: stepList, stages: stages ? rollUp(stepList, stages) : undefined };
}

/**
 * Sum each stage's steps.
 *
 * A step named by no stage is NOT dropped — it lands in a trailing "Other" stage. Add a step
 * to the workflow and forget to file it under a stage, and the scoreboard would otherwise
 * stop counting it the moment the row is expanded: the totals on the collapsed row would no
 * longer equal the sum of what's shown beneath them, with nothing on screen to say why.
 * Better an odd-looking "Other" than a silent hole.
 */
function rollUp(
  steps: readonly StepBreak[],
  stages: readonly { label: string; keys: readonly string[] }[],
): StageBreak[] {
  const byKey = new Map(steps.map((s) => [s.stepKey, s]));
  const claimed = new Set<string>();
  const out: StageBreak[] = [];

  for (const stage of stages) {
    const members = stage.keys.map((k) => byKey.get(k)).filter((s): s is StepBreak => !!s);
    members.forEach((m) => claimed.add(m.stepKey));
    out.push({ label: stage.label, counts: sum(members), steps: members });
  }

  const orphans = steps.filter((s) => !claimed.has(s.stepKey));
  if (orphans.length) out.push({ label: "Other", counts: sum(orphans), steps: orphans });
  return out;
}

function sum(steps: readonly StepBreak[]): Record<Bucket, number> {
  const acc: Record<Bucket, number> = { ...EMPTY_COUNTS };
  for (const s of steps) for (const b of Object.keys(acc) as Bucket[]) acc[b] += s.counts[b];
  return acc;
}
