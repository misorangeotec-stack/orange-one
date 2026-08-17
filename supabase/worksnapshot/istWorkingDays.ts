/**
 * The IST clock, for a runtime that will not give us one.
 *
 * ── The problem ───────────────────────────────────────────────────────────────
 * Every due date in this system is a LOCAL calendar day. `localDateIso` reads
 * `getFullYear/getMonth/getDate`, `addWorkingDays` decides "is this a Sunday?"
 * with `getDay()` — all host-local. In the browser the host is a person's laptop
 * in India, so local IS Indian time and the code is right.
 *
 * Supabase's edge runtime is pinned to UTC. A `TZ` project secret does not reach
 * it, and `Deno.env.set("TZ", …)` throws `NotSupported` — both were tried against
 * the live function. So the clock has to be corrected in the data path instead.
 *
 * ── The fix ───────────────────────────────────────────────────────────────────
 * India is UTC+5:30 with **no DST**, so the correction is a constant. Adding 5h30m
 * to an instant makes its UTC wall-clock equal its Indian wall-clock — and a UTC
 * host reading "local" components of that shifted instant therefore reads Indian
 * date, weekday and hour. build.mjs aliases `shared/lib/workingDays` to this file
 * so every consumer gets it, including the ones that reach for the helpers
 * directly rather than through `dueIsoFrom` (hr-recruitment/lib/queues.ts:17 does).
 *
 * ⚠ SHIFT EXACTLY ONCE. `addWorkingDays` and friends shift on the way IN, and the
 * Date they return is already in shifted space — so `localDateIso` and `dueState`
 * are re-exported UNCHANGED. Shifting there too would push every due date a day
 * late for anything anchored after 18:30 IST, which is the very bug this file
 * exists to prevent, wearing the opposite sign.
 *
 * ⚠ `dueIsoFrom` NEEDS THE OTHER HALF OF THIS FILE. Its `same_day_cutoff` branch
 * reads `from.getHours()` on its own Date, which this file never sees — so
 * shifting here alone would answer Order to Dispatch's "before 12 noon" rule in
 * UTC hours and put half a day's orders on the wrong date. `istStepSla.ts`
 * handles that by shifting the anchor once and then using the BASE helpers
 * exported below, so nothing is shifted twice.
 */
import * as base from "@/shared/lib/workingDays";

/** UTC+5:30, fixed. India has never observed daylight saving. */
export const IST_SHIFT_MS = 330 * 60_000;

/** An instant whose UTC wall-clock reads as the Indian wall-clock. */
export const toIst = (d: Date): Date => new Date(d.getTime() + IST_SHIFT_MS);

export const addWorkingDays = (from: Date, n: number): Date => base.addWorkingDays(toIst(from), n);

export const addWorkingDaysSigned = (from: Date, n: number): Date =>
  base.addWorkingDaysSigned(toIst(from), n);

export const addMonths = (from: Date, n: number): Date => base.addMonths(toIst(from), n);

// Already in shifted space — see the warning above.
export const localDateIso = base.localDateIso;
export const dueState = base.dueState;

/**
 * The UNSHIFTED originals, for the one caller that shifts its own anchor first
 * (istStepSla.ts). Exported under distinct names so that reaching for them is a
 * deliberate act rather than something you can do by accident and shift twice.
 */
export const baseAddWorkingDays = base.addWorkingDays;
export const baseAddMonths = base.addMonths;
