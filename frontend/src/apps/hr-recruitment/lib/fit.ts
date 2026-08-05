import type { CandidateFit, FitAxisKey, Requisition } from "../types";

/**
 * AI fit scoring — the pure bits: the axis order, the colour ramp, the band
 * words, and the two predicates the panel needs.
 *
 * Everything here is deliberately free of React and of the store, so the board
 * card and the panel can both read it without dragging one into the other.
 */

/** The order the axes are read in. The function returns them already sorted this way. */
export const FIT_AXIS_ORDER: FitAxisKey[] = [
  "must_have_skills",
  "experience",
  "role_fit",
  "preferred_skills",
  "qualifications",
];

/**
 * ── ONE HUE, LIGHT TO DARK. NOT RED-AMBER-GREEN. ───────────────────────────
 *
 * Two reasons, and the first is verifiable rather than a matter of taste:
 *
 * 1. RED ALREADY MEANS SOMETHING ELSE ON THE SAME CARD. CandidateCard paints an
 *    overdue card `border-ryg-red/40 bg-[#FDECEC]/30`, and DueCell prints a red
 *    "3d overdue" chip about 20px away. In this app red means WE ARE LATE — our
 *    failure, not theirs. Painting a person red for scoring 3 overloads a colour
 *    that already has a firm and unrelated meaning on the same 260px of card.
 *
 * 2. A red person is a verdict; a short bar is an observation. Green/red is the
 *    vocabulary of pass/fail, and applied to a human it converts a screening aid
 *    into a judgement — including to anyone the screenshot reaches. Length plus
 *    lightness reads as LESS OF THE THING, which is exactly and only what the
 *    score measures.
 *
 * The three stops are PipelineSummary's, so nothing new enters the palette.
 */
export const fitFill = (score: number): string =>
  score >= 8 ? "#FF6A1F" : score >= 5 ? "#FF9C63" : "#FFD8C2";

/**
 * The judgement lives in a word, not a colour.
 *
 * Every band is about the PAPERWORK, and none says hire or reject. "Light on
 * paper" is the load-bearing one: it puts the deficiency in the document, which
 * is the only thing that was actually read.
 */
export const fitBand = (score: number): string =>
  score >= 8
    ? "Strong on paper"
    : score >= 6
      ? "Worth a look"
      : score >= 4
        ? "Some gaps"
        : "Light on paper";

/**
 * Enough of a job description to score against.
 *
 * Requisitions raised before 15 Aug 2026 carry none of the JD fields, so this is
 * a common state rather than an error — the panel turns it into a link to go and
 * write one. Every call site goes through this one predicate so that the day an
 * attached JD *file* becomes readable, it changes in one place.
 */
export const hasJd = (r: Requisition): boolean =>
  r.skillIds.length > 0 ||
  r.qualificationIds.length > 0 ||
  !!r.roleSummary?.trim() ||
  !!r.keyResponsibilities?.trim() ||
  !!r.requiredSkills?.trim() ||
  !!r.skillsNote?.trim() ||
  r.experienceMinYears !== null ||
  r.experienceMaxYears !== null;

/**
 * A digest of exactly the JD fields the scorer reads.
 *
 * NOT a timestamp, and that is not a shortcut — it is the only thing that works.
 * `Requisition.editedAt` means "a completed approval step was corrected via the
 * Completed tab", and `updated_at` is never fetched into the frontend at all. A
 * fingerprint is also strictly better than either would have been: posting,
 * holding or re-pricing a vacancy does not change what the role asks for, so it
 * does not make a fit score stale, and a timestamp would have claimed it did.
 *
 * Ids, not names: renaming a skill master does not change what was asked for.
 * Sorted, so re-saving the same skills in a different order is not a false stale.
 */
export const jdFingerprint = (r: Requisition): string =>
  JSON.stringify([
    r.jobTitle?.trim() ?? "",
    r.roleSummary?.trim() ?? "",
    r.keyResponsibilities?.trim() ?? "",
    r.requiredSkills?.trim() ?? "",
    r.preferredExperience?.trim() ?? "",
    r.skillsNote?.trim() ?? "",
    [...r.skillIds].sort(),
    [...r.preferredSkillIds].sort(),
    [...r.qualificationIds].sort(),
    r.experienceMinYears,
    r.experienceMaxYears,
    r.freshersOk,
  ]);

/**
 * Has the vacancy changed since this score was made?
 *
 * An empty stored fingerprint means "we don't know" — never nag about a row that
 * predates the fingerprint rather than one that is genuinely out of date.
 */
export const isFitStale = (fit: CandidateFit, r: Requisition | undefined): boolean =>
  !!r && !!fit.jdFingerprint && fit.jdFingerprint !== jdFingerprint(r);
