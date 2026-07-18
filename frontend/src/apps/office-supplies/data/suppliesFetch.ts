import { supabase } from "@/core/platform/supabase";
import { resolveStepSla, type StepSlaMap } from "../lib/sla";
import type {
  Category,
  Company,
  Department,
  Designation,
  Item,
  ServiceType,
  StepOwner,
  SupplyActivity,
  SupplyEntityType,
  SupplyMasterManager,
  SupplyMasterRequest,
  SupplyMasterType,
  SupplyNotification,
  SupplyRequest,
} from "../types";

/**
 * Office Supplies FMS read layer. One paginated pass over the module's tables, mapped
 * snake_case → camelCase. The whole module loads in one snapshot so the pure queue
 * rules (lib/queues.ts) get plain data, and the Control Center adapter can reuse this
 * exact react-query cache entry.
 */

const PAGE = 1000;

type Tbl =
  | "fms_supplies_step_owners"
  | "fms_supplies_config"
  | "fms_supplies_companies"
  | "fms_supplies_departments"
  | "fms_supplies_categories"
  | "fms_supplies_items"
  | "fms_supplies_service_types"
  | "fms_supplies_master_managers"
  | "fms_supplies_master_requests"
  | "fms_supplies_requests"
  | "fms_supplies_activity"
  | "fms_supplies_notifications"
  | "designations";

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

export interface SuppliesConfig {
  processCoordinatorIds: string[];
  stepSla: StepSlaMap;
}

/** The react-query key. Keyed on the REAL session user id, shared with the adapter. */
export const SUPPLIES_QK = ["officeSuppliesData"] as const;
export const suppliesQueryKey = (userId: string | null) => [...SUPPLIES_QK, userId] as const;

export interface SuppliesData {
  stepOwners: StepOwner[];
  designations: Designation[];
  config: SuppliesConfig;
  companies: Company[];
  departments: Department[];
  categories: Category[];
  items: Item[];
  serviceTypes: ServiceType[];
  masterManagers: SupplyMasterManager[];
  masterRequests: SupplyMasterRequest[];
  requests: SupplyRequest[];
  activity: SupplyActivity[];
  notifications: SupplyNotification[];
}

const mapCompany = (r: any): Company => ({
  id: r.id,
  name: r.name,
  active: r.active,
  sortOrder: r.sort_order ?? 0,
});

const mapDepartment = (r: any): Department => ({
  id: r.id,
  name: r.name,
  hodUserId: r.hod_user_id ?? null,
  orgDepartmentId: r.org_department_id ?? null,
  active: r.active,
  sortOrder: r.sort_order ?? 0,
});

const mapCategory = (r: any): Category => ({
  id: r.id,
  name: r.name,
  requiresApproval: !!r.requires_approval,
  active: r.active,
  sortOrder: r.sort_order ?? 0,
});

const mapItem = (r: any): Item => ({
  id: r.id,
  categoryId: r.category_id,
  name: r.name,
  unit: r.unit ?? null,
  active: r.active,
  sortOrder: r.sort_order ?? 0,
});

const mapServiceType = (r: any): ServiceType => ({
  id: r.id,
  name: r.name,
  active: r.active,
  sortOrder: r.sort_order ?? 0,
});

const mapMasterManager = (r: any): SupplyMasterManager => ({
  id: r.id,
  masterType: r.master_type as SupplyMasterType,
  managerUserId: r.manager_user_id,
});

const mapMasterRequest = (r: any): SupplyMasterRequest => ({
  id: r.id,
  masterType: r.master_type as SupplyMasterType,
  proposedPayload: (r.proposed_payload ?? {}) as Record<string, unknown>,
  status: r.status,
  requestedBy: r.requested_by ?? null,
  reviewedBy: r.reviewed_by ?? null,
  reviewNote: r.review_note ?? null,
  resolvedMasterId: r.resolved_master_id ?? null,
  createdAt: r.created_at,
});

const mapRequest = (r: any): SupplyRequest => ({
  id: r.id,
  reqNo: r.req_no,
  companyId: r.company_id,
  location: r.location,
  departmentId: r.department_id,
  raisedBy: r.raised_by ?? null,
  requestedForName: r.requested_for_name,
  requestedForUserId: r.requested_for_user_id ?? null,
  raisedOnBehalf: !!r.raised_on_behalf,
  requestType: r.request_type,
  categoryId: r.category_id ?? null,
  serviceTypeId: r.service_type_id ?? null,
  itemName: r.item_name ?? null,
  quantity: r.quantity,
  reason: r.reason ?? null,
  requiresApproval: !!r.requires_approval,
  status: r.status,
  currentStep: r.current_step,
  submittedAt: r.submitted_at,
  firstApprovedAt: r.first_approved_at ?? null,
  firstApproverId: r.first_approver_id ?? null,
  firstRemarks: r.first_remarks ?? null,
  secondApprovedAt: r.second_approved_at ?? null,
  secondApproverId: r.second_approver_id ?? null,
  secondRemarks: r.second_remarks ?? null,
  handedOverAt: r.handed_over_at ?? null,
  handoverBy: r.handover_by ?? null,
  handoverRemarks: r.handover_remarks ?? null,
  tentativeDeliveryDate: r.tentative_delivery_date ?? null,
  actualDeliveryDate: r.actual_delivery_date ?? null,
  deliveredAt: r.delivered_at ?? null,
  rejectedAt: r.rejected_at ?? null,
  rejectStage: r.reject_stage ?? null,
  rejectReason: r.reject_reason ?? null,
  holdAt: r.hold_at ?? null,
  holdReason: r.hold_reason ?? null,
  cancelledAt: r.cancelled_at ?? null,
  cancelReason: r.cancel_reason ?? null,
  editedAt: r.edited_at ?? null,
  editedBy: r.edited_by ?? null,
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

const mapActivity = (r: any): SupplyActivity => ({
  id: r.id,
  entityType: r.entity_type as SupplyEntityType,
  entityId: r.entity_id,
  type: r.type,
  actorId: r.actor_id ?? null,
  note: r.note ?? null,
  meta: (r.meta ?? {}) as Record<string, unknown>,
  createdAt: r.created_at,
});

const mapNotification = (r: any): SupplyNotification => ({
  id: r.id,
  userId: r.user_id,
  type: r.type,
  entityType: r.entity_type as SupplyEntityType,
  entityId: r.entity_id,
  text: r.text,
  actorId: r.actor_id ?? null,
  readAt: r.read_at ?? null,
  createdAt: r.created_at,
});

export async function fetchSuppliesData(): Promise<SuppliesData> {
  const [
    stepOwners,
    configRows,
    designations,
    companies,
    departments,
    categories,
    items,
    serviceTypes,
    masterManagers,
    masterRequests,
    requests,
    activity,
    notifications,
  ] = await Promise.all([
    fetchAll("fms_supplies_step_owners"),
    fetchAll("fms_supplies_config", "key"),
    fetchAll("designations"),
    fetchAll("fms_supplies_companies"),
    fetchAll("fms_supplies_departments"),
    fetchAll("fms_supplies_categories"),
    fetchAll("fms_supplies_items"),
    fetchAll("fms_supplies_service_types"),
    fetchAll("fms_supplies_master_managers"),
    fetchAll("fms_supplies_master_requests"),
    fetchAll("fms_supplies_requests", "submitted_at"),
    fetchAll("fms_supplies_activity"),
    fetchAll("fms_supplies_notifications"),
  ]);

  const byKey = new Map<string, any>(configRows.map((r) => [r.key, r.value ?? {}]));
  const config: SuppliesConfig = {
    processCoordinatorIds: (byKey.get("process_coordinators")?.user_ids ?? []) as string[],
    stepSla: resolveStepSla(byKey.get("step_sla")),
  };

  return {
    stepOwners: stepOwners.map(mapStepOwner),
    designations: designations.map(mapDesignation),
    config,
    companies: companies.map(mapCompany),
    departments: departments.map(mapDepartment),
    categories: categories.map(mapCategory),
    items: items.map(mapItem),
    serviceTypes: serviceTypes.map(mapServiceType),
    masterManagers: masterManagers.map(mapMasterManager),
    masterRequests: masterRequests.map(mapMasterRequest),
    requests: requests.map(mapRequest),
    activity: activity.map(mapActivity),
    notifications: notifications.map(mapNotification),
  };
}
