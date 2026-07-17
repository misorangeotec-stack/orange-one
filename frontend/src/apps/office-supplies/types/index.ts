/**
 * Domain types for the Office Supplies Purchase FMS.
 *
 * A lightweight requisition workflow (single item per request, conditional
 * approvals, then handover) modelled on the fms_exit_* case shape. Every DB row is
 * mapped snake_case → camelCase in data/suppliesFetch.ts.
 */

export type RequestType = "new_requirement" | "services_maintenance";
export type Location = "Plant" | "Office";

/** STATUSES ARE NOT STEP KEYS — on_hold / cancelled / rejected / delivered leave every queue. */
export type RequestStatus =
  | "pending_first_approval"
  | "pending_second_approval"
  | "pending_handover"
  | "delivered"
  | "rejected"
  | "on_hold"
  | "cancelled";

export interface Company {
  id: string;
  name: string;
  active: boolean;
  sortOrder: number;
}

export interface Department {
  id: string;
  name: string;
  hodUserId: string | null;
  active: boolean;
  sortOrder: number;
}

export interface Category {
  id: string;
  name: string;
  requiresApproval: boolean;
  active: boolean;
  sortOrder: number;
}

export interface Item {
  id: string;
  categoryId: string;
  name: string;
  unit: string | null;
  active: boolean;
  sortOrder: number;
}

export interface ServiceType {
  id: string;
  name: string;
  active: boolean;
  sortOrder: number;
}

export interface SupplyRequest {
  id: string;
  reqNo: string;
  companyId: string;
  location: Location;
  departmentId: string;
  raisedBy: string | null;
  requestedForName: string;
  requestedForUserId: string | null;
  raisedOnBehalf: boolean;
  requestType: RequestType;
  categoryId: string | null;
  serviceTypeId: string | null;
  itemName: string | null;
  quantity: string;
  reason: string | null;
  requiresApproval: boolean;
  status: RequestStatus;
  currentStep: string;
  submittedAt: string;
  firstApprovedAt: string | null;
  firstApproverId: string | null;
  firstRemarks: string | null;
  secondApprovedAt: string | null;
  secondApproverId: string | null;
  secondRemarks: string | null;
  handedOverAt: string | null;
  handoverBy: string | null;
  handoverRemarks: string | null;
  tentativeDeliveryDate: string | null;
  actualDeliveryDate: string | null;
  deliveredAt: string | null;
  rejectedAt: string | null;
  rejectStage: string | null;
  rejectReason: string | null;
  holdAt: string | null;
  holdReason: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  /**
   * When a stage entry on this request was last CORRECTED via an update_* RPC.
   * Distinct from `updated_at`, which a DB trigger bumps on every write and so
   * cannot date an edit.
   */
  editedAt: string | null;
  editedBy: string | null;
  createdAt: string;
}

/* ------------------------------ master governance ------------------------- */

export type SupplyMasterType = "company" | "department" | "category" | "item" | "service_type";

export const SUPPLY_MASTER_TYPES: { value: SupplyMasterType; label: string; plural: string }[] = [
  { value: "company", label: "Company", plural: "Companies" },
  { value: "department", label: "Department", plural: "Departments" },
  { value: "category", label: "Category", plural: "Categories" },
  { value: "item", label: "Item", plural: "Items" },
  { value: "service_type", label: "Service type", plural: "Service types" },
];

/** The two masters staff pick from a dropdown and might find missing. */
export const REQUESTABLE_SUPPLY_MASTER_TYPES = SUPPLY_MASTER_TYPES.filter(
  (m) => m.value === "item" || m.value === "service_type",
);

export interface SupplyMasterManager {
  id: string;
  masterType: SupplyMasterType;
  managerUserId: string;
}

export interface SupplyMasterRequest {
  id: string;
  masterType: SupplyMasterType;
  proposedPayload: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  requestedBy: string | null;
  reviewedBy: string | null;
  reviewNote: string | null;
  resolvedMasterId: string | null;
  createdAt: string;
}

/* --------------------------------- config --------------------------------- */

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
  active: boolean;
}

/* ------------------------------ activity + bell --------------------------- */

export type SupplyEntityType = "request" | "master_request";

export interface SupplyActivity {
  id: string;
  entityType: SupplyEntityType;
  entityId: string;
  type: string;
  actorId: string | null;
  note: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
}

export interface SupplyNotification {
  id: string;
  userId: string;
  type: string;
  entityType: SupplyEntityType;
  entityId: string;
  text: string;
  actorId: string | null;
  readAt: string | null;
  createdAt: string;
}
