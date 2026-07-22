import { supabase } from "@/core/platform/supabase";
// fms_production_* tables are not in the generated Database types; route table/rpc
// calls through an untyped alias (the row mappers below already treat rows as any).
const db = supabase as any;
import { resolveStepSla, type StepSlaMap } from "../lib/sla";
import type {
  Category,
  Designation,
  FgItem,
  NamedMaster,
  ProductionActivity,
  ProductionEntityType,
  ProductionMasterManager,
  ProductionMasterRequest,
  ProductionMasterType,
  ProductionNotification,
  ProductionRequest,
  RawMaterial,
  StepOwner,
  Unit,
} from "../types";

/**
 * Production Entry FMS read layer. One paginated pass over the module's tables,
 * mapped snake_case → camelCase. The whole module loads in one snapshot so the pure
 * queue rules (lib/queues.ts) get plain data, and the Control Center adapter + My
 * Work provider can reuse this exact react-query cache entry.
 */

const PAGE = 1000;

type Tbl =
  | "fms_production_step_owners"
  | "fms_production_config"
  | "fms_production_categories"
  | "fms_production_raw_materials"
  | "fms_production_fg_items"
  | "fms_production_units"
  | "fms_production_master_managers"
  | "fms_production_master_requests"
  | "fms_production_requests"
  | "fms_production_activity"
  | "fms_production_notifications"
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

export interface ProductionConfig {
  processCoordinatorIds: string[];
  stepSla: StepSlaMap;
}

/** The react-query key. Keyed on the REAL session user id, shared with the adapter. */
export const PRODUCTION_QK = ["productionData"] as const;
export const productionQueryKey = (userId: string | null) => [...PRODUCTION_QK, userId] as const;

export interface ProductionData {
  stepOwners: StepOwner[];
  designations: Designation[];
  config: ProductionConfig;
  categories: Category[];
  rawMaterials: RawMaterial[];
  fgItems: FgItem[];
  units: Unit[];
  masterManagers: ProductionMasterManager[];
  masterRequests: ProductionMasterRequest[];
  requests: ProductionRequest[];
  activity: ProductionActivity[];
  notifications: ProductionNotification[];
}

const num = (v: any): number | null => (v === null || v === undefined || v === "" ? null : Number(v));

const mapMaster = (r: any): NamedMaster => ({ id: r.id, name: r.name, active: r.active, sortOrder: r.sort_order ?? 0 });

const mapMasterManager = (r: any): ProductionMasterManager => ({
  id: r.id,
  masterType: r.master_type as ProductionMasterType,
  managerUserId: r.manager_user_id,
});

const mapMasterRequest = (r: any): ProductionMasterRequest => ({
  id: r.id,
  masterType: r.master_type as ProductionMasterType,
  proposedPayload: (r.proposed_payload ?? {}) as Record<string, unknown>,
  status: r.status,
  requestedBy: r.requested_by ?? null,
  reviewedBy: r.reviewed_by ?? null,
  reviewNote: r.review_note ?? null,
  resolvedMasterId: r.resolved_master_id ?? null,
  createdAt: r.created_at,
});

const mapRequest = (r: any): ProductionRequest => ({
  id: r.id,
  reqNo: r.req_no,
  jobcardNo: r.jobcard_no,
  categoryId: r.category_id ?? null,
  rawMaterialId: r.raw_material_id ?? null,
  requiredQty: num(r.required_qty),
  unitId: r.unit_id ?? null,
  bomLines: Array.isArray(r.bom_lines)
    ? r.bom_lines.map((l: any) => ({
        rawMaterialId: l.raw_material_id ?? null,
        requiredQty: num(l.required_qty),
        unitId: l.unit_id ?? null,
      }))
    : [],
  fgItemId: r.fg_item_id ?? null,
  issueRemarks: r.issue_remarks ?? null,
  raisedBy: r.raised_by ?? null,
  requesterName: r.requester_name,
  status: r.status,
  currentStep: r.current_step,
  submittedAt: r.submitted_at,

  mhActualDate: r.mh_actual_date ?? null,
  mhStatus: r.mh_status ?? null,
  mhQty: num(r.mh_qty),
  rmBookNo: r.rm_book_no ?? null,
  mhRemarks: r.mh_remarks ?? null,
  mhAt: r.mh_at ?? null,
  mhBy: r.mh_by ?? null,

  tsActualDate: r.ts_actual_date ?? null,
  tsStatus: r.ts_status ?? null,
  transferSlipNo: r.transfer_slip_no ?? null,
  batchCardNo: r.batch_card_no ?? null,
  tsRemarks: r.ts_remarks ?? null,
  tsAt: r.ts_at ?? null,
  tsBy: r.ts_by ?? null,

  peActualDate: r.pe_actual_date ?? null,
  peStatus: r.pe_status ?? null,
  actualQty: num(r.actual_qty),
  scrapQty: num(r.scrap_qty),
  lotNo: r.lot_no ?? null,
  peRemarks: r.pe_remarks ?? null,
  peAt: r.pe_at ?? null,
  peBy: r.pe_by ?? null,

  qcActualDate: r.qc_actual_date ?? null,
  qcStatus: r.qc_status ?? null,
  qcRemarks: r.qc_remarks ?? null,
  qcAttachmentPath: r.qc_attachment_path ?? null,
  qcAttachmentName: r.qc_attachment_name ?? null,
  qcAt: r.qc_at ?? null,
  qcBy: r.qc_by ?? null,

  mcActualDate: r.mc_actual_date ?? null,
  mcStatus: r.mc_status ?? null,
  mcRemarks: r.mc_remarks ?? null,
  mcAt: r.mc_at ?? null,
  mcBy: r.mc_by ?? null,

  pmhActualDate: r.pmh_actual_date ?? null,
  pmhStatus: r.pmh_status ?? null,
  pmhQty: num(r.pmh_qty),
  pmhBatchNo: r.pmh_batch_no ?? null,
  pmhRemarks: r.pmh_remarks ?? null,
  pmhAt: r.pmh_at ?? null,
  pmhBy: r.pmh_by ?? null,

  pmtActualDate: r.pmt_actual_date ?? null,
  pmtStatus: r.pmt_status ?? null,
  pmtQty: num(r.pmt_qty),
  pmtRemarks: r.pmt_remarks ?? null,
  pmtAt: r.pmt_at ?? null,
  pmtBy: r.pmt_by ?? null,

  pkActualDate: r.pk_actual_date ?? null,
  pkStatus: r.pk_status ?? null,
  packedQty: num(r.packed_qty),
  looseInkQty: num(r.loose_ink_qty),
  pkRemarks: r.pk_remarks ?? null,
  pkAt: r.pk_at ?? null,
  pkBy: r.pk_by ?? null,

  fgActualDate: r.fg_actual_date ?? null,
  fgStatus: r.fg_status ?? null,
  finalQty: num(r.final_qty),
  fgRemarks: r.fg_remarks ?? null,
  fgAt: r.fg_at ?? null,
  fgBy: r.fg_by ?? null,
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

const mapActivity = (r: any): ProductionActivity => ({
  id: r.id,
  entityType: r.entity_type as ProductionEntityType,
  entityId: r.entity_id,
  type: r.type,
  actorId: r.actor_id ?? null,
  note: r.note ?? null,
  meta: (r.meta ?? {}) as Record<string, unknown>,
  createdAt: r.created_at,
});

const mapNotification = (r: any): ProductionNotification => ({
  id: r.id,
  userId: r.user_id,
  type: r.type,
  entityType: r.entity_type as ProductionEntityType,
  entityId: r.entity_id,
  text: r.text,
  actorId: r.actor_id ?? null,
  readAt: r.read_at ?? null,
  createdAt: r.created_at,
});

export async function fetchProductionData(): Promise<ProductionData> {
  const [
    stepOwners, configRows, designations, categories, rawMaterials, fgItems, units,
    masterManagers, masterRequests, requests, activity, notifications,
  ] = await Promise.all([
    fetchAll("fms_production_step_owners"),
    fetchAll("fms_production_config", "key"),
    fetchAll("designations"),
    fetchAll("fms_production_categories"),
    fetchAll("fms_production_raw_materials"),
    fetchAll("fms_production_fg_items"),
    fetchAll("fms_production_units"),
    fetchAll("fms_production_master_managers"),
    fetchAll("fms_production_master_requests"),
    fetchAll("fms_production_requests", "submitted_at"),
    fetchAll("fms_production_activity"),
    fetchAll("fms_production_notifications"),
  ]);

  const byKey = new Map<string, any>(configRows.map((r) => [r.key, r.value ?? {}]));
  const config: ProductionConfig = {
    processCoordinatorIds: (byKey.get("process_coordinators")?.user_ids ?? []) as string[],
    stepSla: resolveStepSla(byKey.get("step_sla")),
  };

  return {
    stepOwners: stepOwners.map(mapStepOwner),
    designations: designations.map(mapDesignation),
    config,
    categories: categories.map(mapMaster),
    rawMaterials: rawMaterials.map((r) => ({ ...mapMaster(r), unitId: r.unit_id ?? null })),
    fgItems: fgItems.map(mapMaster),
    units: units.map(mapMaster),
    masterManagers: masterManagers.map(mapMasterManager),
    masterRequests: masterRequests.map(mapMasterRequest),
    requests: requests.map(mapRequest),
    activity: activity.map(mapActivity),
    notifications: notifications.map(mapNotification),
  };
}
