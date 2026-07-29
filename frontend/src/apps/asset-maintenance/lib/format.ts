/**
 * Display helpers for Asset Maintenance — labels, tones and number/date
 * formatting. Everything user-visible about a status lives here so no screen
 * spells one out on its own.
 */
import type { FrequencyUnit, JobStatus, RaisedSource, ScheduleKind, VerifyOutcome } from "../types";

export type Tone = "grey" | "blue" | "orange" | "green" | "red" | "yellow";

export const STATUS_LABEL: Record<JobStatus, string> = {
  awaiting_schedule: "To schedule",
  awaiting_service: "Awaiting service",
  awaiting_verification: "Awaiting verification",
  closed: "Closed",
  on_hold: "On hold",
  cancelled: "Cancelled",
  skipped: "Skipped",
};

export const STATUS_TONE: Record<JobStatus, Tone> = {
  awaiting_schedule: "blue",
  awaiting_service: "orange",
  awaiting_verification: "orange",
  closed: "green",
  on_hold: "yellow",
  cancelled: "grey",
  skipped: "grey",
};

export const KIND_LABEL: Record<ScheduleKind, string> = {
  service: "Service",
  renewal: "Renewal",
};

export const OUTCOME_LABEL: Record<VerifyOutcome, string> = {
  satisfactory: "Satisfactory",
  rework_needed: "Rework needed",
};

/**
 * How the job came to exist. Worth surfacing: an 'auto' job proves the engine is
 * working, and a run of 'manual' ones is a sign the schedules are wrong.
 */
export const SOURCE_LABEL: Record<RaisedSource, string> = {
  auto: "Auto (due)",
  manual: "Raised by hand",
  usage: "Usage reached",
};

export const FREQ_UNIT_LABEL: Record<FrequencyUnit, string> = {
  days: "days",
  months: "months",
  years: "years",
  one_time: "one time",
};

/** "Every 6 months" / "One time only" — how a track reads in a list. */
export function frequencyLabel(value: number | null, unit: FrequencyUnit): string {
  if (unit === "one_time") return "One time only";
  if (!value || value <= 0) return "—";
  const u = value === 1 ? FREQ_UNIT_LABEL[unit].replace(/s$/, "") : FREQ_UNIT_LABEL[unit];
  return `Every ${value} ${u}`;
}

/** dd-mm-yyyy, the app-wide date format. Empty input renders an em dash. */
export const dmy = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const d = iso.slice(0, 10);
  const [y, m, day] = d.split("-");
  if (!y || !m || !day) return "—";
  return `${day}-${m}-${y}`;
};

/** dd-mm-yyyy hh:mm for a timestamp. */
export const dmyTime = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export const numOrDash = (n: number | null | undefined): string =>
  n === null || n === undefined ? "—" : String(n);

/** ₹ with Indian grouping. */
export const inr = (n: number | null | undefined): string =>
  n === null || n === undefined
    ? "—"
    : `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/**
 * "Due in 7 days" / "Due today" / "12 days overdue" — the countdown the whole
 * module is about. Kept here so the dashboard, the calendar, the register and
 * the queue all phrase it identically.
 */
export function duePhrase(dueIso: string | null, todayIso: string): string {
  if (!dueIso) return "No date set";
  const days = daysBetween(todayIso, dueIso);
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days > 1) return `Due in ${days} days`;
  const over = Math.abs(days);
  return over === 1 ? "1 day overdue" : `${over} days overdue`;
}

/** Whole days from `fromIso` to `toIso`, both local yyyy-mm-dd. Negative = past. */
export function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T00:00:00`);
  const b = new Date(`${toIso}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/**
 * "dd-mm-yyyy" → "yyyy-mm-dd" so a column whose DISPLAY value is dd-mm-yyyy still
 * sorts and range-filters chronologically instead of lexicographically by day.
 */
export const isoFromDmy = (v: string): string =>
  /^\d{2}-\d{2}-\d{4}$/.test(v) ? v.split("-").reverse().join("-") : v;
