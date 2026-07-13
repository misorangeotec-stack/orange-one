/**
 * HR Recruitment domain types — camelCase mirrors of the snake_case fms_hr_* rows.
 * Phase 2 covers config + masters; the workflow entities (requisitions, candidates,
 * interviews, onboardings, probations) land in Phases 3–7.
 */

export type HrEntityType = "requisition" | "candidate" | "interview" | "onboarding" | "probation";

/** Every HR master has the same {id, name, active, sortOrder} shape (MasterCrud). */
export interface HrMaster {
  id: string;
  name: string;
  active: boolean;
  sortOrder: number;
  createdAt: string;
}

export type JobPlatform = HrMaster;
export type JobType = HrMaster;
export type HrLocation = HrMaster;
export type DisqualificationReason = HrMaster;

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
 * The MRF (sheet columns A–V) plus every step's authoritative timestamp.
 *
 * `hiringManagerIds` / `reportingToIds` are ARRAYS because the live sheet really
 * does name two people ("Ritesh Tulsyan & Dimple"). `reportingToNote` keeps free
 * text that doesn't resolve to a portal user.
 *
 * `salaryMin`/`salaryMax` are optional and exist only for the over-range check at
 * offer time; `salaryNote` is the human truth ("If fresh (Zero to two years) 15000/-").
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
  jobTitle: string;
  jobTypeId: string | null;

  positionKind: PositionKind;
  previousEmployeeName: string | null;

  expectedStartDate: string | null;
  positionsRequired: number;

  salaryMin: number | null;
  salaryMax: number | null;
  salaryNote: string | null;

  whyNeeded: string | null;
  businessContribution: string | null;
  impactIfUnfilled: string | null;
  keyResponsibilities: string | null;
  requiredSkills: string | null;
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
  /** The business date HR typed — the sheet's "Date of Job Posted". Not the same fact. */
  postedOn: string | null;
  holdReason: string | null;
  /** When it was parked. Drives the "held N days" age — a held vacancy must not go quiet. */
  holdAt: string | null;
  cancelReason: string | null;
  closedAt: string | null;
  createdAt: string;
}

/** One platform a requisition was advertised on (the sheet's "Which Platform"). */
export interface RequisitionPlatform {
  requisitionId: string;
  platformId: string;
  postedOn: string | null;
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
  | "hr_shortlisted"
  | "shared_with_hod"
  | "hod_shortlisted"
  | "interview_1"
  | "interview_2"
  | "interview_3"
  | "final_decision"
  | "finalized"
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
  sharedToHodAt: string | null;
  sharedToHodBy: string | null;
  hodDecidedAt: string | null;
  hodDecidedBy: string | null;
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

  createdAt: string;
}

export type InterviewStatus = "scheduled" | "selected" | "rejected" | "on_hold" | "no_show";

export interface Interview {
  id: string;
  candidateId: string;
  round: 1 | 2 | 3;
  /** A portal user, OR a free-text name — the interviewer may be an external consultant. */
  interviewerId: string | null;
  interviewerName: string | null;
  scheduledOn: string | null;
  /** Null while the round is only BOOKED. This is what makes "scheduled" ≠ "conducted". */
  heldAt: string | null;
  status: InterviewStatus;
  remarks: string | null;
  documentPath: string | null;
  documentName: string | null;
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

  offerStatus: OfferStatus;
  offerStatusReason: string | null;
  offerDecidedAt: string | null;

  employeeCode: string | null;
  employeeCodeAt: string | null;

  /** They joined. Set only when the offer was accepted AND every item is done. */
  completedAt: string | null;
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
}
