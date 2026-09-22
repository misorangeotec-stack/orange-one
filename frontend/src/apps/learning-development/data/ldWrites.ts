import { supabase } from "@/core/platform/supabase";
import type { Database, Json } from "@/core/platform/database.types";
import type { ApprovalRule } from "../types";

/**
 * Only the RPCs `database.types.ts` knows about. Typing the helper against the
 * generated union means a typo in a function name fails the build rather than at
 * runtime — which matters here, because every workflow move is an RPC call.
 */
type RpcName = keyof Database["public"]["Functions"];

/**
 * Learning & Development write layer.
 *
 * ⚠ EVERY WORKFLOW WRITE GOES THROUGH AN RPC, never through a PostgREST
 *   insert/update on the table. The tables' own RLS write policies are
 *   admin-only precisely so a mistyped patch from the browser cannot move a
 *   request sideways past its own rules — the status machine, the "a reason is
 *   required" checks and the authorization all live in `fms_ld_*` functions and
 *   are re-checked server-side on every call.
 *
 * The exceptions below are honest ones: the Setup tables and the masters are
 * plain rows with no state machine, and their policies already say who may
 * write them.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
const rpc = async (fn: RpcName, args: Record<string, unknown>): Promise<any> => {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw new Error(error.message);
  return data;
};

/* ------------------------------------------------------------------ steps 1–8 */

export interface NewRequestInput {
  title: string;
  needSourceId?: string | null;
  departmentId?: string | null;
  skillGap?: string | null;
  objective?: string | null;
  targetGroup?: string | null;
  requiredBy?: string | null;
  priority?: string | null;
  attachmentPath?: string | null;
  /** false keeps it a draft with no Training Request ID yet. */
  submit: boolean;
}

export const createRequest = (input: NewRequestInput): Promise<string> =>
  rpc("fms_ld_create_request", {
    p_payload: {
      title: input.title,
      need_source_id: input.needSourceId ?? null,
      department_id: input.departmentId ?? null,
      skill_gap: input.skillGap ?? null,
      objective: input.objective ?? null,
      target_group: input.targetGroup ?? null,
      required_by: input.requiredBy ?? null,
      priority: input.priority ?? null,
      attachment_path: input.attachmentPath ?? null,
      submit: input.submit,
    },
  });

export interface ValidationInput {
  competencyId?: string | null;
  isMandatory?: boolean;
  duplicateChecked?: boolean;
  businessJustification?: string | null;
  expectedOutcome?: string | null;
}

export const validateRequest = (
  requestId: string,
  approve: boolean,
  input: ValidationInput,
  note: string | null,
): Promise<void> =>
  rpc("fms_ld_validate_request", {
    p_request_id: requestId,
    p_approve: approve,
    p_payload: {
      competency_id: input.competencyId ?? null,
      is_mandatory: input.isMandatory ?? false,
      duplicate_checked: input.duplicateChecked ?? false,
      business_justification: input.businessJustification ?? null,
      expected_outcome: input.expectedOutcome ?? null,
    },
    p_note: note,
  });

export interface ProposalInput {
  priority: string;
  sessionTypeIds: string[];
  deliveryMode?: string | null;
  proposedTrainerType?: string | null;
  proposedCost?: number | null;
  proposedMonth?: string | null;
  proposalPath?: string | null;
}

export const submitProposal = (requestId: string, input: ProposalInput): Promise<void> =>
  rpc("fms_ld_submit_proposal", {
    p_request_id: requestId,
    p_payload: {
      priority: input.priority,
      session_type_ids: input.sessionTypeIds,
      delivery_mode: input.deliveryMode ?? null,
      proposed_trainer_type: input.proposedTrainerType ?? null,
      proposed_cost: input.proposedCost ?? null,
      proposed_month: input.proposedMonth ?? null,
      proposal_path: input.proposalPath ?? null,
    },
  });

/**
 * One call for both gates and all three decisions.
 *
 * ⚠ The caller never decides whether Management is needed — the server reads
 *   `mgmt_required`, frozen on the row at proposal time, and either stops at
 *   `hr_approved` or goes straight to `approved` while RECORDING that the gate
 *   did not apply. Do not try to route around it from here.
 */
export const decideApproval = (
  requestId: string,
  stage: "hr_head" | "management",
  decision: "approve" | "reject" | "return",
  approvedBudget: number | null,
  note: string | null,
): Promise<void> =>
  rpc("fms_ld_approve_request", {
    p_request_id: requestId,
    p_stage: stage,
    p_decision: decision,
    p_payload: { approved_budget: approvedBudget },
    p_note: note,
  });

export const finaliseTrainer = (
  requestId: string,
  input: { trainerId: string; trainerTerms?: string | null; quotationPath?: string | null },
): Promise<void> =>
  rpc("fms_ld_finalise_trainer", {
    p_request_id: requestId,
    p_payload: {
      trainer_id: input.trainerId,
      trainer_terms: input.trainerTerms ?? null,
      quotation_path: input.quotationPath ?? null,
    },
  });

export interface NewSessionInput {
  requestId?: string | null;
  planLineId?: string | null;
  title: string;
  sessionTypeIds: string[];
  deliveryMode?: string | null;
  trainerId?: string | null;
  sessionDate: string;
  startTime?: string | null;
  endTime?: string | null;
  hours?: number | null;
  venueId?: string | null;
  meetingLink?: string | null;
  capacity?: number | null;
  registrationCutoff?: string | null;
}

export const createSession = (input: NewSessionInput): Promise<string> =>
  rpc("fms_ld_create_session", {
    p_payload: {
      request_id: input.requestId ?? null,
      plan_line_id: input.planLineId ?? null,
      title: input.title,
      session_type_ids: input.sessionTypeIds,
      delivery_mode: input.deliveryMode ?? null,
      trainer_id: input.trainerId ?? null,
      session_date: input.sessionDate,
      start_time: input.startTime ?? null,
      end_time: input.endTime ?? null,
      hours: input.hours ?? null,
      venue_id: input.venueId ?? null,
      meeting_link: input.meetingLink ?? null,
      capacity: input.capacity ?? null,
      registration_cutoff: input.registrationCutoff ?? null,
    },
  });

/** `toUser = null` hands the step back to its usual owners. */
export const reassignStep = (
  requestId: string,
  stepKey: string,
  toUser: string | null,
  note: string | null,
): Promise<void> =>
  rpc("fms_ld_reassign_step", {
    p_request_id: requestId,
    p_step_key: stepKey,
    p_to_user: toUser,
    p_note: note,
  });

/* ------------------------------------------------------------------- setup */

export const setStepOwner = async (
  stepKey: string,
  departmentIds: string[],
  employeeIds: string[],
): Promise<void> => {
  const { error } = await supabase
    .from("fms_ld_step_owners")
    .upsert(
      { step_key: stepKey, department_ids: departmentIds, employee_ids: employeeIds },
      { onConflict: "step_key" },
    );
  if (error) throw new Error(error.message);
};

export const setConfig = async (key: string, value: Json): Promise<void> => {
  const { error } = await supabase
    .from("fms_ld_config")
    .upsert({ key, value }, { onConflict: "key" });
  if (error) throw new Error(error.message);
};

export const setApprovalRule = (rule: ApprovalRule): Promise<void> =>
  setConfig("approval_rule", { mgmt: rule.mgmt, above_amount: rule.aboveAmount } as Json);

export const setCoordinators = (userIds: string[]): Promise<void> =>
  setConfig("process_coordinators", { user_ids: userIds } as Json);

export const setMasterManagers = async (masterType: string, userIds: string[]): Promise<void> => {
  const { error: delErr } = await supabase
    .from("fms_ld_master_managers")
    .delete()
    .eq("master_type", masterType);
  if (delErr) throw new Error(delErr.message);
  if (userIds.length === 0) return;
  const { error } = await supabase
    .from("fms_ld_master_managers")
    .insert(userIds.map((id) => ({ master_type: masterType, manager_user_id: id })));
  if (error) throw new Error(error.message);
};

export const markNotificationsRead = async (ids: string[]): Promise<void> => {
  if (ids.length === 0) return;
  const { error } = await supabase
    .from("fms_ld_notifications")
    .update({ read_at: new Date().toISOString() })
    .in("id", ids);
  if (error) throw new Error(error.message);
};

/* -------------------------------------------- steps 9–22: the session side */

export const nominate = (
  sessionId: string,
  employeeIds: string[],
  source: "hod" | "hr" | "self" = "hr",
): Promise<number> =>
  rpc("fms_ld_nominate", {
    p_session_id: sessionId,
    p_employee_ids: employeeIds,
    p_source: source,
  });

export const decideNomination = (
  nominationId: string,
  approve: boolean,
  reason: string | null,
): Promise<void> =>
  rpc("fms_ld_decide_nomination", {
    p_nomination_id: nominationId,
    p_approve: approve,
    p_reason: reason,
  });

export const sendInvitations = (sessionId: string): Promise<number> =>
  rpc("fms_ld_send_invitations", { p_session_id: sessionId });

/**
 * ⚠ THE NOMINEE ANSWERS FOR THEMSELVES. The RPC takes no employee id — it reads
 *   `auth.uid()` — because an RSVP entered by somebody else is not an RSVP.
 */
export const rsvp = (sessionId: string, accept: boolean, reason: string | null): Promise<void> =>
  rpc("fms_ld_rsvp", { p_session_id: sessionId, p_accept: accept, p_reason: reason });

export const addMaterial = (
  sessionId: string,
  input: { title: string; kind?: string; filePath?: string | null; linkUrl?: string | null; note?: string | null },
): Promise<string> =>
  rpc("fms_ld_add_material", {
    p_session_id: sessionId,
    p_payload: {
      title: input.title,
      kind: input.kind ?? "other",
      file_path: input.filePath ?? null,
      link_url: input.linkUrl ?? null,
      note: input.note ?? null,
    },
  });

export const deleteMaterial = (materialId: string): Promise<void> =>
  rpc("fms_ld_delete_material", { p_material_id: materialId });

export const confirmReadiness = (sessionId: string): Promise<void> =>
  rpc("fms_ld_confirm_readiness", { p_session_id: sessionId });

export const recordConduct = (
  sessionId: string,
  input: {
    outcome: string;
    actualStart?: string | null;
    actualEnd?: string | null;
    trainerAttended?: boolean | null;
    changeReason?: string | null;
  },
): Promise<void> =>
  rpc("fms_ld_record_conduct", {
    p_session_id: sessionId,
    p_payload: {
      outcome: input.outcome,
      actual_start: input.actualStart ?? null,
      actual_end: input.actualEnd ?? null,
      trainer_attended: input.trainerAttended ?? null,
      change_reason: input.changeReason ?? null,
    },
  });

export interface AttendanceRow {
  employeeId: string;
  status: string;
  minutes?: number | null;
  reason?: string | null;
}

export const markAttendance = (sessionId: string, rows: AttendanceRow[]): Promise<number> =>
  rpc("fms_ld_mark_attendance", {
    p_session_id: sessionId,
    p_rows: rows.map((r) => ({
      employee_id: r.employeeId,
      status: r.status,
      minutes: r.minutes ?? null,
      reason: r.reason ?? null,
    })),
  });

export const followUpAbsentee = (attendanceId: string): Promise<void> =>
  rpc("fms_ld_follow_up_absentee", { p_attendance_id: attendanceId });

/**
 * Closes attendance AND creates the 30-day HOD reviews in one call.
 *
 * Returns `{ hod_tasks, no_reviewer }` — `no_reviewer` is how many attendees
 * resolved to no HOD at all. ⚠ SHOW IT. Treating it as zero would report a
 * control that does not exist.
 */
export const closeAttendance = (
  sessionId: string,
): Promise<{ hod_tasks: number; no_reviewer: number }> =>
  rpc("fms_ld_close_attendance", { p_session_id: sessionId });

export const issueAssignment = (
  sessionId: string,
  input: { title: string; brief?: string | null; dueAt?: string | null; filePath?: string | null },
): Promise<string> =>
  rpc("fms_ld_issue_assignment", {
    p_session_id: sessionId,
    p_payload: {
      title: input.title,
      brief: input.brief ?? null,
      due_at: input.dueAt ?? null,
      file_path: input.filePath ?? null,
    },
  });

export const submitAssignment = (
  assignmentId: string,
  input: { note?: string | null; filePath?: string | null },
): Promise<void> =>
  rpc("fms_ld_submit_assignment", {
    p_assignment_id: assignmentId,
    p_payload: { note: input.note ?? null, file_path: input.filePath ?? null },
  });

export const reviewSubmission = (
  submissionId: string,
  outcome: "accepted" | "needs_rework",
  remarks: string | null,
): Promise<void> =>
  rpc("fms_ld_review_submission", {
    p_submission_id: submissionId,
    p_outcome: outcome,
    p_remarks: remarks,
  });

export const escalateSubmission = (submissionId: string): Promise<void> =>
  rpc("fms_ld_escalate_submission", { p_submission_id: submissionId });

export const submitFeedback = (
  sessionId: string,
  input: {
    overallRating: number;
    contentRating?: number | null;
    trainerRating?: number | null;
    relevanceRating?: number | null;
    comment?: string | null;
  },
): Promise<void> =>
  rpc("fms_ld_submit_feedback", {
    p_session_id: sessionId,
    p_payload: {
      overall_rating: input.overallRating,
      content_rating: input.contentRating ?? null,
      trainer_rating: input.trainerRating ?? null,
      relevance_rating: input.relevanceRating ?? null,
      comment: input.comment ?? null,
    },
  });

export const reviewSession = (
  sessionId: string,
  input: { reviewNote?: string | null; actionPoints?: string | null; actualCost?: number | null },
): Promise<void> =>
  rpc("fms_ld_review_session", {
    p_session_id: sessionId,
    p_payload: {
      review_note: input.reviewNote ?? null,
      action_points: input.actionPoints ?? null,
      actual_cost: input.actualCost ?? null,
    },
  });

export const submitEffectiveness = (
  id: string,
  input: {
    outcome: string;
    rating?: number | null;
    applicationObserved?: string | null;
    evidence?: string | null;
    improvementArea?: string | null;
    followupRequired?: boolean;
    followupActionId?: string | null;
  },
): Promise<void> =>
  rpc("fms_ld_submit_effectiveness", {
    p_id: id,
    p_payload: {
      outcome: input.outcome,
      rating: input.rating ?? null,
      application_observed: input.applicationObserved ?? null,
      evidence: input.evidence ?? null,
      improvement_area: input.improvementArea ?? null,
      followup_required: input.followupRequired ?? false,
      followup_action_id: input.followupActionId ?? null,
    },
  });

export const closeRequest = (
  requestId: string,
  input: { finalOutcome?: string | null; closureNote?: string | null; actualCost?: number | null },
): Promise<void> =>
  rpc("fms_ld_close_request", {
    p_request_id: requestId,
    p_payload: {
      final_outcome: input.finalOutcome ?? null,
      closure_note: input.closureNote ?? null,
      actual_cost: input.actualCost ?? null,
    },
  });

export const reopenRequest = (requestId: string, reason: string): Promise<void> =>
  rpc("fms_ld_reopen_request", { p_request_id: requestId, p_reason: reason });

/* --------------------------------- storage -------------------------------- */

/**
 * Private bucket. Nothing in it is ever public: every read goes through a short
 * signed URL.
 *
 * ⚠ THIS IS THE FIRST MODULE HERE WHERE AN ORDINARY EMPLOYEE WRITES A FILE —
 *   an assignment submission is their own work, uploaded by them. The bucket
 *   policy allows any signed-in user to insert (as its siblings do); what keeps
 *   a stray upload harmless is that nothing displays a file the database does
 *   not reference, and the RPC that records the reference checks who you are.
 */
const BUCKET = "fms-ld-docs";

const safeName = (name: string) => name.replace(/[^\w.\-]+/g, "_");

async function upload(path: string, file: File): Promise<string> {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || undefined });
  if (error) throw new Error(error.message);
  return path;
}

/** A 10-minute signed URL, or null if the object has gone. */
export async function ldDocUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 10);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/**
 * Drop a superseded object. The ONLY storage delete in this module.
 *
 * ⚠ ORDER: clear the database reference FIRST, then call this. The row survives
 *   here, so a path left behind after a failed RPC is a broken link the UI keeps
 *   rendering; a leftover object is invisible and costs pennies. Best-effort by
 *   design — storage failing must not undo a completed write.
 */
export async function removeLdDoc(path: string | null | undefined): Promise<void> {
  if (!path) return;
  try {
    await supabase.storage.from(BUCKET).remove([path]);
  } catch {
    /* best effort — see the doc comment */
  }
}

const stamped = (folder: string, id: string, file: File) =>
  `${folder}/${id}/${Date.now()}-${safeName(file.name)}`;

export const uploadMaterial = (sessionId: string, file: File) =>
  upload(stamped("material", sessionId, file), file);

export const uploadAttendanceSheet = (sessionId: string, file: File) =>
  upload(stamped("attendance", sessionId, file), file);

export const uploadEvidence = (sessionId: string, file: File) =>
  upload(stamped("evidence", sessionId, file), file);

export const uploadAssignmentBrief = (sessionId: string, file: File) =>
  upload(stamped("assignment", sessionId, file), file);

export const uploadSubmission = (assignmentId: string, file: File) =>
  upload(stamped("submission", assignmentId, file), file);

export const uploadProposal = (requestId: string, file: File) =>
  upload(stamped("proposal", requestId, file), file);

export const uploadQuotation = (requestId: string, file: File) =>
  upload(stamped("quotation", requestId, file), file);

/** Attach or replace the signed attendance sheet on a session. */
export const setAttendanceSheet = (sessionId: string, path: string | null): Promise<void> =>
  rpc("fms_ld_set_attendance_sheet", { p_session_id: sessionId, p_path: path });

/** Add photos / screenshots of the session as it ran. */
export const addEvidence = (sessionId: string, paths: string[]): Promise<void> =>
  rpc("fms_ld_add_evidence", { p_session_id: sessionId, p_paths: paths });
