import { supabase } from "@/core/platform/supabase";
// fms_dispatch_* tables are not in the generated Database types; route table/rpc
// calls through an untyped alias (the row mappers below already treat rows as any).
// This is the standing FMS convention — see production-entry/data/productionFetch.ts.
const db = supabase as any;

import { resolveStepSla, type StepSlaMap } from "../lib/sla";
import type {
  Company, CompanyScopedMaster, Customer, Designation, DispatchActivity, DispatchMasterRequest,
  DispatchMasterType, DispatchNotification, DispatchOrder, Driver, Item, Lot, MailTemplate,
  MasterManager, NamedMaster, OrderLine, PaymentTerm, ShipTo, StepOwner, Transporter, Vehicle,
} from "../types";

/**
 * Order to Dispatch FMS read layer. One paginated pass over the module's tables,
 * mapped snake_case → camelCase. The whole module loads in one snapshot so the
 * pure queue rules (lib/queues.ts) get plain data, and the Control Center adapter
 * + My Work provider can reuse this exact react-query cache entry.
 *
 * ⚠ Order lines are fetched as their OWN paginated pass and grouped in memory, not
 *   as a nested PostgREST select (`orders(*, items(*))`) — a nested select silently
 *   truncates at the API row limit once the order count grows.
 */

const PAGE = 1000;

type Tbl =
  | "fms_dispatch_step_owners"
  | "fms_dispatch_config"
  | "fms_dispatch_companies"
  | "fms_dispatch_transporters"
  | "fms_dispatch_units"
  | "fms_dispatch_categories"
  | "fms_dispatch_order_sources"
  | "fms_dispatch_payment_terms"
  | "fms_dispatch_shortfall_reasons"
  | "fms_dispatch_packing_types"
  | "fms_dispatch_mail_templates"
  | "fms_dispatch_drivers"
  | "fms_dispatch_customers"
  | "fms_dispatch_ship_to"
  | "fms_dispatch_items"
  | "fms_dispatch_lots"
  | "fms_dispatch_godowns"
  | "fms_dispatch_gates"
  | "fms_dispatch_invoice_series"
  | "fms_dispatch_vehicles"
  | "fms_dispatch_master_managers"
  | "fms_dispatch_master_requests"
  | "fms_dispatch_orders"
  | "fms_dispatch_order_items"
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

export interface DispatchConfig {
  processCoordinatorIds: string[];
  stepSla: StepSlaMap;
  /** The customer auto-mail switch, on top of the per-module email gate. */
  customerMail: { enabled: boolean; templateCode: string };
}

/** The react-query key. Keyed on the REAL session user id, shared with the adapter. */
export const DISPATCH_QK = ["orderToDispatchData"] as const;
export const dispatchQueryKey = (userId: string | null) => [...DISPATCH_QK, userId] as const;

export interface DispatchData {
  stepOwners: StepOwner[];
  designations: Designation[];
  config: DispatchConfig;

  companies: Company[];
  transporters: Transporter[];
  units: NamedMaster[];
  categories: NamedMaster[];
  orderSources: NamedMaster[];
  paymentTerms: PaymentTerm[];
  shortfallReasons: NamedMaster[];
  packingTypes: NamedMaster[];
  mailTemplates: MailTemplate[];
  drivers: Driver[];
  customers: Customer[];
  shipTos: ShipTo[];
  items: Item[];
  lots: Lot[];
  godowns: CompanyScopedMaster[];
  gates: CompanyScopedMaster[];
  invoiceSeries: CompanyScopedMaster[];
  vehicles: Vehicle[];

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

const mapCompanyScoped = (r: any): CompanyScopedMaster => ({
  ...mapMaster(r), companyId: r.company_id ?? null, location: r.location ?? null,
});

const mapCustomer = (r: any): Customer => ({
  ...mapMaster(r),
  code: str(r.code), gstin: str(r.gstin), contactName: str(r.contact_name), phone: str(r.phone),
  email: str(r.email), billingAddress: str(r.billing_address),
  creditLimit: num(r.credit_limit), creditDays: num(r.credit_days),
  defaultType: r.default_type ?? null, defaultTransporterId: r.default_transporter_id ?? null,
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
  unitId: r.unit_id ?? null,
  lineRemark: str(r.line_remark),
  msLineStatus: r.ms_line_status ?? null,
  msAvailableQty: num(r.ms_available_qty),
  msShortfallReasonId: r.ms_shortfall_reason_id ?? null,
  lotId: r.lot_id ?? null,
  lotNoSnapshot: str(r.lot_no_snapshot),
  finalQty: num(r.final_qty),
  finalUnitId: r.final_unit_id ?? null,
  packingTypeId: r.packing_type_id ?? null,
  packs: num(r.packs),
  lcShortfallReasonId: r.lc_shortfall_reason_id ?? null,
});

const mapOrder = (r: any): DispatchOrder => ({
  id: r.id,
  orderNo: r.order_no,

  dispatchType: r.dispatch_type,
  companyId: r.company_id ?? null,
  customerId: r.customer_id,
  shipToId: r.ship_to_id ?? null,
  orderSourceId: r.order_source_id ?? null,
  orderDate: r.order_date,
  promisedDate: r.promised_date ?? null,
  tatDays: num(r.tat_days),
  customerRef: str(r.customer_ref),
  orderRemarks: str(r.order_remarks),

  raisedBy: r.raised_by ?? null,
  requesterName: r.requester_name,
  status: r.status,
  currentStep: r.current_step,
  submittedAt: r.submitted_at,

  ccActualDate: r.cc_actual_date ?? null,
  ccStatus: r.cc_status ?? null,
  ccPaymentTermId: r.cc_payment_term_id ?? null,
  ccCreditLimit: num(r.cc_credit_limit),
  ccOutstandingAmount: num(r.cc_outstanding_amount),
  ccPaymentRef: str(r.cc_payment_ref),
  ccPaymentAmount: num(r.cc_payment_amount),
  ccRemarks: str(r.cc_remarks),
  ccAt: r.cc_at ?? null,
  ccBy: r.cc_by ?? null,

  msActualDate: r.ms_actual_date ?? null,
  msStatus: r.ms_status ?? null,
  msGodownId: r.ms_godown_id ?? null,
  msPlannedDispatchDate: r.ms_planned_dispatch_date ?? null,
  msRemarks: str(r.ms_remarks),
  msMailTemplateId: r.ms_mail_template_id ?? null,
  msMailTo: str(r.ms_mail_to),
  msMailSubject: str(r.ms_mail_subject),
  msMailQueuedAt: r.ms_mail_queued_at ?? null,
  msMailOutboxId: r.ms_mail_outbox_id ?? null,
  msMailSkippedReason: str(r.ms_mail_skipped_reason),
  msAt: r.ms_at ?? null,
  msBy: r.ms_by ?? null,

  lcActualDate: r.lc_actual_date ?? null,
  lcStatus: str(r.lc_status),
  lcRemarks: str(r.lc_remarks),
  lcAt: r.lc_at ?? null,
  lcBy: r.lc_by ?? null,

  sbActualDate: r.sb_actual_date ?? null,
  sbStatus: str(r.sb_status),
  sbCompanyId: r.sb_company_id ?? null,
  sbInvoiceSeriesId: r.sb_invoice_series_id ?? null,
  sbInvoiceNo: str(r.sb_invoice_no),
  sbInvoiceDate: r.sb_invoice_date ?? null,
  sbInvoiceValue: num(r.sb_invoice_value),
  sbAttachmentPath: str(r.sb_attachment_path),
  sbAttachmentName: str(r.sb_attachment_name),
  sbRemarks: str(r.sb_remarks),
  sbAt: r.sb_at ?? null,
  sbBy: r.sb_by ?? null,

  goActualDate: r.go_actual_date ?? null,
  goStatus: str(r.go_status),
  goGatePassNo: str(r.go_gate_pass_no),
  goGateId: r.go_gate_id ?? null,
  goGodownId: r.go_godown_id ?? null,
  goVehicleId: r.go_vehicle_id ?? null,
  goDriverId: r.go_driver_id ?? null,
  goOutAt: r.go_out_at ?? null,
  goRemarks: str(r.go_remarks),
  goAt: r.go_at ?? null,
  goBy: r.go_by ?? null,

  dcActualDate: r.dc_actual_date ?? null,
  dcStatus: r.dc_status ?? null,
  dcReceiverName: str(r.dc_receiver_name),
  dcReceivedAt: r.dc_received_at ?? null,
  dcDriverId: r.dc_driver_id ?? null,
  dcTransporterId: r.dc_transporter_id ?? null,
  dcLrNo: str(r.dc_lr_no),
  dcLrDate: r.dc_lr_date ?? null,
  dcFreightAmount: num(r.dc_freight_amount),
  dcAttachmentPath: str(r.dc_attachment_path),
  dcAttachmentName: str(r.dc_attachment_name),
  dcRemarks: str(r.dc_remarks),
  dcAt: r.dc_at ?? null,
  dcBy: r.dc_by ?? null,
  closedAt: r.closed_at ?? null,

  editedAt: r.edited_at ?? null,
  editedBy: r.edited_by ?? null,
  holdAt: r.hold_at ?? null,
  holdReason: str(r.hold_reason),
  cancelledAt: r.cancelled_at ?? null,
  cancelReason: str(r.cancel_reason),
  createdAt: r.created_at,

  lines: [],
});

const mapStepOwner = (r: any): StepOwner => ({
  id: r.id,
  stepKey: r.step_key,
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
  const [
    stepOwners, configRows, designations,
    companies, transporters, units, categories, orderSources, paymentTerms,
    shortfallReasons, packingTypes, mailTemplates, drivers, customers, shipTos,
    items, lots, godowns, gates, invoiceSeries, vehicles,
    masterManagers, masterRequests, orders, orderItems, activity, notifications,
  ] = await Promise.all([
    fetchAll("fms_dispatch_step_owners"),
    fetchAll("fms_dispatch_config", "key"),
    fetchAll("designations"),
    fetchAll("fms_dispatch_companies"),
    fetchAll("fms_dispatch_transporters"),
    fetchAll("fms_dispatch_units"),
    fetchAll("fms_dispatch_categories"),
    fetchAll("fms_dispatch_order_sources"),
    fetchAll("fms_dispatch_payment_terms"),
    fetchAll("fms_dispatch_shortfall_reasons"),
    fetchAll("fms_dispatch_packing_types"),
    fetchAll("fms_dispatch_mail_templates"),
    fetchAll("fms_dispatch_drivers"),
    fetchAll("fms_dispatch_customers"),
    fetchAll("fms_dispatch_ship_to"),
    fetchAll("fms_dispatch_items"),
    fetchAll("fms_dispatch_lots"),
    fetchAll("fms_dispatch_godowns"),
    fetchAll("fms_dispatch_gates"),
    fetchAll("fms_dispatch_invoice_series"),
    fetchAll("fms_dispatch_vehicles"),
    fetchAll("fms_dispatch_master_managers"),
    fetchAll("fms_dispatch_master_requests"),
    fetchAll("fms_dispatch_orders", "submitted_at"),
    fetchAll("fms_dispatch_order_items"),
    fetchAll("fms_dispatch_activity"),
    fetchAll("fms_dispatch_notifications"),
  ]);

  const byKey = new Map<string, any>(configRows.map((r) => [r.key, r.value ?? {}]));
  const config: DispatchConfig = {
    processCoordinatorIds: (byKey.get("process_coordinators")?.user_ids ?? []) as string[],
    stepSla: resolveStepSla(byKey.get("step_sla")),
    customerMail: {
      enabled: Boolean(byKey.get("customer_mail")?.enabled),
      templateCode: String(byKey.get("customer_mail")?.template_code ?? "dispatch_plan"),
    },
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

  const mappedOrders = orders.map((r) => {
    const o = mapOrder(r);
    o.lines = linesByOrder.get(o.id) ?? [];
    return o;
  });

  // The next order number to be issued (preview — does not consume the counter).
  const { data: orderPeek } = await db.rpc("fms_dispatch_peek_order_no");

  return {
    stepOwners: stepOwners.map(mapStepOwner),
    designations: designations.map(mapDesignation),
    config,

    companies: companies.map((r) => ({ ...mapMaster(r), gstin: str(r.gstin), address: str(r.address) })),
    transporters: transporters.map((r): Transporter => ({
      ...mapMaster(r), gstin: str(r.gstin), contactName: str(r.contact_name),
      phone: str(r.phone), email: str(r.email), address: str(r.address),
    })),
    units: units.map(mapMaster),
    categories: categories.map(mapMaster),
    orderSources: orderSources.map(mapMaster),
    paymentTerms: paymentTerms.map((r): PaymentTerm => ({
      ...mapMaster(r), days: num(r.days), description: str(r.description),
    })),
    shortfallReasons: shortfallReasons.map(mapMaster),
    packingTypes: packingTypes.map(mapMaster),
    mailTemplates: mailTemplates.map((r): MailTemplate => ({
      ...mapMaster(r), code: r.code, subject: r.subject ?? "", body: r.body ?? "",
    })),
    drivers: drivers.map((r): Driver => ({
      ...mapMaster(r), phone: str(r.phone), licenceNo: str(r.licence_no), userId: r.user_id ?? null,
    })),
    customers: customers.map(mapCustomer),
    shipTos: shipTos.map((r): ShipTo => ({
      ...mapMaster(r), customerId: r.customer_id, address: str(r.address), city: str(r.city),
      state: str(r.state), contactName: str(r.contact_name), phone: str(r.phone),
    })),
    items: items.map((r): Item => ({
      ...mapMaster(r), code: str(r.code), categoryId: r.category_id ?? null,
      unitId: r.unit_id ?? null, hsnCode: str(r.hsn_code),
    })),
    lots: lots.map((r): Lot => ({
      ...mapMaster(r), itemId: r.item_id ?? null, mfgDate: r.mfg_date ?? null,
      expiryDate: r.expiry_date ?? null, availableQty: num(r.available_qty), unitId: r.unit_id ?? null,
    })),
    godowns: godowns.map(mapCompanyScoped),
    gates: gates.map(mapCompanyScoped),
    invoiceSeries: invoiceSeries.map(mapCompanyScoped),
    vehicles: vehicles.map((r): Vehicle => ({
      ...mapMaster(r), vehicleType: str(r.vehicle_type),
      transporterId: r.transporter_id ?? null, capacity: str(r.capacity),
    })),

    masterManagers: masterManagers.map(mapMasterManager),
    masterRequests: masterRequests.map(mapMasterRequest),
    orders: mappedOrders,
    activity: activity.map(mapActivity),
    notifications: notifications.map(mapNotification),
    orderNoPreview: (orderPeek as string) ?? "",
  };
}
