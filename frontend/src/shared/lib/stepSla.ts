/**
 * The per-step due-date model every FMS shares.
 *
 * A step's due date = the **anchor step's completion timestamp** + `days`, where
 * `days` is counted in the step's {@link SlaUnit} (working days by default).
 *
 * The anchor defaults to the immediately preceding step — "one working day after
 * the previous step" — but an admin may point any step at any *strictly earlier*
 * step (Setup → Due Dates). Because only earlier steps are offerable, an anchor
 * cycle is impossible by construction.
 *
 * The live map is stored per-FMS in that module's `config` table under the key
 * `step_sla` and merged over the defaults, so an unset or unknown step falls back
 * to its default and behaviour never silently disappears.
 *
 * This module is generic over the step-key union: call {@link createStepSlaModel}
 * with your FMS's `STEPS` array and you get the defaults, the anchor options and
 * the merge function, all typed to your keys.
 */
import { addMonths, addWorkingDays, localDateIso } from "./workingDays";

/**
 * How a step's `days` is counted.
 *
 * `working_days` — Mon–Sat, skipping Sundays. The default, and all Purchase uses.
 * `months`       — calendar months. HR probation reviews are due a month after
 *                  joining, not N working days after it.
 */
export type SlaUnit = "working_days" | "months";

export interface StepSla<K extends string = string> {
  /** An earlier step whose completion starts this step's clock. */
  anchor: K;
  /** Amount to add to the anchor's completion, counted in {@link unit}. */
  days: number;
  /** Absent means `working_days`. */
  unit?: SlaUnit;
}

export type StepSlaMap<K extends string = string> = Record<K, StepSla<K>>;

export interface StepSlaModel<K extends string> {
  /** Previous step + 1 working day, for every step, unless overridden. */
  DEFAULT_STEP_SLA: StepSlaMap<K>;
  /** Steps an admin may anchor `step` on: any strictly earlier step (the first → itself). */
  anchorOptions(step: K): K[];
  /** Merge a stored (possibly partial / stale) map over the defaults. */
  resolveStepSla(stored: Partial<Record<string, Partial<StepSla<K>>>> | null | undefined): StepSlaMap<K>;
}

/**
 * Build the SLA model for one FMS's step list.
 *
 * `overrides` seeds non-default rules — e.g. HR's probation steps, which are
 * month-anchored on the joining date rather than one working day after the step
 * before them.
 */
export function createStepSlaModel<K extends string>(
  steps: readonly { key: K }[],
  overrides: Partial<Record<K, Partial<StepSla<K>>>> = {},
): StepSlaModel<K> {
  /**
   * The first step anchors on itself so the map is total, but its own rule is
   * never evaluated — the origin step never becomes a queue entry. It matters
   * only as the *anchor* other steps point at, where it resolves to the entity's
   * creation date.
   */
  const DEFAULT_STEP_SLA = steps.reduce((acc, step, i) => {
    acc[step.key] = {
      anchor: steps[i - 1]?.key ?? step.key,
      days: 1,
      ...overrides[step.key],
    };
    return acc;
  }, {} as StepSlaMap<K>);

  const anchorOptions = (step: K): K[] => {
    const i = steps.findIndex((s) => s.key === step);
    return i <= 0 ? [steps[0].key] : steps.slice(0, i).map((s) => s.key);
  };

  const resolveStepSla = (
    stored: Partial<Record<string, Partial<StepSla<K>>>> | null | undefined,
  ): StepSlaMap<K> => {
    const out = { ...DEFAULT_STEP_SLA };
    for (const step of steps) {
      const s = stored?.[step.key];
      if (!s) continue;
      const days = Number(s.days);
      const anchor = s.anchor as K | undefined;
      out[step.key] = {
        ...out[step.key],
        // Guard against a stored anchor that is not a legal (earlier) step.
        anchor: anchor && anchorOptions(step.key).includes(anchor) ? anchor : out[step.key].anchor,
        days: Number.isFinite(days) && days >= 0 ? Math.floor(days) : out[step.key].days,
      };
    }
    return out;
  };

  return { DEFAULT_STEP_SLA, anchorOptions, resolveStepSla };
}

/**
 * Apply one step's rule to its anchor's completion timestamp.
 * Returns a local yyyy-mm-dd, or `null` if the anchor never completed.
 */
export function dueIsoFrom<K extends string>(fromIso: string | null | undefined, sla: StepSla<K>): string | null {
  if (!fromIso) return null;
  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) return null;
  const due = sla.unit === "months" ? addMonths(from, sla.days) : addWorkingDays(from, sla.days);
  return localDateIso(due);
}
