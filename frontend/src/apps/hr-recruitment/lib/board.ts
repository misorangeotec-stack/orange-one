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
  telephonic: 5,
  interview_1: 6,
  interview_2: 7,
  interview_3: 8,
  final_decision: 9,
  finalized: 10,
  disqualified: 10,
};

/**
 * The launch rank of the "skippable zone": from hod_shortlisted (4) onward the four
 * screening/interview stages and Awaiting Decision are optional, so a forward move
 * may jump any distance within the zone (skip Telephonic, skip a round, go straight
 * to a decision). Below this rank the pipeline stays strictly one-column-at-a-time.
 */
const ZONE_START = 4; // hod_shortlisted
const ZONE_END = 9; // final_decision

export const STAGE_LABEL: Record<CandidateStage, string> = {
  resume_uploaded: "Resumes Uploaded",
  hr_shortlisted: "Shortlisted by HR",
  shared_with_hod: "Shared with HOD",
  hod_shortlisted: "Shortlisted by HOD",
  telephonic: "Telephonic Screening",
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
  "telephonic",
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
 * Forward: one column at a time BELOW the interview zone; but inside the zone
 * (hod_shortlisted → Telephonic → R1 → R2 → R3 → Awaiting Decision) any forward
 * jump is allowed — Telephonic and the rounds are optional, so a card can skip
 * straight to Round 2, or to a decision. Backward, any distance (correcting a
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
  if (b < a) return true; // backwards: any distance
  if (b === a + 1) return true; // forwards: the next column, anywhere
  // Inside the skippable zone, a forward jump of any distance is allowed.
  return a >= ZONE_START && b <= ZONE_END && b > a;
}

/** The stages a card may legally move to (drives the ⋮ → "Move to" menu). */
export const legalTargets = (from: CandidateStage): CandidateStage[] =>
  BOARD_STAGES.filter((s) => canDropOn(from, s));

/**
 * Which interview round a stage is, if any. Telephonic screening is round 0.
 * Returns null for non-interview stages.
 */
export const roundOf = (s: CandidateStage): 0 | 1 | 2 | 3 | null =>
  s === "telephonic" ? 0 : s === "interview_1" ? 1 : s === "interview_2" ? 2 : s === "interview_3" ? 3 : null;
