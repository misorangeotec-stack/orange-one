/**
 * Order to Dispatch FMS domain types — the camelCase shape the store hands out,
 * mapped from the snake_case `fms_dispatch_*` tables in data/dispatchFetch.ts.
 */

/* -------------------------------------------------------------------------- */
/*  Masters                                                                    */
/* -------------------------------------------------------------------------- */

/** Every master satisfies MasterCrud's contract: id / name / active. */
export interface NamedMaster {
  id: string;
  name: string;
  active: boolean;
  sortOrder: number;
}

export interface Company extends NamedMaster {
  gstin: string | null;
  address: string | null;
}

export interface Transporter extends NamedMaster {
  gstin: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
}

export interface Customer extends NamedMaster {
  code: string | null;
  gstin: string | null;
  contactName: string | null;
  phone: string | null;
  /** Where the material-status auto-mail goes. Blank ⇒ the mail is skipped. */
  email: string | null;
  billingAddress: string | null;
  creditLimit: number | null;
  creditDays: number | null;
  defaultType: DispatchType | null;
  defaultTransporterId: string | null;
}

export interface ShipTo extends NamedMaster {
  customerId: string;
  address: string | null;
  city: string | null;
  state: string | null;
  contactName: string | null;
  phone: string | null;
}

export interface Item extends NamedMaster {
  code: string | null;
  categoryId: string | null;
  unitId: string | null;
  hsnCode: string | null;
}

/** `name` IS the lot number. */
export interface Lot extends NamedMaster {
  itemId: string | null;
  mfgDate: string | null;
  expiryDate: string | null;
  availableQty: number | null;
  unitId: string | null;
}

export interface PaymentTerm extends NamedMaster {
  days: number | null;
  description: string | null;
}

export interface MailTemplate extends NamedMaster {
  code: string;
  subject: string;
  body: string;
}

export interface Driver extends NamedMaster {
  phone: string | null;
  licenceNo: string | null;
  /** Set ⇒ this driver can confirm their own delivery from their queue. */
  userId: string | null;
}

/** `name` IS the vehicle number. */
export interface Vehicle extends NamedMaster {
  vehicleType: string | null;
  /** Null ⇒ own vehicle. */
  transporterId: string | null;
  capacity: string | null;
}

/** Godowns, gates and invoice series are all "a name under a company". */
export interface CompanyScopedMaster extends NamedMaster {
  companyId: string | null;
  location?: string | null;
}

/* -------------------------------------------------------------------------- */
/*  Master governance                                                          */
/* -------------------------------------------------------------------------- */

export type DispatchMasterType =
  | "company" | "transporter" | "unit" | "category" | "order_source" | "payment_term"
  | "shortfall_reason" | "packing_type" | "mail_template" | "driver" | "customer"
  | "ship_to" | "item" | "lot" | "godown" | "gate" | "invoice_series" | "vehicle";

export interface MasterTypeDef {
  value: DispatchMasterType;
  label: string;
  plural: string;
  /** Which Masters tab group it belongs to. */
  group: "sales" | "stores" | "logistics" | "accounts";
}

/**
 * Every master type, in Masters-tab order. All 18 are OWNABLE (they take an owner
 * list and are editable on the Masters page).
 */
export const DISPATCH_MASTER_TYPES: MasterTypeDef[] = [
  { value: "customer",         label: "Customer",          plural: "Customers",           group: "sales" },
  { value: "ship_to",          label: "Delivery address",  plural: "Delivery addresses",  group: "sales" },
  { value: "item",             label: "Item",              plural: "Items",               group: "sales" },
  { value: "category",         label: "Item category",     plural: "Item categories",     group: "sales" },
  { value: "unit",             label: "Unit",              plural: "Units",               group: "sales" },
  { value: "order_source",     label: "Order source",      plural: "Order sources",       group: "sales" },
  { value: "lot",              label: "LOT",               plural: "LOTs",                group: "stores" },
  { value: "godown",           label: "Godown",            plural: "Godowns",             group: "stores" },
  { value: "packing_type",     label: "Packing type",      plural: "Packing types",       group: "stores" },
  { value: "shortfall_reason", label: "Shortfall reason",  plural: "Shortfall reasons",   group: "stores" },
  { value: "gate",             label: "Gate",              plural: "Gates",               group: "logistics" },
  { value: "vehicle",          label: "Vehicle",           plural: "Vehicles",            group: "logistics" },
  { value: "driver",           label: "Driver",            plural: "Drivers",             group: "logistics" },
  { value: "transporter",      label: "Transporter",       plural: "Transporters",        group: "logistics" },
  { value: "company",          label: "Company",           plural: "Companies",           group: "accounts" },
  { value: "invoice_series",   label: "Invoice series",    plural: "Invoice series",      group: "accounts" },
  { value: "payment_term",     label: "Payment term",      plural: "Payment terms",       group: "accounts" },
  { value: "mail_template",    label: "Customer mail template", plural: "Customer mail templates", group: "accounts" },
];

/**
 * The subset offered in the "Request a new entry" picker.
 *
 * A master is REQUESTABLE when it feeds a dropdown a non-owner has to pick from
 * and could plausibly find missing mid-task — the store keeper who finds an
 * unlisted LOT is the motivating case. The excluded five are one-time
 * configuration a coordinator sets up (companies, godowns, gates, invoice series)
 * or, in the mail template's case, something nobody would ever "request".
 * Mirrors HR Exit's REQUESTABLE_EXIT_MASTER_TYPES split.
 */
const NOT_REQUESTABLE: DispatchMasterType[] = [
  "company", "godown", "gate", "invoice_series", "mail_template",
];
export const REQUESTABLE_DISPATCH_MASTER_TYPES: MasterTypeDef[] =
  DISPATCH_MASTER_TYPES.filter((m) => !NOT_REQUESTABLE.includes(m.value));

export interface MasterManager {
  id: string;
  masterType: DispatchMasterType;
  managerUserId: string;
}

export interface DispatchMasterRequest {
  id: string;
  masterType: DispatchMasterType;
  proposedPayload: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  requestedBy: string | null;
  reviewedBy: string | null;
  reviewNote: string | null;
  resolvedMasterId: string | null;
  createdAt: string;
}

/* -------------------------------------------------------------------------- */
/*  Config / owners / feed                                                     */
/* -------------------------------------------------------------------------- */

export interface StepOwner {
  id: string;
  stepKey: string;
  departmentIds: string[];
  designationId: string | null;
  employeeIds: string[];
}

export interface Designation {
  id: string;
  name: string;
}

export interface OrgDepartment {
  id: string;
  name: string;
}

export interface DispatchActivity {
  id: string;
  entityType: "order" | "master_request";
  entityId: string;
  type: string;
  actorId: string | null;
  note: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
}

export interface DispatchNotification {
  id: string;
  userId: string;
  type: string;
  entityType: string;
  entityId: string;
  text: string;
  actorId: string | null;
  readAt: string | null;
  createdAt: string;
}

/* -------------------------------------------------------------------------- */
/*  The order                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * How the consignment travels. A CODE ENUM, never a master: it is the branch
 * condition for the dispatch-confirmation step, so a third value would produce
 * orders whose final step has no validation rule and no RPC branch.
 */
export type DispatchType = "local" | "transport";

/**
 * STATUSES ARE NOT STEP KEYS — closed / on_hold / cancelled live only here.
 *
 * Note what is absent: there is no `awaiting_production`. When stock is short the
 * agreed behaviour is record-and-continue, so "Production required" is an
 * `msStatus` VALUE on a completed step, not a state. Do not add one later.
 */
export type DispatchStatus =
  | "awaiting_credit_check"
  | "awaiting_material_status"
  | "awaiting_lot_confirm"
  | "awaiting_sales_bill"
  | "awaiting_gate_out"
  | "awaiting_dispatch_confirm"
  | "closed"
  | "on_hold"
  | "cancelled";

export type CreditStatus = "credit_available" | "payment_required";
export type MaterialStatus = "available_for_dispatch" | "production_required";
export type DeliveryStatus = "delivered" | "partially_delivered" | "returned";

export interface OrderLine {
  id: string;
  orderId: string;
  lineNo: number;
  itemId: string;
  quantity: number;
  unitId: string | null;
  lineRemark: string | null;

  // step 3, per line
  msLineStatus: MaterialStatus | null;
  msAvailableQty: number | null;
  msShortfallReasonId: string | null;

  // step 4, per line
  lotId: string | null;
  /** The lot label at confirmation time — survives a later master rename. */
  lotNoSnapshot: string | null;
  finalQty: number | null;
  finalUnitId: string | null;
  packingTypeId: string | null;
  packs: number | null;
  lcShortfallReasonId: string | null;
}

export interface DispatchOrder {
  id: string;
  orderNo: string;

  // ---- intake ----
  dispatchType: DispatchType;
  companyId: string | null;
  customerId: string;
  shipToId: string | null;
  orderSourceId: string | null;
  /** When the customer's order arrived — the anchor for steps 2 and 3. */
  orderDate: string;
  /** The dispatch date promised to the CUSTOMER. Not an internal SLA. */
  promisedDate: string | null;
  tatDays: number | null;
  customerRef: string | null;
  orderRemarks: string | null;

  raisedBy: string | null;
  requesterName: string;
  status: DispatchStatus;
  currentStep: string;
  submittedAt: string;

  // ---- step 2: credit_check ----
  ccActualDate: string | null;
  ccStatus: CreditStatus | null;
  ccPaymentTermId: string | null;
  ccCreditLimit: number | null;
  ccOutstandingAmount: number | null;
  ccPaymentRef: string | null;
  ccPaymentAmount: number | null;
  ccRemarks: string | null;
  ccAt: string | null;
  ccBy: string | null;

  // ---- step 3: material_status ----
  msActualDate: string | null;
  msStatus: MaterialStatus | null;
  msGodownId: string | null;
  msPlannedDispatchDate: string | null;
  msRemarks: string | null;
  msMailTemplateId: string | null;
  msMailTo: string | null;
  msMailSubject: string | null;
  msMailQueuedAt: string | null;
  msMailOutboxId: string | null;
  msMailSkippedReason: string | null;
  msAt: string | null;
  msBy: string | null;

  // ---- step 4: lot_confirm ----
  lcActualDate: string | null;
  lcStatus: string | null;
  lcRemarks: string | null;
  lcAt: string | null;
  lcBy: string | null;

  // ---- step 5: sales_bill ----
  sbActualDate: string | null;
  sbStatus: string | null;
  sbCompanyId: string | null;
  sbInvoiceSeriesId: string | null;
  sbInvoiceNo: string | null;
  sbInvoiceDate: string | null;
  sbInvoiceValue: number | null;
  sbAttachmentPath: string | null;
  sbAttachmentName: string | null;
  sbRemarks: string | null;
  sbAt: string | null;
  sbBy: string | null;

  // ---- step 6: gate_out ----
  goActualDate: string | null;
  goStatus: string | null;
  goGatePassNo: string | null;
  goGateId: string | null;
  goGodownId: string | null;
  goVehicleId: string | null;
  goDriverId: string | null;
  goOutAt: string | null;
  goRemarks: string | null;
  goAt: string | null;
  goBy: string | null;

  // ---- step 7: dispatch_confirm ----
  dcActualDate: string | null;
  dcStatus: DeliveryStatus | null;
  dcReceiverName: string | null;
  dcReceivedAt: string | null;
  dcDriverId: string | null;
  dcTransporterId: string | null;
  dcLrNo: string | null;
  dcLrDate: string | null;
  dcFreightAmount: number | null;
  dcAttachmentPath: string | null;
  dcAttachmentName: string | null;
  dcRemarks: string | null;
  dcAt: string | null;
  dcBy: string | null;
  closedAt: string | null;

  editedAt: string | null;
  editedBy: string | null;
  holdAt: string | null;
  holdReason: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;

  createdAt: string;

  /** Attached by the fetch layer — the order's lines, in line_no order. */
  lines: OrderLine[];
}
