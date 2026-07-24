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

/** One competitor sample to collect — colour + quantity, entered as a line item. */
export interface SampleItem {
  colour: string;
  quantity: string;
}

/** STATUSES ARE NOT STEP KEYS — closed / on_hold / cancelled leave every queue. */
export type RequestStatus =
  | "awaiting_receipt"          // LEGACY inward (pre lab-gate rows only)
  | "awaiting_send"
  | "awaiting_confirm"
  | "awaiting_testing"
  | "awaiting_result"
  | "awaiting_handover"
  | "awaiting_collect"           // inward, either branch: sample_collect
  | "awaiting_sample_received"   // inward, lab NOT required: sample_received (closes)
  | "awaiting_sample_to_lab"     // inward, lab required: sample_to_lab
  | "awaiting_lab_process"       // inward, lab required: lab_process — BOTH passes
  | "awaiting_result_received"   // inward, lab required: result_received (closes)
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
  colourQty: string | null;             // legacy single value (old rows)
  sampleItems: SampleItem[];            // the colour/quantity samples (all directions/types)
  collectorId: string | null;           // the chosen collector (auth.users id)
  collectorName: string | null;         // legacy free-text collector name
  handoverName: string | null;          // legacy free-text "hand to" name (old rows)
  /** Inward only: true → receive/testing/result flow; false → the short collect→received branch; null on outward. */
  labTestingRequired: boolean | null;
  /** The chosen hand-over recipient (an app user). Null when a free-text name was typed. */
  handoverRecipientId: string | null;
  handoverRecipientName: string | null;
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
  gateEntryNo: string | null;
  sentQty: string | null;
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

  // result (both) — moves the request to awaiting_handover
  resultComment: string | null;
  resultOwner: string | null;
  attachmentPath: string | null;
  attachmentName: string | null;
  resultedAt: string | null;
  resultedBy: string | null;

  // result_handover (both) — closes the request
  handoverDate: string | null;
  handoverNote: string | null;
  handedOverAt: string | null;
  handedOverBy: string | null;

  // sample_collect (inward, lab testing NOT required) — collector hands over
  collectedDate: string | null;
  collectedAt: string | null;
  collectedBy: string | null;

  // sample_received (inward, lab testing NOT required) — recipient confirms; closes
  sampleReceivedDate: string | null;
  sampleReceivedNote: string | null;
  sampleReceivedDocPath: string | null;
  sampleReceivedDocName: string | null;
  sampleReceivedAt: string | null;
  sampleReceivedBy: string | null;

  // sample_to_lab (inward, lab testing required) — recipient confirms + sends on.
  // The internal reference number lives in `internalRef`, shared with outward testing.
  labSentDate: string | null;
  labSentAt: string | null;
  labSentBy: string | null;

  // lab_process pass 1 — the lab acknowledges the sample by dating the result.
  labTentativeDate: string | null;
  labStartedAt: string | null;
  labStartedBy: string | null;

  // lab_process pass 2 — testing done; comment + document are both REQUIRED.
  labCompletedDate: string | null;
  labComment: string | null;
  labDocPath: string | null;
  labDocName: string | null;
  /** Whom the result is handed to. Null id + a name = a free-text recipient. */
  labResultToId: string | null;
  labResultToName: string | null;
  labCompletedAt: string | null;
  labCompletedBy: string | null;

  // result_received (inward, lab testing required) — closes the request
  resultReceivedDate: string | null;
  resultReceivedNote: string | null;
  resultReceivedAt: string | null;
  resultReceivedBy: string | null;

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

/* --------------------------------- masters -------------------------------- */

/** A curated collector — "who will collect the sample". Maps to an app user. */
export interface Collector {
  id: string;
  name: string;
  userId: string;
  active: boolean;
  sortOrder: number;
}

/** A curated hand-over recipient — "whom to hand the sample to". Maps to an app user. */
export interface HandoverRecipient {
  id: string;
  name: string;
  userId: string;
  active: boolean;
  sortOrder: number;
}

/* ------------------------------ master governance ------------------------- */

/** The ownable master types. All are ownable but never "requestable". */
export type SamplingMasterType = "company" | "collector" | "recipient";

export const SAMPLING_MASTER_TYPES: { value: SamplingMasterType; label: string; plural: string }[] = [
  { value: "company", label: "Company", plural: "Companies" },
  { value: "collector", label: "Collector", plural: "Collectors" },
  { value: "recipient", label: "Hand-over recipient", plural: "Hand-over recipients" },
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
