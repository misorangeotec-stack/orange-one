import type { CandidateStage } from "../types";

/**
 * Board order. Mirrors `fms_hr_stage_rank()` in SQL — keep the two in step.
 * Finalized and Disqualified share a rank: both are terminal.
 */
export const STAGE_RANK: Record<CandidateStage, number> = {
  resume_uploaded: 1,
  hr_shortlisted: 2,
  shared_with_hod: 3,
  hod_shortlisted: 4,
  interview_1: 5,
  interview_2: 6,
  interview_3: 7,
  final_decision: 8,
  finalized: 9,
  disqualified: 9,
};

export const STAGE_LABEL: Record<CandidateStage, string> = {
  resume_uploaded: "Resumes Uploaded",
  hr_shortlisted: "Shortlisted by HR",
  shared_with_hod: "Shared with HOD",
  hod_shortlisted: "Shortlisted by HOD",
  interview_1: "Interview R1 — HR",
  interview_2: "Interview R2 — HOD",
  interview_3: "Interview R3 — Director",
  // "Final Decision" next to "Finalized" read as the same word — nobody could tell the
  // question apart from the answer. The stored values are unchanged; only the wording is.
  final_decision: "Awaiting Decision",
  finalized: "Selected",
  disqualified: "Disqualified",
};

/** The columns, left to right. */
export const BOARD_STAGES: CandidateStage[] = [
  "resume_uploaded",
  "hr_shortlisted",
  "shared_with_hod",
  "hod_shortlisted",
  "interview_1",
  "interview_2",
  "interview_3",
  "final_decision",
  "finalized",
  "disqualified",
];

export const isTerminal = (s: CandidateStage): boolean => s === "finalized" || s === "disqualified";

/**
 * Is this drop legal?
 *
 * Forward, exactly one column at a time. Backward, any distance (correcting a
 * misdrop). Disqualified, from anywhere still open. Finalized, only from Final
 * Decision.
 *
 * Mirrors the transition rules in `fms_hr_move_candidate`. This is UI courtesy —
 * the RPC re-validates, and it is the real gate.
 */
export function canDropOn(from: CandidateStage, to: CandidateStage): boolean {
  if (from === to) return false;
  if (isTerminal(from)) return STAGE_RANK[to] < STAGE_RANK[from]; // only back out of a terminal
  if (to === "disqualified") return true;
  if (to === "finalized") return from === "final_decision";
  const a = STAGE_RANK[from];
  const b = STAGE_RANK[to];
  if (b < a) return true;              // backwards: any distance
  return b === a + 1;                  // forwards: one column
}

/** The stages a card may legally move to (drives the ⋮ → "Move to" menu). */
export const legalTargets = (from: CandidateStage): CandidateStage[] =>
  BOARD_STAGES.filter((s) => canDropOn(from, s));

/** Which interview round a stage is, if any. */
export const roundOf = (s: CandidateStage): 1 | 2 | 3 | null =>
  s === "interview_1" ? 1 : s === "interview_2" ? 2 : s === "interview_3" ? 3 : null;
