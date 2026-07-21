import { supabase } from "@/core/platform/supabase";
// fms_sampling_* tables are not in the generated Database types; route table/rpc
// calls through an untyped alias (the row mappers below already treat rows as any).
const db = supabase as any;
import { resolveStepSla, type StepSlaMap } from "../lib/sla";
import type {
  Company,
  Designation,
  SamplingActivity,
  SamplingEntityType,
  SamplingMasterManager,
  SamplingMasterType,
  SamplingNotification,
  SamplingRequest,
  StepOwner,
} from "../types";

/**
 * Sampling FMS read layer. One paginated pass over the module's tables, mapped
 * snake_case → camelCase. The whole module loads in one snapshot so the pure queue
 * rules (lib/queues.ts) get plain data, and the Control Center adapter can reuse
 * this exact react-query cache entry.
 */

const PAGE = 1000;

type Tbl =
  | "fms_sampling_step_owners"
  | "fms_sampling_config"
  | "fms_sampling_companies"
  | "fms_sampling_master_managers"
  | "fms_sampling_requests"
  | "fms_sampling_activity"
  | "fms_sampling_notifications"
  | "designations";

async function fetchAll(table: Tbl, orderBy = "created_at"): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
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

export interface SamplingConfig {
  processCoordinatorIds: string[];
  stepSla: StepSlaMap;
}

/** The react-query key. Keyed on the REAL session user id, shared with the adapter. */
export const SAMPLING_QK = ["samplingData"] as const;
export const samplingQueryKey = (userId: string | null) => [...SAMPLING_QK, userId] as const;

export interface SamplingData {
  stepOwners: StepOwner[];
  designations: Designation[];
  config: SamplingConfig;
  companies: Company[];
  masterManagers: SamplingMasterManager[];
  requests: SamplingRequest[];
  activity: SamplingActivity[];
  notifications: SamplingNotification[];
}

const mapCompany = (r: any): Company => ({
  id: r.id,
  name: r.name,
  active: r.active,
  sortOrder: r.sort_order ?? 0,
});

const mapMasterManager = (r: any): SamplingMasterManager => ({
  id: r.id,
  masterType: r.master_type as SamplingMasterType,
  managerUserId: r.manager_user_id,
});

const mapRequest = (r: any): SamplingRequest => ({
  id: r.id,
  reqNo: r.req_no,
  companyId: r.company_id,
  receiveVia: r.receive_via,
  direction: r.direction,
  requirementType: r.requirement_type ?? null,
  raisedBy: r.raised_by ?? null,
  requesterName: r.requester_name,
  partyName: r.party_name ?? null,
  productDesc: r.product_desc ?? null,
  colourQty: r.colour_qty ?? null,
  sampleItems: Array.isArray(r.sample_items) ? r.sample_items : [],
  collectorId: r.collector_id ?? null,
  collectorName: r.collector_name ?? null,
  handoverName: r.handover_name ?? null,
  transportBorne: r.transport_borne ?? null,
  desiredResult: r.desired_result ?? null,
  additionalInfo: r.additional_info ?? null,
  status: r.status,
  currentStep: r.current_step,
  submittedAt: r.submitted_at,
  receivedDate: r.received_date ?? null,
  receivedAt: r.received_at ?? null,
  receivedBy: r.received_by ?? null,
  sentDate: r.sent_date ?? null,
  gateEntryNo: r.gate_entry_no ?? null,
  sentQty: r.sent_qty ?? null,
  sentAt: r.sent_at ?? null,
  sentBy: r.sent_by ?? null,
  partyReceivedDate: r.party_received_date ?? null,
  confirmedAt: r.confirmed_at ?? null,
  confirmedBy: r.confirmed_by ?? null,
  testingCompletedDate: r.testing_completed_date ?? null,
  internalRef: r.internal_ref ?? null,
  tentativeResultDate: r.tentative_result_date ?? null,
  testedAt: r.tested_at ?? null,
  testedBy: r.tested_by ?? null,
  resultComment: r.result_comment ?? null,
  resultOwner: r.result_owner ?? null,
  attachmentPath: r.attachment_path ?? null,
  attachmentName: r.attachment_name ?? null,
  resultedAt: r.resulted_at ?? null,
  resultedBy: r.resulted_by ?? null,
  handoverDate: r.handover_date ?? null,
  handoverNote: r.handover_note ?? null,
  handedOverAt: r.handed_over_at ?? null,
  handedOverBy: r.handed_over_by ?? null,
  closedAt: r.closed_at ?? null,
  editedAt: r.edited_at ?? null,
  editedBy: r.edited_by ?? null,
  holdAt: r.hold_at ?? null,
  holdReason: r.hold_reason ?? null,
  cancelledAt: r.cancelled_at ?? null,
  cancelReason: r.cancel_reason ?? null,
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

const mapActivity = (r: any): SamplingActivity => ({
  id: r.id,
  entityType: r.entity_type as SamplingEntityType,
  entityId: r.entity_id,
  type: r.type,
  actorId: r.actor_id ?? null,
  note: r.note ?? null,
  meta: (r.meta ?? {}) as Record<string, unknown>,
  createdAt: r.created_at,
});

const mapNotification = (r: any): SamplingNotification => ({
  id: r.id,
  userId: r.user_id,
  type: r.type,
  entityType: r.entity_type as SamplingEntityType,
  entityId: r.entity_id,
  text: r.text,
  actorId: r.actor_id ?? null,
  readAt: r.read_at ?? null,
  createdAt: r.created_at,
});

export async function fetchSamplingData(): Promise<SamplingData> {
  const [stepOwners, configRows, designations, companies, masterManagers, requests, activity, notifications] =
    await Promise.all([
      fetchAll("fms_sampling_step_owners"),
      fetchAll("fms_sampling_config", "key"),
      fetchAll("designations"),
      fetchAll("fms_sampling_companies"),
      fetchAll("fms_sampling_master_managers"),
      fetchAll("fms_sampling_requests", "submitted_at"),
      fetchAll("fms_sampling_activity"),
      fetchAll("fms_sampling_notifications"),
    ]);

  const byKey = new Map<string, any>(configRows.map((r) => [r.key, r.value ?? {}]));
  const config: SamplingConfig = {
    processCoordinatorIds: (byKey.get("process_coordinators")?.user_ids ?? []) as string[],
    stepSla: resolveStepSla(byKey.get("step_sla")),
  };

  return {
    stepOwners: stepOwners.map(mapStepOwner),
    designations: designations.map(mapDesignation),
    config,
    companies: companies.map(mapCompany),
    masterManagers: masterManagers.map(mapMasterManager),
    requests: requests.map(mapRequest),
    activity: activity.map(mapActivity),
    notifications: notifications.map(mapNotification),
  };
}
