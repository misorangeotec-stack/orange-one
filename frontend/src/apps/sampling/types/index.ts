/**
 * Domain types for the Sampling FMS (ink / raw-material sampling).
 *
 * A lab-sampling tracker with ONE entity per request (no header/line split,
 * like fms_supplies_requests). Two paths through the same row, chosen by
 * `direction`:
 *   inward  : request → receive_sample → testing → result → closed
 *   outward : request → send_sample → confirm_receipt → testing → result → closed
 *
 * Every DB row is mapped snake_case → camelCase in data/samplingFetch.ts.
 */

export type ReceiveVia = "import" | "domestic";
export type Direction = "inward" | "outward";
export type RequirementType = "competitor" | "new_product";
export type TransportBorne = "Yes" | "No";

/** STATUSES ARE NOT STEP KEYS — closed / on_hold / cancelled leave every queue. */
export type RequestStatus =
  | "awaiting_receipt"
  | "awaiting_send"
  | "awaiting_confirm"
  | "awaiting_testing"
  | "awaiting_result"
  | "closed"
  | "on_hold"
  | "cancelled";

export interface Company {
  id: string;
  name: string;
  active: boolean;
  sortOrder: number;
}

export interface SamplingRequest {
  id: string;
  reqNo: string;
  companyId: string;
  receiveVia: ReceiveVia;
  direction: Direction;
  requirementType: RequirementType | null;
  raisedBy: string | null;
  requesterName: string;
  partyName: string | null;
  productDesc: string | null;
  colourQty: string | null;
  collectorName: string | null;
  handoverName: string | null;
  transportBorne: TransportBorne | null;
  desiredResult: string | null;
  additionalInfo: string | null;
  status: RequestStatus;
  currentStep: string;
  submittedAt: string;

  // receive_sample (inward)
  receivedDate: string | null;
  receivedAt: string | null;
  receivedBy: string | null;

  // send_sample (outward)
  sentDate: string | null;
  sentAt: string | null;
  sentBy: string | null;

  // confirm_receipt (outward)
  partyReceivedDate: string | null;
  confirmedAt: string | null;
  confirmedBy: string | null;

  // testing (both)
  testingCompletedDate: string | null;
  internalRef: string | null;
  tentativeResultDate: string | null;
  testedAt: string | null;
  testedBy: string | null;

  // result (both) — closes the request
  resultComment: string | null;
  resultOwner: string | null;
  attachmentPath: string | null;
  attachmentName: string | null;
  resultedAt: string | null;
  resultedBy: string | null;
  closedAt: string | null;

  /**
   * When a stage entry on this request was last CORRECTED via an update_* RPC.
   * Distinct from `updated_at`, which a DB trigger bumps on every write.
   */
  editedAt: string | null;
  editedBy: string | null;

  holdAt: string | null;
  holdReason: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
}

/* ------------------------------ master governance ------------------------- */

/** Company is the ONLY master, and it is ownable but never "requestable". */
export type SamplingMasterType = "company";

export const SAMPLING_MASTER_TYPES: { value: SamplingMasterType; label: string; plural: string }[] = [
  { value: "company", label: "Company", plural: "Companies" },
];

export interface SamplingMasterManager {
  id: string;
  masterType: SamplingMasterType;
  managerUserId: string;
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

export type SamplingEntityType = "request";

export interface SamplingActivity {
  id: string;
  entityType: SamplingEntityType;
  entityId: string;
  type: string;
  actorId: string | null;
  note: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
}

export interface SamplingNotification {
  id: string;
  userId: string;
  type: string;
  entityType: SamplingEntityType;
  entityId: string;
  text: string;
  actorId: string | null;
  readAt: string | null;
  createdAt: string;
}
