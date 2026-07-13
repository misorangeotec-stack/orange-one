import type { StepDefBase } from "@/shared/lib/fmsQueue";

/**
 * The 18 canonical HR Recruitment steps (code-defined, 1-based display index).
 * `key` is the stable identifier used by fms_hr_step_owners, the SLA config and
 * the queue logic.
 *
 * Three scopes, because three different things move through this workflow:
 *   • requisition — the vacancy itself (1 MRF)
 *   • candidate   — one person applying to it (the Kanban cards)
 *   • hire        — a finalised candidate being onboarded and reviewed
 *
 * The list is LINEAR and that is load-bearing: the SLA engine only offers
 * *strictly earlier* steps as anchors, which makes an anchor cycle impossible by
 * construction. Cross-scope anchors resolve by walking up (a candidate finds its
 * requisition; a hire finds its candidate) — see lib/queues.ts.
 *
 * Two kinds of step never produce a queue entry of their own:
 *   • `mrf` — raising the requisition IS the event. It exists here only as the
 *     anchor later steps point at (it resolves to the requisition's submitted_at).
 *   • `probation_extension` — conditional: it only appears once the 3-month review
 *     lands on "Extend".
 *
 * NOTE the onboarding CHECKLIST is deliberately not modelled here. `onboarding` is
 * ONE step; its items live in the fms_hr_onboarding_items master so HR can add one
 * without a migration. Item due dates are nested inside the onboarding screen.
 */
export type StepKey =
  | "mrf"
  /** Sent back to the raiser to revise. Real work, owed by one named person. */
  | "mrf_resubmit"
  | "hr_head_approval"
  | "mgmt_approval"
  | "job_posting"
  | "resume_upload"
  | "hr_shortlist"
  | "hod_share"
  | "hod_shortlist"
  | "interview_1"
  | "interview_2"
  | "interview_3"
  | "final_decision"
  | "onboarding"
  | "probation_m1"
  | "probation_m2"
  | "probation_m3"
  | "probation_final"
  | "probation_extension";

export type StepScope = "requisition" | "candidate" | "hire";

export type StepDef = StepDefBase<StepKey, StepScope>;

/**
 * `index` is display + sort only — nothing persists it (the DB stores step KEYS as free
 * text). What IS load-bearing is the ARRAY POSITION: `createStepSlaModel` derives a
 * step's default anchor from the step before it, and offers only earlier steps as anchor
 * options. Splicing `mrf_resubmit` in at position 2 is therefore safe only because every
 * step below carries an explicit anchor in sla.ts's OVERRIDES — verify that still holds
 * before moving anything here.
 *
 * `noQueue` marks a step that structurally never holds a work-item, so consumers can tell
 * "this step cannot hold work" apart from "this step happens to be empty right now".
 */
export const STEPS: StepDef[] = [
  { key: "mrf",                 index: 1,  title: "Manpower Requisition (MRF)",   short: "MRF",           scope: "requisition", noQueue: true },
  { key: "mrf_resubmit",        index: 2,  title: "Sent Back — Revise & Resubmit", short: "Sent back",    scope: "requisition" },
  { key: "hr_head_approval",    index: 3,  title: "HR Head Approval",             short: "HR Approval",   scope: "requisition" },
  { key: "mgmt_approval",       index: 4,  title: "Management Approval",          short: "Mgmt Approval", scope: "requisition" },
  { key: "job_posting",         index: 5,  title: "Job Posting",                  short: "Posting",       scope: "requisition" },
  { key: "resume_upload",       index: 6,  title: "Collect Resumes",              short: "Resumes",       scope: "requisition" },
  { key: "hr_shortlist",        index: 7,  title: "Shortlist by HR",              short: "HR Shortlist",  scope: "candidate" },
  { key: "hod_share",           index: 8,  title: "Share CVs with HOD",           short: "Share to HOD",  scope: "candidate" },
  { key: "hod_shortlist",       index: 9,  title: "Shortlist by HOD",             short: "HOD Shortlist", scope: "candidate" },
  { key: "interview_1",         index: 10, title: "Interview Round 1 — HR",       short: "Round 1",       scope: "candidate" },
  { key: "interview_2",         index: 11, title: "Interview Round 2 — HOD",      short: "Round 2",       scope: "candidate" },
  { key: "interview_3",         index: 12, title: "Interview Round 3 — Director", short: "Round 3",       scope: "candidate" },
  { key: "final_decision",      index: 13, title: "Awaiting Decision",            short: "Decision",      scope: "candidate" },
  { key: "onboarding",          index: 14, title: "Onboarding",                   short: "Onboarding",    scope: "hire" },
  { key: "probation_m1",        index: 15, title: "Month-1 Review (HOD)",         short: "Review M1",     scope: "hire" },
  { key: "probation_m2",        index: 16, title: "Month-2 Review (HOD)",         short: "Review M2",     scope: "hire" },
  { key: "probation_m3",        index: 17, title: "Month-3 Review (HOD)",         short: "Review M3",     scope: "hire" },
  { key: "probation_final",     index: 18, title: "Probation Decision",           short: "Confirm",       scope: "hire" },
  { key: "probation_extension", index: 19, title: "Extended Review (Month 4)",    short: "Extension",     scope: "hire" },
];

export const stepByKey = (key: string): StepDef | undefined => STEPS.find((s) => s.key === key);

/**
 * The four stages recruitment really is — one vacancy being approved, then people moving
 * through a pipeline, then one of them being hired, then that hire being reviewed.
 *
 * Recruitment is four different processes wearing one coat, and a flat rail of 18 steps is
 * twice the screen — which puts the worst step off-screen, i.e. exactly the one you opened
 * the page to find. Grouped, each stage gets its own line and its own subtotal.
 *
 * Lives here, not in a page, because two screens read it: HR's own Control Center strip and
 * the HR row on the cross-FMS scoreboard. One list, so the two cannot describe the same
 * workflow differently. Anything left out of every stage still shows up — consumers fall
 * back to an "Other" bucket rather than silently dropping a step (see lib/buckets.ts).
 *
 * `mrf` is absent on purpose: it is `noQueue`, so it never holds work.
 */
export const STAGES: { label: string; keys: StepKey[] }[] = [
  { label: "Requisition", keys: ["mrf_resubmit", "hr_head_approval", "mgmt_approval", "job_posting", "resume_upload"] },
  {
    label: "Pipeline",
    keys: ["hr_shortlist", "hod_share", "hod_shortlist", "interview_1", "interview_2", "interview_3", "final_decision"],
  },
  { label: "Onboarding", keys: ["onboarding"] },
  { label: "Probation", keys: ["probation_m1", "probation_m2", "probation_m3", "probation_final", "probation_extension"] },
];

/**
 * The Kanban columns, in board order.
 *
 * These are CandidateStage values (the column a card sits in), NOT StepKeys —
 * the step DUE on a card is the one that moves it out (see STAGE_PENDING_STEP in
 * lib/queues.ts). Finalized and Disqualified are terminal: nothing is due on them.
 */
export const BOARD_COLUMNS: Array<{ stage: string; title: string; hint: string; terminal?: boolean }> = [
  { stage: "resume_uploaded", title: "Resumes Uploaded", hint: "HR to screen" },
  { stage: "hr_shortlisted", title: "Shortlisted by HR", hint: "send to the HOD" },
  { stage: "shared_with_hod", title: "Shared with HOD", hint: "HOD to decide" },
  { stage: "hod_shortlisted", title: "Shortlisted by HOD", hint: "book Round 1" },
  { stage: "interview_1", title: "Interview R1 — HR", hint: "conduct + record" },
  { stage: "interview_2", title: "Interview R2 — HOD", hint: "conduct + record" },
  { stage: "interview_3", title: "Interview R3 — Director", hint: "conduct + record" },
  { stage: "final_decision", title: "Awaiting Decision", hint: "select or drop" },
  { stage: "finalized", title: "Selected", hint: "offer made", terminal: true },
  { stage: "disqualified", title: "Disqualified", hint: "", terminal: true },
];

/**
 * Steps owned by the requisition's OWN hiring manager (whoever raised the MRF),
 * not by the global step-owner table.
 *
 * This is the one real structural difference from Purchase FMS, and it exists
 * because "the HOD" is not a portal concept — there is no departments.hod_id, and
 * a single global "HOD" owner would send Sachin Plant candidates to the Exim head.
 * The MRF already names the right person, so we route back to them.
 * Server-side, this is enforced by fms_hr_can_act().
 *
 * `probation_final` and `probation_extension` belong here for the same reason the
 * monthly reviews do: the HOD writes all three reviews, so the decision those reviews
 * exist to support is theirs too. (Both were missing from the SQL list until
 * 20260712170000 — the same client/server disagreement that made the HOD unable to
 * reject a CV they were reviewing in Phase 4. Change one list, change the other.)
 */
export const HOD_STEPS: StepKey[] = [
  "hod_shortlist",
  "interview_2",
  "probation_m1",
  "probation_m2",
  "probation_m3",
  "probation_final",
  "probation_extension",
];

export const isHodStep = (key: StepKey): boolean => HOD_STEPS.includes(key);
