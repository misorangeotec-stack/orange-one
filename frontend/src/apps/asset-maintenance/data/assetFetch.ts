import { supabase } from "@/core/platform/supabase";
// fms_asset_* tables are not in the generated Database types; route table/rpc
// calls through an untyped alias (the row mappers below already treat rows as any).
// This is the standing FMS convention — see order-to-dispatch/data/dispatchFetch.ts.
const db = supabase as any;

import { resolveStepSla, type StepSlaMap } from "../lib/sla";
import type {
  ActivityEntry, Asset, AssetCategory, AssetLocation, AssetNotification, AssetReading,
  AssetSchedule, Company, Department, Designation, FrequencyUnit, JobStatus, MasterManager,
  MasterRequest, NamedMaster, RaisedSource, ReminderLogEntry, ScheduleKind, ScheduleType,
  ServiceJob, StepOwner, Vendor, VerifyOutcome,
} from "../types";

/**
 * Asset Maintenance FMS read layer. One paginated pass over the module's tables,
 * mapped snake_case → camelCase. The whole module loads in one snapshot so the
 * pure queue rules (lib/queues.ts) get plain data, and the Control Center adapter
 * + My Work provider can reuse this exact react-query cache entry.
 *
 * ⚠ Schedules are fetched as their OWN paginated pass and grouped in memory, not
 *   as a nested PostgREST select (`assets(*, schedules(*))`) — a nested select
 *   silently truncates at the API row limit once the asset count grows. Same trap
 *   the dispatch fetcher documents for order lines.
 *
 * ⚠ Every `.range()` is paired with an `.order()`. Postgres makes no ordering
 *   promise without one, so paging an unordered relation can return the same row
 *   on two pages and drop another entirely.
 */

const PAGE = 1000;

type Tbl =
  | "fms_asset_step_owners"
  | "fms_asset_config"
  | "fms_asset_schedule_types"
  | "fms_asset_categories"
  | "fms_asset_locations"
  | "fms_asset_vendors"
  | "fms_asset_makes"
  | "fms_asset_companies"
  | "fms_asset_conditions"
  | "fms_asset_usage_units"
  | "fms_asset_cost_heads"
  | "fms_asset_master_managers"
  | "fms_asset_master_requests"
  | "fms_asset_assets"
  | "fms_asset_schedules"
  | "fms_asset_readings"
  | "fms_asset_jobs"
  | "fms_asset_reminder_log"
  | "fms_asset_activity"
  | "fms_asset_notifications"
  | "designations"
  | "departments";

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

export interface AssetConfig {
  processCoordinatorIds: string[];
  stepSla: StepSlaMap;
  /**
   * Days-before-due at which a reminder fires, descending. Read SERVER-side by
   * fms_asset_send_reminders; surfaced here so Setup can show and edit it.
   */
  reminderLadder: number[];
}

export const DEFAULT_REMINDER_LADDER = [45, 30, 15, 7, 1];

/** The react-query key. Keyed on the REAL session user id, shared with the adapter. */
export const ASSET_QK = ["assetMaintenanceData"] as const;
export const assetQueryKey = (userId: string | null) => [...ASSET_QK, userId] as const;

export interface AssetData {
  stepOwners: StepOwner[];
  designations: Designation[];
  departments: Department[];
  config: AssetConfig;

  scheduleTypes: ScheduleType[];
  categories: AssetCategory[];
  locations: AssetLocation[];
  vendors: Vendor[];
  makes: NamedMaster[];
  companies: Company[];
  conditions: NamedMaster[];
  usageUnits: NamedMaster[];
  costHeads: NamedMaster[];

  masterManagers: MasterManager[];
  masterRequests: MasterRequest[];

  assets: Asset[];
  jobs: ServiceJob[];
  readings: AssetReading[];
  reminderLog: ReminderLogEntry[];
  activity: ActivityEntry[];
  notifications: AssetNotification[];
}

const num = (v: any): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
const str = (v: any): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const arr = (v: any): string[] => (Array.isArray(v) ? v.map(String) : []);

const mapMaster = (r: any): NamedMaster => ({
  id: r.id, name: r.name, active: r.active, sortOrder: r.sort_order ?? 0,
});

const mapScheduleType = (r: any): ScheduleType => ({
  ...mapMaster(r),
  kind: (r.kind ?? "service") as ScheduleKind,
  defaultFrequencyValue: num(r.default_frequency_value),
  defaultFrequencyUnit: (str(r.default_frequency_unit) as FrequencyUnit | null),
  defaultLeadDays: Number(r.default_lead_days ?? 15),
});

const mapCategory = (r: any): AssetCategory => ({
  ...mapMaster(r),
  defaultLeadDays: num(r.default_lead_days),
  defaultScheduleTypeIds: arr(r.default_schedule_type_ids),
});

const mapLocation = (r: any): AssetLocation => ({ ...mapMaster(r), address: str(r.address) });

const mapVendor = (r: any): Vendor => ({
  ...mapMaster(r),
  contactPerson: str(r.contact_person), phone: str(r.phone), email: str(r.email),
  gstin: str(r.gstin), address: str(r.address),
});

const mapCompany = (r: any): Company => ({ ...mapMaster(r), gstin: str(r.gstin), address: str(r.address) });

const mapSchedule = (r: any): AssetSchedule => ({
  id: r.id,
  assetId: r.asset_id,
  scheduleTypeId: r.schedule_type_id,
  frequencyValue: num(r.frequency_value),
  frequencyUnit: (r.frequency_unit ?? "months") as FrequencyUnit,
  lastDoneDate: str(r.last_done_date),
  nextDueDate: str(r.next_due_date),
  leadDays: Number(r.lead_days ?? 15),
  usageInterval: num(r.usage_interval),
  usageAtLastDone: num(r.usage_at_last_done),
  refNo: str(r.ref_no),
  provider: str(r.provider),
  amount: num(r.amount),
  notes: str(r.notes),
  active: !!r.active,
});

const mapAsset = (r: any, schedules: AssetSchedule[]): Asset => ({
  id: r.id,
  assetNo: r.asset_no,
  name: r.name,
  categoryId: str(r.category_id),
  makeId: str(r.make_id),
  model: str(r.model),
  serialNo: str(r.serial_no),
  companyId: str(r.company_id),
  locationId: str(r.location_id),
  departmentId: str(r.department_id),
  custodianUserId: str(r.custodian_user_id),
  purchaseDate: str(r.purchase_date),
  purchaseCost: num(r.purchase_cost),
  vendorId: str(r.vendor_id),
  invoiceNo: str(r.invoice_no),
  invoicePath: str(r.invoice_path),
  invoiceName: str(r.invoice_name),
  warrantyMonths: num(r.warranty_months),
  conditionId: str(r.condition_id),
  usageUnitId: str(r.usage_unit_id),
  currentUsage: num(r.current_usage),
  usageAsOn: str(r.usage_as_on),
  retiredOn: str(r.retired_on),
  retiredReason: str(r.retired_reason),
  remarks: str(r.remarks),
  active: !!r.active,
  createdBy: str(r.created_by),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  schedules,
});

const mapJob = (r: any): ServiceJob => ({
  id: r.id,
  jobNo: r.job_no,
  assetId: r.asset_id,
  scheduleId: r.schedule_id,
  scheduleTypeId: str(r.schedule_type_id),
  dueDate: str(r.due_date),
  status: r.status as JobStatus,
  currentStep: str(r.current_step),
  holdFromStatus: str(r.hold_from_status),
  raisedSource: (r.raised_source ?? "auto") as RaisedSource,
  raisedBy: str(r.raised_by),

  scActualDate: str(r.sc_actual_date),
  scPlannedDate: str(r.sc_planned_date),
  scVendorId: str(r.sc_vendor_id),
  scRemarks: str(r.sc_remarks),
  scAt: str(r.sc_at),
  scBy: str(r.sc_by),

  sdActualDate: str(r.sd_actual_date),
  sdVendorId: str(r.sd_vendor_id),
  sdCost: num(r.sd_cost),
  sdCostHeadId: str(r.sd_cost_head_id),
  sdBillNo: str(r.sd_bill_no),
  sdBillPath: str(r.sd_bill_path),
  sdBillName: str(r.sd_bill_name),
  sdMeterReading: num(r.sd_meter_reading),
  sdRemarks: str(r.sd_remarks),
  sdAt: str(r.sd_at),
  sdBy: str(r.sd_by),

  vcActualDate: str(r.vc_actual_date),
  vcOutcome: (str(r.vc_outcome) as VerifyOutcome | null),
  vcNewDueDate: str(r.vc_new_due_date),
  vcNewRefNo: str(r.vc_new_ref_no),
  vcNewAmount: num(r.vc_new_amount),
  vcRemarks: str(r.vc_remarks),
  vcAt: str(r.vc_at),
  vcBy: str(r.vc_by),

  holdReason: str(r.hold_reason),
  heldAt: str(r.held_at),
  heldBy: str(r.held_by),
  cancelReason: str(r.cancel_reason),
  cancelledAt: str(r.cancelled_at),
  cancelledBy: str(r.cancelled_by),
  skippedReason: str(r.skipped_reason),
  closedAt: str(r.closed_at),

  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function fetchAssetData(): Promise<AssetData> {
  const [
    stepOwnerRows, configRows, designationRows, departmentRows,
    scheduleTypeRows, categoryRows, locationRows, vendorRows, makeRows,
    companyRows, conditionRows, usageUnitRows, costHeadRows,
    managerRows, requestRows,
    assetRows, scheduleRows, readingRows, jobRows, reminderRows,
    activityRows, notificationRows,
  ] = await Promise.all([
    fetchAll("fms_asset_step_owners"),
    fetchAll("fms_asset_config", "key"),
    fetchAll("designations", "name"),
    fetchAll("departments", "name"),
    fetchAll("fms_asset_schedule_types", "sort_order"),
    fetchAll("fms_asset_categories", "sort_order"),
    fetchAll("fms_asset_locations", "sort_order"),
    fetchAll("fms_asset_vendors", "sort_order"),
    fetchAll("fms_asset_makes", "sort_order"),
    fetchAll("fms_asset_companies", "sort_order"),
    fetchAll("fms_asset_conditions", "sort_order"),
    fetchAll("fms_asset_usage_units", "sort_order"),
    fetchAll("fms_asset_cost_heads", "sort_order"),
    fetchAll("fms_asset_master_managers"),
    fetchAll("fms_asset_master_requests"),
    fetchAll("fms_asset_assets"),
    fetchAll("fms_asset_schedules"),
    fetchAll("fms_asset_readings"),
    fetchAll("fms_asset_jobs"),
    fetchAll("fms_asset_reminder_log"),
    fetchAll("fms_asset_activity"),
    fetchAll("fms_asset_notifications"),
  ]);

  const byKey = new Map<string, any>(configRows.map((r: any) => [r.key, r.value ?? {}]));
  const ladderRaw = byKey.get("reminder_ladder")?.days;
  const config: AssetConfig = {
    processCoordinatorIds: byKey.get("process_coordinators")?.user_ids ?? [],
    stepSla: resolveStepSla(byKey.get("step_sla")),
    reminderLadder: Array.isArray(ladderRaw) && ladderRaw.length
      ? ladderRaw.map(Number).filter((n: number) => Number.isFinite(n) && n > 0).sort((a: number, b: number) => b - a)
      : DEFAULT_REMINDER_LADDER,
  };

  const schedulesByAsset = new Map<string, AssetSchedule[]>();
  for (const r of scheduleRows) {
    const s = mapSchedule(r);
    const list = schedulesByAsset.get(s.assetId);
    if (list) list.push(s);
    else schedulesByAsset.set(s.assetId, [s]);
  }

  return {
    stepOwners: stepOwnerRows.map((r: any) => ({
      id: r.id, stepKey: r.step_key, departmentIds: arr(r.department_ids),
      designationId: str(r.designation_id), employeeIds: arr(r.employee_ids),
    })),
    designations: designationRows.map((r: any) => ({ id: r.id, name: r.name })),
    departments: departmentRows.map((r: any) => ({ id: r.id, name: r.name })),
    config,

    scheduleTypes: scheduleTypeRows.map(mapScheduleType),
    categories: categoryRows.map(mapCategory),
    locations: locationRows.map(mapLocation),
    vendors: vendorRows.map(mapVendor),
    makes: makeRows.map(mapMaster),
    companies: companyRows.map(mapCompany),
    conditions: conditionRows.map(mapMaster),
    usageUnits: usageUnitRows.map(mapMaster),
    costHeads: costHeadRows.map(mapMaster),

    masterManagers: managerRows.map((r: any) => ({
      id: r.id, masterType: r.master_type, managerUserId: r.manager_user_id,
    })),
    masterRequests: requestRows.map((r: any) => ({
      id: r.id, masterType: r.master_type, proposedPayload: r.proposed_payload ?? {},
      status: r.status, requestedBy: str(r.requested_by), reviewedBy: str(r.reviewed_by),
      reviewNote: str(r.review_note), resolvedMasterId: str(r.resolved_master_id),
      createdAt: r.created_at, updatedAt: r.updated_at,
    })),

    assets: assetRows.map((r: any) => mapAsset(r, schedulesByAsset.get(r.id) ?? [])),
    jobs: jobRows.map(mapJob),
    readings: readingRows.map((r: any) => ({
      id: r.id, assetId: r.asset_id, readingDate: r.reading_date, reading: Number(r.reading),
      note: str(r.note), recordedBy: str(r.recorded_by), createdAt: r.created_at,
    })),
    reminderLog: reminderRows.map((r: any) => ({
      id: r.id, jobId: r.job_id, reminderOn: r.reminder_on, tier: r.tier, createdAt: r.created_at,
    })),
    activity: activityRows.map((r: any) => ({
      id: r.id, entityType: r.entity_type, entityId: r.entity_id, type: r.type,
      actorId: str(r.actor_id), note: str(r.note), meta: r.meta ?? {}, createdAt: r.created_at,
    })),
    notifications: notificationRows.map((r: any) => ({
      id: r.id, userId: r.user_id, type: r.type, entityType: r.entity_type, entityId: r.entity_id,
      text: r.text, actorId: str(r.actor_id), readAt: str(r.read_at), createdAt: r.created_at,
    })),
  };
}
