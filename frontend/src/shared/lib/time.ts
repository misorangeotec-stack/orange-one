/** Lightweight date/time helpers for display. */

/** Canonical absolute date format used everywhere: dd-mm-yyyy. */
export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return "—";
  return `${d}-${m}-${y}`;
}

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr > 1 ? "s" : ""} ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day} day${day > 1 ? "s" : ""} ago`;
  return formatDateTime(iso);
}

/**
 * Compact relative age for the notifications bell: `now`, `5m`, `3h`, `2d`,
 * `3w`, `5mo`, `3y`.
 *
 * Deliberately NOT `timeAgo`. That one reads as prose ("3 hours ago") and falls
 * back to an absolute date past a week, which is right for a page but too wide
 * for a chip sitting beside a name. This one never falls back — a compact chip
 * stays compact, and the bell carries the absolute value in the row's tooltip.
 *
 * Floors rather than rounds (unlike `timeAgo`), so "3h" means at least three
 * hours have passed — never a time that hasn't arrived yet.
 */
export function timeAgoShort(iso: string): string {
  const then = new Date(iso).getTime();
  if (isNaN(then)) return "—";
  const sec = Math.floor((Date.now() - then) / 1000);
  // Negative = the row is stamped in the future (clock skew between the
  // browser and Postgres). "now" beats a nonsensical "-1m".
  if (sec < 60) return "now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  if (day < 30) return `${Math.floor(day / 7)}w`;
  if (day < 365) return `${Math.floor(day / 30)}mo`;
  return `${Math.floor(day / 365)}y`;
}

/** Absolute date + time: dd-mm-yyyy h:mm AM/PM (local time, 12-hour). */
export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return formatDate(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  let h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}-${mm}-${yyyy} ${h}:${min} ${ampm}`;
}

/** Today's date as yyyy-mm-dd (local). */
export const todayIso = () => new Date().toISOString().slice(0, 10);

/** Friendly date label: Today / Tomorrow / Yesterday / dd-mm-yyyy. */
export function dateLabel(iso: string | null): string {
  if (!iso) return "—";
  const today = new Date(todayIso());
  const target = new Date(iso);
  const days = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return formatDate(iso);
}

/** True if the ISO date is strictly before today. */
export function isOverdue(iso: string | null): boolean {
  if (!iso) return false;
  return iso < todayIso();
}

export function isToday(iso: string | null): boolean {
  return !!iso && iso === todayIso();
}

// ---- week / month helpers (weeks start Monday, matching weekly_plans) ----

/** Monday (yyyy-mm-dd) of the week containing iso. */
export function weekStartOf(iso: string): string {
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7; // 0=Mon..6=Sun
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/** Sunday (yyyy-mm-dd) of the week containing iso. */
export function weekEndOf(iso: string): string {
  const d = new Date(weekStartOf(iso) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

/** Add n weeks to iso, returning the Monday of the resulting week. */
export function addWeeks(iso: string, n: number): string {
  const d = new Date(weekStartOf(iso) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n * 7);
  return d.toISOString().slice(0, 10);
}

/** ISO-8601 week number + ISO year for the week containing iso. */
export function isoWeekOf(iso: string): { isoYear: number; isoWeek: number } {
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7; // 0=Mon..6=Sun
  d.setUTCDate(d.getUTCDate() - day + 3); // Thursday of this week
  const isoYear = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const ftDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ftDay + 3);
  const isoWeek = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return { isoYear, isoWeek };
}

/** Month key "yyyy-mm" for grouping. */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/** Friendly month label, e.g. "June 2026". */
export function monthLabel(iso: string): string {
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
  return d.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}
