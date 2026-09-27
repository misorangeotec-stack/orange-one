import type { StepDefBase } from "@/shared/lib/fmsQueue";

/**
 * The 22 canonical Learning & Development steps (code-defined, 1-based display
 * index). `key` is the stable identifier used by `fms_ld_step_owners`, the SLA
 * config, the queue logic and — critically — by `fms_ld_can_act()` on the server.
 *
 * Source: files/Orange_Hub_Learning_Development_FMS_Flow.docx §11 "Final
 * Arrow-wise End-to-End Flow" (page 8), plus the twelve decisions the client made
 * on 21-09-2026 (WORKLIST.md → Learning & Development → LD-0).
 *
 * THREE SCOPES, because three different things move through this workflow:
 *   • request     — the training need itself (one Training Request ID)
 *   • session     — one scheduled event born from it
 *   • participant — one nominated person's own obligations
 *
 * The list is LINEAR and that is load-bearing: the SLA engine only offers
 * *strictly earlier* steps as anchors, which makes an anchor cycle impossible by
 * construction.
 *
 * TWO DELIBERATE ABSENCES, so nobody reads them as oversights:
 *   • There is NO assessment step. The client dropped scoring entirely on
 *     21-09-2026 — "we don't have to do the proper assessment, like a test or
 *     marks. We just need to track whether all the employees have submitted their
 *     assignment." §3 step 12 of the document asks for a post-test; it is gone,
 *     and `fms_ld_assessments` was never created.
 *   • There is NO separate "pre-assessment". Same decision.
 */
export type StepKey =
  /** Raising IS the event — it exists as the anchor later steps point at. */
  | "need_raised"
  /** Sent back to the raiser to revise. Real work, owed by one named person. */
  | "need_resubmit"
  | "need_validation"
  | "proposal"
  | "hr_head_approval"
  /** CONDITIONAL — see `mgmt_required` on the request. May be skipped entirely. */
  | "mgmt_approval"
  | "trainer_finalization"
  | "session_scheduling"
  | "nomination"
  | "nomination_approval"
  | "invitation"
  | "pre_material"
  | "conducted"
  | "attendance"
  | "assignment_issue"
  | "assignment_submit"
  | "assignment_review"
  | "feedback"
  | "session_review"
  | "effectiveness"
  | "followup_decision"
  | "closure";

export type StepScope = "request" | "session" | "participant";

export type StepDef = StepDefBase<StepKey, StepScope>;

/**
 * `index` is display + sort only — nothing persists it (the DB stores step KEYS as
 * free text). What IS load-bearing is the ARRAY POSITION: `createStepSlaModel`
 * derives a step's default anchor from the step before it, and offers only earlier
 * steps as anchor options.
 *
 * `noQueue` marks a step that structurally never holds a work-item, so consumers
 * can tell "this step cannot hold work" apart from "this step happens to be empty
 * right now" — the distinction the cross-FMS scoreboard needs.
 */
export const STEPS: StepDef[] = [
  { key: "need_raised",          index: 1,  title: "Training Need Raised",          short: "Need",         scope: "request",     noQueue: true },
  { key: "need_resubmit",        index: 2,  title: "Sent Back — Revise & Resubmit", short: "Sent back",    scope: "request" },
  { key: "need_validation",      index: 3,  title: "HR Validation",                 short: "Validation",   scope: "request" },
  { key: "proposal",             index: 4,  title: "Proposal, Priority & Budget",   short: "Proposal",     scope: "request" },
  { key: "hr_head_approval",     index: 5,  title: "HR Head Approval",              short: "HR Approval",  scope: "request" },
  { key: "mgmt_approval",        index: 6,  title: "Management Approval",           short: "Mgmt Approval",scope: "request" },
  { key: "trainer_finalization", index: 7,  title: "Trainer Finalisation",          short: "Trainer",      scope: "request" },
  { key: "session_scheduling",   index: 8,  title: "Calendar & Session Creation",   short: "Scheduling",   scope: "request" },
  { key: "nomination",           index: 9,  title: "Employee Nomination",           short: "Nomination",   scope: "session" },
  { key: "nomination_approval",  index: 10, title: "Nomination Approval",           short: "Nom. Approval",scope: "session" },
  { key: "invitation",           index: 11, title: "Invitation & RSVP",             short: "RSVP",         scope: "participant" },
  { key: "pre_material",         index: 12, title: "Pre-Training Material",         short: "Material",     scope: "session" },
  { key: "conducted",            index: 13, title: "Training Conducted",            short: "Conduct",      scope: "session" },
  { key: "attendance",           index: 14, title: "Attendance Closure",            short: "Attendance",   scope: "session" },
  { key: "assignment_issue",     index: 15, title: "Assignment Issued",             short: "Assign",       scope: "session" },
  { key: "assignment_submit",    index: 16, title: "Assignment Submission",         short: "Submission",   scope: "participant" },
  { key: "assignment_review",    index: 17, title: "Assignment Reviewed",           short: "Review",       scope: "participant" },
  { key: "feedback",             index: 18, title: "Employee Feedback",             short: "Feedback",     scope: "participant" },
  { key: "session_review",       index: 19, title: "HR Session Review",             short: "Session Review", scope: "session" },
  { key: "effectiveness",        index: 20, title: "30-Day Effectiveness",          short: "Effectiveness",scope: "session" },
  { key: "followup_decision",    index: 21, title: "Follow-up Decision",            short: "Follow-up",    scope: "request" },
  { key: "closure",              index: 22, title: "Closure & KPI",                 short: "Closure",      scope: "request" },
];

export const stepByKey = (key: string): StepDef | undefined => STEPS.find((s) => s.key === key);

/**
 * 🔴 STEPS THAT ARE **NOT** OWNED BY `fms_ld_step_owners`.
 *
 * Each of these is owed by a person the ROW names, not by a globally configured
 * owner. A nominee's RSVP, assignment and feedback are theirs; the nomination and
 * the 30-day effectiveness note are owed by *that employee's* HOD, resolved by
 * `fms_ld_hods_of()` — there is no departments.hod_id in this hub, so a single
 * global "HOD" owner would send the plant's people to the Exim head.
 *
 * ⚠ THIS LIST AND `fms_ld_can_act()` ON THE SERVER MUST BE THE SAME LIST.
 *   New Recruitment has shipped that disagreement twice — once leaving a HOD
 *   unable to reject a CV they were in the middle of reviewing (fixed in
 *   20260712170000). Change one, change the other, in the same commit.
 *
 * ⚠ They are deliberately still offerable in Setup → Step Owners. A named owner
 *   there acts as the FALLBACK when the row names nobody — which, on today's data,
 *   is 19 of 67 employees who resolve to no HOD at all. Without a fallback their
 *   effectiveness review would be owed by nobody and silently never happen.
 */
export const ROW_OWNED_STEPS: StepKey[] = [
  "nomination",
  "invitation",
  "assignment_submit",
  "feedback",
  "effectiveness",
];

export const isRowOwnedStep = (key: StepKey): boolean => ROW_OWNED_STEPS.includes(key);

/**
 * `mgmt_approval` is the one step that may not apply at all.
 *
 * The rule lives in `fms_ld_config.approval_rule` (never / always / above ₹X) and
 * is FROZEN onto each request at proposal time as `mgmtRequired`. Read that field,
 * never the live rule — a request that cleared HR Head approval under one
 * threshold must not sprout or lose a gate because an admin moved it afterwards.
 */
export const CONDITIONAL_STEPS: StepKey[] = ["mgmt_approval"];

/**
 * The five stages this workflow really is. A flat rail of 22 steps is twice the
 * screen, which puts the worst step off-screen — i.e. exactly the one you opened
 * the page to find.
 *
 * Lives here, not in a page, because the dashboard, the detail rail and (later)
 * the cross-FMS scoreboard all read it. One list, so no two screens can describe
 * the same workflow differently. `need_raised` is absent: it is `noQueue`.
 */
export const STAGES: { label: string; keys: StepKey[] }[] = [
  {
    label: "Request",
    keys: ["need_resubmit", "need_validation", "proposal", "hr_head_approval", "mgmt_approval"],
  },
  { label: "Planning", keys: ["trainer_finalization", "session_scheduling"] },
  { label: "Participants", keys: ["nomination", "nomination_approval", "invitation", "pre_material"] },
  {
    label: "Delivery",
    keys: ["conducted", "attendance", "assignment_issue", "assignment_submit", "assignment_review", "feedback"],
  },
  { label: "Close", keys: ["session_review", "effectiveness", "followup_decision", "closure"] },
];

/** Steps LD-1 actually implements. The rest arrive with LD-3 … LD-8. */
export const REQUEST_STEPS: StepKey[] = [
  "need_resubmit",
  "need_validation",
  "proposal",
  "hr_head_approval",
  "mgmt_approval",
  "trainer_finalization",
  "session_scheduling",
];
