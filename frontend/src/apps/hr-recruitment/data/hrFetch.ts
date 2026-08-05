import { supabase } from "@/core/platform/supabase";
import { resolveStepSla, type StepSlaMap } from "../lib/sla";
import type {
  Designation,
  DisqualificationReason,
  HrActivity,
  HrLocation,
  HrNotification,
  HrEntityType,
  HrMasterManager,
  HrMasterRequest,
  HrSkill,
  JobPlatform,
  JobTitle,
  JobType,
  OnboardingItem,
  Qualification,
  SalaryPeriod,
  SalaryStructure,
  SkillCategory,
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
  StepOwner,
} from "../types";

/**
 * HR Recruitment read layer. One paginated pass over the tables the module needs,
 * mapped snake_case → camelCase. Mirrors procurement's `fetchProcurementData`.
 *
 * The module loads in one snapshot so the pure queue rules in lib/queues.ts can be
 * handed plain data (and so the Control Center adapter can reuse this exact
 * react-query cache entry rather than issuing a second copy of the reads).
 *
 * ── What is bounded, and why ────────────────────────────────────────────────────
 * Requisitions, onboardings and probations are bounded by *vacancies and hires* —
 * tens per year — so they load in full, for all time. That is deliberate and it is
 * what makes the dashboard possible: time-to-hire, offer-acceptance and probation
 * outcomes all live on CLOSED requisitions, so filtering those out (the original
 * day-one instinct) would have deleted the reports before they were written.
 *
 * CANDIDATES are the one entity that grows without bound — hundreds of CVs per
 * vacancy, kept forever. So the candidate read is the one that is bounded, by three
 * clauses whose union is exactly what the app can actually use:
 *
 *   A. every CV uploaded inside the reporting window (CANDIDATE_WINDOW_MONTHS)
 *      — the set the leak-funnel and platform report are computed over;
 *   B. every CV on a requisition that can still move (not closed / cancelled /
 *      rejected) — so an old, still-open vacancy never loses its board;
 *   C. every FINALIZED candidate, for all time — one row per hire, so seat counts,
 *      and the names on onboarding / probation rows, resolve however old the hire.
 *
 * The cost: open a requisition that closed longer ago than the window and you see
 * its hires but not the CVs it rejected. `candidateWindowStartIso` is exported so
 * the board can say so out loud rather than showing a silent zero.
 */

const PAGE = 1000;

/**
 * How far back CVs are loaded. Long enough that recruitment for any live vacancy is
 * comfortably inside it, short enough that the snapshot cannot grow forever.
 */
export const CANDIDATE_WINDOW_MONTHS = 24;

/** Start of the CV window: the first day of the month N months back, local time. */
export function candidateWindowStartIso(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth() - CANDIDATE_WINDOW_MONTHS, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

/** A requisition that can still move — so its board must load in full. */
const canStillMove = (status: string): boolean =>
  status !== "closed" && status !== "cancelled" && status !== "rejected";

/** PostgREST puts `.in()` lists in the URL, so long id lists go in chunks. */
const CHUNK = 80;

type Tbl =
  | "fms_hr_step_owners"
  | "fms_hr_config"
  | "fms_hr_job_platforms"
  | "fms_hr_job_types"
  | "fms_hr_locations"
  | "fms_hr_disqualification_reasons"
  | "fms_hr_onboarding_items"
  | "fms_hr_requisitions"
  | "fms_hr_requisition_platforms"
  | "fms_hr_candidates"
  | "fms_hr_interviews"
  | "fms_hr_onboardings"
  | "fms_hr_onboarding_checks"
  | "fms_hr_probations"
  | "fms_hr_probation_reviews"
  | "fms_hr_activity"
  | "fms_hr_notifications"
  | "fms_hr_master_managers"
  | "fms_hr_master_requests"
  | "fms_hr_job_titles"
  | "fms_hr_skills"
  | "fms_hr_qualifications"
  | "designations";

/** Narrow a candidate read. `q` is the PostgREST builder mid-chain. */
type Narrow = (q: any) => any;

async function fetchAll(table: Tbl, orderBy = "created_at", narrow?: Narrow): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += PAGE) {
    let q: any = supabase.from(table).select("*");
    if (narrow) q = narrow(q);
    const { data, error } = await q.order(orderBy, { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * The candidate read — the union of the three clauses documented at the top of this
 * file, deduplicated by id. Three narrow reads beat one wide one: each clause is an
 * indexed predicate, and together they are the only candidates any screen can use.
 */
async function fetchCandidatesInScope(liveRequisitionIds: string[]): Promise<any[]> {
  const windowStart = `${candidateWindowStartIso()}T00:00:00Z`;

  const chunks: string[][] = [];
  for (let i = 0; i < liveRequisitionIds.length; i += CHUNK) {
    chunks.push(liveRequisitionIds.slice(i, i + CHUNK));
  }

  const batches = await Promise.all([
    fetchAll("fms_hr_candidates", "created_at", (q) => q.gte("uploaded_at", windowStart)), // A
    ...chunks.map((ids) => fetchAll("fms_hr_candidates", "created_at", (q) => q.in("requisition_id", ids))), // B
    // C — every hire ever, whatever the window. BOTH terminal hire stages: an
    // offered candidate who is later marked `hired` must not fall out of the read,
    // or their onboarding and probation rows lose the person's name.
    fetchAll("fms_hr_candidates", "created_at", (q) => q.in("stage", ["finalized", "hired"])),
  ]);

  const byId = new Map<string, any>();
  for (const batch of batches) for (const row of batch) byId.set(row.id, row);
  return [...byId.values()];
}

export interface HrConfig {
  processCoordinatorIds: string[];
  /** Per-step due-date rules (anchor + days), merged over the code defaults. */
  stepSla: StepSlaMap;
  /** The sheet's "share a minimum of 5–10 CVs with the HOD" rule. */
  minCvsToShare: number;
  /**
   * Who may see the OFFERED salary (not the requisition range, which stays public).
   * Admins and the person who finalizes always see it; this widens the audience to
   * whole departments and named people. UI-level only — see store.canViewSalary.
   */
  salaryViewers: { departmentIds: string[]; personIds: string[] };
}

/**
 * The react-query key. Exported so consumers outside this app (the FMS Control
 * Center's HR adapter) share the same cache entry. Keyed on the REAL session user
 * id — never the impersonated persona — so switching persona never refetches.
 */
export const HR_QK = ["hrRecruitmentData"] as const;
export const hrQueryKey = (userId: string | null) => [...HR_QK, userId] as const;

export interface HrData {
  stepOwners: StepOwner[];
  designations: Designation[];
  config: HrConfig;
  jobPlatforms: JobPlatform[];
  jobTypes: JobType[];
  locations: HrLocation[];
  disqualificationReasons: DisqualificationReason[];
  onboardingItems: OnboardingItem[];
  /** The JD masters — see types/index.ts. `jobTitles` is HR's own list, not `designations`. */
  jobTitles: JobTitle[];
  skills: HrSkill[];
  qualifications: Qualification[];
  requisitions: Requisition[];
  requisitionPlatforms: RequisitionPlatform[];
  candidates: Candidate[];
  interviews: Interview[];
  onboardings: Onboarding[];
  onboardingChecks: OnboardingCheck[];
  probations: Probation[];
  probationReviews: ProbationReview[];
  activity: HrActivity[];
  notifications: HrNotification[];
  masterManagers: HrMasterManager[];
  masterRequests: HrMasterRequest[];
}

const num = (v: any): number | null => (v === null || v === undefined ? null : Number(v));

const mapRequisition = (r: any): Requisition => ({
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
  cancelReason: r.cancel_reason ?? null,
  closedAt: r.closed_at ?? null,
  editedAt: r.edited_at ?? null,
  editedBy: r.edited_by ?? null,
  createdAt: r.created_at,
});

const mapRequisitionPlatform = (r: any): RequisitionPlatform => ({
  requisitionId: r.requisition_id,
  platformId: r.platform_id,
  postedOn: r.posted_on ?? null,
  otherNote: r.other_note ?? null,
});

const mapCandidate = (r: any): Candidate => ({
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
  sourcePlatformId: r.source_platform_id ?? null,
  resumePath: r.resume_path ?? null,
  resumeName: r.resume_name ?? null,
  parseStatus: (r.parse_status ?? "manual") as ParseStatus,
  parsedJson: (r.parsed_json ?? {}) as Record<string, unknown>,
  stage: r.stage as CandidateStage,
  uploadedAt: r.uploaded_at,
  hrShortlistedAt: r.hr_shortlisted_at ?? null,
  hrShortlistedBy: r.hr_shortlisted_by ?? null,
  sharedToHodAt: r.shared_to_hod_at ?? null,
  sharedToHodBy: r.shared_to_hod_by ?? null,
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

const mapInterview = (r: any): Interview => ({
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

const mapOnboarding = (r: any): Onboarding => ({
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

const mapOnboardingCheck = (r: any): OnboardingCheck => ({
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

const mapProbation = (r: any): Probation => ({
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

const mapProbationReview = (r: any): ProbationReview => ({
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

const mapMaster = (r: any) => ({
  id: r.id,
  name: r.name,
  active: r.active,
  sortOrder: r.sort_order ?? 0,
  createdAt: r.created_at,
});

/** The one master with a column of its own: `is_other` flags the catch-all row. */
const mapJobPlatform = (r: any): JobPlatform => ({
  ...mapMaster(r),
  isOther: r.is_other ?? false,
});

const mapOnboardingItem = (r: any): OnboardingItem => ({
  id: r.id,
  key: r.key,
  name: r.name,
  description: r.description ?? null,
  requiresFile: r.requires_file,
  allowsLink: r.allows_link,
  dueDays: r.due_days ?? 0,
  active: r.active,
  sortOrder: r.sort_order ?? 0,
});

const mapMasterManager = (r: any): HrMasterManager => ({
  id: r.id,
  masterType: r.master_type,
  managerUserId: r.manager_user_id,
});

const mapMasterRequest = (r: any): HrMasterRequest => ({
  id: r.id,
  masterType: r.master_type,
  proposedPayload: (r.proposed_payload ?? {}) as Record<string, unknown>,
  status: r.status,
  requestedBy: r.requested_by ?? null,
  reviewedBy: r.reviewed_by ?? null,
  reviewNote: r.review_note ?? null,
  resolvedMasterId: r.resolved_master_id ?? null,
  createdAt: r.created_at,
});

const mapStepOwner = (r: any): StepOwner => ({
  id: r.id,
  stepKey: r.step_key,
  departmentIds: (r.department_ids ?? []) as string[],
  designationId: r.designation_id ?? null,
  employeeIds: (r.employee_ids ?? []) as string[],
});

const mapDesignation = (r: any): Designation => ({ id: r.id, name: r.name, active: r.active });

/** The job title master + its optional JD template. Not the same as a Designation. */
const mapJobTitle = (r: any): JobTitle => ({
  id: r.id,
  name: r.name,
  active: r.active,
  sortOrder: r.sort_order ?? 0,
  createdAt: r.created_at,
  departmentId: r.department_id ?? null,
  defaultJobTypeId: r.default_job_type_id ?? null,
  defaultRoleSummary: r.default_role_summary ?? null,
  defaultResponsibilities: r.default_responsibilities ?? null,
  defaultExperienceMinYears: num(r.default_experience_min_years),
  defaultExperienceMaxYears: num(r.default_experience_max_years),
  defaultQualificationIds: (r.default_qualification_ids ?? []) as string[],
  defaultSkillIds: (r.default_skill_ids ?? []) as string[],
  defaultPreferredSkillIds: (r.default_preferred_skill_ids ?? []) as string[],
});

const mapSkill = (r: any): HrSkill => ({
  id: r.id,
  name: r.name,
  active: r.active,
  sortOrder: r.sort_order ?? 0,
  createdAt: r.created_at,
  category: (r.category ?? "technical") as SkillCategory,
});

const mapActivity = (r: any): HrActivity => ({
  id: r.id,
  entityType: r.entity_type as HrEntityType,
  entityId: r.entity_id,
  type: r.type,
  actorId: r.actor_id ?? null,
  note: r.note ?? null,
  meta: (r.meta ?? {}) as Record<string, unknown>,
  createdAt: r.created_at,
});

const mapNotification = (r: any): HrNotification => ({
  id: r.id,
  userId: r.user_id,
  type: r.type,
  entityType: r.entity_type as HrEntityType,
  entityId: r.entity_id,
  text: r.text,
  actorId: r.actor_id ?? null,
  readAt: r.read_at ?? null,
  createdAt: r.created_at,
});

export async function fetchHrData(): Promise<HrData> {
  // Requisitions first, and in full: they are bounded by vacancies, the Requisitions
  // list must show the closed ones, and clause B of the candidate read needs to know
  // which vacancies can still move.
  const requisitions = await fetchAll("fms_hr_requisitions");
  const liveRequisitionIds = requisitions.filter((r) => canStillMove(r.status)).map((r) => r.id as string);

  const [
    stepOwners,
    configRows,
    designations,
    jobPlatforms,
    jobTypes,
    locations,
    disqualificationReasons,
    onboardingItems,
    jobTitles,
    skills,
    qualifications,
    requisitionPlatforms,
    candidates,
    interviews,
    onboardings,
    onboardingChecks,
    probations,
    probationReviews,
    activity,
    notifications,
    masterManagers,
    masterRequests,
  ] = await Promise.all([
    fetchAll("fms_hr_step_owners"),
    fetchAll("fms_hr_config", "key"),
    fetchAll("designations"),
    fetchAll("fms_hr_job_platforms"),
    fetchAll("fms_hr_job_types"),
    fetchAll("fms_hr_locations"),
    fetchAll("fms_hr_disqualification_reasons"),
    fetchAll("fms_hr_onboarding_items"),
    // The JD masters. `sort_order` is the display order HR sets, so read in it —
    // the skills list runs to ~113 rows and created_at order would be noise.
    fetchAll("fms_hr_job_titles", "sort_order"),
    fetchAll("fms_hr_skills", "sort_order"),
    fetchAll("fms_hr_qualifications", "sort_order"),
    fetchAll("fms_hr_requisition_platforms", "requisition_id"),
    fetchCandidatesInScope(liveRequisitionIds),
    // Interviews exist only for candidates who actually reached a round, so they are
    // already scarce — no window needed, and none imposed.
    fetchAll("fms_hr_interviews"),
    fetchAll("fms_hr_onboardings"),
    fetchAll("fms_hr_onboarding_checks"),
    fetchAll("fms_hr_probations"),
    fetchAll("fms_hr_probation_reviews"),
    fetchAll("fms_hr_activity"),
    fetchAll("fms_hr_notifications"),
    fetchAll("fms_hr_master_managers"),
    fetchAll("fms_hr_master_requests"),
  ]);

  const byKey = new Map<string, any>(configRows.map((r) => [r.key, r.value ?? {}]));
  const config: HrConfig = {
    processCoordinatorIds: (byKey.get("process_coordinators")?.user_ids ?? []) as string[],
    // Unset or partially-stored rules fall back to the code defaults.
    stepSla: resolveStepSla(byKey.get("step_sla")),
    minCvsToShare: Number(byKey.get("min_cvs_to_share")?.value ?? 5),
    salaryViewers: {
      departmentIds: (byKey.get("salary_viewers")?.department_ids ?? []) as string[],
      personIds: (byKey.get("salary_viewers")?.person_ids ?? []) as string[],
    },
  };

  return {
    stepOwners: stepOwners.map(mapStepOwner),
    designations: designations.map(mapDesignation),
    config,
    jobPlatforms: jobPlatforms.map(mapJobPlatform),
    jobTypes: jobTypes.map(mapMaster),
    locations: locations.map(mapMaster),
    disqualificationReasons: disqualificationReasons.map(mapMaster),
    onboardingItems: onboardingItems.map(mapOnboardingItem),
    jobTitles: jobTitles.map(mapJobTitle),
    skills: skills.map(mapSkill),
    qualifications: qualifications.map(mapMaster),
    requisitions: requisitions.map(mapRequisition),
    requisitionPlatforms: requisitionPlatforms.map(mapRequisitionPlatform),
    candidates: candidates.map(mapCandidate),
    interviews: interviews.map(mapInterview),
    onboardings: onboardings.map(mapOnboarding),
    onboardingChecks: onboardingChecks.map(mapOnboardingCheck),
    probations: probations.map(mapProbation),
    probationReviews: probationReviews.map(mapProbationReview),
    activity: activity.map(mapActivity),
    notifications: notifications.map(mapNotification),
    masterManagers: masterManagers.map(mapMasterManager),
    masterRequests: masterRequests.map(mapMasterRequest),
  };
}
