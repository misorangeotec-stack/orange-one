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
  PoCancelRequest,
  PoCancelRequestStatus,
  Designation,
  StepOwner,
  ApprovalBand,
  PurchaseRequest,
  RequestItem,
  RequestVendor,
  SourcingDoc,
  VendorItemPrice,
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
  QcInspection,
  QcItem,
  QcResult,
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
  FollowupItem,
} from "../types";

/**
 * Procurement read layer. Loads the masters + governance tables for the
 * signed-in user (all RLS-readable) via paginated range reads, and maps the
 * snake_case rows to the camelCase domain types the screens consume. Mirrors
 * the task-management `fetchTaskData` shape (paginate to bypass PostgREST's
 * 1000-row cap, then map in memory).
 *
 * CENTRAL MASTERS. Companies, vendors and items are not Purchase's own tables
 * any more — they are the Tally-fed mst_* rows every module shares (the
 * cutover is supabase/purchase-central/01_cutover.sql). They load in THREE
 * places, on purpose:
 *
 *   • fetchProcurementData — only the items the requisitions already name, so
 *     every line renders. A few hundred rows; rides with the working set.
 *   • fetchProcurementMasters — the 5 company books and every vendor ledger,
 *     for the pickers. Its own query key, so a workflow save does not re-pull
 *     3,000 ledgers to learn that a GRN was booked.
 *   • fetchCompanyItems — ONE company's stock book, fetched when a requisition
 *     picks that company. O-tec — Surat alone is 8,000+ items; loading every
 *     book up front would put 14,000 rows behind every visit.
 *
 * Categories, rates and everything else stay Purchase's own.
 */

const PAGE = 1000;

// mst_* tables are not in the generated Database types; the standing FMS
// convention routes them through an untyped alias (see dispatchFetch.ts).
const db = supabase as any;

type Tbl =
  | "fms_purchase_categories"
  | "fms_purchase_item_groups"
  | "fms_purchase_master_managers"
  | "fms_purchase_master_requests"
  | "fms_purchase_po_cancel_requests"
  | "fms_purchase_step_owners"
  | "fms_purchase_approval_matrix"
  | "fms_purchase_config"
  | "designations"
  | "fms_purchase_requests"
  | "fms_purchase_request_items"
  | "fms_purchase_request_vendors"
  | "fms_purchase_sourcing_docs"
  | "fms_purchase_request_docs"
  | "fms_purchase_followup_items"
  | "fms_purchase_vendor_item_prices"
  | "fms_purchase_quotations"
  | "fms_purchase_pos"
  | "fms_purchase_po_items"
  | "fms_purchase_pis"
  | "fms_purchase_pi_items"
  | "fms_purchase_grns"
  | "fms_purchase_grn_items"
  | "fms_purchase_tally_bookings"
  | "fms_purchase_qc_inspections"
  | "fms_purchase_qc_items"
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

/**
 * `fetchAll` for a table the deployed database may not have yet.
 *
 * ⚠ THIS EXISTS FOR EXACTLY ONE HAZARD, the one CLAUDE.md calls out under
 *   "Deploy ordering matters". Every other read here is inside the same
 *   `Promise.all`, and `fetchAll` throws — so one missing relation does not
 *   degrade a panel, it takes down the ENTIRE app's data load. The sourcing
 *   attachments table ships in migration 20260903120000; a frontend that
 *   reaches production first would otherwise black out Purchase for everyone
 *   until the SQL was applied.
 *
 * It swallows ONLY "relation does not exist" (Postgres 42P01, surfaced by
 * PostgREST as PGRST205). Every other error still throws — a permissions
 * failure or a dropped connection must not quietly read as "no attachments".
 *
 * Once the migration is applied everywhere, this can go back to plain
 * `fetchAll`.
 */
async function fetchAllOptional(table: Tbl, orderBy = "created_at"): Promise<any[]> {
  try {
    return await fetchAll(table, orderBy);
  } catch (e) {
    const msg = (e as Error).message ?? "";
    if (/does not exist|schema cache/i.test(msg)) return [];
    throw e;
  }
}

/* ------------------------------ central masters --------------------------- */

type MstTbl = "mst_companies" | "mst_parties" | "mst_items" | "mst_units";

/**
 * The columns each mapper below reads — and nothing else. mst_parties has 26
 * columns and ~7,800 rows; select("*") would ship the credit limits and group
 * chains of every ledger in Tally to fill a vendor dropdown.
 *
 * ⚠ THE MAPPER IS THE CONTRACT. Rows are `any`, so a column dropped here reads
 *   as undefined in the UI with no compiler error. Change both together.
 */
const MST_COLS = {
  companies: "id,name,alias,location,active,sort_order,created_at",
  vendors: "id,name,company_id,gstin,contact_name,phone,email,address,active,created_at",
  items: "id,name,company_id,unit_id,item_type,active,sort_order,created_at",
  units: "id,name",
} as const;

/**
 * A paged read of a Central Masters table.
 *
 * ⚠ ORDERED BY `id`, A UNIQUE KEY. OFFSET paging over a non-unique order skips
 *   and repeats rows between pages, differently on every run, and nothing
 *   errors — CENTRAL-MASTERS.md item 24 is the story of the ~1,600 ledgers that
 *   went missing that way. `created_at` is NOT unique on these tables: the sync
 *   writes them in batches that share a timestamp.
 */
async function fetchMst(table: MstTbl, cols: string, where?: (q: any) => any): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = db.from(table).select(cols);
    if (where) q = where(q);
    const { data, error } = await q.order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * Rows by id, in concurrent chunks. `in` builds a query STRING, and a few
 * hundred uuids already exceed what the gateway accepts as one.
 */
async function fetchMstByIds(table: MstTbl, cols: string, ids: string[]): Promise<any[]> {
  const CHUNK = 200;
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
  const results = await Promise.all(chunks.map((c) => db.from(table).select(cols).in("id", c)));
  const out: any[] = [];
  for (const { data, error } of results) {
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
  }
  return out;
}

const str = (v: any): string | null => (v === null || v === undefined || v === "" ? null : String(v));

/**
 * ⚠ THE NAME SHOWN IS THE ALIAS, NEVER mst_companies.name. `name` is Tally's
 *   book name — "ORANGE O TEC PRIVATE LIMITED (01-04-25TO31-03-27)" — which the
 *   sync rewrites and which is re-minted every April. `alias` is ours and no
 *   sync touches it. The site rides separately in `location`, and every screen
 *   already renders a company as "name — location".
 */
const mapCompany = (r: any): Company => ({
  id: r.id,
  name: str(r.alias) ?? r.name,
  location: str(r.location),
  active: r.active,
  sortOrder: r.sort_order ?? 0,
  createdAt: r.created_at,
});

const mapVendor = (r: any): Vendor => ({
  id: r.id,
  companyId: r.company_id ?? null,
  name: r.name,
  gstin: str(r.gstin),
  contactName: str(r.contact_name),
  phone: str(r.phone),
  email: str(r.email),
  address: str(r.address),
  active: r.active,
  createdAt: r.created_at,
});

const mapItem = (r: any, unitName: Map<string, string>): Item => ({
  id: r.id,
  name: r.name,
  // mst_items points at mst_units; a Purchase line carries the unit's NAME.
  unit: (r.unit_id && unitName.get(r.unit_id)) || "",
  companyId: r.company_id ?? null,
  itemType: str(r.item_type),
  active: r.active,
  sortOrder: r.sort_order ?? 0,
  createdAt: r.created_at,
});

/**
 * LEGACY FALLBACK — for display only, until the cutover has run.
 *
 * Before supabase/purchase-central/01_cutover.sql repoints them, old
 * requisitions, lines and POs still hold the ids of Purchase's own
 * fms_purchase_companies / _vendors / _items rows. Looked up in mst_* alone they
 * render blank. So any id the working set names that is NOT a Central Masters
 * row is read from the legacy table instead. These rows only feed the
 * id → name lookups; they never reach a picker. Once the cutover has run every
 * id resolves in mst_* and these reads come back empty.
 */
type LegacyTbl = "fms_purchase_companies" | "fms_purchase_vendors" | "fms_purchase_items";

async function fetchLegacyByIds(table: LegacyTbl, ids: string[]): Promise<any[]> {
  if (ids.length === 0) return [];
  const CHUNK = 200;
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
  const results = await Promise.all(chunks.map((c) => db.from(table).select("*").in("id", c)));
  const out: any[] = [];
  // A database that has dropped the legacy tables simply has nothing to fall back to.
  for (const { data, error } of results) if (!error) out.push(...(data ?? []));
  return out;
}

const mapLegacyItem = (r: any): Item => ({
  id: r.id,
  name: r.name,
  unit: r.unit ?? "",
  companyId: null,
  itemType: null,
  active: false,
  sortOrder: r.sort_order ?? 0,
  createdAt: r.created_at,
});

async function fetchUnitNames(): Promise<Map<string, string>> {
  const units = await fetchMst("mst_units", MST_COLS.units);
  return new Map(units.map((u: any) => [u.id as string, u.name as string]));
}

/** The pickers' catalogue — see the header. */
export interface ProcurementMasters {
  companies: Company[];
  vendors: Vendor[];
  /** Unit names (KGS, PCS, …) — global, not per company. The item-request form's list. */
  units: string[];
}

/**
 * The catalogue's own react-query key — NOT scoped to the user: RLS on mst_* is
 * "any staff member", so everybody gets the same rows and one entry serves all.
 *
 * ⚠ ONLY MASTER WRITES MAY INVALIDATE THIS (approving a vendor request creates a
 *   ledger). A workflow save invalidating it is the bug the split exists to
 *   prevent.
 */
export const PROCUREMENT_MASTERS_QK = ["procurementMasters"] as const;

export async function fetchProcurementMasters(): Promise<ProcurementMasters> {
  const [companies, vendors, unitName] = await Promise.all([
    // All five books, deliberately unfiltered: a new company should appear on
    // its own rather than wait for somebody to tick it.
    fetchMst("mst_companies", MST_COLS.companies),
    // Every vendor ledger in every book, plus any ledger ticked for Purchase —
    // a firm Tally files as a customer but that we also buy from. The company
    // narrows this on the requisition; there is no list to maintain.
    fetchMst("mst_parties", MST_COLS.vendors, (q) => q.or("is_vendor.eq.true,modules.cs.{procurement}")),
    fetchUnitNames(),
  ]);
  return {
    companies: companies.map(mapCompany),
    vendors: vendors.map(mapVendor),
    units: [...unitName.values()].sort((a, b) => a.localeCompare(b)),
  };
}

/** One company's stock book — see fetchCompanyItems. */
export const PROCUREMENT_ITEM_BOOK_QK = (companyId: string) => ["procurementItemBook", companyId] as const;

/**
 * EVERY ACTIVE ITEM IN ONE COMPANY'S TALLY BOOK — the requisition line's picker.
 *
 * Not filtered on `modules`: almost no stock item carries a module tick, so that
 * filter would collapse the book to nothing. The company is the filter, and the
 * line's category narrows it further by item type.
 *
 * Sizes, measured: Colorix 254 · Enterprise-Surat 1,495 · Enterprise-Noida 2,096
 * · O-tec-Noida 2,140 · O-tec-Surat 8,448.
 */
export async function fetchCompanyItems(companyId: string): Promise<Item[]> {
  if (!companyId) return [];
  const [rows, unitName] = await Promise.all([
    fetchMst("mst_items", MST_COLS.items, (q) => q.eq("company_id", companyId).eq("active", true)),
    fetchUnitNames(),
  ]);
  return rows.map((r) => mapItem(r, unitName)).sort((a, b) => a.name.localeCompare(b.name));
}

export interface ProcConfig {
  processCoordinatorIds: string[];
  amountBasis: string;
  /** Per-step due-date rules (anchor + working days), merged over the code defaults. */
  stepSla: StepSlaMap;
  /**
   * Departments whose employees the Setup picker offers as handover candidates.
   * A UI FILTER ONLY - it grants nothing. Authority is reassignPoolUserIds alone,
   * exactly as fms_purchase_can_receive_reassignment reads it server-side.
   */
  reassignPoolDepartmentIds: string[];
  /** Everyone who may be handed a requisition awaiting approval. The authority. */
  reassignPoolUserIds: string[];
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
  categories: Category[];
  itemGroups: ItemGroup[];
  /**
   * ONLY the items a requisition line or a rate names — what the screens must be
   * able to render. The pickers read a company's whole book through
   * fetchCompanyItems instead; companies and vendors are fetchProcurementMasters.
   */
  items: Item[];
  /**
   * Legacy companies / vendors a pre-cutover record still names — id lookups
   * only, never a picker. Empty once the cutover has run. See fetchLegacyByIds.
   */
  legacyCompanies: Company[];
  legacyVendors: Vendor[];
  masterManagers: MasterManager[];
  masterRequests: MasterRequest[];
  poCancelRequests: PoCancelRequest[];
  designations: Designation[];
  stepOwners: StepOwner[];
  approvalBands: ApprovalBand[];
  config: ProcConfig;
  requests: PurchaseRequest[];
  requestItems: RequestItem[];
  requestVendors: RequestVendor[];
  sourcingDocs: SourcingDoc[];
  /** Files the requester attached when raising the request. Same shape as a sourcing doc. */
  requestDocs: SourcingDoc[];
  vendorItemPrices: VendorItemPrice[];
  quotations: Quotation[];
  pos: PurchaseOrder[];
  poItems: PoItem[];
  pis: Pi[];
  piItems: PiItem[];
  grns: Grn[];
  grnItems: GrnItem[];
  tallyBookings: TallyBooking[];
  qcInspections: QcInspection[];
  qcItems: QcItem[];
  payments: Payment[];
  followups: Followup[];
  /** Per-line quantities of each partial-dispatch lot. */
  followupItems: FollowupItem[];
  activity: Activity[];
  // ⚠ NO `notifications` (PERF-1, 06-10-2026): the bell is its own small query
  //   (shared/lib/fmsBell.ts, wired in store.tsx). Here it cost every notification
  //   ever sent on every load, everyone's for an admin, and all of them again for the
  //   nightly ranking / KPI / morning-mail jobs, which reuse this download.
}

const mapCategory = (r: any): Category => ({
  id: r.id,
  name: r.name,
  active: r.active,
  sortOrder: r.sort_order ?? 0,
  qcRequired: r.qc_required ?? false,
  // Absent until migration 20261217120000 is applied — [] means "no narrowing".
  itemTypes: (r.item_types ?? []) as string[],
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
  // Fall back to the legacy single column for bands written before the array existed.
  approverUserIds: ((r.approver_user_ids ?? []) as string[]).length
    ? (r.approver_user_ids as string[])
    : r.approver_user_id
      ? [r.approver_user_id as string]
      : [],
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
  sourcingReason: r.sourcing_reason ?? null,
  sourcedAt: r.sourced_at ?? null,
  sourcedBy: r.sourced_by ?? null,
  cancelReason: r.cancel_reason ?? null,
  cancelledAt: r.cancelled_at ?? null,
  cancelledBy: r.cancelled_by ?? null,
  editedAt: r.edited_at ?? null,
  editedBy: r.edited_by ?? null,
  poRemarks: r.po_remarks ?? null,
  poRemarksUpdatedAt: r.po_remarks_updated_at ?? null,
  poOnHoldAt: r.po_on_hold_at ?? null,
  poOnHoldBy: r.po_on_hold_by ?? null,
});

const mapSourcingDoc = (r: any): SourcingDoc => ({
  id: r.id,
  requestId: r.request_id,
  path: r.path,
  name: r.name,
  mimeType: r.mime_type ?? null,
  sizeBytes: r.size_bytes === null || r.size_bytes === undefined ? null : Number(r.size_bytes),
  sortOrder: r.sort_order ?? 0,
});

const mapRequestVendor = (r: any): RequestVendor => ({
  id: r.id,
  requestId: r.request_id,
  vendorId: r.vendor_id,
  isRecommended: !!r.is_recommended,
  remark: r.remark ?? null,
  sortOrder: r.sort_order ?? 0,
});

const mapVendorItemPrice = (r: any): VendorItemPrice => ({
  id: r.id,
  vendorId: r.vendor_id,
  itemId: r.item_id,
  rate: Number(r.rate),
  gstPct: num(r.gst_pct),
  leadTimeDays: r.lead_time_days ?? null,
  active: r.active,
  sortOrder: r.sort_order ?? 0,
  createdAt: r.created_at,
});

const mapRequestItem = (r: any): RequestItem => ({
  id: r.id,
  requestId: r.request_id,
  itemId: r.item_id,
  categoryId: r.category_id ?? null,
  quantity: Number(r.quantity),
  unit: r.unit ?? "",
  lineRemark: r.line_remark ?? null,
  sourcingReason: r.sourcing_reason ?? null,
  finalVendorId: r.final_vendor_id ?? null,
  finalQty: num(r.final_qty),
  finalRate: num(r.final_rate),
  gstPct: num(r.gst_pct),
  leadTimeDays: r.lead_time_days ?? null,
  lineValue: num(r.line_value),
  status: r.status as LineStatus,
  approverId: r.approver_id ?? null,
  assignedApproverId: r.assigned_approver_id ?? null,
  approvalTier: r.approval_tier ?? null,
  rejectReason: r.reject_reason ?? null,
  cancelReason: r.cancel_reason ?? null,
  sourcedAt: r.sourced_at ?? null,
  sourcedBy: r.sourced_by ?? null,
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
  qcWaivedAt: r.qc_waived_at ?? null,
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

const mapQcInspection = (r: any): QcInspection => ({
  id: r.id,
  poId: r.po_id,
  grnId: r.grn_id,
  result: r.result as QcResult,
  remarks: r.remarks ?? null,
  documentPath: r.document_path ?? null,
  documentName: r.document_name ?? null,
  inspectedAt: r.inspected_at,
  inspectedBy: r.inspected_by ?? null,
  editedAt: r.edited_at ?? null,
  editedBy: r.edited_by ?? null,
  returnTallyRef: r.return_tally_ref ?? null,
  returnRemarks: r.return_remarks ?? null,
  returnDocPath: r.return_doc_path ?? null,
  returnDocName: r.return_doc_name ?? null,
  returnedAt: r.returned_at ?? null,
  returnedBy: r.returned_by ?? null,
  returnEditedAt: r.return_edited_at ?? null,
  returnEditedBy: r.return_edited_by ?? null,
  gateRegisterNo: r.gate_register_no ?? null,
  gateOutDate: r.gate_out_date ?? null,
  gateRemarks: r.gate_remarks ?? null,
  gateDocPath: r.gate_doc_path ?? null,
  gateDocName: r.gate_doc_name ?? null,
  gateOutAt: r.gate_out_at ?? null,
  gateOutBy: r.gate_out_by ?? null,
  gateEditedAt: r.gate_edited_at ?? null,
  gateEditedBy: r.gate_edited_by ?? null,
  createdAt: r.created_at,
});

const mapQcItem = (r: any): QcItem => ({
  id: r.id,
  inspectionId: r.inspection_id,
  poItemId: r.po_item_id,
  receivedQty: Number(r.received_qty),
  rejectedQty: Number(r.rejected_qty),
  remark: r.remark ?? null,
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
  entityType: r.entity_type as ProcEntityType,
  entityId: r.entity_id,
  type: r.type,
  actorId: r.actor_id ?? null,
  note: r.note ?? null,
  meta: (r.meta ?? {}) as Record<string, unknown>,
  createdAt: r.created_at,
});

export const mapNotification = (r: any): ProcNotification => ({
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
  // ⚠ DESTRUCTURED BY POSITION — the names and the calls below must stay in
  //   step. Every row is `any`, so a shifted binding compiles and renders wrong.
  const [
    categories,
    itemGroups,
    unitName,
    managers,
    masterReqs,
    poCancelReqs,
    designations,
    stepOwners,
    bands,
    configRows,
    requests,
    requestItems,
    requestVendors,
    vendorItemPrices,
    quotations,
    pos,
    poItems,
    pis,
    piItems,
    grns,
    grnItems,
    tallyBookings,
    qcInspections,
    qcItems,
    payments,
    followups,
    activity,
    sourcingDocs,
    requestDocs,
    followupItems,
  ] = await Promise.all([
    fetchAll("fms_purchase_categories"),
    fetchAll("fms_purchase_item_groups"),
    fetchUnitNames(),
    fetchAll("fms_purchase_master_managers"),
    fetchAll("fms_purchase_master_requests"),
    fetchAll("fms_purchase_po_cancel_requests"),
    fetchAll("designations"),
    fetchAll("fms_purchase_step_owners"),
    fetchAll("fms_purchase_approval_matrix"),
    fetchAll("fms_purchase_config", "key"),
    fetchAll("fms_purchase_requests"),
    fetchAll("fms_purchase_request_items"),
    fetchAll("fms_purchase_request_vendors"),
    fetchAll("fms_purchase_vendor_item_prices"),
    fetchAll("fms_purchase_quotations"),
    fetchAll("fms_purchase_pos"),
    fetchAll("fms_purchase_po_items"),
    fetchAll("fms_purchase_pis"),
    fetchAll("fms_purchase_pi_items"),
    fetchAll("fms_purchase_grns"),
    fetchAll("fms_purchase_grn_items"),
    fetchAll("fms_purchase_tally_bookings"),
    fetchAll("fms_purchase_qc_inspections"),
    fetchAll("fms_purchase_qc_items"),
    fetchAll("fms_purchase_payments"),
    fetchAll("fms_purchase_followups"),
    fetchAll("fms_purchase_activity"),
    fetchAllOptional("fms_purchase_sourcing_docs"),
    // Optional for the same reason: migration 20261217140000 may not be applied yet.
    fetchAllOptional("fms_purchase_request_docs"),
    // Optional: migration 20261217160000 may not be applied yet.
    fetchAllOptional("fms_purchase_followup_items"),
  ]);

  const configByKey = new Map<string, any>(configRows.map((r) => [r.key, r.value ?? {}]));
  const config: ProcConfig = {
    processCoordinatorIds: (configByKey.get("process_coordinators")?.user_ids ?? []) as string[],
    amountBasis: (configByKey.get("amount_basis")?.value ?? "line_incl_gst") as string,
    // Unset or partially-stored rules fall back to the code defaults.
    stepSla: resolveStepSla(configByKey.get("step_sla")),
    reassignPoolDepartmentIds: (configByKey.get("reassign_pool")?.department_ids ?? []) as string[],
    reassignPoolUserIds: (configByKey.get("reassign_pool")?.user_ids ?? []) as string[],
  };

  /*
    THE ITEMS THIS WORKING SET NAMES, and only those.

    A line carries `item_id` and no name, so every item a line or a rate points
    at must be here or it renders as "Unknown item" — in the queues, on the PO,
    in the email. That is a few hundred rows; the item BOOKS the pickers need
    are thousands and load per company (fetchCompanyItems).

    ⚠ A SECOND WAVE, because it needs the lines first. It is chunked and
      concurrent (fetchMstByIds), so it costs one round trip, not one per chunk.
  */
  const itemIds = new Set<string>();
  for (const r of requestItems) if (r.item_id) itemIds.add(r.item_id);
  for (const r of vendorItemPrices) if (r.item_id) itemIds.add(r.item_id);
  const companyIds = new Set<string>();
  for (const r of [...requests, ...pos]) if (r.company_id) companyIds.add(r.company_id);
  const vendorIds = new Set<string>();
  for (const r of [...requestVendors, ...quotations, ...pos, ...vendorItemPrices]) if (r.vendor_id) vendorIds.add(r.vendor_id);
  for (const r of requestItems) if (r.final_vendor_id) vendorIds.add(r.final_vendor_id);

  const [items, mstCompanies, mstVendors] = await Promise.all([
    itemIds.size ? fetchMstByIds("mst_items", MST_COLS.items, [...itemIds]) : Promise.resolve([]),
    companyIds.size ? fetchMstByIds("mst_companies", "id", [...companyIds]) : Promise.resolve([]),
    vendorIds.size ? fetchMstByIds("mst_parties", "id", [...vendorIds]) : Promise.resolve([]),
  ]);
  const missing = (want: Set<string>, found: any[]) => {
    const have = new Set(found.map((r) => r.id as string));
    return [...want].filter((id) => !have.has(id));
  };
  const [legacyCompanies, legacyVendors, legacyItems] = await Promise.all([
    fetchLegacyByIds("fms_purchase_companies", missing(companyIds, mstCompanies)),
    fetchLegacyByIds("fms_purchase_vendors", missing(vendorIds, mstVendors)),
    fetchLegacyByIds("fms_purchase_items", missing(itemIds, items)),
  ]);

  return {
    categories: categories.map(mapCategory),
    itemGroups: itemGroups.map(mapItemGroup),
    items: [...items.map((r) => mapItem(r, unitName)), ...legacyItems.map(mapLegacyItem)],
    legacyCompanies: legacyCompanies.map(mapCompany),
    legacyVendors: legacyVendors.map(mapVendor),
    masterManagers: managers.map(mapManager),
    masterRequests: masterReqs.map(mapMasterRequest),
    poCancelRequests: poCancelReqs.map(mapPoCancelRequest),
    designations: designations.map(mapDesignation),
    stepOwners: stepOwners.map(mapStepOwner),
    approvalBands: bands.map(mapApprovalBand),
    config,
    requests: requests.map(mapRequest),
    requestItems: requestItems.map(mapRequestItem),
    requestVendors: requestVendors.map(mapRequestVendor),
    sourcingDocs: sourcingDocs.map(mapSourcingDoc),
    requestDocs: requestDocs.map(mapSourcingDoc),
    vendorItemPrices: vendorItemPrices.map(mapVendorItemPrice),
    quotations: quotations.map(mapQuotation),
    pos: pos.map(mapPo),
    poItems: poItems.map(mapPoItem),
    pis: pis.map(mapPi),
    piItems: piItems.map(mapPiItem),
    grns: grns.map(mapGrn),
    grnItems: grnItems.map(mapGrnItem),
    tallyBookings: tallyBookings.map(mapTally),
    qcInspections: qcInspections.map(mapQcInspection),
    qcItems: qcItems.map(mapQcItem),
    payments: payments.map(mapPayment),
    followups: followups.map(mapFollowup),
    followupItems: followupItems.map((r: any): FollowupItem => ({
      id: r.id,
      followupId: r.followup_id,
      poItemId: r.po_item_id,
      qty: Number(r.qty),
    })),
    activity: activity.map(mapActivity),
  };
}
