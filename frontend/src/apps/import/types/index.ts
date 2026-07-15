/** Domain types for the Import Purchase FMS module. */

export type MasterType = "company" | "category" | "item_group" | "item" | "vendor" | "vendor_item_price";

export const MASTER_TYPES: { value: MasterType; label: string; plural: string }[] = [
  { value: "company", label: "Company", plural: "Companies" },
  { value: "category", label: "Category", plural: "Categories" },
  { value: "item_group", label: "Item Group", plural: "Item Groups" },
  { value: "item", label: "Item", plural: "Items" },
  { value: "vendor", label: "Vendor", plural: "Vendors" },
  { value: "vendor_item_price", label: "Vendor-Item Price", plural: "Vendor-Item Prices" },
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
  itemGroupId: string;
  name: string;
  unit: string;
  active: boolean;
  sortOrder: number;
  createdAt: string;
}

export interface Vendor {
  id: string;
  name: string;
  gstin: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  /** The vendor's quoting currency (e.g. USD/EUR) — a request/PO is single-currency. */
  defaultCurrency: string | null;
  active: boolean;
  createdAt: string;
}

/** The fixed agreed price for one (vendor, item) — auto-fills the request line. */
export interface VendorItemPrice {
  id: string;
  vendorId: string;
  itemId: string;
  currency: string;
  rate: number;
  gstPct: number | null;
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

export interface PurchaseRequest {
  id: string;
  requestNo: string;
  companyId: string;
  categoryId: string;
  /** The fixed vendor chosen on the request header (import has no sourcing). */
  vendorId: string | null;
  /** The request's single foreign currency (= the vendor's default). */
  currency: string | null;
  requesterId: string | null;
  status: RequestStatus;
  note: string | null;
  createdAt: string;
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
  quantity: number;
  unit: string;
  lineRemark: string | null;
  sourcingReason: string | null;
  finalVendorId: string | null;
  finalQty: number | null;
  /** The chosen rate in the vendor's foreign currency (from the price master, editable). */
  finalRate: number | null;
  gstPct: number | null;
  /** The line's foreign currency (e.g. USD). */
  currency: string | null;
  /** Exchange rate (foreign→INR) captured at submit; used to derive lineValue (INR). */
  fxRateAtRequest: number | null;
  /** Line value in the vendor currency (qty × rate × (1+gst/100)). */
  lineValueFx: number | null;
  /** Line value in INR (foreign × fxRateAtRequest) — the approval-tier basis. */
  lineValue: number | null;
  status: LineStatus;
  approverId: string | null;
  approvalTier: string | null;
  assignedApproverId: string | null;
  rejectReason: string | null;
  cancelReason: string | null;
  /** When sourcing was saved — the `sourcing` step's completion timestamp. */
  sourcedAt: string | null;
  /** When the line was approved/overridden — the `approval` step's completion timestamp. */
  approvedAt: string | null;
  createdAt: string;
}

export interface Quotation {
  id: string;
  requestItemId: string;
  vendorId: string;
  rate: number;
  gstPct: number | null;
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
  documentPath: string | null;
  documentName: string | null;
  tallyPoNo: string | null;
  shareRemarks: string | null;
  createdBy: string | null;
  createdAt: string;
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
  gstPct: number | null;
  lineValue: number;
  receivedQty: number;
}

export type PaymentTerms = "full_advance" | "partial_advance" | "credit" | "on_delivery";
export type PiStatus = "open" | "partially_received" | "received";
export type DispatchStatus = "pending" | "dispatched" | "delayed";

export interface Pi {
  id: string;
  poId: string;
  vendorPiNo: string;
  paymentTerms: PaymentTerms;
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
  createdAt: string;
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
