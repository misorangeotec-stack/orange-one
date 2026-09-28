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
import { tanishaFramework } from "./tanisha";
import { dharmisthaFramework } from "./dharmistha";
import type { ReportForm } from "../report/types";
import { weeklyReviewForm } from "../report/weeklyReview";
import { dharmisthaWeeklyForm } from "../report/dharmisthaWeekly";

/** A sheet, plus the jobs — or, where the job is not enough, the people — it is FOR. */
export interface FrameworkEntry {
  framework: Framework;
  /** Every department+designation pair this sheet scores. Compared case-insensitively. */
  appliesTo: { department: string; designation: string }[];
  /**
   * Named people this sheet is for, by email, checked BEFORE `appliesTo`.
   *
   * ⚠ AN ESCAPE HATCH, NOT THE MODEL. See the note below on why HR needed one.
   */
  people?: string[];
}

/**
 * ⚠ DEPARTMENT + DESIGNATION STOPPED IDENTIFYING THE JOB, AND HR IS WHERE IT BROKE.
 *
 * The model above hangs a sheet off the job so a second person in that job is scored
 * from day one. It relies on the job being legible from the directory. In Human
 * Resources it is not: on 24-09-2026 Saloni Rathod, Tanisha Tikde and Khushi Soni are
 * ALL "Human Resources · Executive", and they do three different jobs —
 *
 *   Saloni   recruitment and L&D
 *   Tanisha  the travel desk
 *   Khushi   engagement, celebrations, rewards and internal communication
 *
 * — which Tanisha's own sheet spells out in its Responsibility Boundary matrix, where
 * three rows are explicitly transferred from her to Khushi. Two sheets keyed on that one
 * pair would have silently scored Tanisha against "CVs uploaded per requisition".
 *
 * ⚠ THE REAL FIX IS IN THE DIRECTORY, NOT HERE. Both documents already carry the right
 *   title — Tanisha's says "HR Executive - Travel Desk", Saloni's says "HR EXECUTIVE-
 *   SALONI" — while the designation master flattens both to "Executive". When HR gives
 *   those roles distinct designations, delete the `people` lines and put the real
 *   designation in `appliesTo`, and the job-based model works again.
 *
 * ⚠ UNTIL THEN, `appliesTo` IS EMPTY FOR BOTH. Leaving "Human Resources · Executive" on
 *   either would hand that sheet to whichever of the three matched first — including
 *   Khushi, who has no sheet written yet and should see the honest empty state rather
 *   than somebody else's targets.
 */
export const FRAMEWORKS: FrameworkEntry[] = [
  {
    framework: saloniFramework,
    // "HR EXECUTIVE-SALONI · FINAL KPI & PMS FRAMEWORK".
    appliesTo: [],
    people: ["recruitment@orangeotec.com"],
  },
  {
    framework: tanishaFramework,
    // "FINAL REVISED KRA & KPI FRAMEWORK · Travel Desk Focus" — HR Executive - Travel Desk.
    appliesTo: [],
    people: ["travel@orangeotec.com"],
  },
  {
    framework: dharmisthaFramework,
    // "FINAL UPDATED KRA & KPI FRAMEWORK · Executive - HR & Admin".
    //
    // ⚠ PINNED BY PERSON FOR THE SAME REASON AS THE TWO ABOVE, and this one makes the
    //   collision impossible to miss: Dharmistha Prajapati is "Human Resources ·
    //   Executive" in the directory, exactly like Saloni, Tanisha and Khushi. Four
    //   people, one department+designation pair, four different jobs. Her document's
    //   own title is "Executive - HR & Admin"; give that designation to the directory
    //   and this entry can move to `appliesTo` and the job-based model works again.
    appliesTo: [],
    people: ["office@orangeotec.com"],
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
export function frameworkFor(person: {
  department: string | null;
  designation: string | null;
  email?: string | null;
}): Framework | null {
  // The named pin wins, and is asked first — see the note on FRAMEWORKS. A person
  // pinned to one sheet must never also match another job's.
  const mail = norm(person.email);
  if (mail) {
    const pinned = FRAMEWORKS.find((e) => e.people?.some((p) => norm(p) === mail));
    if (pinned) return pinned.framework;
  }
  const dep = norm(person.department);
  const des = norm(person.designation);
  if (!dep || !des) return null;
  const hit = FRAMEWORKS.find((e) =>
    e.appliesTo.some((a) => norm(a.department) === dep && norm(a.designation) === des),
  );
  return hit?.framework ?? null;
}

/**
 * Every job that HAS a sheet, for the empty state to name them.
 *
 * A sheet pinned to named people has no job to print, so it is listed by the role its
 * own document states — otherwise the empty state would tell a reader that no sheets
 * exist while two do.
 */
export function jobsWithAFramework(): string[] {
  return FRAMEWORKS.flatMap((e) =>
    e.appliesTo.length
      ? e.appliesTo.map((a) => `${a.department} · ${a.designation}`)
      : [e.framework.role],
  ).sort();
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
  /** Named people this form is for, by email, checked BEFORE `appliesTo`. */
  people?: string[];
}

/**
 * ⚠ THE SAME HR COLLISION AS `FRAMEWORKS`, AND IT BITES HARDER HERE.
 *
 * This form is "HR — Talent Acquisition & Learning and Development | Weekly Review
 * Report": Saloni's job, question for question. Keyed on "Human Resources · Executive"
 * it also matched Tanisha and Khushi, who share that designation and do neither of those
 * jobs — so the travel desk was being asked, every week, how many CVs it had sourced.
 *
 * A scorecard scoring the wrong targets is visible the moment somebody reads it. A weekly
 * FORM asking the wrong questions gets filled in, week after week, and the answers look
 * like data.
 *
 * Pinned by person for the same reason and with the same exit: when HR gives these roles
 * distinct designations, delete `people` and put the real designation in `appliesTo`.
 * Tanisha's sheet contains no weekly review form at all, so she correctly gets the empty
 * state rather than somebody else's questions.
 */
export const FORMS: FormEntry[] = [
  {
    form: weeklyReviewForm,
    // "HR — Talent Acquisition & Learning and Development | Weekly Review Report".
    appliesTo: [],
    people: ["recruitment@orangeotec.com"],
  },
  // ⚠ DHARMISTHA'S WEEKLY FORM IS TRANSCRIBED AND DELIBERATELY NOT LISTED HERE.
  //
  //   `formFor` returning non-null is the ONE thing that flips WeeklyReview.tsx from
  //   the honest empty state to the rendered report — and that page is not generic.
  //   It binds `const form = weeklyReviewForm` and hand-writes every section against
  //   Saloni's field codes: the recruitment funnel, the buddy program, the 90-day
  //   passport tracker. Listing her here would therefore not give her her own report.
  //   It would give her SALONI'S report, with Saloni's questions, under her name —
  //   which is precisely the failure the note above FORMS describes: a scorecard
  //   scoring the wrong targets is visible the moment somebody reads it, a form asking
  //   the wrong questions gets filled in week after week and the answers look like data.
  //
  //   So she keeps the empty state, and her form lives where it is safe and useful: the
  //   gap list at /hr-reports/weekly-review-fields reads any form as data, and now
  //   offers both. Rendering her filled report needs WeeklyReview.tsx to render
  //   `personForm` generically — a real build, and the right one to quote.
];

/**
 * Every form the lab has transcribed, whether or not anybody is pinned to it.
 *
 * Separate from FORMS on purpose: this list is for READING a form's coverage, which is
 * safe for any form; FORMS decides whose weekly report RENDERS, which today is only
 * safe for the one the page was written against.
 */
export const ALL_FORMS: ReportForm[] = [weeklyReviewForm, dharmisthaWeeklyForm];

export function formFor(person: {
  department: string | null;
  designation: string | null;
  email?: string | null;
}): ReportForm | null {
  const mail = norm(person.email);
  if (mail) {
    const pinned = FORMS.find((e) => e.people?.some((p) => norm(p) === mail));
    if (pinned) return pinned.form;
  }
  const dep = norm(person.department);
  const des = norm(person.designation);
  if (!dep || !des) return null;
  const hit = FORMS.find((e) => e.appliesTo.some((a) => norm(a.department) === dep && norm(a.designation) === des));
  return hit?.form ?? null;
}

/** Every job that files a weekly review, for the empty state to name them. */
export function jobsWithAForm(): string[] {
  // A form pinned to named people has no job to print, so it is listed by the role its
  // own document states — see jobsWithAFramework, same reason.
  return FORMS.flatMap((e) =>
    e.appliesTo.length
      ? e.appliesTo.map((a) => `${a.department} · ${a.designation}`)
      : [e.form.role],
  ).sort();
}
