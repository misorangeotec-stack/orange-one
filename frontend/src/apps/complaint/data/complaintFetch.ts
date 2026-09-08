import { supabase } from "@/core/platform/supabase";
// fms_complaint_* tables are not in the generated Database types (which is stale
// by ~78 tables, deliberately — regenerating it would surface errors across every
// other FMS). Route table/rpc calls through an untyped alias; the row mappers
// below already treat rows as any.
const db = supabase as any;
import { resolveStepSla, type StepSlaMap } from "../lib/sla";
import type {
  AckDecision,
  CauseGroup,
  ComplaintActivity,
  ComplaintDoc,
  ComplaintEntityType,
  ComplaintMasterManager,
  ComplaintMasterRequest,
  ComplaintMasterType,
  ComplaintNature,
  ComplaintNotification,
  ComplaintRequest,
  ComplaintType,
  Designation,
  DocSlot,
  LotSource,
  MasterRequestStatus,
  RequestStatus,
  ResolutionType,
  RootCause,
  Severity,
  StepOwner,
} from "../types";

/**
 * Complaint FMS read layer. One paginated pass over the module's own tables,
 * mapped snake_case → camelCase. The whole module loads in one snapshot so the
 * pure queue rules (lib/queues.ts) get plain data, and the Control Center adapter
 * can reuse this exact react-query cache entry rather than computing its own.
 *
 * ⚠ THE CENTRAL MASTERS ARE NOT HERE. `mst_parties` (7,842 rows) and `mst_items`
 *   (14,267) live behind their own query key in ./complaintMasters.ts, because
 *   they are shared with every module and change only when the Tally sync runs.
 *   Folding them in would re-download them every time somebody saved a step.
 */

const PAGE = 1000;

type Tbl =
  | "fms_complaint_step_owners"
  | "fms_complaint_config"
  | "fms_complaint_natures"
  | "fms_complaint_root_causes"
  | "fms_complaint_master_managers"
  | "fms_complaint_master_requests"
  | "fms_complaint_requests"
  | "fms_complaint_docs"
  | "fms_complaint_activity"
  | "fms_complaint_notifications"
  | "designations";

/**
 * ⚠ `orderBy` MUST NAME A UNIQUE KEY, or a paged read silently loses rows.
 *   PostgREST caps a response at 1000 and Postgres does not define row order
 *   without ORDER BY, so pages overlap and skip differently on every run —
 *   `mst_parties` once accumulated 7,832 rows as the union of many such runs, each
 *   dropping a different ~1,600 (CENTRAL-MASTERS.md #24). `created_at` is unique
 *   enough on these tables today; `id` is appended as a tiebreaker regardless,
 *   because "unique enough" is exactly what that incident assumed too.
 */
async function fetchAll(table: Tbl, orderBy = "created_at", tiebreak: string | null = "id"): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = db.from(table).select("*").order(orderBy, { ascending: true });
    // ⚠ NOT EVERY TABLE HAS AN `id`. fms_complaint_config is keyed on `key`
    //   alone, and ordering by a column that does not exist is a PostgREST
    //   error — which fails the whole Promise.all and empties the entire module.
    //   It stayed hidden only because the table was empty: PostgREST never
    //   evaluates the sort with no rows to sort, so it would have surfaced the
    //   first time anyone saved a setting.
    if (tiebreak) q = q.order(tiebreak, { ascending: true });
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export interface ComplaintConfig {
  processCoordinatorIds: string[];
  stepSla: StepSlaMap;
  /** Credit notes above this value need approving. Defaulted, never assumed present. */
  approvalThreshold: number;
}

/** The react-query key. Keyed on the REAL session user id, shared with the adapter. */
export const COMPLAINT_QK = ["complaintData"] as const;
export const complaintQueryKey = (userId: string | null) => [...COMPLAINT_QK, userId] as const;

export interface ComplaintData {
  stepOwners: StepOwner[];
  designations: Designation[];
  config: ComplaintConfig;
  natures: ComplaintNature[];
  rootCauses: RootCause[];
  masterManagers: ComplaintMasterManager[];
  masterRequests: ComplaintMasterRequest[];
  requests: ComplaintRequest[];
  docs: ComplaintDoc[];
  activity: ComplaintActivity[];
  notifications: ComplaintNotification[];
}

/* --------------------------------- mappers -------------------------------- */

const mapNature = (r: any): ComplaintNature => ({
  id: r.id,
  name: r.name,
  active: r.active,
  sortOrder: r.sort_order ?? 0,
});

const mapRootCause = (r: any): RootCause => ({
  id: r.id,
  name: r.name,
  causeGroup: r.cause_group as CauseGroup,
  active: r.active,
  sortOrder: r.sort_order ?? 0,
});

const mapMasterManager = (r: any): ComplaintMasterManager => ({
  id: r.id,
  masterType: r.master_type as ComplaintMasterType,
  managerUserId: r.manager_user_id,
});

const mapMasterRequest = (r: any): ComplaintMasterRequest => ({
  id: r.id,
  masterType: r.master_type as ComplaintMasterType,
  proposedPayload: (r.proposed_payload ?? {}) as Record<string, unknown>,
  status: r.status as MasterRequestStatus,
  requestedBy: r.requested_by ?? null,
  reviewedBy: r.reviewed_by ?? null,
  reviewNote: r.review_note ?? null,
  resolvedMasterId: r.resolved_master_id ?? null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const mapStepOwner = (r: any): StepOwner => ({
  id: r.id,
  stepKey: r.step_key,
  departmentIds: (r.department_ids ?? []) as string[],
  designationId: r.designation_id ?? null,
  employeeIds: (r.employee_ids ?? []) as string[],
});

const mapDesignation = (r: any): Designation => ({
  id: r.id,
  name: r.name,
  active: r.active,
});

const mapDoc = (r: any): ComplaintDoc => ({
  id: r.id,
  complaintId: r.complaint_id,
  stepKey: r.step_key,
  slot: r.slot as DocSlot,
  path: r.path,
  name: r.name,
  mime: r.mime ?? null,
  sizeBytes: r.size_bytes ?? null,
  uploadedBy: r.uploaded_by ?? null,
  createdAt: r.created_at,
});

/**
 * ⚠ NUMERICS COME BACK AS STRINGS AND STAY STRINGS. `qty_affected` and
 *   `res_value` are `numeric` — the PostgREST JSON for a numeric is a string, and
 *   coercing here would silently round a quantity like 12.345. The form parses
 *   them at the point of use.
 */
const mapRequest = (r: any): ComplaintRequest => ({
  id: r.id,
  complaintNo: r.complaint_no,
  complaintType: r.complaint_type as ComplaintType,
  status: r.status as RequestStatus,
  currentStep: r.current_step ?? "",
  raisedBy: r.raised_by ?? null,
  requesterName: r.requester_name ?? "",
  companyId: r.company_id ?? null,

  lotNo: r.lot_no ?? null,
  lotExpiryDate: r.lot_expiry_date ?? null,
  lotSource: (r.lot_source ?? "manual") as LotSource,
  category: r.category ?? null,
  inkType: r.ink_type ?? null,
  itemId: r.item_id ?? null,
  itemName: r.item_name ?? null,
  partyId: r.party_id ?? null,
  partyName: r.party_name ?? null,
  invoiceNo: r.invoice_no ?? null,
  invoiceDate: r.invoice_date ?? null,
  qtyAffected: r.qty_affected ?? null,
  unitName: r.unit_name ?? null,
  natureId: r.nature_id ?? null,

  issueIdentifiedAt: r.issue_identified_at ?? null,
  problemDetails: r.problem_details ?? null,
  otherRemarks: r.other_remarks ?? null,

  submittedAt: r.submitted_at,

  plantAction: r.plant_action ?? null,
  plantRemarks: r.plant_remarks ?? null,
  plantDate: r.plant_date ?? null,
  plantAt: r.plant_at ?? null,
  plantBy: r.plant_by ?? null,

  svcRequisition: r.svc_requisition ?? null,
  svcRemarks: r.svc_remarks ?? null,
  svcConclusion: r.svc_conclusion ?? null,
  svcCommercialCall: r.svc_commercial_call ?? null,
  svcCallRemarks: r.svc_call_remarks ?? null,
  svcDate: r.svc_date ?? null,
  svcAt: r.svc_at ?? null,
  svcBy: r.svc_by ?? null,

  svcCloseRemarks: r.svc_close_remarks ?? null,
  svcCloseDate: r.svc_close_date ?? null,
  svcCloseAt: r.svc_close_at ?? null,
  svcCloseBy: r.svc_close_by ?? null,

  mgmtNote: r.mgmt_note ?? null,
  mgmtDate: r.mgmt_date ?? null,
  mgmtAt: r.mgmt_at ?? null,
  mgmtBy: r.mgmt_by ?? null,

  ackDecision: (r.ack_decision ?? null) as AckDecision | null,
  ackSeverity: (r.ack_severity ?? null) as Severity | null,
  ackAssigneeId: r.ack_assignee_id ?? null,
  ackAssigneeName: r.ack_assignee_name ?? null,
  ackTargetDate: r.ack_target_date ?? null,
  ackRejectReason: r.ack_reject_reason ?? null,
  ackNote: r.ack_note ?? null,
  ackDate: r.ack_date ?? null,
  ackAt: r.ack_at ?? null,
  ackBy: r.ack_by ?? null,

  invRootCauseId: r.inv_root_cause_id ?? null,
  invRootCauseNote: r.inv_root_cause_note ?? null,
  invFindings: r.inv_findings ?? null,
  invResponsibleDeptId: r.inv_responsible_dept_id ?? null,
  invCapaOwnerId: r.inv_capa_owner_id ?? null,
  invCapaOwnerName: r.inv_capa_owner_name ?? null,
  invDate: r.inv_date ?? null,
  invAt: r.inv_at ?? null,
  invBy: r.inv_by ?? null,

  capaCorrective: r.capa_corrective ?? null,
  capaPreventive: r.capa_preventive ?? null,
  capaResolverId: r.capa_resolver_id ?? null,
  capaResolverName: r.capa_resolver_name ?? null,
  capaTargetDate: r.capa_target_date ?? null,
  capaNote: r.capa_note ?? null,
  capaDate: r.capa_date ?? null,
  capaAt: r.capa_at ?? null,
  capaBy: r.capa_by ?? null,

  resType: (r.res_type ?? null) as ResolutionType | null,
  resReference: r.res_reference ?? null,
  resQty: r.res_qty ?? null,
  resValue: r.res_value ?? null,
  resConfirmerId: r.res_confirmer_id ?? null,
  resConfirmerName: r.res_confirmer_name ?? null,
  resNote: r.res_note ?? null,
  resDate: r.res_date ?? null,
  resAt: r.res_at ?? null,
  resBy: r.res_by ?? null,

  approvalRequired: !!r.approval_required,
  aprDecision: (r.apr_decision ?? null) as "approve" | "reject" | null,
  aprNote: r.apr_note ?? null,
  aprDate: r.apr_date ?? null,
  aprAt: r.apr_at ?? null,
  aprBy: r.apr_by ?? null,

  cfmPartySatisfied: r.cfm_party_satisfied ?? null,
  cfmNote: r.cfm_note ?? null,
  cfmDate: r.cfm_date ?? null,
  cfmAt: r.cfm_at ?? null,
  cfmBy: r.cfm_by ?? null,

  clsNote: r.cls_note ?? null,
  clsDate: r.cls_date ?? null,
  clsAt: r.cls_at ?? null,
  clsBy: r.cls_by ?? null,
  closedAt: r.closed_at ?? null,

  rejectedAt: r.rejected_at ?? null,
  rejectReason: r.reject_reason ?? null,
  holdAt: r.hold_at ?? null,
  holdReason: r.hold_reason ?? null,
  holdFromStatus: (r.hold_from_status ?? null) as RequestStatus | null,
  cancelledAt: r.cancelled_at ?? null,
  cancelReason: r.cancel_reason ?? null,
  editedAt: r.edited_at ?? null,
  editedBy: r.edited_by ?? null,
  createdAt: r.created_at,
});

const mapActivity = (r: any): ComplaintActivity => ({
  id: r.id,
  entityType: r.entity_type as ComplaintEntityType,
  entityId: r.entity_id,
  type: r.type,
  actorId: r.actor_id ?? null,
  note: r.note ?? null,
  meta: (r.meta ?? {}) as Record<string, unknown>,
  createdAt: r.created_at,
});

const mapNotification = (r: any): ComplaintNotification => ({
  id: r.id,
  userId: r.user_id,
  type: r.type,
  entityType: r.entity_type as ComplaintEntityType,
  entityId: r.entity_id,
  text: r.text,
  actorId: r.actor_id ?? null,
  readAt: r.read_at ?? null,
  createdAt: r.created_at,
});

export async function fetchComplaintData(): Promise<ComplaintData> {
  // ⚠ THIS PAIRING IS POSITIONAL AND UNTYPED — both sides are any[], so slipping a
  // new fetch into the middle of one list silently hands you another table's rows
  // with NO compile error. One name per line, in the same order as the calls
  // below, and ALWAYS append at the end of both.
  const [
    stepOwners,
    configRows,
    designations,
    natures,
    rootCauses,
    masterManagers,
    masterRequests,
    requests,
    docs,
    activity,
    notifications,
  ] = await Promise.all([
    fetchAll("fms_complaint_step_owners"),
    fetchAll("fms_complaint_config", "key", null),   // keyed on `key`; no id column
    fetchAll("designations"),
    fetchAll("fms_complaint_natures"),
    fetchAll("fms_complaint_root_causes"),
    fetchAll("fms_complaint_master_managers"),
    fetchAll("fms_complaint_master_requests"),
    fetchAll("fms_complaint_requests", "submitted_at"),
    fetchAll("fms_complaint_docs"),
    fetchAll("fms_complaint_activity"),
    fetchAll("fms_complaint_notifications"),
  ]);

  const byKey = new Map<string, any>(configRows.map((r) => [r.key, r.value ?? {}]));
  const config: ComplaintConfig = {
    processCoordinatorIds: (byKey.get("process_coordinators")?.user_ids ?? []) as string[],
    stepSla: resolveStepSla(byKey.get("step_sla")),
    approvalThreshold: Number(byKey.get("approval")?.credit_note_threshold ?? 25000),
  };

  return {
    stepOwners: stepOwners.map(mapStepOwner),
    designations: designations.map(mapDesignation),
    config,
    natures: natures.map(mapNature),
    rootCauses: rootCauses.map(mapRootCause),
    masterManagers: masterManagers.map(mapMasterManager),
    masterRequests: masterRequests.map(mapMasterRequest),
    requests: requests.map(mapRequest),
    docs: docs.map(mapDoc),
    activity: activity.map(mapActivity),
    notifications: notifications.map(mapNotification),
  };
}
