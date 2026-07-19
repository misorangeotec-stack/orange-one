import { supabase } from "@/core/platform/supabase";
// fms_import_* tables are not yet in the generated Database types; route table/rpc
// calls through an untyped alias (the row mappers below already treat rows as any).
/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabase as any;
import { resolveStepSla, type StepSlaMap } from "../lib/sla";
import type {
  Company,
  Category,
  ItemGroup,
  Item,
  Vendor,
  VendorItemPrice,
  MasterManager,
  MasterRequest,
  MasterType,
  MasterRequestStatus,
  PoCancelRequest,
  PoCancelRequestStatus,
  Designation,
  StepOwner,
  ApprovalBand,
  PurchaseRequest,
  RequestItem,
  Quotation,
  PurchaseOrder,
  PoItem,
  RequestStatus,
  LineStatus,
  Pi,
  PiItem,
  Grn,
  GrnItem,
  TallyBooking,
  Payment,
  Followup,
  PaymentTerms,
  PiStatus,
  DispatchStatus,
  GrnCondition,
  PaymentKind,
  Activity,
  ImportNotification,
  ImportEntityType,
} from "../types";

/**
 * Import read layer. Loads the masters + governance tables for the
 * signed-in user (all RLS-readable) via paginated range reads, and maps the
 * snake_case rows to the camelCase domain types the screens consume. Mirrors
 * the task-management `fetchTaskData` shape (paginate to bypass PostgREST's
 * 1000-row cap, then map in memory).
 */

const PAGE = 1000;

type Tbl =
  | "fms_import_companies"
  | "fms_import_categories"
  | "fms_import_item_groups"
  | "fms_import_items"
  | "fms_import_vendors"
  | "fms_import_vendor_item_prices"
  | "fms_import_master_managers"
  | "fms_import_master_requests"
  | "fms_import_po_cancel_requests"
  | "fms_import_step_owners"
  | "fms_import_approval_matrix"
  | "fms_import_config"
  | "designations"
  | "fms_import_requests"
  | "fms_import_request_items"
  | "fms_import_quotations"
  | "fms_import_pos"
  | "fms_import_po_items"
  | "fms_import_pis"
  | "fms_import_pi_items"
  | "fms_import_grns"
  | "fms_import_grn_items"
  | "fms_import_tally_bookings"
  | "fms_import_payments"
  | "fms_import_followups"
  | "fms_import_activity"
  | "fms_import_notifications";

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

export interface ImportConfig {
  processCoordinatorIds: string[];
  /** Per-step due-date rules (anchor + working days), merged over the code defaults. */
  stepSla: StepSlaMap;
}

/**
 * The react-query key for `fetchImportData`. Exported so that consumers
 * outside this app (the FMS Control Center's purchase adapter) share the same
 * cache entry instead of issuing a second copy of the ~25 table reads. Key on
 * the REAL session user id — never the impersonated persona — to match the
 * store; admin RLS returns all rows, so switching persona must not refetch.
 */
export const IMPORT_QK = ["importData"] as const;
export const importQueryKey = (userId: string | null) => [...IMPORT_QK, userId] as const;

export interface ImportData {
  companies: Company[];
  categories: Category[];
  itemGroups: ItemGroup[];
  items: Item[];
  vendors: Vendor[];
  vendorItemPrices: VendorItemPrice[];
  masterManagers: MasterManager[];
  masterRequests: MasterRequest[];
  poCancelRequests: PoCancelRequest[];
  designations: Designation[];
  stepOwners: StepOwner[];
  approvalBands: ApprovalBand[];
  config: ImportConfig;
  requests: PurchaseRequest[];
  requestItems: RequestItem[];
  quotations: Quotation[];
  pos: PurchaseOrder[];
  poItems: PoItem[];
  pis: Pi[];
  piItems: PiItem[];
  grns: Grn[];
  grnItems: GrnItem[];
  tallyBookings: TallyBooking[];
  payments: Payment[];
  followups: Followup[];
  activity: Activity[];
  notifications: ImportNotification[];
}

const mapCompany = (r: any): Company => ({
  id: r.id,
  name: r.name,
  location: r.location ?? null,
  active: r.active,
  sortOrder: r.sort_order ?? 0,
  createdAt: r.created_at,
});

const mapCategory = (r: any): Category => ({
  id: r.id,
  name: r.name,
  active: r.active,
  sortOrder: r.sort_order ?? 0,
  createdAt: r.created_at,
});

const mapItemGroup = (r: any): ItemGroup => ({
  id: r.id,
  categoryId: r.category_id,
  name: r.name,
  active: r.active,
  sortOrder: r.sort_order ?? 0,
  createdAt: r.created_at,
});

const mapItem = (r: any): Item => ({
  id: r.id,
  itemGroupId: r.item_group_id,
  name: r.name,
  unit: r.unit ?? "",
  active: r.active,
  sortOrder: r.sort_order ?? 0,
  createdAt: r.created_at,
});

const mapVendor = (r: any): Vendor => ({
  id: r.id,
  name: r.name,
  contactName: r.contact_name ?? null,
  phone: r.phone ?? null,
  email: r.email ?? null,
  address: r.address ?? null,
  defaultCurrency: r.default_currency ?? null,
  active: r.active,
  createdAt: r.created_at,
});

const mapVendorItemPrice = (r: any): VendorItemPrice => ({
  id: r.id,
  vendorId: r.vendor_id,
  itemId: r.item_id,
  currency: r.currency ?? "USD",
  rate: Number(r.rate ?? 0),
  active: r.active,
  sortOrder: r.sort_order ?? 0,
  createdAt: r.created_at,
});

const mapManager = (r: any): MasterManager => ({
  id: r.id,
  masterType: r.master_type as MasterType,
  managerUserId: r.manager_user_id,
});

const mapMasterRequest = (r: any): MasterRequest => ({
  id: r.id,
  masterType: r.master_type as MasterType,
  proposedPayload: (r.proposed_payload ?? {}) as Record<string, unknown>,
  status: r.status as MasterRequestStatus,
  requestedBy: r.requested_by ?? null,
  reviewedBy: r.reviewed_by ?? null,
  reviewNote: r.review_note ?? null,
  resolvedMasterId: r.resolved_master_id ?? null,
  createdAt: r.created_at,
});

const mapPoCancelRequest = (r: any): PoCancelRequest => ({
  id: r.id,
  poId: r.po_id,
  reason: r.reason,
  vendorRef: r.vendor_ref ?? null,
  status: r.status as PoCancelRequestStatus,
  requestedBy: r.requested_by ?? null,
  reviewedBy: r.reviewed_by ?? null,
  reviewNote: r.review_note ?? null,
  createdAt: r.created_at,
});

const mapDesignation = (r: any): Designation => ({
  id: r.id,
  name: r.name,
  active: r.active,
});

const mapStepOwner = (r: any): StepOwner => {
  const ids = (r.department_ids ?? []) as string[];
  return {
    id: r.id,
    stepKey: r.step_key,
    departmentId: r.department_id ?? null,
    // Fall back to the legacy single column for rows written before the array existed.
    departmentIds: ids.length ? ids : r.department_id ? [r.department_id] : [],
    designationId: r.designation_id ?? null,
    employeeIds: (r.employee_ids ?? []) as string[],
  };
};

const mapApprovalBand = (r: any): ApprovalBand => ({
  id: r.id,
  tierLabel: r.tier_label,
  minAmount: Number(r.min_amount ?? 0),
  maxAmount: r.max_amount === null || r.max_amount === undefined ? null : Number(r.max_amount),
  approverUserId: r.approver_user_id,
  sortOrder: r.sort_order ?? 0,
  active: r.active,
});

const num = (v: any): number | null => (v === null || v === undefined ? null : Number(v));

const mapRequest = (r: any): PurchaseRequest => ({
  id: r.id,
  requestNo: r.request_no,
  companyId: r.company_id,
  categoryId: r.category_id,
  vendorId: r.vendor_id ?? null,
  currency: r.currency ?? null,
  requesterId: r.requester_id ?? null,
  status: r.status as RequestStatus,
  note: r.note ?? null,
  createdAt: r.created_at,
});

const mapRequestItem = (r: any): RequestItem => ({
  id: r.id,
  requestId: r.request_id,
  itemId: r.item_id,
  quantity: Number(r.quantity),
  unit: r.unit ?? "",
  lineRemark: r.line_remark ?? null,
  sourcingReason: r.sourcing_reason ?? null,
  finalVendorId: r.final_vendor_id ?? null,
  finalQty: num(r.final_qty),
  finalRate: num(r.final_rate),
  currency: r.currency ?? null,
  fxRateAtRequest: num(r.fx_rate_at_request),
  lineValueFx: num(r.line_value_fx),
  lineValue: num(r.line_value),
  status: r.status as LineStatus,
  approverId: r.approver_id ?? null,
  approvalTier: r.approval_tier ?? null,
  assignedApproverId: r.assigned_approver_id ?? null,
  rejectReason: r.reject_reason ?? null,
  cancelReason: r.cancel_reason ?? null,
  sourcedAt: r.sourced_at ?? null,
  approvedAt: r.approved_at ?? null,
  editedAt: r.edited_at ?? null,
  editedBy: r.edited_by ?? null,
  createdAt: r.created_at,
});

const mapQuotation = (r: any): Quotation => ({
  id: r.id,
  requestItemId: r.request_item_id,
  vendorId: r.vendor_id,
  rate: Number(r.rate),
  leadTimeDays: r.lead_time_days ?? null,
  remark: r.remark ?? null,
  isRecommended: r.is_recommended,
});

const mapPo = (r: any): PurchaseOrder => ({
  id: r.id,
  poNo: r.po_no,
  vendorId: r.vendor_id,
  companyId: r.company_id,
  currentStage: r.current_stage,
  totalValue: Number(r.total_value ?? 0),
  totalValueFx: Number(r.total_value_fx ?? 0),
  currency: r.currency ?? null,
  fxRate: num(r.fx_rate),
  fxRateAt: r.fx_rate_at ?? null,
  fxSource: r.fx_source ?? null,
  advancePaid: Number(r.advance_paid ?? 0),
  paymentTerms: (r.payment_terms ?? null) as PurchaseOrder["paymentTerms"],
  dispatchDate: r.dispatch_date ?? null,
  sharedAt: r.shared_at ?? null,
  sharedBy: r.shared_by ?? null,
  documentPath: r.document_path ?? null,
  documentName: r.document_name ?? null,
  tallyPoNo: r.tally_po_no ?? null,
  shareRemarks: r.share_remarks ?? null,
  createdBy: r.created_by ?? null,
  createdAt: r.created_at,
  editedAt: r.edited_at ?? null,
  editedBy: r.edited_by ?? null,
  cancelledBy: r.cancelled_by ?? null,
  cancelledAt: r.cancelled_at ?? null,
  cancelReason: r.cancel_reason ?? null,
});

const mapPoItem = (r: any): PoItem => ({
  id: r.id,
  poId: r.po_id,
  requestItemId: r.request_item_id,
  qty: Number(r.qty),
  rate: Number(r.rate),
  lineValue: Number(r.line_value),
  receivedQty: Number(r.received_qty ?? 0),
});

const mapPi = (r: any): Pi => ({
  id: r.id,
  poId: r.po_id,
  vendorPiNo: r.vendor_pi_no,
  paymentTerms: r.payment_terms as PaymentTerms,
  piValue: Number(r.pi_value ?? 0),
  dispatchDate: r.dispatch_date ?? null,
  status: r.status as PiStatus,
  dispatchStatus: r.dispatch_status as DispatchStatus,
  actualDispatchDate: r.actual_dispatch_date ?? null,
  lrNo: r.lr_no ?? null,
  transportDetails: r.transport_details ?? null,
  revisedDispatchDate: r.revised_dispatch_date ?? null,
  documentPath: r.document_path ?? null,
  documentName: r.document_name ?? null,
  createdBy: r.created_by ?? null,
  editedAt: r.edited_at ?? null,
  editedBy: r.edited_by ?? null,
  createdAt: r.created_at,
});

const mapPiItem = (r: any): PiItem => ({
  id: r.id,
  piId: r.pi_id,
  poItemId: r.po_item_id,
  qty: Number(r.qty),
});

const mapGrn = (r: any): Grn => ({
  id: r.id,
  poId: r.po_id,
  piId: r.pi_id ?? null,
  poRef: r.po_ref ?? null,
  piRef: r.pi_ref ?? null,
  gateRegisterNo: r.gate_register_no ?? null,
  condition: r.condition as GrnCondition,
  note: r.note ?? null,
  photoPath: r.photo_path ?? null,
  photoName: r.photo_name ?? null,
  receivedBy: r.received_by ?? null,
  editedAt: r.edited_at ?? null,
  editedBy: r.edited_by ?? null,
  createdAt: r.created_at,
});

const mapGrnItem = (r: any): GrnItem => ({
  id: r.id,
  grnId: r.grn_id,
  poItemId: r.po_item_id,
  receivedQty: Number(r.received_qty),
  condition: r.condition as GrnCondition,
});

const mapTally = (r: any): TallyBooking => ({
  id: r.id,
  poId: r.po_id,
  grnId: r.grn_id ?? null,
  tallyPiNo: r.tally_pi_no,
  documentPath: r.document_path ?? null,
  documentName: r.document_name ?? null,
  remarks: r.remarks ?? null,
  bookedBy: r.booked_by ?? null,
  editedAt: r.edited_at ?? null,
  editedBy: r.edited_by ?? null,
  createdAt: r.created_at,
});

const mapPayment = (r: any): Payment => ({
  id: r.id,
  poId: r.po_id,
  piId: r.pi_id ?? null,
  kind: r.kind as PaymentKind,
  amount: Number(r.amount),
  amountFx: num(r.amount_fx),
  currency: r.currency ?? null,
  fxRate: num(r.fx_rate),
  inrAmount: num(r.inr_amount),
  paidOn: r.paid_on,
  utrRef: r.utr_ref ?? null,
  details: r.details ?? null,
  advicePath: r.advice_path ?? null,
  adviceName: r.advice_name ?? null,
  piRemarks: r.pi_remarks ?? null,
  createdBy: r.created_by ?? null,
  editedAt: r.edited_at ?? null,
  editedBy: r.edited_by ?? null,
  createdAt: r.created_at,
});

const mapFollowup = (r: any): Followup => ({
  id: r.id,
  piId: r.pi_id ?? null,
  poId: r.po_id,
  dispatchStatus: r.dispatch_status as DispatchStatus,
  actualDispatchDate: r.actual_dispatch_date ?? null,
  revisedDispatchDate: r.revised_dispatch_date ?? null,
  lrNo: r.lr_no ?? null,
  transportDetails: r.transport_details ?? null,
  remarks: r.remarks ?? null,
  piRemarks: r.pi_remarks ?? null,
  createdBy: r.created_by ?? null,
  editedAt: r.edited_at ?? null,
  editedBy: r.edited_by ?? null,
  createdAt: r.created_at,
});

const mapActivity = (r: any): Activity => ({
  id: r.id,
  entityType: r.entity_type as ImportEntityType,
  entityId: r.entity_id,
  type: r.type,
  actorId: r.actor_id ?? null,
  note: r.note ?? null,
  meta: (r.meta ?? {}) as Record<string, unknown>,
  createdAt: r.created_at,
});

const mapNotification = (r: any): ImportNotification => ({
  id: r.id,
  userId: r.user_id,
  type: r.type,
  entityType: r.entity_type as ImportEntityType,
  entityId: r.entity_id,
  text: r.text,
  actorId: r.actor_id ?? null,
  readAt: r.read_at ?? null,
  createdAt: r.created_at,
});


export async function fetchImportData(): Promise<ImportData> {
  const [
    companies,
    categories,
    itemGroups,
    items,
    vendors,
    vendorItemPrices,
    managers,
    masterReqs,
    poCancelReqs,
    designations,
    stepOwners,
    bands,
    configRows,
    requests,
    requestItems,
    quotations,
    pos,
    poItems,
    pis,
    piItems,
    grns,
    grnItems,
    tallyBookings,
    payments,
    followups,
    activity,
    notifications,
  ] = await Promise.all([
    fetchAll("fms_import_companies"),
    fetchAll("fms_import_categories"),
    fetchAll("fms_import_item_groups"),
    fetchAll("fms_import_items"),
    fetchAll("fms_import_vendors"),
    fetchAll("fms_import_vendor_item_prices"),
    fetchAll("fms_import_master_managers"),
    fetchAll("fms_import_master_requests"),
    fetchAll("fms_import_po_cancel_requests"),
    fetchAll("designations"),
    fetchAll("fms_import_step_owners"),
    fetchAll("fms_import_approval_matrix"),
    fetchAll("fms_import_config", "key"),
    fetchAll("fms_import_requests"),
    fetchAll("fms_import_request_items"),
    fetchAll("fms_import_quotations"),
    fetchAll("fms_import_pos"),
    fetchAll("fms_import_po_items"),
    fetchAll("fms_import_pis"),
    fetchAll("fms_import_pi_items"),
    fetchAll("fms_import_grns"),
    fetchAll("fms_import_grn_items"),
    fetchAll("fms_import_tally_bookings"),
    fetchAll("fms_import_payments"),
    fetchAll("fms_import_followups"),
    fetchAll("fms_import_activity"),
    fetchAll("fms_import_notifications"),
  ]);

  const configByKey = new Map<string, any>(configRows.map((r) => [r.key, r.value ?? {}]));
  const config: ImportConfig = {
    processCoordinatorIds: (configByKey.get("process_coordinators")?.user_ids ?? []) as string[],
    // Unset or partially-stored rules fall back to the code defaults.
    stepSla: resolveStepSla(configByKey.get("step_sla")),
  };

  return {
    companies: companies.map(mapCompany),
    categories: categories.map(mapCategory),
    itemGroups: itemGroups.map(mapItemGroup),
    items: items.map(mapItem),
    vendors: vendors.map(mapVendor),
    vendorItemPrices: vendorItemPrices.map(mapVendorItemPrice),
    masterManagers: managers.map(mapManager),
    masterRequests: masterReqs.map(mapMasterRequest),
    poCancelRequests: poCancelReqs.map(mapPoCancelRequest),
    designations: designations.map(mapDesignation),
    stepOwners: stepOwners.map(mapStepOwner),
    approvalBands: bands.map(mapApprovalBand),
    config,
    requests: requests.map(mapRequest),
    requestItems: requestItems.map(mapRequestItem),
    quotations: quotations.map(mapQuotation),
    pos: pos.map(mapPo),
    poItems: poItems.map(mapPoItem),
    pis: pis.map(mapPi),
    piItems: piItems.map(mapPiItem),
    grns: grns.map(mapGrn),
    grnItems: grnItems.map(mapGrnItem),
    tallyBookings: tallyBookings.map(mapTally),
    payments: payments.map(mapPayment),
    followups: followups.map(mapFollowup),
    activity: activity.map(mapActivity),
    notifications: notifications.map(mapNotification),
  };
}
