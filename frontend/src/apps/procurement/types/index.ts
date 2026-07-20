/** Domain types for the Purchase FMS (procurement) module. */

export type MasterType = "company" | "category" | "item_group" | "item" | "vendor" | "vendor_item_price";

export const MASTER_TYPES: { value: MasterType; label: string; plural: string }[] = [
  { value: "company", label: "Company", plural: "Companies" },
  { value: "category", label: "Category", plural: "Categories" },
  { value: "item_group", label: "Item Group", plural: "Item Groups" },
  { value: "item", label: "Item", plural: "Items" },
  { value: "vendor", label: "Vendor", plural: "Vendors" },
  { value: "vendor_item_price", label: "Vendor-Item Rate", plural: "Vendor-Item Rates" },
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
  active: boolean;
  createdAt: string;
}

/**
 * Standing rate card per (vendor, item). Pre-fills the sourcing grid's rate /
 * GST / lead days — a DEFAULT, never a lock: every cell stays editable there,
 * and nothing here is consulted again once a line is sourced.
 */
export interface VendorItemPrice {
  id: string;
  vendorId: string;
  itemId: string;
  rate: number;
  gstPct: number | null;
  leadTimeDays: number | null;
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
  /**
   * Everyone who may approve in this band. ANY ONE of them can decide — this is
   * not a sequential or quorum approval. The DB keeps `approver_user_id` in sync
   * with the first entry purely as a legacy mirror; nothing here reads it.
   */
  approverUserIds: string[];
  sortOrder: number;
  active: boolean;
}

export type RequestStatus = "open" | "closed" | "cancelled";

export interface PurchaseRequest {
  id: string;
  requestNo: string;
  companyId: string;
  categoryId: string;
  requesterId: string | null;
  status: RequestStatus;
  note: string | null;
  createdAt: string;
  /** Why fewer than three vendors were shortlisted. Mandatory below three. */
  sourcingReason: string | null;
  /** When sourcing was saved for the whole requisition. Null on legacy requests
   *  sourced per line — lib/queues.ts falls back to max(line.sourcedAt). */
  sourcedAt: string | null;
  sourcedBy: string | null;
  /** Set when the requester (or an admin) cancelled it before sourcing began. */
  cancelReason: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  /** Set when the requester corrected the request after submitting it. */
  editedAt: string | null;
  editedBy: string | null;
}

/**
 * One vendor on a requisition's shortlist (max 3). Captured ONCE per requisition
 * at sourcing; exactly one row has `isRecommended`, and that vendor becomes the
 * final vendor on every line. Rates are deliberately NOT here — they are per
 * item, on RequestItem.
 */
export interface RequestVendor {
  id: string;
  requestId: string;
  vendorId: string;
  isRecommended: boolean;
  remark: string | null;
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
  quantity: number;
  unit: string;
  lineRemark: string | null;
  sourcingReason: string | null;
  finalVendorId: string | null;
  finalQty: number | null;
  finalRate: number | null;
  gstPct: number | null;
  /** Lead days agreed at sourcing, typed per item (fill-down in the form). */
  leadTimeDays: number | null;
  lineValue: number | null;
  status: LineStatus;
  approverId: string | null;
  approvalTier: string | null;
  assignedApproverId: string | null;
  rejectReason: string | null;
  cancelReason: string | null;
  /** When sourcing was saved — the `sourcing` step's completion timestamp. */
  sourcedAt: string | null;
  /** Who last saved sourcing. Null for lines sourced before the column existed. */
  sourcedBy: string | null;
  /** When the line was approved/overridden — the `approval` step's completion timestamp. */
  approvedAt: string | null;
  /** Set when this entry was CORRECTED via an update_* RPC (never by the stage machine). */
  editedAt: string | null;
  editedBy: string | null;
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
  totalValue: number;
  advancePaid: number;
  /** Payment terms are decided at the Share-PO step and drive whether an advance is due. */
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

export type PaymentKind = "advance" | "installment";

export interface Payment {
  id: string;
  poId: string;
  piId: string | null;
  kind: PaymentKind;
  amount: number;
  paidOn: string;
  utrRef: string | null;
  /** Optional free-text PI reference / remark (PI is no longer the payment base). */
  piRemarks: string | null;
  createdBy: string | null;
  /** Set when this entry was CORRECTED via an update_* RPC (never by the stage machine). */
  editedAt: string | null;
  editedBy: string | null;
  createdAt: string;
}

/** Entities an activity row / notification can point at. */
export type ProcEntityType = "request" | "line" | "po" | "pi" | "grn" | "payment" | "master_request";

export interface Activity {
  id: string;
  entityType: ProcEntityType;
  entityId: string;
  type: string;
  actorId: string | null;
  note: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
}

export interface ProcNotification {
  id: string;
  userId: string;
  type: string;
  entityType: ProcEntityType;
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
