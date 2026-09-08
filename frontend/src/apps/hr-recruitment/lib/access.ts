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
 * Board access, PLUS the admin-editable Setup list — because the whole point of that
 * list is to admit people who own no recruitment step at all.
 *
 * ⚠ `isModuleViewer` is deliberately NOT an arm. A "View only" module grant reaches
 *   the VACANCY tier only, on purpose: 20260925130100 widened the sibling
 *   `fms_hr_can_view_requisition` precisely so the candidate-PII gate stayed shut, and
 *   folding it in here would render a screen whose rows RLS then refuses to send —
 *   nineteen positions and no candidates, with nothing to explain it. A viewer who
 *   should see this screen needs the Setup list (for the rows) and `edit` (to open the
 *   app and to press anything) — see PipelineViewersSection.
 *
 * The route and the sidebar both read this, so the link can never offer a screen that
 * then refuses you.
 */
export const canSeePipeline = (s: PipelineAccess): boolean =>
  s.isAdmin || s.isPipelineViewer || canSeeBoard(s);
