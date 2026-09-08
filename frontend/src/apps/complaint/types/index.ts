/**
 * Domain types for the Complaint (RM/FG) FMS.
 *
 * ONE entity per complaint (no header/line split, like fms_supplies_requests and
 * fms_sampling_requests), running ONE linear path — see lib/steps.ts, which is
 * the authority:
 *   raise → acknowledge → investigation → capa → resolution → confirmation → close
 *
 * Every DB row is mapped snake_case → camelCase in data/complaintFetch.ts.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RM/FG SPLIT IS ONE SHARED BLOCK OF COLUMNS, NOT TWO.
 *
 * `complaintType` decides the LABELS and the PICKER FILTER, never a second set of
 * fields: one `partyId`/`partyName`, one `invoiceNo`/`invoiceDate`, one `lotNo`,
 * one `itemId`/`itemName`. The business itself describes it that way — the source
 * sheet's words for the raw-material arm are "Purchase invoice. And all the
 * heading of sales and customer, change", which is a heading change, not a
 * different fact.
 *
 * It is also what `mst_parties` already does: customers AND vendors in one table,
 * because in Tally both are a ledger. FG filters `is_customer`, RM filters
 * `is_vendor` — a `.eq()` argument, not a schema. And every downstream reader
 * (the queue grid, the Excel export, the Control Center, the email rows, the
 * Master Report) wants ONE Party column; a coalesced cell would need an explicit
 * `sortValue` + `filter.get` override in every one of them.
 *
 * The labels live in lib/format.ts and nowhere else.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Which side the complaint came from. Drives labels and the party picker, not the flow. */
export type ComplaintType = "finished_good" | "raw_material";

export const COMPLAINT_TYPE_LABEL: Record<ComplaintType, string> = {
  finished_good: "Finished Good",
  raw_material: "Raw Material",
};

export const COMPLAINT_TYPES: ComplaintType[] = ["finished_good", "raw_material"];

/**
 * Where the raise panel's facts came from.
 *
 * `manual` on every row today, and that is the measured answer rather than a
 * placeholder: the Tally mirror carries no batch/LOT dimension at all, so there
 * is nothing to resolve a LOT No. against (see lib/resolveLot.ts). The column
 * ships now so that when the connector is widened, the hit rate is measurable
 * from day one and phase 2 needs no migration.
 */
export type LotSource = "manual" | "tally";

/** How badly it hurts. Set at acknowledge; drives nothing automatic, reported on. */
export type Severity = "critical" | "major" | "minor";

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  major: "Major",
  minor: "Minor",
};

export const SEVERITIES: Severity[] = ["critical", "major", "minor"];

/** What was done about it. A CHECK'd vocabulary, NOT a master — each value branches code. */
export type ResolutionType = "replace" | "credit_note" | "rework" | "no_action";

export const RESOLUTION_TYPE_LABEL: Record<ResolutionType, string> = {
  replace: "Replacement",
  credit_note: "Credit note",
  rework: "Rework",
  no_action: "No action",
};

export const RESOLUTION_TYPES: ResolutionType[] = ["replace", "credit_note", "rework", "no_action"];

/** Accept it as a real complaint, or reject it. Rejection is terminal. */
export type AckDecision = "accept" | "reject";

/**
 * Where a root cause sits, so the Dashboard can Pareto them without reading the
 * free text. A CHECK'd vocabulary on the root-cause master, not a master of its own.
 */
export type CauseGroup = "material" | "process" | "handling" | "storage" | "transport" | "party_side";

export const CAUSE_GROUP_LABEL: Record<CauseGroup, string> = {
  material: "Material",
  process: "Process",
  handling: "Handling",
  storage: "Storage",
  transport: "Transport",
  party_side: "At the party's end",
};

export const CAUSE_GROUPS: CauseGroup[] = [
  "material",
  "process",
  "handling",
  "storage",
  "transport",
  "party_side",
];

/**
 * STATUSES ARE NOT STEP KEYS — closed / rejected / on_hold / cancelled leave every
 * queue and appear in no StepKey union. One status per open step, so `openStep`
 * (lib/queues.ts) is a lookup and never a special case.
 *
 * There is deliberately NO `draft`: the module has one intake form, and browser-
 * side draft safety comes from shared/lib/useStepDraft.ts rather than a DB status,
 * so no complaint number is ever burnt on something nobody submitted.
 */
export type RequestStatus =
  // the live chain
  | "awaiting_plant"
  | "awaiting_service"
  | "awaiting_approval"
  | "awaiting_service_close"
  | "awaiting_management_review"
  | "closed"
  | "on_hold"
  | "cancelled"
  // RETIRED with the seven-step chain (phase 12). Nothing produces these, but a
  // CHECK is never narrowed and six early test rows may still hold them — so the
  // union keeps them and every Record<RequestStatus, …> map must too.
  | "awaiting_acknowledge"
  | "awaiting_investigation"
  | "awaiting_capa"
  | "awaiting_resolution"
  | "awaiting_confirmation"
  | "awaiting_close"
  | "rejected";

/* --------------------------------- the row -------------------------------- */

export interface ComplaintRequest {
  id: string;
  complaintNo: string;
  complaintType: ComplaintType;
  status: RequestStatus;
  currentStep: string;
  raisedBy: string | null;
  requesterName: string;
  companyId: string | null;

  /* ---- the raise panel: ONE block, FG and RM (see the header) ---- */

  /** "FG Lot No." or "RM Lot No." depending on complaintType. Free text — there is no LOT master. */
  lotNo: string | null;
  /** TYPED BY THE RAISER. Nothing in Tally, production or dispatch holds an expiry date. */
  lotExpiryDate: string | null;
  lotSource: LotSource;
  /** "Category of Ink" — seeded from mst_items.category when an item is picked, then editable. */
  category: string | null;
  /** The finer split under category, from mst_items.ink_type. Optional. */
  inkType: string | null;
  /**
   * NULLABLE FK WITH A FROZEN NAME ALONGSIDE, and that is load-bearing: a user
   * can name a LOT whose item is not in mst_items at all and the row is still
   * valid. It is also exactly the shape the phase-2 LOT resolver needs.
   */
  itemId: string | null;
  /** FROZEN AT SUBMIT. Never re-joined for display — see the archive_round war story in CENTRAL-MASTERS.md. */
  itemName: string | null;
  /** The customer (FG) or the vendor (RM) — one column, because mst_parties is one table. */
  partyId: string | null;
  /** FROZEN AT SUBMIT, same reason as itemName. */
  partyName: string | null;
  /** Sales invoice no. (FG) or purchase invoice no. (RM). */
  invoiceNo: string | null;
  invoiceDate: string | null;
  qtyAffected: string | null;
  unitName: string | null;
  /** What went wrong, from the fms_complaint_natures master. */
  natureId: string | null;

  /* ---- the three the raiser types by hand ---- */

  /** "Issue Identified days/Time" — when the problem was noticed, not when it was raised. */
  issueIdentifiedAt: string | null;
  problemDetails: string | null;
  otherRemarks: string | null;

  submittedAt: string;

  /* ---- plant ---- */
  plantAction: string | null;
  plantRemarks: string | null;
  plantDate: string | null;
  plantAt: string | null;
  plantBy: string | null;

  /* ---- service (first pass) ---- */
  /** RETIRED 07-09-2026 — the field was removed from the service step. Nothing writes it. */
  svcRequisition: string | null;
  svcRemarks: string | null;
  svcConclusion: string | null;
  /** THE GATE. true → management approval; false → the service team closes it here. */
  svcCommercialCall: boolean | null;
  svcCallRemarks: string | null;
  svcDate: string | null;
  svcAt: string | null;
  svcBy: string | null;

  /* ---- service (second pass, after approval) ---- */
  svcCloseRemarks: string | null;
  svcCloseDate: string | null;
  svcCloseAt: string | null;
  svcCloseBy: string | null;

  /* ---- management review ---- */
  mgmtNote: string | null;
  mgmtDate: string | null;
  mgmtAt: string | null;
  mgmtBy: string | null;

  /* ---- RETIRED (phase 12): the seven-step chain's own columns. Kept because
     Supabase changes here are additive-only; nothing writes them any more. ---- */
  /* ---- acknowledge ---- */
  ackDecision: AckDecision | null;
  ackSeverity: Severity | null;
  /** Who investigates. Authorized on `investigation` and notified — see lib/steps.ts. */
  ackAssigneeId: string | null;
  ackAssigneeName: string | null;
  /** The date promised to the party. Once set it OVERRIDES the resolution SLA (lib/queues.ts). */
  ackTargetDate: string | null;
  ackRejectReason: string | null;
  ackNote: string | null;
  ackDate: string | null;
  ackAt: string | null;
  ackBy: string | null;

  /* ---- investigation ---- */
  invRootCauseId: string | null;
  invRootCauseNote: string | null;
  invFindings: string | null;
  invResponsibleDeptId: string | null;
  /** Who owns the corrective action. Authorized on `capa`. */
  invCapaOwnerId: string | null;
  invCapaOwnerName: string | null;
  invDate: string | null;
  invAt: string | null;
  invBy: string | null;

  /* ---- capa ---- */
  capaCorrective: string | null;
  capaPreventive: string | null;
  /** Who resolves it with the party. Authorized on `resolution`. */
  capaResolverId: string | null;
  capaResolverName: string | null;
  capaTargetDate: string | null;
  capaNote: string | null;
  capaDate: string | null;
  capaAt: string | null;
  capaBy: string | null;

  /* ---- resolution ---- */
  resType: ResolutionType | null;
  /** Credit-note no., replacement lot no. or rework job no. — whichever resType names. */
  resReference: string | null;
  resQty: string | null;
  resValue: string | null;
  /** Who confirms the party is satisfied. Authorized on `confirmation`. */
  resConfirmerId: string | null;
  resConfirmerName: string | null;
  resNote: string | null;
  resDate: string | null;
  resAt: string | null;
  resBy: string | null;

  /* ---- approval (credit note above the threshold only) ---- */
  /** Decided when the resolution was recorded and FROZEN there — never re-derived. */
  approvalRequired: boolean;
  aprDecision: "approve" | "reject" | null;
  aprNote: string | null;
  aprDate: string | null;
  aprAt: string | null;
  aprBy: string | null;

  /* ---- confirmation ---- */
  cfmPartySatisfied: boolean | null;
  cfmNote: string | null;
  cfmDate: string | null;
  cfmAt: string | null;
  cfmBy: string | null;

  /* ---- close ---- */
  clsNote: string | null;
  clsDate: string | null;
  clsAt: string | null;
  clsBy: string | null;
  closedAt: string | null;

  /* ---- lifecycle ---- */
  rejectedAt: string | null;
  rejectReason: string | null;
  holdAt: string | null;
  holdReason: string | null;
  /**
   * The status a held complaint goes back to. Stored EXPLICITLY rather than
   * re-derived from the timestamps: sampling derives it, which is why its
   * `heldOrTerminal` has to lock every edit while a request is on hold.
   */
  holdFromStatus: RequestStatus | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  /**
   * A HUMAN corrected something. Deliberately not `updatedAt`, which is a trigger
   * on every row touch and answers "did anything happen", never "did someone fix this".
   */
  editedAt: string | null;
  editedBy: string | null;
  createdAt: string;
}

/* ------------------------------- attachments ------------------------------ */

/**
 * Which step's evidence a document is. A CHILD TABLE, not `<step>_doc_path` /
 * `_name` column pairs: seven steps each take several files — the customer's
 * photos of a leaking pouch, the lab report, the credit note PDF — and column
 * pairs cap every step at one.
 */
export type DocSlot = "evidence" | "lab_report" | "capa_doc" | "resolution_doc" | "other";

export const DOC_SLOT_LABEL: Record<DocSlot, string> = {
  evidence: "Evidence",
  lab_report: "Lab report",
  capa_doc: "CAPA document",
  resolution_doc: "Resolution document",
  other: "Other",
};

export interface ComplaintDoc {
  id: string;
  complaintId: string;
  stepKey: string;
  slot: DocSlot;
  /** Storage path inside fms-complaint-docs: <complaint-id>/<slot>/<epoch>-<filename>. */
  path: string;
  name: string;
  mime: string | null;
  sizeBytes: number | null;
  uploadedBy: string | null;
  createdAt: string;
}

/* --------------------------------- masters -------------------------------- */

/**
 * What went wrong — "shade variation", "clogging", "viscosity out of spec",
 * "leaking pouch", "packaging damage", "short quantity".
 *
 * A NEW master because nothing central holds this vocabulary. Contrast the party,
 * the item and the ink category, which all come from `mst_*` and must never be
 * duplicated here — fms_dispatch_customers is the cautionary tale.
 */
export interface ComplaintNature {
  id: string;
  name: string;
  active: boolean;
  sortOrder: number;
}

/** Why it went wrong. `causeGroup` is what lets the Dashboard Pareto them. */
export interface RootCause {
  id: string;
  name: string;
  causeGroup: CauseGroup;
  active: boolean;
  sortOrder: number;
}

/* ---------------------------- master governance --------------------------- */

/**
 * The ownable master types — ONLY the two this module owns.
 *
 * The central masters (party, item, company, unit) are deliberately absent: they
 * are governed in core/admin/Masters.tsx and fed by the Tally sync, and a
 * complaint is the worst possible moment to invent a customer or an item. When
 * one genuinely is not there, the form takes the typed name with a null FK.
 */
export type ComplaintMasterType = "nature" | "root_cause";

export const COMPLAINT_MASTER_TYPES: { value: ComplaintMasterType; label: string; plural: string }[] = [
  { value: "nature", label: "Nature of complaint", plural: "Natures of complaint" },
  { value: "root_cause", label: "Root cause", plural: "Root causes" },
];

export interface ComplaintMasterManager {
  id: string;
  masterType: ComplaintMasterType;
  managerUserId: string;
}

export type MasterRequestStatus = "pending" | "approved" | "rejected";

export interface ComplaintMasterRequest {
  id: string;
  masterType: ComplaintMasterType;
  /**
   * ⚠ THE WIRE CONTRACT. These keys are read VERBATIM by the SQL
   *   `fms_complaint_resolve_master_request`. A key added in lib/masterFields.ts
   *   without being added to the RPC is silently dropped on approval.
   */
  proposedPayload: Record<string, unknown>;
  status: MasterRequestStatus;
  requestedBy: string | null;
  reviewedBy: string | null;
  reviewNote: string | null;
  resolvedMasterId: string | null;
  createdAt: string;
  updatedAt: string;
}

/* --------------------------------- config --------------------------------- */

export interface StepOwner {
  id: string;
  stepKey: string;
  /** UI FILTERS ONLY. Authorization comes solely from `employeeIds` — mirror of the SQL. */
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

export type ComplaintEntityType = "request";

export interface ComplaintActivity {
  id: string;
  entityType: ComplaintEntityType;
  entityId: string;
  type: string;
  actorId: string | null;
  note: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
}

export interface ComplaintNotification {
  id: string;
  userId: string;
  type: string;
  entityType: ComplaintEntityType;
  entityId: string;
  text: string;
  actorId: string | null;
  readAt: string | null;
  createdAt: string;
}
