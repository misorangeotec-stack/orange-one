/**
 * HR Recruitment domain types — camelCase mirrors of the snake_case fms_hr_* rows.
 * Phase 2 covers config + masters; the workflow entities (requisitions, candidates,
 * interviews, onboardings, probations) land in Phases 3–7.
 */

export type HrEntityType =
  | "requisition"
  | "candidate"
  | "interview"
  | "onboarding"
  | "probation"
  | "master_request";

/** Every HR master has the same {id, name, active, sortOrder} shape (MasterCrud). */
export interface HrMaster {
  id: string;
  name: string;
  active: boolean;
  sortOrder: number;
  createdAt: string;
}

/**
 * Job platforms carry one extra bit: `isOther` marks the single catch-all row.
 * It is a FLAG rather than a name match, so an admin renaming it in Setup →
 * Masters doesn't quietly break the Post Job form's free-text box.
 */
export interface JobPlatform extends HrMaster {
  isOther: boolean;
}

export type JobType = HrMaster;
export type HrLocation = HrMaster;
export type DisqualificationReason = HrMaster;
export type Qualification = HrMaster;

/**
 * How a skill is grouped in the MRF's two skill pickers. One flat master with a
 * category, rather than five masters: the form shows ONE "must-have" list and one
 * "good to have" list, with these as the group headers inside the menu. That is
 * what keeps a full JD down to two dropdowns instead of five.
 */
export type SkillCategory = "technical" | "tool" | "soft" | "language" | "certification";

export const SKILL_CATEGORIES: { value: SkillCategory; label: string }[] = [
  { value: "technical", label: "Technical & domain" },
  { value: "tool", label: "Tools & software" },
  { value: "soft", label: "Soft skills" },
  { value: "language", label: "Languages" },
  { value: "certification", label: "Certifications & licences" },
];

export const skillCategoryLabel = (c: SkillCategory | string): string =>
  SKILL_CATEGORIES.find((s) => s.value === c)?.label ?? String(c);

export interface HrSkill extends HrMaster {
  category: SkillCategory;
}

/**
 * A job title a vacancy can be raised for, plus an optional JD TEMPLATE.
 *
 * NOT {@link Designation} — that is the portal-wide EMPLOYEE title list behind
 * `profiles.designation` (six rows, admin-managed). This one is HR's own, is
 * requestable, carries a department and carries the job description.
 *
 * The template is why the rebuilt MRF is short: picking a title pre-fills the
 * whole job-description step, so the HOD reviews instead of authoring. Every
 * `default*` field is optional — a title with no template just leaves the step
 * empty, which is a normal state, not an error.
 */
export interface JobTitle extends HrMaster {
  departmentId: string | null;
  defaultJobTypeId: string | null;
  defaultRoleSummary: string | null;
  /** Newline-separated bullets, the same encoding the form's bullet editor uses. */
  defaultResponsibilities: string | null;
  defaultExperienceMinYears: number | null;
  defaultExperienceMaxYears: number | null;
  defaultQualificationIds: string[];
  defaultSkillIds: string[];
  defaultPreferredSkillIds: string[];
}

/** True when this title carries enough of a template to be worth pre-filling. */
export const hasJdTemplate = (t: JobTitle | undefined): boolean =>
  !!t &&
  (!!t.defaultRoleSummary ||
    !!t.defaultResponsibilities ||
    t.defaultSkillIds.length > 0 ||
    t.defaultQualificationIds.length > 0);

/* ================= master governance ==================================== */

export type HrMasterType =
  | "job_platform"
  | "job_type"
  | "location"
  | "disqualification_reason"
  | "onboarding_item"
  | "job_title"
  | "skill"
  | "qualification";

/** Every master, for the owners config — all eight can be assigned an owner. */
export const HR_MASTER_TYPES: { value: HrMasterType; label: string; plural: string }[] = [
  { value: "job_title", label: "Job Title", plural: "Job Titles" },
  { value: "skill", label: "Skill", plural: "Skills" },
  { value: "qualification", label: "Qualification", plural: "Qualifications" },
  { value: "job_platform", label: "Job Platform", plural: "Job Platforms" },
  { value: "job_type", label: "Employment Type", plural: "Employment Types" },
  { value: "location", label: "Location", plural: "Locations" },
  { value: "disqualification_reason", label: "Disqualification Reason", plural: "Disqualification Reasons" },
  { value: "onboarding_item", label: "Checklist Item", plural: "Onboarding Checklist" },
];

/**
 * The masters a user can REQUEST a new entry for — the seven that back a dropdown.
 * The onboarding checklist is deliberately absent: it feeds no form (it is seeded
 * server-side onto each onboarding), so there is no "it's missing from this list"
 * moment. Its owner edits it directly on the Masters page. The DB agrees — the
 * master_type CHECK on fms_hr_master_requests lists only these seven.
 */
export const REQUESTABLE_MASTER_TYPES = HR_MASTER_TYPES.filter((m) => m.value !== "onboarding_item");

export interface HrMasterManager {
  id: string;
  masterType: HrMasterType;
  managerUserId: string;
}

export type HrMasterRequestStatus = "pending" | "approved" | "rejected";

export interface HrMasterRequest {
  id: string;
  masterType: HrMasterType;
  proposedPayload: Record<string, unknown>;
  status: HrMasterRequestStatus;
  requestedBy: string | null;
  reviewedBy: string | null;
  reviewNote: string | null;
  resolvedMasterId: string | null;
  createdAt: string;
}

/**
 * One onboarding checklist item. Config-driven on purpose: HR adds, renames and
 * reorders these in Setup, and a new item must never need a migration.
 */
export interface OnboardingItem {
  id: string;
  /** Stable identifier for code that special-cases an item. */
  key: string;
  name: string;
  description: string | null;
  /** The item cannot be ticked without a file. */
  requiresFile: boolean;
  /** A Drive link may be pasted instead of / as well as a file. */
  allowsLink: boolean;
  /** Working days from the onboarding date. */
  dueDays: number;
  active: boolean;
  sortOrder: number;
}

/**
 * Who is currently HOLDING one step of one requisition.
 *
 * ⚠ Keyed on (requisitionId, stepKey), NOT on the entity the step acts on. That
 *   is how fms_hr_can_act already authorises - even hire-scoped steps pass their
 *   requisition id - so the client and the server ask the same question. Read it
 *   as "for this requisition, this step is held by X".
 */
export interface StepAssignee {
  requisitionId: string;
  stepKey: string;
  assignedTo: string;
  assignedBy: string | null;
  assignedAt: string;
  note: string | null;
}

export interface StepOwner {
  id: string;
  stepKey: string;
  /** UI filter for choosing employees. Authorization comes from employeeIds. */
  departmentIds: string[];
  designationId: string | null;
  employeeIds: string[];
}

export interface Designation {
  id: string;
  name: string;
  active: boolean;
}

export interface HrActivity {
  id: string;
  entityType: HrEntityType;
  entityId: string;
  type: string;
  actorId: string | null;
  note: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
}

export interface HrNotification {
  id: string;
  userId: string;
  type: string;
  entityType: HrEntityType;
  entityId: string;
  text: string;
  actorId: string | null;
  readAt: string | null;
  createdAt: string;
}

/* ------------------------------- requisition ------------------------------ */

export type RequisitionStatus =
  | "hr_review"
  | "mgmt_review"
  | "sent_back"
  | "rejected"
  | "posting"
  | "sourcing"
  | "on_hold"
  | "closed"
  | "cancelled";

export type PositionKind = "new" | "replacement";

/**
 * How to READ salaryMin/salaryMax, not where the money lives. "fixed" means the
 * form captured a single figure and wrote it to BOTH bounds — which is exactly
 * what keeps the over-range warning on an offer working without special-casing.
 */
export type SalaryStructure = "fixed" | "range";
export type SalaryPeriod = "month" | "annum";

/**
 * The MRF (sheet columns A–V) plus every step's authoritative timestamp.
 *
 * `hiringManagerIds` / `reportingToIds` are ARRAYS because the live sheet really
 * does name two people ("Ritesh Tulsyan & Dimple"). `reportingToNote` keeps free
 * text that doesn't resolve to a portal user.
 *
 * `salaryMin`/`salaryMax` are both optional: they are the band the requisition is
 * approved against and what flags an over-range offer. The sheet's free-text salary
 * note is retired — the column survives in the table, nothing reads it.
 *
 * `expectedStartDate` is the column name; the UI calls it the expected JOINING date,
 * which is the same thing said in HR's words. `Onboarding.joiningDate` is the real one.
 */
export interface Requisition {
  id: string;
  mrfNo: string;
  requestDate: string;

  requesterId: string | null;
  /** Defaults to the requester. Every HOD step on this requisition routes here. */
  hiringManagerIds: string[];
  reportingToIds: string[];
  reportingToNote: string | null;

  departmentId: string;
  locationId: string | null;
  /** The title as text. Always set — rows raised before the master existed have only this. */
  jobTitle: string;
  /** The {@link JobTitle} master row it was raised from. Null on pre-master rows. */
  jobTitleId: string | null;
  /** Employment type (Full-time / Contract / …) — the fms_hr_job_types master. */
  jobTypeId: string | null;

  positionKind: PositionKind;
  previousEmployeeName: string | null;

  expectedStartDate: string | null;
  positionsRequired: number;

  salaryMin: number | null;
  salaryMax: number | null;
  salaryStructure: SalaryStructure;
  salaryPeriod: SalaryPeriod;
  incentiveNote: string | null;

  whyNeeded: string | null;
  /**
   * The two questions the rebuilt form stopped asking. Kept on the type and the
   * table because requisitions raised before the rebuild have them filled, and
   * the detail page still renders whatever is there. Nothing writes them now.
   */
  businessContribution: string | null;
  impactIfUnfilled: string | null;

  /* ---- the structured job description ---- */
  roleSummary: string | null;
  /** Newline-separated bullets. */
  keyResponsibilities: string | null;
  experienceMinYears: number | null;
  experienceMaxYears: number | null;
  freshersOk: boolean;
  qualificationIds: string[];
  /** Must-have skills, spanning every category. */
  skillIds: string[];
  preferredSkillIds: string[];
  skillsNote: string | null;
  /** Denormalised summary of skillIds, so old text-only consumers still read something. */
  requiredSkills: string | null;
  /** Legacy free text; superseded by experienceMin/MaxYears + preferredSkillIds. */
  preferredExperience: string | null;

  jdPath: string | null;
  jdName: string | null;

  status: RequisitionStatus;
  /** The step this requisition currently sits at — drives the queues. */
  currentStep: string;

  submittedAt: string;
  hrApprovedAt: string | null;
  hrApproverId: string | null;
  hrRemarks: string | null;
  mgmtApprovedAt: string | null;
  mgmtApproverId: string | null;
  mgmtRemarks: string | null;
  sentBackAt: string | null;
  sentBackReason: string | null;
  rejectedAt: string | null;
  rejectReason: string | null;
  /** When the job_posting STEP completed (drives the SLA). */
  postedAt: string | null;
  /** Who posted the job. Null on rows posted before attribution was captured. */
  postedBy: string | null;
  /** The business date HR typed — the sheet's "Date of Job Posted". Not the same fact. */
  postedOn: string | null;
  holdReason: string | null;
  /** When it was parked. Drives the "held N days" age — a held vacancy must not go quiet. */
  holdAt: string | null;
  cancelReason: string | null;
  closedAt: string | null;
  /** When a COMPLETED approval step was last corrected via the Completed tab. Distinct from updatedAt. */
  editedAt: string | null;
  editedBy: string | null;
  createdAt: string;
}

/**
 * One platform a requisition was advertised on (the sheet's "Which Platform").
 *
 * `otherNote` is only ever set on the `isOther` platform — what HR typed when the
 * list had no row for where they actually posted.
 */
export interface RequisitionPlatform {
  requisitionId: string;
  platformId: string;
  postedOn: string | null;
  otherNote: string | null;
}

/* -------------------------------- candidate ------------------------------- */

/**
 * The column a card SITS IN.
 *
 * Not the same as the step that is DUE on it — a card in `resume_uploaded` is
 * waiting on `hr_shortlist`. That mapping is STAGE_PENDING_STEP in lib/queues.ts,
 * and it mirrors `fms_hr_pending_step()` in SQL.
 */
export type CandidateStage =
  | "resume_uploaded"
  /**
   * Shortlisted by HR — and, since 20260903130000, THE HANDOVER ITSELF. A card
   * here is owed a decision by the HOD; there is no `shared_with_hod` between the
   * two any more (that stage was reachable only by pressing a Share button, which
   * granted nothing the hiring manager did not already have, and behind which 27
   * CVs had silently piled up).
   */
  | "hr_shortlisted"
  | "hod_shortlisted"
  | "telephonic"
  | "interview_1"
  | "interview_2"
  | "interview_3"
  | "final_decision"
  /** An offer has been extended: agreed CTC, joining date, onboarding opened. */
  | "finalized"
  /**
   * They joined. An ACKNOWLEDGEMENT of `joined_at`, never a second record of it —
   * the move is refused until the onboarding has actually completed, so the board
   * and the onboarding can never tell different stories about the same person.
   */
  | "hired"
  | "disqualified";

/** How the candidate's details got here: AI-read, AI-failed, or typed in. */
export type ParseStatus = "ok" | "failed" | "manual";

export interface Candidate {
  id: string;
  requisitionId: string;
  candidateNo: string | null;

  name: string;
  phone: string | null;
  email: string | null;
  currentCompany: string | null;
  experienceYears: number | null;
  skills: string[];
  notes: string | null;
  /** Free-text marks the process has no field for — referred, rehire, do-not-hire. */
  tags: string[];

  sourcePlatformId: string | null;
  resumePath: string | null;
  resumeName: string | null;
  parseStatus: ParseStatus;
  parsedJson: Record<string, unknown>;

  stage: CandidateStage;

  /** One authoritative timestamp per stage, stamped inside the RPC that moved the card. */
  uploadedAt: string;
  hrShortlistedAt: string | null;
  hrShortlistedBy: string | null;
  // No sharedToHodAt / sharedToHodBy. The columns still exist in Postgres and keep
  // whatever they hold, but nothing produces them and nothing reads them.
  hodDecidedAt: string | null;
  hodDecidedBy: string | null;
  /** When the telephonic screening (round 0) was HELD. Null if skipped. */
  telephonicAt: string | null;
  /** When the round was HELD — not when it was booked. */
  interview1At: string | null;
  interview2At: string | null;
  interview3At: string | null;
  finalDecisionAt: string | null;
  finalizedAt: string | null;
  finalizedBy: string | null;
  /** The agreed salary. Recorded nowhere at all before this system. */
  offeredCtc: number | null;
  /**
   * When they actually turned up (their onboarding completed).
   *
   * A finalized candidate is a promise; this is the fact. It is what fills a seat,
   * and it is why the requisition auto-closes on joining rather than on finalizing.
   */
  joinedAt: string | null;
  disqualifiedAt: string | null;
  disqualificationReasonId: string | null;
  disqualificationNote: string | null;
  /** A free-text note captured on the Awaiting-Decision / finalize move. */
  decisionRemarks: string | null;

  createdAt: string;
}

export type InterviewStatus = "scheduled" | "selected" | "rejected" | "on_hold" | "no_show";

export interface Interview {
  id: string;
  candidateId: string;
  /** 0 = telephonic screening; 1–3 = the interview rounds. */
  round: 0 | 1 | 2 | 3;
  /**
   * Everyone taking this round — a panel, not a person. Real technical rounds are
   * the HOD plus someone from the team; final rounds are two directors.
   */
  interviewerIds: string[];
  /** The panel lead (element 1 of `interviewerIds`). Kept for anything reading a scalar. */
  interviewerId: string | null;
  /** Free-text fallback — an external consultant with no portal login. */
  interviewerName: string | null;
  scheduledOn: string | null;
  /** Null while the round is only BOOKED. This is what makes "scheduled" ≠ "conducted". */
  heldAt: string | null;
  status: InterviewStatus;
  remarks: string | null;
  documentPath: string | null;
  documentName: string | null;
  /** A meeting / recording link for an online interview (used most for Round 2). */
  videoUrl: string | null;
  /** Who recorded the round's outcome. Null on rows recorded before attribution was captured. */
  resultRecordedBy: string | null;
  /** When the recorded result was last corrected. Distinct from the row's updatedAt. */
  editedAt: string | null;
  editedBy: string | null;
}

/* ------------------------------- onboarding ------------------------------- */

/**
 * Did the person we hired actually take the job?
 *
 * This is the seat-accounting field, not a checklist box. `declined` and `no_show`
 * release the seat back to the requisition — without that, an MRF for 4 people, one
 * of whom drops out, could never be filled.
 */
export type OfferStatus = "pending" | "accepted" | "declined" | "no_show";

/** One onboarding per finalized candidate, created by the finalize move. */
export interface Onboarding {
  id: string;
  candidateId: string;
  requisitionId: string;

  /** HR sets this first — it unlocks the checklist, and every item's due date hangs off it. */
  joiningDate: string | null;
  joiningDateSetAt: string | null;
  joiningDateBy: string | null;

  offerStatus: OfferStatus;
  offerStatusReason: string | null;
  offerDecidedAt: string | null;
  offerDecidedBy: string | null;

  employeeCode: string | null;
  employeeCodeAt: string | null;
  employeeCodeBy: string | null;

  /** They joined. Set only when the offer was accepted AND every item is done. */
  completedAt: string | null;
  /** When an onboarding sub-event was last corrected. Distinct from updatedAt. */
  editedAt: string | null;
  editedBy: string | null;
  createdAt: string;
}

/**
 * One checklist row, SNAPSHOTTED from the active master at seed time — renaming or
 * removing an item in Setup must not rewrite what a past hire was asked for.
 */
export interface OnboardingCheck {
  id: string;
  onboardingId: string;
  /** Provenance only; null if the master row was later deleted. */
  itemId: string | null;
  itemKey: string;

  name: string;
  description: string | null;
  requiresFile: boolean;
  allowsLink: boolean;
  /** Working days from the joining date. */
  dueDays: number;
  sortOrder: number;

  done: boolean;
  /** Stamped automatically by the RPC when the box is ticked — HR never types a date. */
  doneAt: string | null;
  doneBy: string | null;
  filePath: string | null;
  fileName: string | null;
  linkUrl: string | null;
  /** The sheet's "Reason (If Pending)" — why this still isn't done. */
  pendingReason: string | null;
}

/* -------------------------------- probation ------------------------------- */

/** How the month went. Drives the "probation outcomes" report in Phase 8. */
export type ProbationReviewStatus = "satisfactory" | "needs_improvement" | "unsatisfactory";

/** The three-month verdict. `extended` buys one more month and a Month-4 review. */
export type ProbationOutcome = "approved" | "rejected" | "extended";

/** The answer, whichever path reached it. An extension still ends here. */
export type ProbationFinalStatus = "approved" | "rejected";

/**
 * One probation, opened the moment a hire actually JOINS (their onboarding
 * completes) — never when they are merely finalized or offered.
 *
 * `joiningDate` is COPIED from the onboarding rather than read through it: a
 * probation is the record of a person's first three months, so a later correction
 * to the onboarding must not silently re-date reviews that already happened.
 *
 * Owned by the requisition's hiring manager — the person who raised the MRF. They
 * write all three reviews AND take the decision those reviews exist to support;
 * `fms_hr_can_act()` says the same thing server-side.
 */
export interface Probation {
  id: string;
  onboardingId: string;
  candidateId: string;
  requisitionId: string;

  /** THE anchor. Month N's review is due N calendar months after this. */
  joiningDate: string;
  openedAt: string;

  /** The three-month decision. Null until the Month-3 review is in and the HOD acts. */
  outcome: ProbationOutcome | null;
  outcomeAt: string | null;
  outcomeBy: string | null;
  outcomeRemarks: string | null;

  extensionMonths: number;
  /** The verdict after the extra month. Only ever set when `outcome === "extended"`. */
  extensionOutcome: ProbationFinalStatus | null;
  extensionOutcomeAt: string | null;
  extensionOutcomeBy: string | null;
  extensionRemarks: string | null;

  /**
   * The single answer every report reads. A rejection here records the outcome and
   * stops — it does NOT reopen the requisition, because this person genuinely filled
   * the seat. Replacing them is a new MRF.
   */
  finalStatus: ProbationFinalStatus | null;
  finalStatusAt: string | null;
  /** Captured on approval: the day they stop being on probation. */
  permanentFrom: string | null;
  /** Captured on approval: the ID they are confirmed under. */
  employeeCode: string | null;
  /** When an 'extend' decision was last corrected. Distinct from updatedAt. */
  editedAt: string | null;
  editedBy: string | null;
}

/** One monthly review. Month 4 exists only after an extension. */
export interface ProbationReview {
  id: string;
  probationId: string;
  month: 1 | 2 | 3 | 4;
  status: ProbationReviewStatus;
  remarks: string | null;
  filePath: string | null;
  fileName: string | null;
  /** Stamped by the RPC — the HOD never types a date. */
  reviewedAt: string;
  reviewerId: string | null;
  /** When this monthly review was last re-recorded. Distinct from updatedAt. */
  editedAt: string | null;
  editedBy: string | null;
}

// ---------------------------------------------------------------------------
// AI FIT SCORING
// ---------------------------------------------------------------------------

/** The five parameters a CV is read against. Fixed, so two people compare. */
export type FitAxisKey =
  | "must_have_skills"
  | "experience"
  | "role_fit"
  | "preferred_skills"
  | "qualifications";

export interface FitAxis {
  key: FitAxisKey;
  label: string;
  /** 0–10 whole number. 0 when the vacancy says nothing about this axis. */
  score: number;
  /** The renormalised weight actually used. 0 when not applicable. */
  weight: number;
  /** False when the JD gives nothing to score against — the row is then hidden. */
  applicable: boolean;
  /** One or two sentences naming what in the CV justified the number. */
  evidence: string;
}

/**
 * One advisory read of one CV against one vacancy's job description.
 *
 * Append-only in the database: a row is a statement made at a time, by a named
 * model, about a named version of the JD. Nothing here can move a stage.
 */
export interface CandidateFit {
  id: string;
  candidateId: string;
  requisitionId: string;
  /** 0–10 whole number, computed from the axes — never the model's own arithmetic. */
  overall: number;
  verdict: "strong" | "possible" | "weak";
  axes: FitAxis[];
  notes: string | null;
  cvQuality: "text" | "scanned" | "thin";
  /**
   * A digest of the JD fields this score was formed from. Recomputed on read and
   * compared: different = the vacancy changed since, so the score is stale.
   */
  jdFingerprint: string;
  model: string;
  scoredBy: string | null;
  scoredAt: string;
}
