/**
 * Working-day date math, shared by every FMS module.
 *
 * A working day here is **Mon–Sat** — only Sunday is skipped. That is the Orange
 * O Tec week, and it is the one rule every FMS due date depends on, so it lives
 * in exactly one place: two copies of "skip Sunday" is precisely the drift that
 * makes two screens disagree about what is overdue.
 */

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
 * Add `n` calendar months, clamping to the end of a short month (31 Jan + 1 month
 * → 28 Feb, not 3 Mar). Used by HR probation reviews, which are due a month after
 * joining, not N working days after it.
 */
export function addMonths(from: Date, n: number): Date {
  const d = new Date(from);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + Math.max(0, n));
  const lastOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastOfMonth));
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
