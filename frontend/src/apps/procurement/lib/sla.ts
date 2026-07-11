import { STEPS, type StepKey } from "./steps";

/**
 * Per-step due-date rules.
 *
 * A step's due date = the **anchor step's completion timestamp** + `days`
 * **working days**, where a working day is Mon–Sat (only Sunday is skipped).
 *
 * The anchor defaults to the immediately preceding step — "24 hours after the
 * previous step" — but an admin may point any step at any *earlier* step (Setup →
 * Due Dates), because the natural reference is not always the previous one. The
 * live map is stored in `fms_purchase_config` under the key `step_sla` and merged
 * over {@link DEFAULT_STEP_SLA}, so an unset or unknown step falls back to the
 * default and behaviour never silently disappears.
 *
 * Three steps are exceptions to the anchor rule:
 *   • `follow_up` — its due date is the vendor's promised dispatch date (captured
 *     at Share PO), not an SLA. See `dispatchDueForPo` in queues.ts.
 *   • `inward` — untimed: receiving can never be late, so it has no due date at all.
 *   • `tally` — trigger-anchored, see {@link TRIGGER_STEPS}.
 * Their `anchor` entries here are inert, as is `days` for the first two.
 */
export interface StepSla {
  /** An earlier step whose completion starts this step's clock. */
  anchor: StepKey;
  /** Working days (Mon–Sat) to add to the anchor's completion. */
  days: number;
}

export type StepSlaMap = Record<StepKey, StepSla>;

/**
 * Previous step + 1 working day, for every step.
 *
 * `request` anchors on itself so the map is total, but its own rule is never
 * evaluated — raising the order never becomes a queue entry (see `LINE_STEPS` in
 * queues.ts). It matters only as the *anchor* other steps point at, where it
 * resolves to the line's creation date.
 */
export const DEFAULT_STEP_SLA: StepSlaMap = STEPS.reduce((acc, step, i) => {
  acc[step.key] = { anchor: STEPS[i - 1]?.key ?? step.key, days: 1 };
  return acc;
}, {} as StepSlaMap);

/**
 * Steps whose clock starts on a domain EVENT, not on an earlier step's completion.
 * `days` stays admin-configurable; `anchor` is inert and never read.
 *
 * Each GRN is its own invoice, so `tally` keys off the oldest one still unbooked.
 */
export const TRIGGER_STEPS: Partial<Record<StepKey, { dueAfter: string; rule: string }>> = {
  tally: {
    dueAfter: "Oldest unbooked goods receipt (GRN)",
    rule: "Each GRN is its own invoice; the oldest unbooked one sets the deadline.",
  },
};

/** Steps an admin may anchor `step` on: any strictly earlier step (`request` → itself). */
export function anchorOptions(step: StepKey): StepKey[] {
  const i = STEPS.findIndex((s) => s.key === step);
  return i <= 0 ? [STEPS[0].key] : STEPS.slice(0, i).map((s) => s.key);
}

/** Merge a stored (possibly partial / stale) map over the defaults. */
export function resolveStepSla(stored: Partial<Record<string, Partial<StepSla>>> | null | undefined): StepSlaMap {
  const out = { ...DEFAULT_STEP_SLA };
  for (const step of STEPS) {
    const s = stored?.[step.key];
    if (!s) continue;
    const days = Number(s.days);
    const anchor = s.anchor as StepKey | undefined;
    out[step.key] = {
      // Guard against a stored anchor that is not a legal (earlier) step.
      anchor: anchor && anchorOptions(step.key).includes(anchor) ? anchor : out[step.key].anchor,
      days: Number.isFinite(days) && days >= 0 ? Math.floor(days) : out[step.key].days,
    };
  }
  return out;
}

const isSunday = (d: Date) => d.getDay() === 0;

/**
 * Add `n` working days, counting Mon–Sat and skipping Sundays. `n = 0` means the
 * anchor day itself (rolled forward if it lands on a Sunday).
 */
export function addWorkingDays(from: Date, n: number): Date {
  const d = new Date(from);
  for (let i = 0; i < Math.max(0, n); i++) {
    d.setDate(d.getDate() + 1);
    if (isSunday(d)) d.setDate(d.getDate() + 1);
  }
  if (isSunday(d)) d.setDate(d.getDate() + 1);
  return d;
}

/**
 * Overdue / due-today state of an already-computed due date. `days` is whole days
 * until due at day granularity (negative = overdue).
 */
export function dueState(due: Date): { days: number; overdue: boolean; dueToday: boolean } {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const dueDay = new Date(due);
  dueDay.setHours(0, 0, 0, 0);
  const days = Math.round((dueDay.getTime() - startOfToday.getTime()) / 86_400_000);
  return { days, overdue: days < 0, dueToday: days === 0 };
}

/** Local yyyy-mm-dd (avoids the UTC drift `toISOString()` would introduce). */
export const localDateIso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
