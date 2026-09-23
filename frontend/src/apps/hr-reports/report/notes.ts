/**
 * What a reader types into the weekly report (KPI-3, read-only).
 *
 * ⚠ THIS NEVER REACHES THE DATABASE, AND THAT IS THE POINT. Most of this form is boxes
 *   the hub cannot fill yet. If the page wrote those figures somewhere they would look
 *   like records: somebody would read them next month, quote them in an appraisal, and
 *   there would be an HR number in the hub that traces to nothing. They live in this
 *   browser and nowhere else, so the report can be demonstrated end to end while the
 *   gap stays visibly a gap.
 *
 * Kept per person and per week, because a figure typed for week 38 is not a figure for
 * week 39. Every read and write is wrapped: a private window or blocked site data
 * throws on access, and the page has to render anyway.
 *
 * ── Why this is not the framework lab's `lib/manual.ts` ───────────────────────
 * That one holds NUMBERS — a missing target, or an achievement out of 100 — because
 * everything on a scorecard is arithmetic. A form's empty boxes are mostly prose: a
 * one-line summary, a buddy's name, a list of next week's priorities. One map of
 * strings, with the number-shaped boxes parsed at the point of use, keeps both files
 * honest about what they are for.
 */

/** Green / Amber / Red, as the form prints it. */
export type WeekStatus = "green" | "amber" | "red";

export interface ReportNotes {
  /** The reader's own verdict. The page proposes one from the live flags; this overrules it. */
  status?: WeekStatus;
  /** One value per field code the hub cannot fill. Strings — see the note above. */
  fields: Record<string, string>;
  /** The form's "Pending Actions from Last Week" block, as typed lines. */
  pending: string;
  /** The form's "Key Priorities for Next Week" block, as typed lines. */
  priorities: string;
  /** The form's free-text highlight / flag box, beneath the flags the page proposes. */
  highlights: string;
}

export const emptyNotes = (): ReportNotes => ({ fields: {}, pending: "", priorities: "", highlights: "" });

const keyOf = (formId: string, person: string, from: string, to: string) => `kpi-lab-report:${formId}:${person}:${from}:${to}`;

export function loadNotes(formId: string, person: string, from: string, to: string): ReportNotes {
  try {
    const raw = localStorage.getItem(keyOf(formId, person, from, to));
    if (!raw) return emptyNotes();
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return emptyNotes();
    const n = parsed as Partial<ReportNotes>;
    // Merged onto a fresh object rather than trusted: a shape written by an earlier
    // version of this page must not leave the report with an undefined `fields`.
    return {
      status: n.status,
      fields: n.fields && typeof n.fields === "object" ? n.fields : {},
      pending: typeof n.pending === "string" ? n.pending : "",
      priorities: typeof n.priorities === "string" ? n.priorities : "",
      highlights: typeof n.highlights === "string" ? n.highlights : "",
    };
  } catch {
    return emptyNotes();
  }
}

export function saveNotes(formId: string, person: string, from: string, to: string, notes: ReportNotes): void {
  try {
    localStorage.setItem(keyOf(formId, person, from, to), JSON.stringify(notes));
  } catch {
    // A full or blocked store must not take the page down; the figures simply do not persist.
  }
}

export function clearNotes(formId: string, person: string, from: string, to: string): void {
  try {
    localStorage.removeItem(keyOf(formId, person, from, to));
  } catch {
    /* nothing to undo */
  }
}

/** How many boxes a reader has filled in — printed beside the coverage meter. */
export function typedCount(n: ReportNotes): number {
  let c = Object.values(n.fields).filter((v) => v.trim() !== "").length;
  for (const v of [n.pending, n.priorities, n.highlights]) if (v.trim() !== "") c += 1;
  if (n.status) c += 1;
  return c;
}
