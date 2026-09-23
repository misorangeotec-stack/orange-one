/**
 * The lab's period (KPI-3, read-only): month, quarter, year or any From–To.
 *
 * Deliberately NOT the live scorecard's week. An appraisal framework carries annual
 * targets ("minimum 48 external trainings annually") and quarterly reviews; a week is
 * the wrong window to read any of it in, and would make every count line look missed.
 * The live scorecard keeps its week — this is a different instrument.
 *
 * `rangeLabel` and the date helpers are the live app's, imported rather than copied, so
 * the two screens can never print the same range two different ways.
 */
import { monthEndOf, monthStartOf } from "@/shared/lib/time";
import { rangeLabel, today } from "@/apps/kra-kpi/lib/period";

export type PeriodMode = "month" | "quarter" | "year" | "custom";

export interface Period {
  mode: PeriodMode;
  from: string;
  to: string;
}

const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const parts = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return { y: y!, m: m!, d: d! };
};

const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);

export const monthOf = (at: string): Period => ({ mode: "month", from: monthStartOf(at), to: monthEndOf(at) });

export function quarterOf(at: string): Period {
  const { y, m } = parts(at);
  const q = Math.floor((m - 1) / 3);
  return { mode: "quarter", from: iso(y, q * 3 + 1, 1), to: monthEndOf(iso(y, q * 3 + 3, 1)) };
}

export const yearOf = (at: string): Period => {
  const { y } = parts(at);
  return { mode: "year", from: iso(y, 1, 1), to: iso(y, 12, 31) };
};

export const daysIn = (p: Pick<Period, "from" | "to">): number =>
  Math.round((Date.parse(`${p.to}T00:00:00Z`) - Date.parse(`${p.from}T00:00:00Z`)) / 86_400_000) + 1;

/** One step back or forward, keeping the mode. */
export function step(p: Period, dir: -1 | 1): Period {
  const { y, m } = parts(p.from);
  if (p.mode === "month") return monthOf(new Date(Date.UTC(y, m - 1 + dir, 1)).toISOString().slice(0, 10));
  if (p.mode === "quarter") return quarterOf(new Date(Date.UTC(y, m - 1 + 3 * dir, 1)).toISOString().slice(0, 10));
  if (p.mode === "year") return yearOf(iso(y + dir, 1, 1));
  const n = daysIn(p) * dir;
  const shift = (s: string) => {
    const d = new Date(`${s}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  return { mode: "custom", from: shift(p.from), to: shift(p.to) };
}

/** "September 2026", "Q3 2026 · Jul–Sep", "2026", or the plain range. */
export function periodLabel(p: Period): string {
  const { y, m } = parts(p.from);
  if (p.mode === "month") return `${MONTHS_LONG[m - 1]} ${y}`;
  if (p.mode === "quarter") return `Q${Math.floor((m - 1) / 3) + 1} ${y} · ${rangeLabel(p.from, p.to)}`;
  if (p.mode === "year") return `${y}`;
  return rangeLabel(p.from, p.to);
}

/**
 * A period that has not started yet has nothing in it — the live scorecard learned that
 * the hard way (a week nobody had worked read as a perfect score). The lab never steps
 * into one either.
 */
export const hasStarted = (p: Pick<Period, "from">): boolean => p.from <= today();
export const canStepForward = (p: Period): boolean => hasStarted(step(p, 1));

/** The current period is still running, so its later work is not missed — just not due. */
export const isRunning = (p: Period): boolean => p.from <= today() && today() <= p.to;

export const defaultPeriod = (): Period => monthOf(today());

export { today };
