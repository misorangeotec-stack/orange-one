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

/** What `canSeePipeline` needs on top of the board's own three fields. */
export interface PipelineAccess extends BoardAccess {
  isAdmin: boolean;
  /** On the `pipeline_viewers` Setup list — the same key RLS reads. */
  isPipelineViewer: boolean;
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
  // The three APPROVAL-side steps. They were missing, and the frontend was therefore
  // STRICTER THAN RLS: `fms_hr_is_recruitment_staff()` grants candidate read to the
  // owner of ANY step except `mrf`, so all three already pass the server's gate and
  // were then refused by this one. It bit nobody only because every current owner
  // happens to own another step as well (checked 08-09-2026: Aayush and Karan are
  // admins, Riya is the coordinator, Saloni owns `onboarding`) — which is exactly the
  // kind of accident that stops being true the day somebody new is set up.
  s.isStepOwner("mgmt_approval") ||
  s.isStepOwner("hr_head_approval") ||
  s.isStepOwner("job_posting") ||
  s.isProcessCoordinator ||
  s.myRequisitions.length > 0;

/**
 * Who may open the management pipeline dashboard (NR-2).
 *
 * THE SETUP LIST IS THE ONLY CONTROL. An admin picks the people; nobody else gets in.
 *
 * ⚠ `canSeeBoard` is deliberately NOT an arm, and it used to be. That arm quietly
 *   handed the report to 21 people: it admits anyone who works a candidate board, and
 *   `canSeeBoard` tests `isStepOwner("interview_2")` — a HOD step, which `isStepOwner`
 *   answers TRUE for anyone who merely owns `mrf`. So all 13 department heads set up to
 *   raise a requisition were let in, against a client who had asked for "the directors".
 *   Worse, most of them met a BLANK report: RLS hands a head only their own vacancies,
 *   and 5 of the 8 checked on 09-09-2026 could read no position and no candidate at all.
 *   Positions and Candidates already serve a head's own hiring, and serve it better.
 *
 * ⚠ `isModuleViewer` is not an arm either. A "View only" module grant reaches the
 *   VACANCY tier only, on purpose: 20260925130100 widened the sibling
 *   `fms_hr_can_view_requisition` precisely so the candidate-PII gate stayed shut, and
 *   folding it in here would render a screen whose rows RLS then refuses to send.
 *
 * `isAdmin` remains, because the portal's admin bypass is platform-wide and is not this
 * module's to withdraw. Everyone else is added on Setup → Pipeline Access, which grants
 * the candidate data in SQL at the same time — one list, one meaning.
 *
 * The route and the sidebar both read this, so the link can never offer a screen that
 * then refuses you.
 */
export const canSeePipeline = (s: PipelineAccess): boolean => s.isAdmin || s.isPipelineViewer;
