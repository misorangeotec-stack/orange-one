/**
 * The scorecard's period: an ISO week (the default), a calendar month, or any From–To.
 *
 * Only the dates travel to the server; kpi_report works out the previous and next
 * periods itself (previous ISO week, previous calendar month, or the same number of days
 * before), so the screen and the export can never disagree with it about "last week".
 */
import { addWeeks, isoWeekOf, monthEndOf, monthStartOf, weekEndOf, weekStartOf } from "@/shared/lib/time";
import { addDaysIso, todayLocalIso } from "@/shared/lib/dueBuckets";

export type PeriodMode = "week" | "month" | "custom";

export interface Period {
  mode: PeriodMode;
  from: string;
  to: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const parts = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return { y: y!, m: m!, d: d! };
};

/** Today in India — the browser's own calendar day, never UTC. */
export const today = (): string => todayLocalIso();

export function weekOf(iso: string): Period {
  return { mode: "week", from: weekStartOf(iso), to: weekEndOf(iso) };
}

export function monthOf(iso: string): Period {
  return { mode: "month", from: monthStartOf(iso), to: monthEndOf(iso) };
}

export const daysIn = (p: Pick<Period, "from" | "to">): number =>
  Math.round((Date.parse(`${p.to}T00:00:00Z`) - Date.parse(`${p.from}T00:00:00Z`)) / 86_400_000) + 1;

/** One step back (−1) or forward (+1), keeping the mode. */
export function step(p: Period, dir: -1 | 1): Period {
  if (p.mode === "week") return weekOf(addWeeks(p.from, dir));
  if (p.mode === "month") {
    const { y, m } = parts(p.from);
    const first = new Date(Date.UTC(y, m - 1 + dir, 1)).toISOString().slice(0, 10);
    return monthOf(first);
  }
  const n = daysIn(p) * dir;
  return { mode: "custom", from: addDaysIso(p.from, n), to: addDaysIso(p.to, n) };
}

/** "14–20 Sep 2026", "31 Aug – 6 Sep 2026", "29 Dec 2025 – 4 Jan 2026". */
export function rangeLabel(from: string, to: string): string {
  const a = parts(from);
  const b = parts(to);
  if (from === to) return `${a.d} ${MONTHS[a.m - 1]} ${a.y}`;
  if (a.y !== b.y) return `${a.d} ${MONTHS[a.m - 1]} ${a.y} – ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
  if (a.m !== b.m) return `${a.d} ${MONTHS[a.m - 1]} – ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
  return `${a.d}–${b.d} ${MONTHS[a.m - 1]} ${a.y}`;
}

/** "1–2 Aug", "31 Aug", "31 Aug–2 Sep" — a range without its year, for tight labels. */
export function shortRangeLabel(from: string, to: string): string {
  const a = parts(from);
  const b = parts(to);
  if (from === to) return `${a.d} ${MONTHS[a.m - 1]}`;
  if (a.m !== b.m) return `${a.d} ${MONTHS[a.m - 1]}–${b.d} ${MONTHS[b.m - 1]}`;
  return `${a.d}–${b.d} ${MONTHS[a.m - 1]}`;
}

/** "Week 38 · 14–20 Sep 2026", "September 2026", or the range. */
export function periodLabel(p: Period): string {
  if (p.mode === "week") return `Week ${isoWeekOf(p.from).isoWeek} · ${rangeLabel(p.from, p.to)}`;
  if (p.mode === "month") {
    const { y, m } = parts(p.from);
    return `${MONTHS_LONG[m - 1]} ${y}`;
  }
  return rangeLabel(p.from, p.to);
}

/** The word the client's sheet uses in its column headers: Week, Month, or Period. */
export const periodWord = (mode: PeriodMode): string =>
  mode === "week" ? "Week" : mode === "month" ? "Month" : "Period";

/** Does this period contain today? Its later days' work is then still due, not missed. */
export const isRunning = (p: Period): boolean => p.from <= today() && today() <= p.to;

/**
 * A period that has not started has nothing to report — no work in it is due yet, and the
 * only things it could show are steps finished ahead of time, which read as a perfect score
 * for a week nobody has worked (the user caught exactly that on 18-09-2026). Next period's
 * work is already on the report as "Next planned", so the screen never steps into one.
 */
export const hasStarted = (p: Pick<Period, "from">): boolean => p.from <= today();
export const canStepForward = (p: Period): boolean => hasStarted(step(p, 1));

/** Read a period from the URL, falling back to this week. Invalid input never throws. */
export function periodFromParams(mode: string | null, from: string | null, to: string | null): Period {
  const valid = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
  let p: Period;
  if (mode === "month" && valid(from)) p = monthOf(from);
  else if (mode === "custom" && valid(from) && valid(to) && from <= to && daysIn({ from, to }) <= 366) {
    // A range may run up to today, never past it.
    p = { mode: "custom", from, to: to > today() ? today() : to };
  } else if (valid(from)) p = weekOf(from);
  else p = weekOf(today());
  // A link into the future lands on the current week or month instead.
  if (!hasStarted(p)) return p.mode === "month" ? monthOf(today()) : weekOf(today());
  return p;
}
