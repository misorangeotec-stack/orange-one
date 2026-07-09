import { supabase } from "@/core/platform/supabase";
import { resolveStepSla, type StepSlaMap } from "../lib/sla";
import type {
  Company,
  Category,
  ItemGroup,
  Item,
  Vendor,
  MasterManager,
  MasterRequest,
  MasterType,
  MasterRequestStatus,
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
  ProcNotification,
  ProcEntityType,
} from "../types";

/**
 * Procurement read layer. Loads the masters + governance tables for the
 * signed-in user (all RLS-readable) via paginated range reads, and maps the
 * snake_case rows to the camelCase domain types the screens consume. Mirrors
 * the task-management `fetchTaskData` shape (paginate to bypass PostgREST's
 * 1000-row cap, then map in memory).
 */

const PAGE = 1000;

type Tbl =
  | "fms_purchase_companies"
  | "fms_purchase_categories"
  | "fms_purchase_item_groups"
  | "fms_purchase_items"
  | "fms_purchase_vendors"
  | "fms_purchase_master_managers"
  | "fms_purchase_master_requests"
  | "fms_purchase_step_owners"
  | "fms_purchase_approval_matrix"
  | "fms_purchase_config"
  | "designations"
  | "fms_purchase_requests"
  | "fms_purchase_request_items"
  | "fms_purchase_quotations"
  | "fms_purchase_pos"
  | "fms_purchase_po_items"
  | "fms_purchase_pis"
  | "fms_purchase_pi_items"
  | "fms_purchase_grns"
  | "fms_purchase_grn_items"
  | "fms_purchase_tally_bookings"
  | "fms_purchase_payments"
  | "fms_purchase_followups"
  | "fms_purchase_activity"
  | "fms_purchase_notifications";

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

export interface ProcConfig {
  processCoordinatorIds: string[];
  amountBasis: string;
  /** Per-step due-date rules (anchor + working days), merged over the code defaults. */
  stepSla: StepSlaMap;
}

/**
 * The react-query key for `fetchProcurementData`. Exported so that consumers
 * outside this app (the FMS Control Center's purchase adapter) share the same
 * cache entry instead of issuing a second copy of the ~25 table reads. Key on
 * the REAL session user id — never the impersonated persona — to match the
 * store; admin RLS returns all rows, so switching persona must not refetch.
 */
export const PROCUREMENT_QK = ["procurementData"] as const;
export const procurementQueryKey = (userId: string | null) => [...PROCUREMENT_QK, userId] as const;

export interface ProcurementData {
  companies: Company[];
  categories: Category[];
  itemGroups: ItemGroup[];
  items: Item[];
  vendors: Vendor[];
  masterManagers: MasterManager[];
  masterRequests: MasterRequest[];
  designations: Designation[];
  stepOwners: StepOwner[];
  approvalBands: ApprovalBand[];
  config: ProcConfig;
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
  notifications: ProcNotification[];
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
  gstin: r.gstin ?? null,
  contactName: r.contact_name ?? null,
  phone: r.phone ?? null,
  email: r.email ?? null,
  address: r.address ?? null,
  active: r.active,
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
  gstPct: num(r.gst_pct),
  lineValue: num(r.line_value),
  status: r.status as LineStatus,
  approverId: r.approver_id ?? null,
  approvalTier: r.approval_tier ?? null,
  assignedApproverId: r.assigned_approver_id ?? null,
  rejectReason: r.reject_reason ?? null,
  cancelReason: r.cancel_reason ?? null,
  sourcedAt: r.sourced_at ?? null,
  approvedAt: r.approved_at ?? null,
  createdAt: r.created_at,
});

const mapQuotation = (r: any): Quotation => ({
  id: r.id,
  requestItemId: r.request_item_id,
  vendorId: r.vendor_id,
  rate: Number(r.rate),
  gstPct: num(r.gst_pct),
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
  advancePaid: Number(r.advance_paid ?? 0),
  paymentTerms: (r.payment_terms ?? null) as PurchaseOrder["paymentTerms"],
  dispatchDate: r.dispatch_date ?? null,
  sharedAt: r.shared_at ?? null,
  documentPath: r.document_path ?? null,
  documentName: r.document_name ?? null,
  tallyPoNo: r.tally_po_no ?? null,
  shareRemarks: r.share_remarks ?? null,
  createdBy: r.created_by ?? null,
  createdAt: r.created_at,
});

const mapPoItem = (r: any): PoItem => ({
  id: r.id,
  poId: r.po_id,
  requestItemId: r.request_item_id,
  qty: Number(r.qty),
  rate: Number(r.rate),
  gstPct: num(r.gst_pct),
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
  createdAt: r.created_at,
});

const mapPayment = (r: any): Payment => ({
  id: r.id,
  poId: r.po_id,
  piId: r.pi_id ?? null,
  kind: r.kind as PaymentKind,
  amount: Number(r.amount),
  paidOn: r.paid_on,
  utrRef: r.utr_ref ?? null,
  piRemarks: r.pi_remarks ?? null,
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
  createdAt: r.created_at,
});

const mapActivity = (r: any): Activity => ({
  id: r.id,
  entityType: r.entity_type as ProcEntityType,
  entityId: r.entity_id,
  type: r.type,
  actorId: r.actor_id ?? null,
  note: r.note ?? null,
  meta: (r.meta ?? {}) as Record<string, unknown>,
  createdAt: r.created_at,
});

const mapNotification = (r: any): ProcNotification => ({
  id: r.id,
  userId: r.user_id,
  type: r.type,
  entityType: r.entity_type as ProcEntityType,
  entityId: r.entity_id,
  text: r.text,
  actorId: r.actor_id ?? null,
  readAt: r.read_at ?? null,
  createdAt: r.created_at,
});


export async function fetchProcurementData(): Promise<ProcurementData> {
  const [
    companies,
    categories,
    itemGroups,
    items,
    vendors,
    managers,
    masterReqs,
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
    fetchAll("fms_purchase_companies"),
    fetchAll("fms_purchase_categories"),
    fetchAll("fms_purchase_item_groups"),
    fetchAll("fms_purchase_items"),
    fetchAll("fms_purchase_vendors"),
    fetchAll("fms_purchase_master_managers"),
    fetchAll("fms_purchase_master_requests"),
    fetchAll("designations"),
    fetchAll("fms_purchase_step_owners"),
    fetchAll("fms_purchase_approval_matrix"),
    fetchAll("fms_purchase_config", "key"),
    fetchAll("fms_purchase_requests"),
    fetchAll("fms_purchase_request_items"),
    fetchAll("fms_purchase_quotations"),
    fetchAll("fms_purchase_pos"),
    fetchAll("fms_purchase_po_items"),
    fetchAll("fms_purchase_pis"),
    fetchAll("fms_purchase_pi_items"),
    fetchAll("fms_purchase_grns"),
    fetchAll("fms_purchase_grn_items"),
    fetchAll("fms_purchase_tally_bookings"),
    fetchAll("fms_purchase_payments"),
    fetchAll("fms_purchase_followups"),
    fetchAll("fms_purchase_activity"),
    fetchAll("fms_purchase_notifications"),
  ]);

  const configByKey = new Map<string, any>(configRows.map((r) => [r.key, r.value ?? {}]));
  const config: ProcConfig = {
    processCoordinatorIds: (configByKey.get("process_coordinators")?.user_ids ?? []) as string[],
    amountBasis: (configByKey.get("amount_basis")?.value ?? "line_incl_gst") as string,
    // Unset or partially-stored rules fall back to the code defaults.
    stepSla: resolveStepSla(configByKey.get("step_sla")),
  };

  return {
    companies: companies.map(mapCompany),
    categories: categories.map(mapCategory),
    itemGroups: itemGroups.map(mapItemGroup),
    items: items.map(mapItem),
    vendors: vendors.map(mapVendor),
    masterManagers: managers.map(mapManager),
    masterRequests: masterReqs.map(mapMasterRequest),
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
