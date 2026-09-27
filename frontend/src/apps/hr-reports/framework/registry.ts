/**
 * WHICH sheet belongs to WHICH job (HRREP-1).
 *
 * ── Why the sheet hangs off the JOB, not the person ───────────────────────────
 * A KPI sheet is written for a role: Saloni's is titled "HR EXECUTIVE-SALONI", and the
 * targets in it — CVs per requisition, trainings organised, a buddy allocated inside 24
 * hours — belong to whoever does that job, not to her. Keyed by designation:
 *
 *   · a second HR Executive hired tomorrow is scored from day one, with nobody
 *     ticking anything
 *   · one sheet is maintained per job, not one per head, so ~30 instead of 67 and they
 *     cannot drift apart
 *   · when somebody changes job their scorecard follows, because it was never theirs
 *
 * ⚠ DESIGNATION ALONE IS NOT ENOUGH. Saloni's designation is "Executive", and a Sales
 *   Executive is an Executive too — matching on that one word would score the sales
 *   team against HR's targets. The match is DEPARTMENT + DESIGNATION, and it is spelled
 *   out per sheet rather than guessed.
 *
 * ── What happens when there is no sheet ───────────────────────────────────────
 * `frameworkFor` returns null, and the page says so plainly. It does NOT fall back to
 * somebody else's sheet: a warehouse employee scored against "CVs uploaded per
 * requisition" would read a number that looks like an appraisal and means nothing. One
 * honest empty state beats a confident wrong answer.
 *
 * Today exactly one sheet is written down. The rest arrive as HR hands them over, one
 * literal each — see saloni.ts for the shape — and eventually as rows in a table, at
 * which point this file becomes the fallback rather than the source.
 */
import type { Framework } from "./types";
import { saloniFramework } from "./saloni";
import type { ReportForm } from "../report/types";
import { weeklyReviewForm } from "../report/weeklyReview";

/** A sheet, plus the jobs it is the sheet FOR. */
export interface FrameworkEntry {
  framework: Framework;
  /** Every department+designation pair this sheet scores. Compared case-insensitively. */
  appliesTo: { department: string; designation: string }[];
}

export const FRAMEWORKS: FrameworkEntry[] = [
  {
    framework: saloniFramework,
    // "HR EXECUTIVE-SALONI · FINAL KPI & PMS FRAMEWORK" — Human Resources / Executive.
    appliesTo: [{ department: "Human Resources", designation: "Executive" }],
  },
];

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/**
 * The sheet for one person, or null when their job has none.
 *
 * Takes the NAMES rather than the ids: `profiles.designation` is a live mirror of the
 * designation master that every picker in the portal already renders, and the
 * department name is what the reader sees on screen — so a mismatch here is visible to
 * the person reading it rather than buried in a uuid.
 */
export function frameworkFor(person: { department: string | null; designation: string | null }): Framework | null {
  const dep = norm(person.department);
  const des = norm(person.designation);
  if (!dep || !des) return null;
  const hit = FRAMEWORKS.find((e) =>
    e.appliesTo.some((a) => norm(a.department) === dep && norm(a.designation) === des),
  );
  return hit?.framework ?? null;
}

/** Every job that HAS a sheet, for the empty state to name them. */
export function jobsWithAFramework(): string[] {
  return FRAMEWORKS.flatMap((e) => e.appliesTo.map((a) => `${a.department} · ${a.designation}`)).sort();
}

/**
 * The same question for the weekly review FORM, kept separate on purpose.
 *
 * A scorecard and a weekly form are different instruments and there is no reason one
 * job must have both: a department could report weekly without being scored, or be
 * scored without filing a weekly review. Two lists, asked independently.
 */
export interface FormEntry {
  form: ReportForm;
  appliesTo: { department: string; designation: string }[];
}

export const FORMS: FormEntry[] = [
  {
    form: weeklyReviewForm,
    // "HR — Talent Acquisition & Learning and Development | Weekly Review Report".
    appliesTo: [{ department: "Human Resources", designation: "Executive" }],
  },
];

export function formFor(person: { department: string | null; designation: string | null }): ReportForm | null {
  const dep = norm(person.department);
  const des = norm(person.designation);
  if (!dep || !des) return null;
  const hit = FORMS.find((e) => e.appliesTo.some((a) => norm(a.department) === dep && norm(a.designation) === des));
  return hit?.form ?? null;
}

/** Every job that files a weekly review, for the empty state to name them. */
export function jobsWithAForm(): string[] {
  return FORMS.flatMap((e) => e.appliesTo.map((a) => `${a.department} · ${a.designation}`)).sort();
}
