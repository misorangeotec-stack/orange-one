/**
 * Row -> domain-object mapping for HR Recruitment, extracted from hrFetch.ts.
 *
 * WHY IT LIVES IN ITS OWN FILE
 *   hrFetch.ts imports the BROWSER Supabase client, so nothing that imports it
 *   can run anywhere else. The daily personal-snapshot email needs these exact
 *   objects server-side, in a Deno edge function, to feed the same pure
 *   lib/queues.ts rules the dashboard uses.
 *
 *   Copying the mappers instead would mean a column added here and forgotten
 *   there — producing two different Requisition objects, two different due
 *   dates, and an email that quietly disagrees with the screen. Same reasoning
 *   that moved the ownership rule into procurement/lib/owners.ts.
 *
 * Pure: no imports beyond types. Do not add a client, a hook or an env read.
 */
import type {
  Candidate,
  CandidateStage,
  Interview,
  InterviewStatus,
  Onboarding,
  OnboardingCheck,
  OfferStatus,
  ParseStatus,
  PositionKind,
  Probation,
  ProbationFinalStatus,
  ProbationOutcome,
  ProbationReview,
  ProbationReviewStatus,
  Requisition,
  RequisitionPlatform,
  RequisitionStatus,
  SalaryPeriod,
  SalaryStructure,
} from "../types";

export const num = (v: any): number | null => (v === null || v === undefined ? null : Number(v));

export const mapRequisition = (r: any): Requisition => ({
  id: r.id,
  mrfNo: r.mrf_no,
  requestDate: r.request_date,
  requesterId: r.requester_id ?? null,
  hiringManagerIds: (r.hiring_manager_ids ?? []) as string[],
  reportingToIds: (r.reporting_to_ids ?? []) as string[],
  reportingToNote: r.reporting_to_note ?? null,
  departmentId: r.department_id,
  locationId: r.location_id ?? null,
  jobTitle: r.job_title,
  jobTitleId: r.job_title_id ?? null,
  jobTypeId: r.job_type_id ?? null,
  positionKind: r.position_kind as PositionKind,
  previousEmployeeName: r.previous_employee_name ?? null,
  expectedStartDate: r.expected_start_date ?? null,
  positionsRequired: r.positions_required ?? 1,
  salaryMin: num(r.salary_min),
  salaryMax: num(r.salary_max),
  // Defaulted, not `?? null`: both columns are NOT NULL with a default, and the
  // fallbacks here are what a row written before the rebuild reads as.
  salaryStructure: (r.salary_structure ?? "range") as SalaryStructure,
  salaryPeriod: (r.salary_period ?? "month") as SalaryPeriod,
  incentiveNote: r.incentive_note ?? null,
  whyNeeded: r.why_needed ?? null,
  businessContribution: r.business_contribution ?? null,
  impactIfUnfilled: r.impact_if_unfilled ?? null,
  roleSummary: r.role_summary ?? null,
  keyResponsibilities: r.key_responsibilities ?? null,
  experienceMinYears: num(r.experience_min_years),
  experienceMaxYears: num(r.experience_max_years),
  freshersOk: r.freshers_ok ?? false,
  qualificationIds: (r.qualification_ids ?? []) as string[],
  skillIds: (r.skill_ids ?? []) as string[],
  preferredSkillIds: (r.preferred_skill_ids ?? []) as string[],
  skillsNote: r.skills_note ?? null,
  requiredSkills: r.required_skills ?? null,
  preferredExperience: r.preferred_experience ?? null,
  jdPath: r.jd_path ?? null,
  jdName: r.jd_name ?? null,
  status: r.status as RequisitionStatus,
  currentStep: r.current_step,
  submittedAt: r.submitted_at,
  hrApprovedAt: r.hr_approved_at ?? null,
  hrApproverId: r.hr_approver_id ?? null,
  hrRemarks: r.hr_remarks ?? null,
  mgmtApprovedAt: r.mgmt_approved_at ?? null,
  mgmtApproverId: r.mgmt_approver_id ?? null,
  mgmtRemarks: r.mgmt_remarks ?? null,
  sentBackAt: r.sent_back_at ?? null,
  sentBackReason: r.sent_back_reason ?? null,
  rejectedAt: r.rejected_at ?? null,
  rejectReason: r.reject_reason ?? null,
  postedAt: r.posted_at ?? null,
  postedBy: r.posted_by ?? null,
  postedOn: r.posted_on ?? null,
  holdReason: r.hold_reason ?? null,
  holdAt: r.hold_at ?? null,
  heldBy: r.held_by ?? null,
  cancelReason: r.cancel_reason ?? null,
  closedAt: r.closed_at ?? null,
  decidedBy: r.decided_by ?? null,
  editedAt: r.edited_at ?? null,
  editedBy: r.edited_by ?? null,
  createdAt: r.created_at,
});

export const mapRequisitionPlatform = (r: any): RequisitionPlatform => ({
  requisitionId: r.requisition_id,
  platformId: r.platform_id,
  postedOn: r.posted_on ?? null,
  otherNote: r.other_note ?? null,
});

/**
 * Postgres stores `stage` as free text behind a CHECK, so reading it is a CAST, not
 * a check — and a cast will happily type a value the union no longer contains.
 *
 * That matters because of one specific value. `shared_with_hod` was removed from
 * `CandidateStage` when the Share-to-HOD step went (migration 20260903130000); the
 * CHECK constraint still admits it, deliberately, because loosening constraints on a
 * live table is a risk not worth taking for a stage nothing can produce any more.
 * If a row somehow carried it, `STAGE_LABEL[stage]` would render blank and
 * `columnOf()` would return undefined — and a card with no column DROPS OFF THE
 * BOARD while still counting as open work in the queues. lib/board.ts is explicit
 * that this must not happen: "a card that exists must be somewhere you can see it."
 *
 * So: anything unrecognised lands on `hr_shortlisted`, the same stage the migration
 * normalises stragglers to. Visible and actionable beats correct-but-invisible.
 */
const KNOWN_STAGES = new Set<CandidateStage>([
  "resume_uploaded",
  "hr_shortlisted",
  "hod_shortlisted",
  "telephonic",
  "interview_1",
  "interview_2",
  "interview_3",
  "final_decision",
  "finalized",
  "hired",
  "disqualified",
]);

const toStage = (raw: unknown): CandidateStage =>
  KNOWN_STAGES.has(raw as CandidateStage) ? (raw as CandidateStage) : "hr_shortlisted";

export const mapCandidate = (r: any): Candidate => ({
  id: r.id,
  requisitionId: r.requisition_id,
  candidateNo: r.candidate_no ?? null,
  name: r.name,
  phone: r.phone ?? null,
  email: r.email ?? null,
  currentCompany: r.current_company ?? null,
  experienceYears: num(r.experience_years),
  skills: (r.skills ?? []) as string[],
  notes: r.notes ?? null,
  tags: (r.tags ?? []) as string[],
  sourcePlatformId: r.source_platform_id ?? null,
  resumePath: r.resume_path ?? null,
  resumeName: r.resume_name ?? null,
  parseStatus: (r.parse_status ?? "manual") as ParseStatus,
  parsedJson: (r.parsed_json ?? {}) as Record<string, unknown>,
  stage: toStage(r.stage),
  uploadedAt: r.uploaded_at,
  hrShortlistedAt: r.hr_shortlisted_at ?? null,
  hrShortlistedBy: r.hr_shortlisted_by ?? null,
  hodDecidedAt: r.hod_decided_at ?? null,
  hodDecidedBy: r.hod_decided_by ?? null,
  telephonicAt: r.telephonic_at ?? null,
  interview1At: r.interview1_at ?? null,
  interview2At: r.interview2_at ?? null,
  interview3At: r.interview3_at ?? null,
  finalDecisionAt: r.final_decision_at ?? null,
  finalizedAt: r.finalized_at ?? null,
  finalizedBy: r.finalized_by ?? null,
  offeredCtc: num(r.offered_ctc),
  joinedAt: r.joined_at ?? null,
  disqualifiedAt: r.disqualified_at ?? null,
  disqualificationReasonId: r.disqualification_reason_id ?? null,
  disqualificationNote: r.disqualification_note ?? null,
  decisionRemarks: r.decision_remarks ?? null,
  createdAt: r.created_at,
});

export const mapInterview = (r: any): Interview => ({
  id: r.id,
  candidateId: r.candidate_id,
  round: r.round as 0 | 1 | 2 | 3,
  interviewerIds: (r.interviewer_ids ?? []) as string[],
  interviewerId: r.interviewer_id ?? null,
  interviewerName: r.interviewer_name ?? null,
  scheduledOn: r.scheduled_on ?? null,
  heldAt: r.held_at ?? null,
  status: r.status as InterviewStatus,
  remarks: r.remarks ?? null,
  documentPath: r.document_path ?? null,
  documentName: r.document_name ?? null,
  videoUrl: r.video_url ?? null,
  resultRecordedBy: r.result_recorded_by ?? null,
  editedAt: r.edited_at ?? null,
  editedBy: r.edited_by ?? null,
});

export const mapOnboarding = (r: any): Onboarding => ({
  id: r.id,
  candidateId: r.candidate_id,
  requisitionId: r.requisition_id,
  joiningDate: r.joining_date ?? null,
  joiningDateSetAt: r.joining_date_set_at ?? null,
  joiningDateBy: r.joining_date_by ?? null,
  offerStatus: (r.offer_status ?? "pending") as OfferStatus,
  offerStatusReason: r.offer_status_reason ?? null,
  offerDecidedAt: r.offer_decided_at ?? null,
  offerDecidedBy: r.offer_decided_by ?? null,
  employeeCode: r.employee_code ?? null,
  employeeCodeAt: r.employee_code_at ?? null,
  employeeCodeBy: r.employee_code_by ?? null,
  completedAt: r.completed_at ?? null,
  editedAt: r.edited_at ?? null,
  editedBy: r.edited_by ?? null,
  createdAt: r.created_at,
});

export const mapOnboardingCheck = (r: any): OnboardingCheck => ({
  id: r.id,
  onboardingId: r.onboarding_id,
  itemId: r.item_id ?? null,
  itemKey: r.item_key,
  name: r.name,
  description: r.description ?? null,
  requiresFile: r.requires_file,
  allowsLink: r.allows_link,
  dueDays: r.due_days ?? 0,
  sortOrder: r.sort_order ?? 0,
  done: r.done,
  doneAt: r.done_at ?? null,
  doneBy: r.done_by ?? null,
  filePath: r.file_path ?? null,
  fileName: r.file_name ?? null,
  linkUrl: r.link_url ?? null,
  pendingReason: r.pending_reason ?? null,
});

export const mapProbation = (r: any): Probation => ({
  id: r.id,
  onboardingId: r.onboarding_id,
  candidateId: r.candidate_id,
  requisitionId: r.requisition_id,
  joiningDate: r.joining_date,
  openedAt: r.opened_at,
  outcome: (r.outcome ?? null) as ProbationOutcome | null,
  outcomeAt: r.outcome_at ?? null,
  outcomeBy: r.outcome_by ?? null,
  outcomeRemarks: r.outcome_remarks ?? null,
  extensionMonths: r.extension_months ?? 1,
  extensionOutcome: (r.extension_outcome ?? null) as ProbationFinalStatus | null,
  extensionOutcomeAt: r.extension_outcome_at ?? null,
  extensionOutcomeBy: r.extension_outcome_by ?? null,
  extensionRemarks: r.extension_remarks ?? null,
  finalStatus: (r.final_status ?? null) as ProbationFinalStatus | null,
  finalStatusAt: r.final_status_at ?? null,
  permanentFrom: r.permanent_from ?? null,
  employeeCode: r.employee_code ?? null,
  editedAt: r.edited_at ?? null,
  editedBy: r.edited_by ?? null,
});

export const mapProbationReview = (r: any): ProbationReview => ({
  id: r.id,
  probationId: r.probation_id,
  month: r.month as 1 | 2 | 3 | 4,
  status: r.status as ProbationReviewStatus,
  remarks: r.remarks ?? null,
  filePath: r.file_path ?? null,
  fileName: r.file_name ?? null,
  reviewedAt: r.reviewed_at,
  reviewerId: r.reviewer_id ?? null,
  editedAt: r.edited_at ?? null,
  editedBy: r.edited_by ?? null,
});
