import { supabase } from "@/core/platform/supabase";
// fms_dispatch_* tables are not in the generated Database types; route table/rpc
// calls through an untyped alias (the row mappers below already treat rows as any).
// This is the standing FMS convention — see production-entry/data/productionFetch.ts.
const db = supabase as any;

import { resolveStepSla, type StepSlaMap } from "../lib/sla";
import type {
  Company, CompanyLocation, Customer, Designation, DispatchActivity, DispatchMasterRequest,
  CustomerItem, DispatchMasterType, DispatchNotification, DispatchOrder, DispatchRound, Item,
  MasterManager, NamedMaster, OrderLine, RoundItem, StepOwner,
} from "../types";

/**
 * Order to Dispatch FMS read layer. One paginated pass over the module's tables,
 * mapped snake_case → camelCase. The whole module loads in one snapshot so the
 * pure queue rules (lib/queues.ts) get plain data, and the Control Center adapter
 * + My Work provider can reuse this exact react-query cache entry.
 *
 * ⚠ Order lines and ROUNDS are fetched as their OWN paginated passes and grouped
 *   in memory, not as nested PostgREST selects (`orders(*, items(*))`) — a nested
 *   select silently truncates at the API row limit once the order count grows.
 *
 * ⚠ The Promise.all below destructures BY POSITION. Adding or removing a call
 *   without moving its name shifts every binding after it, and because every row
 *   is `any` the compiler cannot see it — you get silently wrong data everywhere.
 *   Change one line at a time and re-count both lists.
 */

const PAGE = 1000;

type Tbl =
  | "fms_dispatch_step_owners"
  | "fms_dispatch_config"
  | "fms_dispatch_companies"
  | "fms_dispatch_company_locations"
  | "fms_dispatch_customer_items"
  | "fms_dispatch_customers"
  | "fms_dispatch_items"
  | "fms_dispatch_master_managers"
  | "fms_dispatch_master_requests"
  | "fms_dispatch_orders"
  | "fms_dispatch_order_items"
  | "fms_dispatch_rounds"
  | "fms_dispatch_round_items"
  | "fms_dispatch_activity"
  | "fms_dispatch_notifications"
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

/**
 * The activity trail, capped to a recent window.
 *
 * It used to be an unbounded pass over the whole table on every page load, and
 * rounds multiply it — each loop writes another set of step entries against the
 * same order. Only the order detail page reads it, and only ever shows the tail,
 * so a window is both cheaper and no less useful.
 */
const ACTIVITY_DAYS = 120;

async function fetchRecentActivity(): Promise<any[]> {
  const since = new Date(Date.now() - ACTIVITY_DAYS * 86_400_000).toISOString();
  const out: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("fms_dispatch_activity")
      .select("*")
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export interface DispatchConfig {
  processCoordinatorIds: string[];
  stepSla: StepSlaMap;
}

/** The react-query key. Keyed on the REAL session user id, shared with the adapter. */
export const DISPATCH_QK = ["orderToDispatchData"] as const;
export const dispatchQueryKey = (userId: string | null) => [...DISPATCH_QK, userId] as const;

export interface DispatchData {
  stepOwners: StepOwner[];
  designations: Designation[];
  config: DispatchConfig;

  companies: Company[];
  companyLocations: CompanyLocation[];
  customers: Customer[];
  items: Item[];
  customerItems: CustomerItem[];

  masterManagers: MasterManager[];
  masterRequests: DispatchMasterRequest[];
  orders: DispatchOrder[];
  activity: DispatchActivity[];
  notifications: DispatchNotification[];
  /** The next order number that will be issued (preview — does not consume it). */
  orderNoPreview: string;
}

const num = (v: any): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
const str = (v: any): string | null => (v === null || v === undefined || v === "" ? null : String(v));

const mapMaster = (r: any): NamedMaster => ({
  id: r.id, name: r.name, active: r.active, sortOrder: r.sort_order ?? 0,
});

const mapCustomer = (r: any): Customer => ({
  ...mapMaster(r),
  companyId: r.company_id ?? null,
  code: str(r.code), location: str(r.location), gstin: str(r.gstin),
  contactName: str(r.contact_name), phone: str(r.phone), email: str(r.email),
});

const mapMasterManager = (r: any): MasterManager => ({
  id: r.id, masterType: r.master_type as DispatchMasterType, managerUserId: r.manager_user_id,
});

const mapMasterRequest = (r: any): DispatchMasterRequest => ({
  id: r.id,
  masterType: r.master_type as DispatchMasterType,
  proposedPayload: (r.proposed_payload ?? {}) as Record<string, unknown>,
  status: r.status,
  requestedBy: r.requested_by ?? null,
  reviewedBy: r.reviewed_by ?? null,
  reviewNote: r.review_note ?? null,
  resolvedMasterId: r.resolved_master_id ?? null,
  createdAt: r.created_at,
});

const mapLine = (r: any): OrderLine => ({
  id: r.id,
  orderId: r.order_id,
  lineNo: r.line_no,
  itemId: r.item_id,
  quantity: Number(r.quantity ?? 0),
  unit: str(r.unit),
  lineRemark: str(r.line_remark),
  dispatchedQty: Number(r.dispatched_qty ?? 0),
  shipQty: num(r.ship_qty),
  lotNo: str(r.lot_no),
});

const mapRoundItem = (r: any): RoundItem => ({
  id: r.id,
  roundId: r.round_id,
  orderItemId: r.order_item_id ?? null,
  lineNo: r.line_no,
  itemId: r.item_id ?? null,
  itemName: r.item_name ?? "Item",
  unitName: str(r.unit_name),
  orderedQty: Number(r.ordered_qty ?? 0),
  shipQty: Number(r.ship_qty ?? 0),
  lotNo: str(r.lot_no),
});

const mapRound = (r: any): DispatchRound => ({
  id: r.id,
  orderId: r.order_id,
  roundNo: r.round_no,
  roundStartedAt: r.round_started_at ?? null,
  companyId: r.company_id ?? null,
  locationId: r.location_id ?? null,

  ccStatus: r.cc_status ?? null,
  ccApprovedQty: num(r.cc_approved_qty),
  ccRemarks: str(r.cc_remarks),
  ccAt: r.cc_at ?? null,
  ccBy: r.cc_by ?? null,

  msActualDate: r.ms_actual_date ?? null,
  msTempoNo: str(r.ms_tempo_no),
  msPorter: r.ms_porter ?? null,
  msRemarks: str(r.ms_remarks),
  msAt: r.ms_at ?? null,
  msBy: r.ms_by ?? null,

  sbActualDate: r.sb_actual_date ?? null,
  sbInvoiceNo: str(r.sb_invoice_no),
  sbAttachmentPath: str(r.sb_attachment_path),
  sbAttachmentName: str(r.sb_attachment_name),
  sbEwayPath: str(r.sb_eway_path),
  sbEwayName: str(r.sb_eway_name),
  sbRemarks: str(r.sb_remarks),
  sbAt: r.sb_at ?? null,
  sbBy: r.sb_by ?? null,
  gpNo: str(r.gp_no),

  goActualDate: r.go_actual_date ?? null,
  goOutwardNo: str(r.go_outward_no),
  goRemarks: str(r.go_remarks),
  goAt: r.go_at ?? null,
  goBy: r.go_by ?? null,

  dcActualDate: r.dc_actual_date ?? null,
  dcStatus: r.dc_status ?? null,
  dcAttachmentPath: str(r.dc_attachment_path),
  dcAttachmentName: str(r.dc_attachment_name),
  dcRemarks: str(r.dc_remarks),
  dcAt: r.dc_at ?? null,
  dcBy: r.dc_by ?? null,

  editedAt: r.edited_at ?? null,
  editedBy: r.edited_by ?? null,
  amendedAt: r.amended_at ?? null,
  amendedBy: r.amended_by ?? null,
  amendReason: str(r.amend_reason),
  archivedReason: r.archived_reason ?? "looped",
  archivedAt: r.archived_at,

  items: [],
});

const mapOrder = (r: any): DispatchOrder => ({
  id: r.id,
  orderNo: r.order_no,

  dispatchType: r.dispatch_type,
  companyId: r.company_id ?? null,
  locationId: r.location_id ?? null,
  customerId: r.customer_id,
  customerLocation: str(r.customer_location),
  customerPoNo: str(r.customer_po_no),
  orderDate: r.order_date,
  orderRemarks: str(r.order_remarks),

  raisedBy: r.raised_by ?? null,
  requesterName: r.requester_name,
  status: r.status,
  currentStep: r.current_step,
  submittedAt: r.submitted_at,

  roundNo: Number(r.round_no ?? 1),
  roundStartedAt: r.round_started_at ?? r.submitted_at,

  ccStatus: r.cc_status ?? null,
  ccRemarks: str(r.cc_remarks),
  ccApprovedQty: num(r.cc_approved_qty),
  ccRoundNo: num(r.cc_round_no),
  ccDecidedAt: r.cc_decided_at ?? null,
  ccDecidedBy: r.cc_decided_by ?? null,
  ccAt: r.cc_at ?? null,
  ccBy: r.cc_by ?? null,
  ccEditedAt: r.cc_edited_at ?? null,
  ccEditedBy: r.cc_edited_by ?? null,

  msActualDate: r.ms_actual_date ?? null,
  msTempoNo: str(r.ms_tempo_no),
  msPorter: r.ms_porter ?? null,
  msRemarks: str(r.ms_remarks),
  msAt: r.ms_at ?? null,
  msBy: r.ms_by ?? null,

  sbActualDate: r.sb_actual_date ?? null,
  sbInvoiceNo: str(r.sb_invoice_no),
  sbAttachmentPath: str(r.sb_attachment_path),
  sbAttachmentName: str(r.sb_attachment_name),
  sbEwayPath: str(r.sb_eway_path),
  sbEwayName: str(r.sb_eway_name),
  sbRemarks: str(r.sb_remarks),
  sbAt: r.sb_at ?? null,
  sbBy: r.sb_by ?? null,
  gpNo: str(r.gp_no),

  goActualDate: r.go_actual_date ?? null,
  goOutwardNo: str(r.go_outward_no),
  goRemarks: str(r.go_remarks),
  goAt: r.go_at ?? null,
  goBy: r.go_by ?? null,

  dcActualDate: r.dc_actual_date ?? null,
  dcStatus: r.dc_status ?? null,
  dcAttachmentPath: str(r.dc_attachment_path),
  dcAttachmentName: str(r.dc_attachment_name),
  dcRemarks: str(r.dc_remarks),
  dcAt: r.dc_at ?? null,
  dcBy: r.dc_by ?? null,

  closedAt: r.closed_at ?? null,
  closedReason: str(r.closed_reason),
  closedBy: r.closed_by ?? null,

  editedAt: r.edited_at ?? null,
  editedBy: r.edited_by ?? null,
  holdAt: r.hold_at ?? null,
  holdReason: str(r.hold_reason),
  cancelledAt: r.cancelled_at ?? null,
  cancelReason: str(r.cancel_reason),

  // Every one of these defaults, so the app loads cleanly against a database
  // that has not had 20260827120000 applied yet. That is what lets the frontend
  // ship FIRST — the reverse order would let the new RPC write a status this
  // build has never heard of, and `status` below is an unvalidated passthrough.
  cancelRequestedAt: r.cancel_requested_at ?? null,
  cancelRequestedBy: r.cancel_requested_by ?? null,
  srRoundNo: num(r.sr_round_no),
  srInvoiceNo: str(r.sr_invoice_no),
  srInvoiceAt: r.sr_invoice_at ?? null,
  srInvoiceDate: r.sr_invoice_date ?? null,
  srEwayExpected: r.sr_eway_expected ?? null,
  srMode: r.sr_mode ?? null,
  srReferenceNo: str(r.sr_reference_no),
  srActualDate: r.sr_actual_date ?? null,
  srRemarks: str(r.sr_remarks),
  srAttachmentPath: str(r.sr_attachment_path),
  srAttachmentName: str(r.sr_attachment_name),
  srAt: r.sr_at ?? null,
  srBy: r.sr_by ?? null,
  srEditedAt: r.sr_edited_at ?? null,
  srEditedBy: r.sr_edited_by ?? null,

  createdAt: r.created_at,
  lines: [],
  rounds: [],
});

const mapStepOwner = (r: any): StepOwner => ({
  id: r.id,
  stepKey: r.step_key,
  locationId: r.location_id ?? null,
  departmentIds: (r.department_ids ?? []) as string[],
  designationId: r.designation_id ?? null,
  employeeIds: (r.employee_ids ?? []) as string[],
});

const mapDesignation = (r: any): Designation => ({ id: r.id, name: r.name });

const mapActivity = (r: any): DispatchActivity => ({
  id: r.id,
  entityType: r.entity_type,
  entityId: r.entity_id,
  type: r.type,
  actorId: r.actor_id ?? null,
  note: str(r.note),
  meta: (r.meta ?? {}) as Record<string, unknown>,
  createdAt: r.created_at,
});

const mapNotification = (r: any): DispatchNotification => ({
  id: r.id,
  userId: r.user_id,
  type: r.type,
  entityType: r.entity_type,
  entityId: r.entity_id,
  text: r.text,
  actorId: r.actor_id ?? null,
  readAt: r.read_at ?? null,
  createdAt: r.created_at,
});

export async function fetchDispatchData(): Promise<DispatchData> {
  // 16 names, 16 calls. Keep them in step.
  const [
    stepOwners, configRows, designations,
    companies, companyLocations, customerItems, customers, items,
    masterManagers, masterRequests,
    orders, orderItems, rounds, roundItems,
    activity, notifications,
  ] = await Promise.all([
    fetchAll("fms_dispatch_step_owners"),
    fetchAll("fms_dispatch_config", "key"),
    fetchAll("designations"),
    fetchAll("fms_dispatch_companies"),
    fetchAll("fms_dispatch_company_locations"),
    fetchAll("fms_dispatch_customer_items"),
    fetchAll("fms_dispatch_customers"),
    fetchAll("fms_dispatch_items"),
    fetchAll("fms_dispatch_master_managers"),
    fetchAll("fms_dispatch_master_requests"),
    fetchAll("fms_dispatch_orders", "submitted_at"),
    fetchAll("fms_dispatch_order_items"),
    fetchAll("fms_dispatch_rounds", "archived_at"),
    fetchAll("fms_dispatch_round_items"),
    fetchRecentActivity(),
    fetchAll("fms_dispatch_notifications"),
  ]);

  const byKey = new Map<string, any>(configRows.map((r) => [r.key, r.value ?? {}]));
  const config: DispatchConfig = {
    processCoordinatorIds: (byKey.get("process_coordinators")?.user_ids ?? []) as string[],
    stepSla: resolveStepSla(byKey.get("step_sla")),
  };

  // Group the lines onto their orders in memory (see the header note).
  const linesByOrder = new Map<string, OrderLine[]>();
  for (const raw of orderItems) {
    const line = mapLine(raw);
    const arr = linesByOrder.get(line.orderId);
    if (arr) arr.push(line);
    else linesByOrder.set(line.orderId, [line]);
  }
  for (const arr of linesByOrder.values()) arr.sort((a, b) => a.lineNo - b.lineNo);

  // Same for the round archive: round items onto rounds, rounds onto orders.
  const itemsByRound = new Map<string, RoundItem[]>();
  for (const raw of roundItems) {
    const ri = mapRoundItem(raw);
    const arr = itemsByRound.get(ri.roundId);
    if (arr) arr.push(ri);
    else itemsByRound.set(ri.roundId, [ri]);
  }
  for (const arr of itemsByRound.values()) arr.sort((a, b) => a.lineNo - b.lineNo);

  const roundsByOrder = new Map<string, DispatchRound[]>();
  for (const raw of rounds) {
    const r = mapRound(raw);
    r.items = itemsByRound.get(r.id) ?? [];
    const arr = roundsByOrder.get(r.orderId);
    if (arr) arr.push(r);
    else roundsByOrder.set(r.orderId, [r]);
  }
  for (const arr of roundsByOrder.values()) arr.sort((a, b) => a.roundNo - b.roundNo);

  const mappedOrders = orders.map((r) => {
    const o = mapOrder(r);
    o.lines = linesByOrder.get(o.id) ?? [];
    o.rounds = roundsByOrder.get(o.id) ?? [];
    return o;
  });

  // The next order number to be issued (preview — does not consume the counter).
  const { data: orderPeek } = await db.rpc("fms_dispatch_peek_order_no");

  return {
    stepOwners: stepOwners.map(mapStepOwner),
    designations: designations.map(mapDesignation),
    config,

    companies: companies.map((r): Company => ({
      ...mapMaster(r), gstin: str(r.gstin), address: str(r.address),
      gatePassPrefix: str(r.gate_pass_prefix),
    })),
    companyLocations: companyLocations.map((r): CompanyLocation => ({
      ...mapMaster(r), companyId: r.company_id,
    })),
    customers: customers.map(mapCustomer),
    items: items.map((r): Item => ({
      ...mapMaster(r), code: str(r.code), unit: str(r.unit), hsnCode: str(r.hsn_code),
    })),
    // The row has no name of its own; the synthetic "Customer - Item" label is
    // built where it is displayed, from the live master lists.
    customerItems: customerItems.map((r): CustomerItem => ({
      ...mapMaster(r), name: "", customerId: r.customer_id, itemId: r.item_id,
    })),

    masterManagers: masterManagers.map(mapMasterManager),
    masterRequests: masterRequests.map(mapMasterRequest),
    orders: mappedOrders,
    activity: activity.map(mapActivity),
    notifications: notifications.map(mapNotification),
    orderNoPreview: (orderPeek as string) ?? "",
  };
}
