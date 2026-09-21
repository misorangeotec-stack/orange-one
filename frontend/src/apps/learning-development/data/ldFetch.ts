import { supabase } from "@/core/platform/supabase";
import { resolveStepSla, type StepSlaMap } from "../lib/sla";
import type {
  ApprovalRule,
  LdActivity,
  LdNotification,
  MasterRow,
  SessionType,
  StepAssignee,
  StepOwner,
  Trainer,
  TrainingRequest,
  TrainingSession,
  Venue,
} from "../types";

/**
 * Learning & Development read layer. One paginated pass over the module's tables,
 * mapped snake_case → camelCase, so the pure rules in lib/queues.ts get plain data
 * and every screen reads the same react-query cache entry.
 *
 * ⚠ REQUESTS COME BACK RLS-FILTERED AND THAT IS NOT AN ERROR. The module is
 *   universal, so everybody loads this — but `fms_ld_can_read_request` withholds a
 *   request from anyone who neither raised it nor owns a step in the workflow. A
 *   plain employee therefore gets zero requests and a full calendar, which is the
 *   intended shape: they see the training, not what it cost to buy. Never read an
 *   empty `requests` array as "the module is broken".
 */

const PAGE = 1000;

type Tbl =
  | "fms_ld_step_owners"
  | "fms_ld_step_assignees"
  | "fms_ld_config"
  | "fms_ld_session_types"
  | "fms_ld_competencies"
  | "fms_ld_need_sources"
  | "fms_ld_venues"
  | "fms_ld_trainers"
  | "fms_ld_delay_reasons"
  | "fms_ld_followup_actions"
  | "fms_ld_master_managers"
  | "fms_ld_master_requests"
  | "fms_ld_requests"
  | "fms_ld_sessions"
  | "fms_ld_activity"
  | "fms_ld_notifications";

/* eslint-disable @typescript-eslint/no-explicit-any */
async function fetchAll(table: Tbl, orderBy = "created_at"): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .order(orderBy, { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

const master = (r: any): MasterRow => ({
  id: r.id,
  name: r.name,
  active: r.active ?? true,
  sortOrder: r.sort_order ?? 0,
});

const mapRequest = (r: any): TrainingRequest => ({
  id: r.id,
  code: r.code,
  status: r.status,
  title: r.title,
  needSourceId: r.need_source_id,
  departmentId: r.department_id,
  requestedBy: r.requested_by,
  skillGap: r.skill_gap,
  objective: r.objective,
  targetGroup: r.target_group,
  requiredBy: r.required_by,
  priority: r.priority,
  attachmentPath: r.attachment_path,
  submittedAt: r.submitted_at,
  returnedAt: r.returned_at,
  returnedBy: r.returned_by,
  returnReason: r.return_reason,
  competencyId: r.competency_id,
  isMandatory: r.is_mandatory ?? false,
  duplicateChecked: r.duplicate_checked ?? false,
  businessJustification: r.business_justification,
  expectedOutcome: r.expected_outcome,
  validatedBy: r.validated_by,
  validatedAt: r.validated_at,
  validationNote: r.validation_note,
  sessionTypeIds: r.session_type_ids ?? [],
  deliveryMode: r.delivery_mode,
  proposedTrainerType: r.proposed_trainer_type,
  proposedCost: num(r.proposed_cost),
  proposedMonth: r.proposed_month,
  proposalPath: r.proposal_path,
  proposedBy: r.proposed_by,
  proposedAt: r.proposed_at,
  mgmtRequired: r.mgmt_required,
  hrApprovedBy: r.hr_approved_by,
  hrApprovedAt: r.hr_approved_at,
  hrApprovalNote: r.hr_approval_note,
  mgmtApprovedBy: r.mgmt_approved_by,
  mgmtApprovedAt: r.mgmt_approved_at,
  mgmtApprovalNote: r.mgmt_approval_note,
  approvedBudget: num(r.approved_budget),
  rejectedBy: r.rejected_by,
  rejectedAt: r.rejected_at,
  rejectReason: r.reject_reason,
  trainerId: r.trainer_id,
  trainerTerms: r.trainer_terms,
  quotationPath: r.quotation_path,
  trainerConfirmedBy: r.trainer_confirmed_by,
  trainerConfirmedAt: r.trainer_confirmed_at,
  actualCost: num(r.actual_cost),
  finalOutcome: r.final_outcome,
  closureNote: r.closure_note,
  closedBy: r.closed_by,
  closedAt: r.closed_at,
  heldReasonId: r.held_reason_id,
  heldNote: r.held_note,
  heldAt: r.held_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const mapSession = (r: any): TrainingSession => ({
  id: r.id,
  code: r.code,
  requestId: r.request_id,
  planLineId: r.plan_line_id,
  title: r.title,
  sessionTypeIds: r.session_type_ids ?? [],
  deliveryMode: r.delivery_mode,
  trainerId: r.trainer_id,
  sessionDate: r.session_date,
  startTime: r.start_time,
  endTime: r.end_time,
  hours: num(r.hours),
  venueId: r.venue_id,
  meetingLink: r.meeting_link,
  capacity: r.capacity,
  registrationCutoff: r.registration_cutoff,
  status: r.status,
  outcome: r.outcome,
  actualStart: r.actual_start,
  actualEnd: r.actual_end,
  changeReason: r.change_reason,
  createdBy: r.created_by,
  createdAt: r.created_at,
});

export const LD_QK = ["learningDevelopmentData"] as const;
export const ldQueryKey = (userId: string | null) => [...LD_QK, userId] as const;

export interface LdData {
  requests: TrainingRequest[];
  sessions: TrainingSession[];
  stepOwners: StepOwner[];
  stepAssignees: StepAssignee[];
  sessionTypes: SessionType[];
  competencies: MasterRow[];
  needSources: MasterRow[];
  venues: Venue[];
  trainers: Trainer[];
  delayReasons: MasterRow[];
  followupActions: MasterRow[];
  masterManagers: { masterType: string; managerUserId: string }[];
  masterRequests: any[];
  activity: LdActivity[];
  notifications: LdNotification[];
  stepSla: StepSlaMap;
  coordinatorIds: string[];
  approvalRule: ApprovalRule;
  /** Raw config, for the Setup tabs that own their own keys. */
  config: Record<string, any>;
}

export async function fetchLdData(): Promise<LdData> {
  const [
    owners, assignees, config, sessionTypes, competencies, needSources, venues,
    trainers, delayReasons, followupActions, masterManagers, masterRequests,
    requests, sessions, activity, notifications,
  ] = await Promise.all([
    fetchAll("fms_ld_step_owners"),
    fetchAll("fms_ld_step_assignees", "assigned_at"),
    fetchAll("fms_ld_config", "key"),
    fetchAll("fms_ld_session_types", "sort_order"),
    fetchAll("fms_ld_competencies", "sort_order"),
    fetchAll("fms_ld_need_sources", "sort_order"),
    fetchAll("fms_ld_venues", "sort_order"),
    fetchAll("fms_ld_trainers", "sort_order"),
    fetchAll("fms_ld_delay_reasons", "sort_order"),
    fetchAll("fms_ld_followup_actions", "sort_order"),
    fetchAll("fms_ld_master_managers"),
    fetchAll("fms_ld_master_requests"),
    fetchAll("fms_ld_requests"),
    fetchAll("fms_ld_sessions"),
    fetchAll("fms_ld_activity"),
    fetchAll("fms_ld_notifications"),
  ]);

  const cfg: Record<string, any> = {};
  for (const row of config) cfg[row.key] = row.value ?? {};

  const rule = cfg.approval_rule ?? {};

  return {
    requests: requests.map(mapRequest),
    sessions: sessions.map(mapSession),
    stepOwners: owners.map((o) => ({
      stepKey: o.step_key,
      departmentIds: o.department_ids ?? [],
      employeeIds: o.employee_ids ?? [],
    })),
    stepAssignees: assignees.map((a) => ({
      requestId: a.request_id,
      sessionId: a.session_id,
      stepKey: a.step_key,
      assignedTo: a.assigned_to,
      assignedBy: a.assigned_by,
      assignedAt: a.assigned_at,
      note: a.note,
    })),
    sessionTypes: sessionTypes.map((r) => ({ ...master(r), code: r.code ?? null })),
    competencies: competencies.map(master),
    needSources: needSources.map(master),
    venues: venues.map((r) => ({
      ...master(r),
      address: r.address,
      capacity: r.capacity,
      isOnline: r.is_online ?? false,
    })),
    trainers: trainers.map((r) => ({
      id: r.id,
      name: r.name,
      trainerType: r.trainer_type,
      employeeId: r.employee_id,
      agency: r.agency,
      contactName: r.contact_name,
      email: r.email,
      phone: r.phone,
      speciality: r.speciality,
      rate: num(r.rate),
      active: r.active ?? true,
      sortOrder: r.sort_order ?? 0,
    })),
    delayReasons: delayReasons.map(master),
    followupActions: followupActions.map(master),
    masterManagers: masterManagers.map((m) => ({
      masterType: m.master_type,
      managerUserId: m.manager_user_id,
    })),
    masterRequests,
    activity: activity.map((a) => ({
      id: a.id,
      entityType: a.entity_type,
      entityId: a.entity_id,
      type: a.type,
      actorId: a.actor_id,
      note: a.note,
      meta: a.meta ?? {},
      createdAt: a.created_at,
    })),
    notifications: notifications.map((n) => ({
      id: n.id,
      type: n.type,
      entityType: n.entity_type,
      entityId: n.entity_id,
      text: n.text,
      actorId: n.actor_id,
      readAt: n.read_at,
      createdAt: n.created_at,
    })),
    stepSla: resolveStepSla(cfg.step_sla ?? null),
    coordinatorIds: (cfg.process_coordinators?.user_ids ?? []) as string[],
    approvalRule: {
      mgmt: (rule.mgmt ?? "never") as ApprovalRule["mgmt"],
      aboveAmount: Number(rule.above_amount ?? 0),
    },
    config: cfg,
  };
}
