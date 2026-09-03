/** Domain types for the Import Purchase FMS module. */

export type MasterType = "company" | "category" | "item_group" | "item" | "vendor" | "vendor_item_price";

// `item_group` is retained in the union above (legacy master_requests /
// master_managers rows may still reference it) but is intentionally omitted from
// this registry so it no longer surfaces on any UI — the Masters tabs, Master
// Owners, the Master Requests banner and the request-new-master type picker are
// all driven by this array. An item hangs off a CATEGORY now; the group level
// never appeared anywhere in the request → PO → Inward → Tally flow.
//
// ⚠ Only `label` / `plural` are display text. Every `value` is a DB string — the
// master_type CHECK on fms_import_master_requests + fms_import_master_managers,
// the RLS predicate fms_import_is_master_manager(<value>, …), and the branch key
// in fms_import_resolve_master_request. `vendor_item_price` therefore keeps its
// id even though it no longer records a price: renaming it would orphan every
// pending request and every assigned-owner row.
export const MASTER_TYPES: { value: MasterType; label: string; plural: string }[] = [
  { value: "company", label: "Company", plural: "Companies" },
  { value: "category", label: "Category", plural: "Categories" },
  { value: "item", label: "Item", plural: "Items" },
  { value: "vendor", label: "Vendor", plural: "Vendors" },
  { value: "vendor_item_price", label: "Vendor-Item Mapping", plural: "Vendor-Item Mappings" },
];

export interface Company {
  id: string;
  name: string;
  location: string | null;
  active: boolean;
  sortOrder: number;
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  active: boolean;
  sortOrder: number;
  /**
   * Goods in this category must clear QC Inspection after their Tally entry
   * before the PO can close. Opt-in — seeded true for Raw Material only, so every
   * other kind of purchase still ends at Tally.
   */
  qcRequired: boolean;
  createdAt: string;
}

export interface ItemGroup {
  id: string;
  categoryId: string;
  name: string;
  active: boolean;
  sortOrder: number;
  createdAt: string;
}

export interface Item {
  id: string;
  categoryId: string;
  name: string;
  unit: string;
  active: boolean;
  sortOrder: number;
  createdAt: string;
}

export interface Vendor {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  /** The vendor's quoting currency (e.g. USD/EUR) — a request/PO is single-currency. */
  defaultCurrency: string | null;
  active: boolean;
  createdAt: string;
}

/**
 * One (vendor, item) mapping: this vendor supplies this item. That is all it
 * means — import is a pure quantity requisition, so there is no price here.
 * A row's presence is what makes an item selectable on a request for that
 * vendor (see `itemsForVendor` in the store).
 *
 * `currency` and `rate` mirror columns that still exist on the row and are no
 * longer read or written by the app: `currency` fills from the table's 'USD'
 * default, `rate` is a structural 0 (the column is NOT NULL with no default).
 * The interface name matches the table, `fms_import_vendor_item_prices`.
 */
export interface VendorItemPrice {
  id: string;
  vendorId: string;
  itemId: string;
  currency: string;
  rate: number;
  active: boolean;
  sortOrder: number;
  createdAt: string;
}

export interface MasterManager {
  id: string;
  masterType: MasterType;
  managerUserId: string;
}

export interface Designation {
  id: string;
  name: string;
  active: boolean;
}

export interface StepOwner {
  id: string;
  stepKey: string;
  /** @deprecated single-department legacy column; use departmentIds. */
  departmentId: string | null;
  /** Departments whose employees may own this step (UI filter only). */
  departmentIds: string[];
  designationId: string | null;
  /** The owners. Authorization derives from this list alone. */
  employeeIds: string[];
}

export interface ApprovalBand {
  id: string;
  tierLabel: string;
  minAmount: number;
  maxAmount: number | null;
  approverUserId: string;
  sortOrder: number;
  active: boolean;
}

export type RequestStatus = "open" | "closed" | "cancelled";

/**
 * How an import consignment travels. Chosen on the requisition, right after the
 * company and the vendor, and copied onto every PO the requisition produces.
 *
 * `lcl` (Less than Container Load) is a sea shipment too, but the desk treats it
 * as its own mode — it books, costs and lands differently from a full container
 * — so it is a sibling of `sea` rather than a flag on it.
 */
export type ShipmentType = "air" | "sea" | "lcl";

export const SHIPMENT_TYPE_LABEL: Record<ShipmentType, string> = {
  air: "By Air",
  sea: "By Sea",
  lcl: "LCL",
};

/** The options, in the order the desk thinks about them. */
export const SHIPMENT_TYPES: { value: ShipmentType; label: string }[] = [
  { value: "air", label: SHIPMENT_TYPE_LABEL.air },
  { value: "sea", label: SHIPMENT_TYPE_LABEL.sea },
  { value: "lcl", label: SHIPMENT_TYPE_LABEL.lcl },
];

/** `SHIPMENT_TYPE_LABEL` with an em dash for "not recorded" — the one display rule. */
export const shipmentLabel = (t: string | null | undefined): string =>
  t ? SHIPMENT_TYPE_LABEL[t as ShipmentType] ?? t : "—";

export interface PurchaseRequest {
  id: string;
  requestNo: string;
  companyId: string;
  categoryId: string;
  /** The fixed vendor chosen on the request header (import has no sourcing). */
  vendorId: string | null;
  /**
   * How the goods travel. Null only on requisitions raised before the field
   * existed — never guessed, and rendered as "—".
   */
  shipmentType: ShipmentType | null;
  /** The request's single foreign currency (= the vendor's default). */
  currency: string | null;
  requesterId: string | null;
  status: RequestStatus;
  note: string | null;
  createdAt: string;
  /** Set when the requester (or an admin) cancelled it before any approval. */
  cancelReason: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  /** Set when the requester corrected the request after submitting it. */
  editedAt: string | null;
  editedBy: string | null;
}

/**
 * One file attached at sourcing on an Import request LINE — a vendor's
 * quotation, a rate comparison, a photographed sheet.
 *
 * ⚠ PER LINE, NOT PER REQUISITION, unlike the Domestic app's SourcingDoc.
 *   `fms_import_save_sourcing` sources one line at a time, so two lines of the
 *   same requisition are two separate sourcing events with two separate sets of
 *   quotations. Keying these on the requisition would make the second line
 *   appear to inherit the first line's files.
 */
export interface SourcingDoc {
  id: string;
  requestItemId: string;
  path: string;
  name: string;
  mimeType: string | null;
  sizeBytes: number | null;
  sortOrder: number;
}

export type LineStatus =
  | "sourcing"
  | "approval"
  | "on_hold"
  | "approved_pending_po"
  | "po"
  | "rejected"
  | "cancelled";

export interface RequestItem {
  id: string;
  requestId: string;
  itemId: string;
  /** Category of THIS line. Null only on rows predating per-line category —
   *  fall back to the request header's in that case. */
  categoryId: string | null;
  quantity: number;
  unit: string;
  lineRemark: string | null;
  sourcingReason: string | null;
  finalVendorId: string | null;
  finalQty: number | null;
  /** The chosen rate in the vendor's foreign currency (from the price master, editable). */
  finalRate: number | null;
  /** The line's foreign currency (e.g. USD). */
  currency: string | null;
  /** Exchange rate (foreign→INR) captured at submit; used to derive lineValue (INR). */
  fxRateAtRequest: number | null;
  /** Line value in the vendor currency (qty × rate). GST does not apply to imports. */
  lineValueFx: number | null;
  /** Line value in INR (foreign × fxRateAtRequest) — the approval-tier basis. */
  lineValue: number | null;
  status: LineStatus;
  approverId: string | null;
  /**
   * Set while this requisition has been HANDED OVER to a specific person. It
   * survives the decision, so the holder can still revise before the PO.
   *
   * A handover MOVES the work: while this is set, the holder is the only
   * non-admin who may decide the line. Null means it sits with whoever is
   * configured in Setup, which is the normal case.
   */
  assignedApproverId: string | null;
  approvalTier: string | null;
  rejectReason: string | null;
  cancelReason: string | null;
  /** When sourcing was saved — the `sourcing` step's completion timestamp. */
  sourcedAt: string | null;
  /** When the line was approved/overridden — the `approval` step's completion timestamp. */
  approvedAt: string | null;
  /** Set when this entry was CORRECTED via an update_* RPC (never by the stage machine). */
  editedAt: string | null;
  editedBy: string | null;
  createdAt: string;
}

/**
 * Outcome of cancelling several lines at once.
 *
 * `fms_import_cancel_line` is per-line, with no bulk or transactional variant,
 * so a batch is a LOOP: a mid-loop failure is REPORTED, never rolled back —
 * every line cancelled before it is already committed and correct. The caller
 * shows what did not go through rather than pretending the whole thing failed.
 */
export interface CancelLinesResult {
  cancelled: string[];
  failed: { requestItemId: string; message: string }[];
}

export interface Quotation {
  id: string;
  requestItemId: string;
  vendorId: string;
  rate: number;
  leadTimeDays: number | null;
  remark: string | null;
  isRecommended: boolean;
}

/**
 * A PO's single state axis is `currentStage` (see PO_STAGE_LABEL). The six
 * workflow stages plus two terminal stages: `closed`, `cancelled`. There is no
 * separate PO status field.
 */
export interface PurchaseOrder {
  id: string;
  poNo: string;
  vendorId: string;
  companyId: string;
  /** Copied from the source requisition at generate time, so every PO-side step
   *  form can name the shipment mode without walking back to the request. */
  shipmentType: ShipmentType | null;
  currentStage: string;
  /** PO value in INR (Σ line INR values) — the approval / cap basis. */
  totalValue: number;
  /** PO value in the vendor's foreign currency (Σ line foreign values). */
  totalValueFx: number;
  /** The PO's foreign currency. */
  currency: string | null;
  /** Exchange rate captured on the PO (at share/payment); editable. */
  fxRate: number | null;
  fxRateAt: string | null;
  fxSource: string | null;
  advancePaid: number;
  /** Import is always 100% advance; terms are forced to full_advance at Share PO. */
  paymentTerms: PaymentTerms | null;
  /** Expected dispatch date, captured (required) at the Share-PO step. */
  dispatchDate: string | null;
  /** When the PO was first shared — the `share_po` step's completion timestamp. */
  sharedAt: string | null;
  /** Who first shared it. Null for POs shared before the column existed — never guessed. */
  sharedBy: string | null;
  documentPath: string | null;
  documentName: string | null;
  tallyPoNo: string | null;
  shareRemarks: string | null;
  createdBy: string | null;
  createdAt: string;
  /**
   * When the share details were last CORRECTED. Distinct from the row's
   * `updated_at`, which a DB trigger bumps on every write (including the stage
   * machine's own recomputes) and so cannot date an edit.
   */
  editedAt: string | null;
  editedBy: string | null;
  /** Set when a PO is cancelled (approver-only, vendor-requested). */
  cancelledBy: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
}

export interface PoItem {
  id: string;
  poId: string;
  requestItemId: string;
  qty: number;
  rate: number;
  lineValue: number;
  receivedQty: number;
}

export type PaymentTerms = "full_advance" | "partial_advance" | "credit" | "on_delivery";
export type PiStatus = "open" | "partially_received" | "received";
export type DispatchStatus = "pending" | "dispatched" | "delayed";

/**
 * The vendor's proforma invoice, captured at the `collect_pi` step.
 *
 * Only four fields are live: `vendorPiNo`, `documentPath`/`documentName` and
 * `remarks`. Everything else — `paymentTerms`, `piValue`, `dispatchDate`, the
 * dispatch/status axis and {@link PiItem} — belongs to the money-driven flow
 * Import shed in 20260727120000. The columns are kept (additive-only rule) and
 * are never written by the current step, so read them as legacy.
 */
export interface Pi {
  id: string;
  poId: string;
  vendorPiNo: string;
  /** Free-text note from the Collect PI step. */
  remarks: string | null;
  /** @deprecated legacy money-flow column; never written by `collect_pi`. */
  paymentTerms: PaymentTerms;
  /** @deprecated legacy money-flow column; never written by `collect_pi`. */
  piValue: number;
  dispatchDate: string | null;
  status: PiStatus;
  dispatchStatus: DispatchStatus;
  actualDispatchDate: string | null;
  lrNo: string | null;
  transportDetails: string | null;
  revisedDispatchDate: string | null;
  documentPath: string | null;
  documentName: string | null;
  /** Who collected the PI — the `collect_pi` step's actor. Recorded since day one; the mapper just never read it. */
  createdBy: string | null;
  /** Set when this entry was CORRECTED via an update_* RPC (never by the stage machine). */
  editedAt: string | null;
  editedBy: string | null;
  createdAt: string;
}

export interface PiItem {
  id: string;
  piId: string;
  poItemId: string;
  qty: number;
}

/** One follow-up event on a PO (append-only history). PO-level follow-ups have piId null. */
export interface Followup {
  id: string;
  piId: string | null;
  poId: string;
  dispatchStatus: DispatchStatus;
  actualDispatchDate: string | null;
  revisedDispatchDate: string | null;
  lrNo: string | null;
  transportDetails: string | null;
  remarks: string | null;
  /** Optional free-text PI reference / remark. */
  piRemarks: string | null;
  createdBy: string | null;
  /** Set when this entry was CORRECTED via an update_* RPC (never by the stage machine). */
  editedAt: string | null;
  editedBy: string | null;
  createdAt: string;
}

export type GrnCondition = "good" | "damaged" | "partial_damage";

export interface Grn {
  id: string;
  poId: string;
  piId: string | null;
  /** The PO reference the receipt was booked against — the base reference. */
  poRef: string | null;
  /** Optional free-text vendor PI reference, kept only as a remark. */
  piRef: string | null;
  gateRegisterNo: string | null;
  condition: GrnCondition;
  note: string | null;
  photoPath: string | null;
  photoName: string | null;
  receivedBy: string | null;
  /** Set when this entry was CORRECTED via an update_* RPC (never by the stage machine). */
  editedAt: string | null;
  editedBy: string | null;
  /** Receipts that predate the QC step; stamped once by the QC migration. Never raise a QC work-item. */
  qcWaivedAt: string | null;
  createdAt: string;
}

export interface GrnItem {
  id: string;
  grnId: string;
  poItemId: string;
  receivedQty: number;
  condition: GrnCondition;
}

export interface TallyBooking {
  id: string;
  poId: string;
  grnId: string | null;
  tallyPiNo: string;
  documentPath: string | null;
  documentName: string | null;
  remarks: string | null;
  bookedBy: string | null;
  /** Set when this entry was CORRECTED via an update_* RPC (never by the stage machine). */
  editedAt: string | null;
  editedBy: string | null;
  createdAt: string;
}

export type QcResult = "approved" | "rejected";

/**
 * One QC inspection per Tally-booked goods receipt. The decision is ITEM-WISE
 * (see {@link QcItem}) and `result` is derived server-side: any rejected quantity
 * makes it `rejected`, which opens the return branch. An approved inspection is
 * the end of the flow.
 *
 * The purchase-return entry and the gate outward are exactly one per rejected
 * inspection, so they live here as columns rather than in tables of their own.
 */
export interface QcInspection {
  id: string;
  poId: string;
  grnId: string;
  result: QcResult;
  remarks: string | null;
  documentPath: string | null;
  documentName: string | null;
  inspectedAt: string;
  inspectedBy: string | null;
  editedAt: string | null;
  editedBy: string | null;

  /** Purchase Return Entry in Tally — both the reference and the document are mandatory. */
  returnTallyRef: string | null;
  returnRemarks: string | null;
  returnDocPath: string | null;
  returnDocName: string | null;
  returnedAt: string | null;
  returnedBy: string | null;
  returnEditedAt: string | null;
  returnEditedBy: string | null;

  /** Gate Register Outward — closes the rejection branch. */
  gateRegisterNo: string | null;
  gateOutDate: string | null;
  gateRemarks: string | null;
  gateDocPath: string | null;
  gateDocName: string | null;
  gateOutAt: string | null;
  gateOutBy: string | null;
  gateEditedAt: string | null;
  gateEditedBy: string | null;

  createdAt: string;
}

export interface QcItem {
  id: string;
  inspectionId: string;
  poItemId: string;
  /**
   * What THIS receipt delivered for the line — a snapshot, because
   * `PoItem.receivedQty` is the rollup across every GRN and is the wrong number
   * to cap a rejection against.
   */
  receivedQty: number;
  rejectedQty: number;
  remark: string | null;
}

export type PaymentKind = "advance" | "installment";

export interface Payment {
  id: string;
  poId: string;
  piId: string | null;
  kind: PaymentKind;
  /** The INR value paid (caps against the PO's INR total). */
  amount: number;
  /** The vendor-currency amount actually paid. */
  amountFx: number | null;
  currency: string | null;
  fxRate: number | null;
  inrAmount: number | null;
  paidOn: string;
  utrRef: string | null;
  /** Free-text payment details (e.g. bank, advice reference). */
  details: string | null;
  /** Uploaded payment-advice document (private bucket path + original name). */
  advicePath: string | null;
  adviceName: string | null;
  /** Optional free-text PI reference / remark (PI is no longer the payment base). */
  piRemarks: string | null;
  /** Who recorded the payment — the `advance_payment` step's actor. Recorded since day one; the mapper just never read it. */
  createdBy: string | null;
  /** Set when this entry was CORRECTED via an update_* RPC (never by the stage machine). */
  editedAt: string | null;
  editedBy: string | null;
  createdAt: string;
}

/** Entities an activity row / notification can point at. */
export type ImportEntityType = "request" | "line" | "po" | "pi" | "grn" | "payment" | "master_request";

export interface Activity {
  id: string;
  entityType: ImportEntityType;
  entityId: string;
  type: string;
  actorId: string | null;
  note: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
}

export interface ImportNotification {
  id: string;
  userId: string;
  type: string;
  entityType: ImportEntityType;
  entityId: string;
  text: string;
  actorId: string | null;
  readAt: string | null;
  createdAt: string;
}

export type MasterRequestStatus = "pending" | "approved" | "rejected";

export interface MasterRequest {
  id: string;
  masterType: MasterType;
  proposedPayload: Record<string, unknown>;
  status: MasterRequestStatus;
  requestedBy: string | null;
  reviewedBy: string | null;
  reviewNote: string | null;
  resolvedMasterId: string | null;
  createdAt: string;
}

export type PoCancelRequestStatus = "pending" | "approved" | "declined";

/**
 * A vendor-requested PO cancellation. A PO-side step owner logs the request;
 * only the PO's approver (or an admin) may approve (cancel) or decline it.
 */
export interface PoCancelRequest {
  id: string;
  poId: string;
  reason: string;
  vendorRef: string | null;
  status: PoCancelRequestStatus;
  requestedBy: string | null;
  reviewedBy: string | null;
  reviewNote: string | null;
  createdAt: string;
}
