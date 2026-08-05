import { supabase } from "@/core/platform/supabase";
import type { Json } from "@/core/platform/database.types";
import type { HrEntityType, HrMasterType, SalaryPeriod, SalaryStructure } from "../types";

/**
 * HR Recruitment write layer.
 *
 * Config and masters are written directly under admin RLS (Setup is admin-only).
 * Every WORKFLOW mutation, by contrast, goes through a SECURITY DEFINER RPC that
 * re-checks authorization, validates the transition and stamps the step's
 * completion timestamp on a domain row — those land in Phases 3–7.
 */

/* ------------------------------- step owners ------------------------------ */

export interface StepOwnerInput {
  departmentIds: string[];
  designationId: string | null;
  employeeIds: string[];
}

/** Upsert the owners for a workflow step (admin-only under RLS). */
export async function setStepOwner(stepKey: string, input: StepOwnerInput): Promise<void> {
  const { error } = await supabase.from("fms_hr_step_owners").upsert(
    {
      step_key: stepKey,
      department_ids: input.departmentIds,
      designation_id: input.designationId,
      employee_ids: input.employeeIds,
    },
    { onConflict: "step_key" },
  );
  if (error) throw new Error(error.message);
}

/* --------------------------------- config --------------------------------- */

/** Upsert a singleton config key (admin-only under RLS). */
export async function setConfig(key: string, value: Record<string, unknown>): Promise<void> {
  const { error } = await supabase
    .from("fms_hr_config")
    .upsert({ key, value: value as unknown as Json }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

/* --------------------------------- masters -------------------------------- */

/** The name/active/sortOrder HR masters, all edited through the shared <MasterCrud>. */
export type HrMasterTable =
  | "fms_hr_job_platforms"
  | "fms_hr_job_types"
  | "fms_hr_locations"
  | "fms_hr_disqualification_reasons"
  | "fms_hr_job_titles"
  | "fms_hr_skills"
  | "fms_hr_qualifications";

export interface MasterInput {
  name: string;
  active: boolean;
  sortOrder: number;
  /**
   * Columns beyond the shared three, already in snake_case — a skill's
   * `category`, a job title's `department_id` and its whole JD template.
   *
   * An untyped bag rather than a union of per-table shapes: MasterCrud hands
   * back a flat `Record<string, string>` whatever the table, so a discriminated
   * type here would only be re-asserted at the one call site that builds it. The
   * DB is the real gate — a wrong key is a PostgREST error, not silent data loss.
   */
  extra?: Record<string, unknown>;
}

export async function insertMaster(table: HrMasterTable, input: MasterInput): Promise<string> {
  const { data, error } = await supabase
    .from(table)
    .insert({ name: input.name, active: input.active, sort_order: input.sortOrder, ...(input.extra ?? {}) })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function updateMaster(table: HrMasterTable, id: string, input: MasterInput): Promise<void> {
  const { error } = await supabase
    .from(table)
    .update({ name: input.name, active: input.active, sort_order: input.sortOrder, ...(input.extra ?? {}) })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/* ------------------------ onboarding checklist master --------------------- */

export interface OnboardingItemInput {
  key: string;
  name: string;
  description: string | null;
  requiresFile: boolean;
  allowsLink: boolean;
  dueDays: number;
  active: boolean;
  sortOrder: number;
}

export async function insertOnboardingItem(input: OnboardingItemInput): Promise<string> {
  const { data, error } = await supabase
    .from("fms_hr_onboarding_items")
    .insert({
      key: input.key,
      name: input.name,
      description: input.description,
      requires_file: input.requiresFile,
      allows_link: input.allowsLink,
      due_days: input.dueDays,
      active: input.active,
      sort_order: input.sortOrder,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function updateOnboardingItem(id: string, input: OnboardingItemInput): Promise<void> {
  const { error } = await supabase
    .from("fms_hr_onboarding_items")
    .update({
      key: input.key,
      name: input.name,
      description: input.description,
      requires_file: input.requiresFile,
      allows_link: input.allowsLink,
      due_days: input.dueDays,
      active: input.active,
      sort_order: input.sortOrder,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/* ================== master governance ===================================== */

/**
 * Replace the whole owner set for one master type. Delete-then-insert rather than
 * upsert, so removing an owner actually drops their row. Admin-only under RLS.
 */
export async function setMasterManagers(masterType: HrMasterType, userIds: string[]): Promise<void> {
  const { error: delError } = await supabase
    .from("fms_hr_master_managers")
    .delete()
    .eq("master_type", masterType);
  if (delError) throw new Error(delError.message);

  if (userIds.length === 0) return;
  const { error } = await supabase
    .from("fms_hr_master_managers")
    .insert(userIds.map((id) => ({ master_type: masterType, manager_user_id: id })));
  if (error) throw new Error(error.message);
}

/**
 * Raise a "Request new …" submission. RLS requires requested_by = auth.uid() and
 * status = 'pending'. Returns the new request id.
 */
export async function requestNewMaster(
  masterType: HrMasterType,
  payload: Record<string, unknown>,
  requestedBy: string
): Promise<string> {
  const { data, error } = await supabase
    .from("fms_hr_master_requests")
    .insert({
      master_type: masterType,
      proposed_payload: payload as unknown as Json,
      requested_by: requestedBy,
      status: "pending",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

/**
 * Resolve a master request via the SECURITY DEFINER RPC: approve (creating the
 * real master row from the payload — the approver's edits win) or reject.
 * Returns the new master id, or null on reject.
 */
export async function resolveMasterRequest(
  requestId: string,
  approve: boolean,
  payload: Record<string, unknown> | null,
  note: string | null
): Promise<string | null> {
  const { data, error } = await supabase.rpc("fms_hr_resolve_master_request", {
    p_request_id: requestId,
    p_approve: approve,
    p_payload: (payload ?? null) as unknown as Json,
    p_note: note ?? undefined,
  });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

/* ================== workflow RPCs — requisitions (Phase 3) ================= */

/**
 * The MRF payload. Every workflow mutation goes through a SECURITY DEFINER RPC
 * that re-checks authorization, validates the transition and stamps the step's
 * completion timestamp on the domain row — the client never writes these tables.
 */
export interface MrfInput {
  /** The title as text — always sent, even when jobTitleId is set (see mrfPayload). */
  jobTitle: string;
  jobTitleId: string | null;
  departmentId: string;
  locationId: string | null;
  /** Employment type. */
  jobTypeId: string | null;
  /** Defaults to the raiser server-side. Every HOD step routes back to these people. */
  hiringManagerIds: string[];
  reportingToIds: string[];
  reportingToNote: string | null;
  positionKind: "new" | "replacement";
  previousEmployeeName: string | null;
  expectedStartDate: string | null;
  positionsRequired: number;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryStructure: SalaryStructure;
  salaryPeriod: SalaryPeriod;
  incentiveNote: string | null;
  whyNeeded: string | null;
  /* ---- the structured job description ---- */
  roleSummary: string | null;
  keyResponsibilities: string | null;
  experienceMinYears: number | null;
  experienceMaxYears: number | null;
  freshersOk: boolean;
  qualificationIds: string[];
  skillIds: string[];
  preferredSkillIds: string[];
  skillsNote: string | null;
  /** Denormalised names of `skillIds` — see mrfPayload. */
  requiredSkills: string | null;
  jdPath: string | null;
  jdName: string | null;
}

/**
 * snake_case payload the RPC expects. `""` reads as NULL on the server side.
 *
 * ⚠ These keys are a verbatim wire contract with fms_hr_submit_mrf /
 * fms_hr_resubmit_mrf. A key added here without a matching column in those RPCs'
 * insert/update chains is silently dropped.
 *
 * THREE deliberate omissions, all of them fields the rebuilt form stopped asking:
 * `business_contribution`, `impact_if_unfilled` and `preferred_experience`. The
 * columns and the RPC arms still exist so requisitions raised before the rebuild
 * keep rendering them; omitting the keys means a resubmit of such a row clears
 * them, which is the honest outcome — the questions are gone.
 *
 * `salary_note` is sent empty for the same reason it always was: min/max are the
 * whole story, now qualified by salary_structure and salary_period.
 */
const mrfPayload = (i: MrfInput): Record<string, unknown> => ({
  // Both, always. job_title is what every list, export, kanban card and email
  // reads; job_title_id is what links back to the master and its JD template.
  job_title: i.jobTitle,
  job_title_id: i.jobTitleId ?? "",
  department_id: i.departmentId,
  location_id: i.locationId ?? "",
  job_type_id: i.jobTypeId ?? "",
  hiring_manager_ids: i.hiringManagerIds,
  reporting_to_ids: i.reportingToIds,
  reporting_to_note: i.reportingToNote ?? "",
  position_kind: i.positionKind,
  previous_employee_name: i.previousEmployeeName ?? "",
  expected_start_date: i.expectedStartDate ?? "",
  positions_required: i.positionsRequired,
  salary_min: i.salaryMin === null ? "" : String(i.salaryMin),
  salary_max: i.salaryMax === null ? "" : String(i.salaryMax),
  salary_note: "",
  salary_structure: i.salaryStructure,
  salary_period: i.salaryPeriod,
  incentive_note: i.incentiveNote ?? "",
  why_needed: i.whyNeeded ?? "",
  role_summary: i.roleSummary ?? "",
  key_responsibilities: i.keyResponsibilities ?? "",
  experience_min_years: i.experienceMinYears === null ? "" : String(i.experienceMinYears),
  experience_max_years: i.experienceMaxYears === null ? "" : String(i.experienceMaxYears),
  freshers_ok: i.freshersOk,
  qualification_ids: i.qualificationIds,
  skill_ids: i.skillIds,
  preferred_skill_ids: i.preferredSkillIds,
  skills_note: i.skillsNote ?? "",
  // A denormalised comma-joined rendering of skill_ids, so the pre-existing
  // text-only consumers (the detail Field, exports, any future email) still show
  // something readable without having to resolve ids.
  required_skills: i.requiredSkills ?? "",
  jd_path: i.jdPath ?? "",
  jd_name: i.jdName ?? "",
});

export async function submitMrf(input: MrfInput): Promise<string> {
  const { data, error } = await supabase.rpc("fms_hr_submit_mrf", {
    p: mrfPayload(input) as unknown as Json,
  });
  if (error) throw new Error(error.message);
  return data as unknown as string;
}

/**
 * Attach (or replace) the JD file on a requisition. Separate from submit because a
 * BRAND-NEW MRF has no id at upload time — the caller creates it, uploads to
 * jd/<id>/…, then records the path here.
 */
export async function setRequisitionJd(
  requisitionId: string,
  path: string | null,
  name: string | null,
): Promise<void> {
  const { error } = await supabase.rpc("fms_hr_set_requisition_jd", {
    p_req: requisitionId,
    p_path: path ?? "",
    p_name: name ?? "",
  });
  if (error) throw new Error(error.message);
}

/** Edit + resubmit a sent-back MRF. The approval clock restarts server-side. */
export async function resubmitMrf(requisitionId: string, input: MrfInput): Promise<void> {
  const { error } = await supabase.rpc("fms_hr_resubmit_mrf", {
    p_req: requisitionId,
    p: mrfPayload(input) as unknown as Json,
  });
  if (error) throw new Error(error.message);
}

export type MrfStage = "hr" | "mgmt";
export type MrfDecision = "approve" | "reject" | "send_back";

export async function decideMrf(
  requisitionId: string,
  stage: MrfStage,
  decision: MrfDecision,
  remarks: string,
): Promise<void> {
  const { error } = await supabase.rpc("fms_hr_decide_mrf", {
    p_req: requisitionId,
    p_stage: stage,
    p_decision: decision,
    p_remarks: remarks,
  });
  if (error) throw new Error(error.message);
}

/**
 * Correct a COMPLETED approval (its remark) or flip it to reject/send-back, while the
 * next gate has not acted. Editable window: HR approval → status 'mgmt_review';
 * Mgmt approval → status 'posting'. Server-enforced (fms_hr_update_decide_mrf).
 */
export async function updateDecideMrf(
  requisitionId: string,
  stage: MrfStage,
  decision: MrfDecision,
  remarks: string,
): Promise<void> {
  const { error } = await supabase.rpc("fms_hr_update_decide_mrf", {
    p_req: requisitionId,
    p_stage: stage,
    p_decision: decision,
    p_remarks: remarks,
  });
  if (error) throw new Error(error.message);
}

/**
 * Requires at least one platform. Stamps posted_at (the step) AND posted_on (the
 * date HR typed).
 *
 * `otherNote` names the platform when the "Others" row is among the ids. The RPC
 * insists on it in that case and stores it against the Others row only — it never
 * becomes a platform master, so the effectiveness report still reads "Others".
 */
export async function postJob(
  requisitionId: string,
  platformIds: string[],
  postedOn: string,
  otherNote: string | null,
): Promise<void> {
  const { error } = await supabase.rpc("fms_hr_post_job", {
    p_req: requisitionId,
    p_platform_ids: platformIds,
    p_posted_on: postedOn,
    p_other_note: otherNote ?? "",
  });
  if (error) throw new Error(error.message);
}

/** Correct the platforms / posting date while the job is posted but no candidate has landed yet. */
export async function updatePostJob(
  requisitionId: string,
  platformIds: string[],
  postedOn: string,
  otherNote: string | null,
): Promise<void> {
  const { error } = await supabase.rpc("fms_hr_update_post_job", {
    p_req: requisitionId,
    p_platform_ids: platformIds,
    p_posted_on: postedOn,
    p_other_note: otherNote ?? "",
  });
  if (error) throw new Error(error.message);
}

export async function holdRequisition(requisitionId: string, hold: boolean, reason: string): Promise<void> {
  const { error } = await supabase.rpc("fms_hr_hold_requisition", {
    p_req: requisitionId,
    p_hold: hold,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

export async function cancelRequisition(requisitionId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("fms_hr_cancel_requisition", {
    p_req: requisitionId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

/* =================== workflow RPCs — candidates (Phase 4) ================== */

/** One row of the bulk-upload review table. AI may prefill it; a human always confirms it. */
export interface CandidateInput {
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
  /** How the details got here — kept so extraction quality stays auditable. */
  parseStatus: "ok" | "failed" | "manual";
  parsedJson: Record<string, unknown>;
}

const candidatePayload = (c: CandidateInput): Record<string, unknown> => ({
  name: c.name,
  phone: c.phone ?? "",
  email: c.email ?? "",
  current_company: c.currentCompany ?? "",
  experience_years: c.experienceYears === null ? "" : String(c.experienceYears),
  skills: c.skills,
  notes: c.notes ?? "",
  source_platform_id: c.sourcePlatformId ?? "",
  resume_path: c.resumePath ?? "",
  resume_name: c.resumeName ?? "",
  parse_status: c.parseStatus,
  parsed_json: c.parsedJson,
});

/** Bulk. HR receives CVs in batches of 50, not one at a time. */
export async function addCandidates(requisitionId: string, candidates: CandidateInput[]): Promise<string[]> {
  const { data, error } = await supabase.rpc("fms_hr_add_candidates", {
    p_req: requisitionId,
    p_candidates: candidates.map(candidatePayload) as unknown as Json,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as string[];
}

export async function updateCandidate(id: string, input: CandidateInput): Promise<void> {
  const { error } = await supabase.rpc("fms_hr_update_candidate", {
    p_id: id,
    p: candidatePayload(input) as unknown as Json,
  });
  if (error) throw new Error(error.message);
}

/**
 * The board move. `payload` carries the fact that justifies it — which is why the
 * UI opens a modal on every drop rather than writing silently.
 */
export interface MovePayload {
  /** The whole interview panel. The RPC mirrors element 1 onto `interviewer_id`. */
  interviewerIds?: string[];
  interviewerName?: string | null;
  scheduledOn?: string | null;
  offeredCtc?: number | null;
  /**
   * Agreed joining date, captured at finalize. Optional — given, the RPC stamps it
   * on the new onboarding and seeds the checklist, so Onboarding opens ready to work
   * instead of asking for a date that was already agreed.
   */
  joiningDate?: string | null;
  disqualificationReasonId?: string | null;
  disqualificationNote?: string | null;
  /**
   * What became of an offer that fell through, captured when disqualifying someone
   * out of Made Offer. The RPC records it on the onboarding rather than deleting the
   * row — it is the only input the offer-acceptance rate has. Defaults to `declined`
   * server-side.
   */
  offerOutcome?: "declined" | "no_show";
  /** Free-text note captured when moving into Awaiting Decision / finalizing. */
  decisionRemarks?: string | null;
}

export async function moveCandidate(id: string, toStage: string, payload: MovePayload = {}): Promise<void> {
  const p: Record<string, unknown> = {};
  if (payload.interviewerIds !== undefined) p.interviewer_ids = payload.interviewerIds;
  if (payload.interviewerName !== undefined) p.interviewer_name = payload.interviewerName ?? "";
  if (payload.scheduledOn !== undefined) p.scheduled_on = payload.scheduledOn ?? "";
  if (payload.offeredCtc !== undefined) p.offered_ctc = payload.offeredCtc === null ? "" : String(payload.offeredCtc);
  if (payload.joiningDate !== undefined) p.joining_date = payload.joiningDate ?? "";
  if (payload.disqualificationReasonId !== undefined)
    p.disqualification_reason_id = payload.disqualificationReasonId ?? "";
  if (payload.disqualificationNote !== undefined) p.disqualification_note = payload.disqualificationNote ?? "";
  if (payload.offerOutcome !== undefined) p.offer_outcome = payload.offerOutcome;
  if (payload.decisionRemarks !== undefined) p.decision_remarks = payload.decisionRemarks ?? "";

  const { error } = await supabase.rpc("fms_hr_move_candidate", {
    p_id: id,
    p_to_stage: toStage,
    p: p as unknown as Json,
  });
  if (error) throw new Error(error.message);
}

/** Bulk — the sheet's own instruction is "share a minimum of 5–10 CVs with the HOD". */
export async function shareCandidatesWithHod(ids: string[]): Promise<void> {
  const { error } = await supabase.rpc("fms_hr_share_candidates_with_hod", { p_ids: ids });
  if (error) throw new Error(error.message);
}

/** Bulk — the HOD returns their picks (and drops the rest with a reason). */
export async function hodDecide(
  ids: string[],
  selected: boolean,
  reasonId: string | null = null,
  note = "",
): Promise<void> {
  const { error } = await supabase.rpc("fms_hr_hod_decide", {
    p_ids: ids,
    p_selected: selected,
    p_reason_id: reasonId ?? undefined,
    p_note: note,
  });
  if (error) throw new Error(error.message);
}

/**
 * Book (or re-book) the round the candidate is currently in.
 *
 * `interviewerIds` is the whole panel. The RPC mirrors element 1 onto the legacy
 * scalar `interviewer_id`, so a report reading that column gets the panel lead.
 */
export async function scheduleInterview(
  id: string,
  round: number,
  interviewerIds: string[],
  interviewerName: string | null,
  scheduledOn: string | null,
): Promise<void> {
  const { error } = await supabase.rpc("fms_hr_schedule_interview", {
    p_id: id,
    p_round: round,
    p_interviewer_ids: interviewerIds,
    p_interviewer_name: interviewerName ?? undefined,
    p_scheduled_on: scheduledOn ?? undefined,
  });
  if (error) throw new Error(error.message);
}

/**
 * Record the RESULT of a round (0 = telephonic, 1–3 = interviews) — this is what
 * closes it. `selected` advances the card to `nextStage` (any later interview round
 * still to come); left null the server picks the immediate next, and after the last
 * round leaves the card where it is. `rejected` sends the card to Disqualified.
 */
export async function recordInterviewResult(
  id: string,
  round: number,
  status: "selected" | "rejected" | "on_hold" | "no_show",
  remarks: string,
  docPath: string | null = null,
  docName: string | null = null,
  videoUrl: string | null = null,
  nextStage: string | null = null,
): Promise<void> {
  const { error } = await supabase.rpc("fms_hr_record_interview_result", {
    p_id: id,
    p_round: round,
    p_status: status,
    p_remarks: remarks,
    p_doc_path: docPath ?? undefined,
    p_doc_name: docName ?? undefined,
    p_video_url: videoUrl ?? undefined,
    p_next_stage: nextStage ?? undefined,
  });
  if (error) throw new Error(error.message);
}

/* =================== workflow RPCs — onboarding (Phase 6) ================== */

/**
 * Set the joining date. This is what UNLOCKS the checklist: the RPC seeds one check
 * per **active** master item, snapshotted, and every item's due date is measured
 * from this date. Changing the date later moves the due dates but never the items —
 * an onboarding in flight must not silently grow a box because Settings changed.
 */
export async function setOnboardingDate(onboardingId: string, joiningDate: string): Promise<void> {
  const { error } = await supabase.rpc("fms_hr_set_onboarding_date", {
    p_onb: onboardingId,
    p_date: joiningDate,
  });
  if (error) throw new Error(error.message);
}

export interface CheckInput {
  filePath?: string | null;
  fileName?: string | null;
  linkUrl?: string | null;
  /** Only meaningful when un-ticking: why the item is still outstanding. */
  pendingReason?: string | null;
}

/**
 * Tick / untick one checklist item. The date is stamped by the RPC — HR never types
 * it. An item flagged `requires_file` cannot be ticked without one, and the last
 * tick (with the offer accepted) completes the onboarding, marks the person joined
 * and may auto-close the requisition.
 */
export async function toggleOnboardingCheck(
  checkId: string,
  done: boolean,
  input: CheckInput = {},
): Promise<void> {
  const { error } = await supabase.rpc("fms_hr_toggle_onboarding_check", {
    p_check: checkId,
    p_done: done,
    p_file_path: input.filePath ?? undefined,
    p_file_name: input.fileName ?? undefined,
    p_link_url: input.linkUrl ?? undefined,
    p_pending_reason: input.pendingReason ?? undefined,
  });
  if (error) throw new Error(error.message);
}

/**
 * The answer to the offer.
 *
 * Making an offer is not the same as it being accepted, so an onboarding is born
 * `pending` and waits here. Accepting runs `fms_hr_try_complete_onboarding` inside
 * the RPC, so a checklist that was already finished completes the moment the answer
 * lands — the acceptance can arrive last without stranding the hire.
 *
 * `declined` / `no_show` are reachable from here too, but the board's move to
 * Disqualified is the usual route: it records the same outcome AND takes the card
 * off the pipeline, which a status change alone would not do.
 */
export async function setOfferStatus(
  onboardingId: string,
  status: "accepted" | "declined" | "no_show",
  reason = "",
): Promise<void> {
  const { error } = await supabase.rpc("fms_hr_set_offer_status", {
    p_onb: onboardingId,
    p_status: status,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

/** The Employee ID from the HR system. A value on the onboarding, not a checklist task. */
export async function setEmployeeCode(onboardingId: string, code: string): Promise<void> {
  const { error } = await supabase.rpc("fms_hr_set_employee_code", {
    p_onb: onboardingId,
    p_code: code,
  });
  if (error) throw new Error(error.message);
}

/* =================== workflow RPCs — probation (Phase 7) =================== */

/**
 * Record one monthly review. The RPC stamps `reviewed_at` and the reviewer — the HOD
 * never types a date — and enforces the sequence: no month 3 before month 2, and no
 * month 4 at all unless the three-month decision was "extend".
 *
 * `month` is 1–3, or 4 for the extended review.
 */
export async function recordProbationReview(
  probationId: string,
  month: number,
  status: "satisfactory" | "needs_improvement" | "unsatisfactory",
  remarks: string,
  filePath: string | null = null,
  fileName: string | null = null,
): Promise<void> {
  const { error } = await supabase.rpc("fms_hr_record_probation_review", {
    p_probation: probationId,
    p_month: month,
    p_status: status,
    p_remarks: remarks,
    p_file_path: filePath ?? undefined,
    p_file_name: fileName ?? undefined,
  });
  if (error) throw new Error(error.message);
}

export type ProbationDecision = "approve" | "reject" | "extend";

/**
 * The three-month decision. The RPC refuses it until the month-3 review exists.
 *
 * `approve` needs the date the person becomes permanent and their final employee ID.
 * `reject` needs a reason — and deliberately does NOT reopen the requisition: this
 * person joined and filled the seat, so replacing them is a new MRF.
 * `extend` buys one more month and opens the Month-4 review.
 */
export async function decideProbation(
  probationId: string,
  decision: ProbationDecision,
  remarks: string,
  permanentFrom: string | null = null,
  employeeCode: string | null = null,
): Promise<void> {
  const { error } = await supabase.rpc("fms_hr_decide_probation", {
    p_probation: probationId,
    p_decision: decision,
    p_remarks: remarks,
    p_permanent_from: permanentFrom ?? undefined,
    p_employee_code: employeeCode ?? undefined,
  });
  if (error) throw new Error(error.message);
}

/**
 * Correct the 3-month decision while it is still an 'extend' (approve/reject conclude
 * it in the same call → terminal). Editable until a month-4 review has been recorded.
 * `extend` edits the remark; `approve`/`reject` conclude it with the permanent details.
 */
export async function updateDecideProbation(
  probationId: string,
  decision: ProbationDecision,
  remarks: string,
  permanentFrom: string | null = null,
  employeeCode: string | null = null,
): Promise<void> {
  const { error } = await supabase.rpc("fms_hr_update_probation_decision", {
    p_probation: probationId,
    p_decision: decision,
    p_remarks: remarks,
    p_permanent_from: permanentFrom ?? undefined,
    p_employee_code: employeeCode ?? undefined,
  });
  if (error) throw new Error(error.message);
}

/** Close an EXTENDED probation, once the month-4 review is in. No second extension. */
export async function decideExtension(
  probationId: string,
  decision: "approve" | "reject",
  remarks: string,
  permanentFrom: string | null = null,
  employeeCode: string | null = null,
): Promise<void> {
  const { error } = await supabase.rpc("fms_hr_decide_extension", {
    p_probation: probationId,
    p_decision: decision,
    p_remarks: remarks,
    p_permanent_from: permanentFrom ?? undefined,
    p_employee_code: employeeCode ?? undefined,
  });
  if (error) throw new Error(error.message);
}

/* --------------------------- activity + bell feed ------------------------- */

/**
 * Write an activity row + fan a notification out to recipients.
 *
 * Best-effort by design: the caller wraps it so a failed announce can never undo
 * a workflow action. It is therefore NEVER the source of truth for state — every
 * step stamps its own timestamp column inside its RPC.
 */
export async function announce(input: {
  entityType: HrEntityType;
  entityId: string;
  type: string;
  text: string;
  recipients?: string[];
  meta?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabase.rpc("fms_hr_announce", {
    p_entity_type: input.entityType,
    p_entity_id: input.entityId,
    p_type: input.type,
    p_text: input.text,
    p_user_ids: input.recipients ?? [],
    p_meta: (input.meta ?? {}) as unknown as Json,
  });
  if (error) throw new Error(error.message);
}

export async function markNotificationsRead(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase
    .from("fms_hr_notifications")
    .update({ read_at: new Date().toISOString() })
    .in("id", ids)
    .is("read_at", null);
  if (error) throw new Error(error.message);
}

/* --------------------------------- storage -------------------------------- */

/** Private bucket. SELECT is restricted to HR step owners / coordinators — resumes are PII. */
const BUCKET = "fms-hr-docs";

const safeName = (name: string) => name.replace(/[^\w.\-]+/g, "_");

async function upload(path: string, file: File): Promise<{ path: string; name: string }> {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || undefined });
  if (error) throw new Error(error.message);
  return { path, name: file.name };
}

/** A 10-minute signed URL. Nothing in this bucket is ever public. */
export async function hrDocUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 10);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export const uploadResume = (requisitionId: string, file: File) =>
  upload(`resumes/${requisitionId}/${Date.now()}-${safeName(file.name)}`, file);

export const uploadJd = (requisitionId: string, file: File) =>
  upload(`jd/${requisitionId}/${Date.now()}-${safeName(file.name)}`, file);

export const uploadOnboardingDoc = (onboardingId: string, itemKey: string, file: File) =>
  upload(`onboarding/${onboardingId}/${itemKey}/${Date.now()}-${safeName(file.name)}`, file);

export const uploadProbationDoc = (probationId: string, month: number, file: File) =>
  upload(`probation/${probationId}/m${month}/${Date.now()}-${safeName(file.name)}`, file);

export const uploadInterviewDoc = (candidateId: string, round: number, file: File) =>
  upload(`interviews/${candidateId}/r${round}/${Date.now()}-${safeName(file.name)}`, file);
