/** Lightweight date/time helpers for display. */

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
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

const todayIso = () => new Date().toISOString().slice(0, 10);

/** Friendly date label: Today / Tomorrow / Yesterday / "12 Jun". */
export function dateLabel(iso: string | null): string {
  if (!iso) return "—";
  const today = new Date(todayIso());
  const target = new Date(iso);
  const days = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return target.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/** True if the ISO date is strictly before today. */
export function isOverdue(iso: string | null): boolean {
  if (!iso) return false;
  return iso < todayIso();
}

export function isToday(iso: string | null): boolean {
  return !!iso && iso === todayIso();
}
