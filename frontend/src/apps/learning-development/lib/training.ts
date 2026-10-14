import type { Attendance, Nomination, Trainer, TrainingCategory, TrainingSession } from "../types";

/**
 * Helpers for the training calendar (HR's change set of 14-10-2026): Internal /
 * External, the Teams link rule, the financial year, and per-person hours.
 *
 * ⚠ ONE PLACE FOR THE ARITHMETIC. The dashboard tiles, the hours chart and the
 *   "not included" list all read these, so no two of them can count a cancelled
 *   training or a partial attendance differently.
 */

export const CATEGORY_LABEL: Record<TrainingCategory, string> = {
  internal: "Internal",
  external: "External",
};

/** Calendar chip colours — Internal blue, External purple; struck through when cancelled. */
export const CATEGORY_TONE: Record<TrainingCategory, string> = {
  internal: "bg-[#EAF1FE] text-[#1D4ED8]",
  external: "bg-[#F1ECFE] text-[#6D28D9]",
};

/** Same rule as `fms_ld_is_teams_link` on the server. */
export const isTeamsLink = (link: string): boolean =>
  /^https:\/\/teams\.(microsoft|live)\.com\/\S+$/i.test(link.trim());

export const isCancelled = (s: TrainingSession) => s.status === "cancelled" || !!s.cancelledAt;
export const isCompleted = (s: TrainingSession) =>
  !!s.completedAt || !!s.attendanceClosedAt || ["attendance_closed", "in_review", "closed"].includes(s.status);

/** Local (IST) start / end of a training as Dates. */
export const startsAt = (s: TrainingSession): Date =>
  new Date(`${s.sessionDate}T${(s.startTime ?? "00:00").slice(0, 5)}:00`);
export const endsAt = (s: TrainingSession): Date =>
  new Date(`${s.sessionDate}T${(s.endTime ?? s.startTime ?? "23:59").slice(0, 5)}:00`);

/** Hours from start/end when the stored figure is missing (older sessions — LD-14). */
export const sessionHours = (s: TrainingSession): number => {
  if (s.hours != null) return s.hours;
  if (!s.startTime || !s.endTime) return 0;
  const h = (endsAt(s).getTime() - startsAt(s).getTime()) / 3_600_000;
  return h > 0 ? Math.round(h * 100) / 100 : 0;
};

export const hm = (t: string | null) => (t ? t.slice(0, 5) : "");

/* ------------------------------------------------------- financial year */

export interface Fy {
  /** "2026-27" */
  label: string;
  from: string;
  to: string;
}

/** Indian financial year (April–March) containing `d`. */
export function fyOf(d: Date = new Date()): Fy {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return { label: `${y}-${String((y + 1) % 100).padStart(2, "0")}`, from: `${y}-04-01`, to: `${y + 1}-03-31` };
}

export function fyList(sessions: TrainingSession[]): Fy[] {
  const set = new Map<string, Fy>();
  const cur = fyOf();
  set.set(cur.label, cur);
  for (const s of sessions) {
    const f = fyOf(new Date(`${s.sessionDate}T00:00:00`));
    set.set(f.label, f);
  }
  return [...set.values()].sort((a, b) => b.from.localeCompare(a.from));
}

export const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/* ------------------------------------------------------------- trainer */

export function trainerLabel(
  s: TrainingSession,
  trainers: Trainer[],
  personName: (id: string | null) => string,
): string {
  if (s.trainerUserId) return personName(s.trainerUserId);
  const t = trainers.find((x) => x.id === s.trainerId);
  if (t) return t.agency ? `${t.name} (${t.agency})` : t.name;
  return s.externalTrainerName ?? "—";
}

/* ------------------------------------------------------ hours per person */

/**
 * Hours each person earned in a date range, from ATTENDANCE (not invitations):
 * present = the training's hours, partial = its minutes, anything else = 0.
 * Cancelled trainings never count.
 */
export function hoursByPerson(
  sessions: TrainingSession[],
  attendance: Attendance[],
  from: string,
  to: string,
): Map<string, { hours: number; trainings: number }> {
  const byId = new Map(sessions.map((s) => [s.id, s] as const));
  const out = new Map<string, { hours: number; trainings: number }>();
  for (const a of attendance) {
    const s = byId.get(a.sessionId);
    if (!s || isCancelled(s) || s.sessionDate < from || s.sessionDate > to) continue;
    let h = 0;
    if (a.status === "present") h = sessionHours(s);
    else if (a.status === "partial") h = (a.minutes ?? 0) / 60;
    else continue;
    const cur = out.get(a.employeeId) ?? { hours: 0, trainings: 0 };
    cur.hours += h;
    cur.trainings += 1;
    out.set(a.employeeId, cur);
  }
  return out;
}

/** People on at least one live (not cancelled) training in a range — "included". */
export function includedPeople(
  sessions: TrainingSession[],
  nominations: Nomination[],
  from: string,
  to: string,
): Set<string> {
  const live = new Set(
    sessions.filter((s) => !isCancelled(s) && s.sessionDate >= from && s.sessionDate <= to).map((s) => s.id),
  );
  const out = new Set<string>();
  for (const n of nominations) {
    if (n.status === "approved" && live.has(n.sessionId)) out.add(n.employeeId);
  }
  return out;
}

/* ------------------------------------------------- spreadsheet parsing */

/** Excel serial / "28-10-2026" / "28/10/2026" / "2026-10-28" → "2026-10-28", else null. */
export function parseSheetDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && isFinite(v)) {
    // Excel's day 0 is 1899-12-30 (the 1900 leap-year bug included).
    const d = new Date(Math.round((v - 25569) * 86_400_000));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  if (v instanceof Date) return isoDate(v);
  const s = String(v).trim();
  let y: number, mo: number, dd: number;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) [y, mo, dd] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else {
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (!m) return null;
    [y, mo, dd] = [Number(m[3]), Number(m[2]), Number(m[1])];
  }
  // ⚠ A REAL DATE ONLY. JS rolls 31-02 over into March; a typo must be flagged,
  //   not quietly scheduled on a different day.
  const t = new Date(Date.UTC(y, mo - 1, dd));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== dd) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

/** Excel time fraction / "10:00" / "10.00" / "2:30 PM" → "10:00", else null. */
export function parseSheetTime(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && isFinite(v)) {
    const mins = Math.round((v % 1) * 24 * 60);
    return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  }
  const s = String(v).trim().toUpperCase();
  const m = s.match(/^(\d{1,2})[:.](\d{2})(?::\d{2})?\s*(AM|PM)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (m[3] === "PM" && h < 12) h += 12;
  if (m[3] === "AM" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/* ------------------------------------------- calendar invite (.ics) import */

export interface IcsMeeting {
  title: string | null;
  date: string | null;
  start: string | null;
  end: string | null;
  teamsLink: string | null;
  description: string | null;
}

/**
 * Read a meeting saved from Outlook / Teams as an .ics file — title, date, start,
 * end, the Teams join link and the agenda.
 *
 * ⚠ WHY A FILE AND NOT THE LINK. A Teams join link carries only the meeting's
 *   thread id and the organiser's tenant — no date, no time, no title. Those live
 *   on the calendar entry, which is what an .ics is (and what Microsoft Graph
 *   would read, if Orange Hub is ever registered with Microsoft 365).
 *
 * Times: a UTC stamp ("…Z") is turned into this browser's local time (IST on
 * our machines); a TZID-tagged or floating time is taken as written, which is
 * the organiser's local clock.
 */
export function parseIcs(text: string): IcsMeeting {
  // RFC 5545 unfolding: a line starting with a space or tab continues the previous one.
  const lines = text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const inEvent: string[] = [];
  let on = false;
  for (const l of lines) {
    if (l.startsWith("BEGIN:VEVENT")) { on = true; continue; }
    if (l.startsWith("END:VEVENT")) break;
    if (on) inEvent.push(l);
  }
  const get = (name: string): { params: string; value: string } | null => {
    const l = inEvent.find((x) => x.toUpperCase().startsWith(name + ":") || x.toUpperCase().startsWith(name + ";"));
    if (!l) return null;
    const i = l.indexOf(":");
    return { params: l.slice(name.length, i), value: l.slice(i + 1) };
  };
  const unescape = (v: string) => v.replace(/\\n/gi, "\n").replace(/\\([,;\\&])/g, "$1").trim();

  const when = (name: string): { date: string; time: string } | null => {
    const f = get(name);
    if (!f) return null;
    const m = f.value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})\d{2}(Z)?)?$/);
    if (!m) return null;
    if (m[6]) {
      const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
      return {
        date: isoDate(d),
        time: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
      };
    }
    return { date: `${m[1]}-${m[2]}-${m[3]}`, time: m[4] ? `${m[4]}:${m[5]}` : "" };
  };

  const st = when("DTSTART");
  const en = when("DTEND");
  const desc = get("DESCRIPTION") ? unescape(get("DESCRIPTION")!.value) : null;
  const link =
    get("X-MICROSOFT-SKYPETEAMSMEETINGURL")?.value.trim() ??
    text.replace(/\r?\n[ \t]/g, "").match(/https:\/\/teams\.(?:microsoft|live)\.com\/[^\s"<>\\]+/i)?.[0] ??
    null;
  // Teams pads the description with its own joining boilerplate; keep only what is above it.
  const agenda = desc ? desc.split(/_{10,}|Microsoft Teams meeting|Join on your computer/i)[0].trim() : null;

  return {
    title: get("SUMMARY") ? unescape(get("SUMMARY")!.value) : null,
    date: st?.date ?? null,
    start: st?.time || null,
    end: en?.time || null,
    teamsLink: link && isTeamsLink(link) ? link : null,
    description: agenda || null,
  };
}
