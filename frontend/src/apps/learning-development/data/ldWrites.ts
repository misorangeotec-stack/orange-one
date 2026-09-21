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
