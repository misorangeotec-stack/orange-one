import type { Candidate, CandidateStage } from "../types";

/**
 * Board order. Mirrors `fms_hr_stage_rank()` in SQL — keep the two in step.
 * Finalized and Disqualified share a rank; Hired sits above both.
 *
 * DO NOT RENUMBER. These integers are hard-coded thresholds in the backward-clear
 * branch of `fms_hr_move_candidate` (`v_to_rank < 9` and friends) and in the zone
 * bounds below. A shifted rank silently changes which moves are legal and which
 * timestamps get wiped on a move back.
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
  hired: 11,
};

/**
 * The launch rank of the "skippable zone": from hod_shortlisted (4) onward the
 * screening and interview stages are optional, so a forward move may jump any
 * distance within the zone — skip Telephonic, skip a round, or go straight to the
 * offer. Below this rank the pipeline stays strictly one-column-at-a-time.
 *
 * The zone now ENDS at Made Offer (10) rather than Awaiting Decision (9): that
 * column is gone, so the offer is made directly from whichever round satisfied
 * the decision-maker.
 */
const ZONE_START = 4; // hod_shortlisted
const ZONE_END = 10; // finalized — "Made Offer"

/**
 * Stage labels. Every stage keeps one, including the two that no longer have a
 * column of their own — the Excel export, the candidate drawer and the activity
 * trail all still render historical stages by name.
 */
export const STAGE_LABEL: Record<CandidateStage, string> = {
  resume_uploaded: "Resumes Uploaded",
  hr_shortlisted: "Shortlisted by HR",
  shared_with_hod: "Shared with HOD",
  hod_shortlisted: "Shortlisted by HOD",
  telephonic: "Telephonic Screening",
  interview_1: "Interview R1 — HR",
  interview_2: "Interview R2 — HOD",
  interview_3: "Interview R3 — Director",
  final_decision: "Awaiting Decision",
  // `finalized` always meant "offer extended" — it captures the agreed CTC, the
  // joining date, and opens the onboarding. "Selected" never said that.
  finalized: "Made Offer",
  hired: "Hired",
  disqualified: "Disqualified",
};

export type BoardColumnKey =
  | "resumes"
  | "hr_shortlist"
  | "hod_shortlist"
  | "telephonic"
  | "r1"
  | "r2"
  | "r3"
  | "offer"
  | "disqualified"
  | "hired";

/** Which glyph the column header draws. Resolved to SVG in BoardColumn.tsx. */
export type BoardIconKey =
  | "inbox"
  | "check"
  | "user-check"
  | "phone"
  | "chat"
  | "gift"
  | "trash"
  | "trophy";

export interface BoardColumnDef {
  key: BoardColumnKey;
  label: string;
  icon: BoardIconKey;
  /** The stage a card MOVES INTO when dropped here. */
  target: CandidateStage;
  /** Every stage this column DISPLAYS. Usually one; column 2 holds two. */
  stages: CandidateStage[];
}

/**
 * The columns, left to right.
 *
 * A column is not a stage. Two stages that the process distinguishes but a person
 * does not are shown as one column:
 *
 *   "Shortlisted by HR" holds `hr_shortlisted` AND `shared_with_hod`. HR sharing a
 *   batch with the HOD is a real step — it fires the notification, starts the HOD's
 *   clock and is audited — but it is not a place a candidate *is*. The card stays
 *   put and grows a "sent to HOD" tick instead.
 *
 * And `final_decision` has no column at all: the decision is now made from the
 * round that produced it (see `columnOf`).
 */
export const BOARD_COLUMNS: BoardColumnDef[] = [
  { key: "resumes", label: "Resumes Uploaded", icon: "inbox", target: "resume_uploaded", stages: ["resume_uploaded"] },
  {
    key: "hr_shortlist",
    label: "Shortlisted by HR",
    icon: "check",
    target: "hr_shortlisted",
    stages: ["hr_shortlisted", "shared_with_hod"],
  },
  { key: "hod_shortlist", label: "Shortlisted by HOD", icon: "user-check", target: "hod_shortlisted", stages: ["hod_shortlisted"] },
  { key: "telephonic", label: "Telephonic Screening", icon: "phone", target: "telephonic", stages: ["telephonic"] },
  { key: "r1", label: "Interview R1 — HR", icon: "chat", target: "interview_1", stages: ["interview_1"] },
  { key: "r2", label: "Interview R2 — HOD", icon: "chat", target: "interview_2", stages: ["interview_2"] },
  { key: "r3", label: "Interview R3 — Director", icon: "chat", target: "interview_3", stages: ["interview_3"] },
  { key: "offer", label: "Made Offer", icon: "gift", target: "finalized", stages: ["finalized"] },
  { key: "disqualified", label: "Disqualified", icon: "trash", target: "disqualified", stages: ["disqualified"] },
  { key: "hired", label: "Hired", icon: "trophy", target: "hired", stages: ["hired"] },
];

/**
 * Which column a card is drawn in. TOTAL — every stage resolves to a column.
 *
 * That totality is the point. The board used to group with `map.get(stage)?.push(c)`,
 * so any stage without a column was silently dropped from the board while still
 * being counted as open work by the queues, the Control Center and the scoreboard.
 * A card that exists must be somewhere you can see it.
 */
export function columnOf(c: Candidate): BoardColumnKey {
  switch (c.stage) {
    case "resume_uploaded":
      return "resumes";
    case "hr_shortlisted":
    case "shared_with_hod":
      return "hr_shortlist";
    case "hod_shortlisted":
      return "hod_shortlist";
    case "telephonic":
      return "telephonic";
    case "interview_1":
      return "r1";
    case "interview_2":
      return "r2";
    case "interview_3":
      return "r3";
    case "finalized":
      return "offer";
    case "disqualified":
      return "disqualified";
    case "hired":
      return "hired";
    // "Awaiting Decision" lost its column — the decision is made from the round
    // that produced it. So a card still parked there sits with the last round it
    // actually completed, which is where its decision-maker is looking.
    case "final_decision":
      return c.interview3At
        ? "r3"
        : c.interview2At
          ? "r2"
          : c.interview1At
            ? "r1"
            : c.telephonicAt
              ? "telephonic"
              : "hod_shortlist";
  }
}

/**
 * Terminal = the board does not move it on.
 *
 * `finalized` is NOT terminal any more: an offer can be declined (→ Disqualified)
 * or accepted and joined (→ Hired). Only those two outcomes are ends.
 */
export const isTerminal = (s: CandidateStage): boolean => s === "hired" || s === "disqualified";

/**
 * Is this drop legal?
 *
 * Forward: one column at a time BELOW the interview zone; inside the zone
 * (hod_shortlisted → Telephonic → R1 → R2 → R3 → Made Offer) any forward jump,
 * because the rounds are optional. Backward, any distance (correcting a misdrop).
 * Disqualified, from anywhere still open — including out of Made Offer, which is
 * how a declined offer is recorded. Hired, only from Made Offer. Out of Hired,
 * never: joining opened a probation and filled a seat, and a drag is not the tool
 * for unwinding that.
 *
 * Mirrors the transition rules in `fms_hr_move_candidate`. This is UI courtesy —
 * the RPC re-validates, and it is the real gate.
 */
export function canDropOn(from: CandidateStage, to: CandidateStage): boolean {
  if (from === to) return false;
  if (from === "hired") return false; // joined — the board does not undo it
  if (to === "hired") return from === "finalized";
  if (from === "disqualified") return STAGE_RANK[to] < STAGE_RANK[from]; // back out of a drop
  if (to === "disqualified") return true;
  const a = STAGE_RANK[from];
  const b = STAGE_RANK[to];
  if (b < a) return true; // backwards: any distance
  if (b === a + 1) return true; // forwards: the next column, anywhere
  // Inside the skippable zone, a forward jump of any distance is allowed.
  return a >= ZONE_START && b <= ZONE_END && b > a;
}

/**
 * The stages a card may legally move to (drives the ⋮ → "Move to" menu).
 *
 * One entry per COLUMN, not per stage — a menu that offered both `hr_shortlisted`
 * and `shared_with_hod` would name two things the board draws as one place.
 */
export const legalTargets = (from: CandidateStage): CandidateStage[] =>
  BOARD_COLUMNS.map((col) => col.target).filter((to) => canDropOn(from, to));

/**
 * Which interview round a stage is, if any. Telephonic screening is round 0.
 * Returns null for non-interview stages.
 */
export const roundOf = (s: CandidateStage): 0 | 1 | 2 | 3 | null =>
  s === "telephonic" ? 0 : s === "interview_1" ? 1 : s === "interview_2" ? 2 : s === "interview_3" ? 3 : null;
