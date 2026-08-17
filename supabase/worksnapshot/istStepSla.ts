/**
 * `dueIsoFrom` on an Indian clock.
 *
 * ── Why this needs its own file ───────────────────────────────────────────────
 * `istWorkingDays.ts` corrects every helper that takes a Date. It cannot correct
 * `dueIsoFrom`, because that function builds its OWN Date from an ISO string and
 * then asks it a question the shim never sees:
 *
 *     from.getHours() >= (sla.cutoffHour ?? DEFAULT_CUTOFF_HOUR)
 *
 * That is Order to Dispatch's rule from the source sheet: "order received before
 * 12PM, same day dispatch; after 12PM, next day". On a UTC runtime 12 noon IST
 * reads as 06:30, so every order placed between 06:30 and 12:00 IST would be
 * judged late and pushed to the next working day, and everything from 18:30 IST
 * onward would land on the wrong date entirely. Half a day's orders, quietly
 * given the wrong deadline.
 *
 * ── How it is fixed ───────────────────────────────────────────────────────────
 * Shift the anchor ONCE, here, then do the rest of the arithmetic with the
 * UNSHIFTED helpers. The body below is otherwise line-for-line the original
 * (shared/lib/stepSla.ts:145-161) — if that changes, change this with it.
 *
 * ⚠ DO NOT call the shifted `addWorkingDays` from here. It would shift a date
 *   that is already in Indian wall-clock space and push every due date a further
 *   5h30m out, which lands on the next day for anything anchored after 18:30.
 *   That is why istWorkingDays exports the base helpers under separate names.
 *
 * Everything else in the module is re-exported untouched; only `dueIsoFrom`
 * differs, and the explicit export below wins over the star re-export.
 */
import {
  DEFAULT_CUTOFF_HOUR,
  type StepSla,
} from "@/shared/lib/stepSla";
import { baseAddMonths, baseAddWorkingDays, localDateIso, toIst } from "./istWorkingDays";

export * from "@/shared/lib/stepSla";

/** Apply one step's rule to its anchor's completion timestamp, in IST. */
export function dueIsoFrom<K extends string>(
  fromIso: string | null | undefined,
  sla: StepSla<K>,
): string | null {
  if (!fromIso) return null;
  const parsed = new Date(fromIso);
  if (Number.isNaN(parsed.getTime())) return null;

  // The single shift. Every read below — getHours for the cut-off, the weekday
  // check inside addWorkingDays, the final localDateIso — is now Indian.
  const from = toIst(parsed);

  const due =
    sla.unit === "months"
      ? baseAddMonths(from, sla.days)
      : sla.unit === "same_day_cutoff"
        ? baseAddWorkingDays(
            from,
            (from.getHours() >= (sla.cutoffHour ?? DEFAULT_CUTOFF_HOUR) ? 1 : 0) + sla.days,
          )
        : baseAddWorkingDays(from, sla.days);

  return localDateIso(due);
}
