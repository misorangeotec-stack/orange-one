/**
 * Who may see a candidate board.
 *
 * Lifted out of the old Candidate Pipeline page so the Positions list and the
 * per-position pipeline cannot drift apart — a list that shows you a position you
 * are then refused entry to is worse than not listing it.
 *
 * Anyone who owns a step the board moves cards through, plus process coordinators,
 * plus anyone whose own requisitions are on it. RLS remains the real gate; this only
 * decides whether the screen is worth rendering.
 */
export interface BoardAccess {
  isStepOwner: (step: import("./steps").StepKey) => boolean;
  isProcessCoordinator: boolean;
  myRequisitions: unknown[];
}

export const canSeeBoard = (s: BoardAccess): boolean =>
  s.isStepOwner("resume_upload") ||
  s.isStepOwner("hr_shortlist") ||
  // `hod_shortlist` is absent on purpose: it is a HOD step with no global owner
  // list, so whoever owes it reaches the board through `myRequisitions` below.
  s.isStepOwner("telephonic_screening") ||
  s.isStepOwner("interview_1") ||
  s.isStepOwner("interview_2") ||
  s.isStepOwner("interview_3") ||
  s.isStepOwner("final_decision") ||
  s.isStepOwner("onboarding") ||
  s.isProcessCoordinator ||
  s.myRequisitions.length > 0;
