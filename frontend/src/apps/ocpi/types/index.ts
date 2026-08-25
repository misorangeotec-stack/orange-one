import type { StepKey } from "../lib/steps";

/**
 * The OCPI domain types.
 *
 * ⚠ STATUS IS THE STATE MACHINE; `currentStep` is a convenience label. Queue
 *   membership is derived from `status` plus the relevant `*At` stamp (see
 *   lib/queues.ts), never from `currentStep` — the same discipline Order to
 *   Dispatch keeps, so the queue pages, the Control Center and My Work cannot
 *   disagree about where a deal is.
 */
export type OcpiStatus =
  | "draft"
  | "awaiting_quotation_approval"
  /** Retired at the stage-F cutover. Kept legal for deals raised before it. */
  | "awaiting_order_confirmation"
  /** Retired at the stage-F cutover. Kept legal for deals raised before it. */
  | "awaiting_oc_approval"
  | "awaiting_customer_sign"
  | "awaiting_management_sign"
  | "awaiting_finance_handover"
  | "awaiting_finance_receipt"
  | "closed"
  /** Management refused it. Distinct from cancelled, which is US withdrawing. */
  | "rejected"
  | "rework"
  | "on_hold"
  | "cancelled";

/** A status that still owes somebody work. */
export const OPEN_STATUSES: OcpiStatus[] = [
  "awaiting_quotation_approval",
  // The two retired statuses stay listed: a deal parked at one still owes
  // somebody the work of deciding what to do with it.
  "awaiting_order_confirmation",
  "awaiting_oc_approval",
  "awaiting_customer_sign",
  "awaiting_management_sign",
  "awaiting_finance_handover",
  "awaiting_finance_receipt",
  "rework",
];

/** Which step a status is waiting at. Drafts and terminal statuses owe nobody. */
export const STATUS_STEP: Partial<Record<OcpiStatus, StepKey>> = {
  awaiting_quotation_approval: "quotation_approval",
  // ⚠ THE RETIRED PAIR KEEPS ITS ENTRIES. Removing them would drop the deals
  //   parked there out of every queue, every count and the Control Center at
  //   once — invisible rather than historical, which is the opposite of what
  //   retiring a step should mean.
  awaiting_order_confirmation: "order_confirmation",
  awaiting_oc_approval: "oc_approval",
  awaiting_customer_sign: "customer_signoff",
  awaiting_management_sign: "management_signoff",
  awaiting_finance_handover: "finance_handover",
  awaiting_finance_receipt: "finance_receipt",
};

export type Decision = "approve" | "reject" | "rework";

/**
 * One stored file — a scanned page of a signed document.
 *
 * `path` is the object's key in `fms-ocpi-docs` and ALWAYS starts with the
 * deal's id: the storage policy reads the owning deal out of that first
 * segment, so a file filed anywhere else would be readable by the wrong people.
 * `name` is what the person who uploaded it called it, kept so a strip of
 * look-alike phone photos can still be told apart.
 */
export interface OcpiDoc {
  path: string;
  name: string;
}

/** What the deal is quoted in. The source form records dollar deals as free text. */
export type DealCurrency = "INR" | "USD";

export type TransportTerms = "high_seas" | "local";
export type HighSeasVia = "CIF" | "EX Factory" | "FOB";
export type CostBearer = "customer" | "company";
export type PaymentType = "advance" | "credit";
export type HeadShipMode = "with_machine" | "separate";
export type HeadShipVia = "directly" | "hss" | "local_sales";

/** One OCPI deal, from first draft to countersigned order confirmation. */
export interface OcpiDeal {
  id: string;
  quotationNo: string | null;
  ocNo: string | null;
  raisedBy: string | null;
  /** The TALLY salesperson name — independent of `raisedBy`, the portal user. */
  salespersonName: string | null;

  customerId: string | null;
  customerName: string | null;
  customerAddress: string | null;
  /** The contact PERSON. The source form's address field is routinely misused for this. */
  customerAttn: string | null;
  customerEmail: string | null;
  customerMobile: string | null;
  gstAvailable: boolean | null;
  gstNo: string | null;

  companyId: string | null;
  locationId: string | null;

  machineCount: number | null;
  machineId: string | null;
  headType: string | null;
  headCount: number | null;
  inkType: string | null;
  inkPrice: string | null;
  inkCreditTerms: string | null;

  inclInk: boolean | null;
  inkQtyIncluded: string | null;
  inclSpares: boolean | null;
  spareDetails: string | null;
  inclHead: boolean | null;
  headsIncluded: number | null;
  dryerType: string | null;

  dealValueCurrency: DealCurrency | null;
  dealValueAmount: number | null;

  /* ── The FX position, for a dollar deal ───────────────────────────────────
   * ⚠ FROZEN, NEVER RE-DERIVED. A rate looked up again at print time would
   *   silently restate arithmetic the customer already agreed to. Stage D
   *   copies these onto each quotation version beside the frozen document.
   *   Named after the Import module's columns, which solved this first. */
  fxRate: number | null;
  fxRateAt: string | null;
  fxRateSource: string | null;
  /** True when a person replaced the fetched rate with the one actually agreed. */
  fxRateOverridden: boolean | null;
  /** The rupee equivalent of a USD deal. Null on a rupee deal — nothing to convert. */
  dealValueInr: number | null;
  paymentType: PaymentType | null;
  paymentTerms: string | null;
  deliveryDate: string | null;
  transportTerms: TransportTerms | null;
  highSeasVia: HighSeasVia | null;
  highSeasCostBy: CostBearer | null;
  localCostBy: CostBearer | null;
  remarks: string | null;
  dollarClauseAgreed: boolean | null;

  headShipMode: HeadShipMode | null;
  headShipVia: HeadShipVia | null;
  headBalanceRemarks: string | null;
  headSeparateInvoice: boolean | null;

  dryerChambers: string | null;
  heatingMode: string | null;
  platterDetails: string | null;
  dryerWarranty: string | null;

  airBlade: boolean | null;
  externalCentering: boolean | null;
  inkDustExhauster: boolean | null;
  chillingSystem: boolean | null;

  otherCommitments: string | null;
  printerWarranty: string | null;
  headWarranty: string | null;
  insuranceClauseAgreed: boolean | null;

  refNo: string | null;
  deliveryDays: string | null;
  tradeTerm: string | null;
  gstRate: number | null;
  /** The rupee figure the OC prints — separate from `dealValueAmount`, which may be USD. */
  machineValueInr: number | null;
  gstAmountInr: number | null;
  totalInr: number | null;
  postWarrantyHeadPrice: number | null;
  consumablesSupplier: string | null;
  machineModelNo: string | null;
  preparedBy: string | null;
  approvedBy: string | null;

  status: OcpiStatus;
  currentStep: string | null;
  holdFromStatus: string | null;
  quotationVersionNo: number;

  /** When it was SENT for approval — re-stamped on every re-submission. */
  qsAt: string | null;

  qaDecision: Decision | null;
  qaNote: string | null;
  qaAt: string | null;
  qaBy: string | null;

  ocAt: string | null;
  ocBy: string | null;

  ocaDecision: Decision | null;
  ocaNote: string | null;
  ocaAt: string | null;
  ocaBy: string | null;

  /**
   * The customer-signed order confirmation. `csDocPath` is page one and
   * `csDocPages` is every page AFTER it — the split order-to-dispatch settled
   * on, so a document photographed sheet by sheet on a phone still arrives
   * whole. Use `signedPages()` rather than reading the pair by hand.
   */
  csDocPath: string | null;
  csDocPages: OcpiDoc[];
  csAt: string | null;
  csBy: string | null;

  /** The countersigned copy, same two-part shape. */
  msDocPath: string | null;
  msDocPages: OcpiDoc[];
  msAt: string | null;
  msBy: string | null;

  rejectedAt: string | null;
  rejectStage: string | null;
  rejectReason: string | null;
  reworkAt: string | null;
  reworkStage: string | null;
  reworkReason: string | null;
  reworkCount: number;
  holdAt: string | null;
  holdReason: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;

  /** The RESOLVED order confirmation, frozen at submit. See fms_ocpi_freeze_oc. */
  ocDocumentPayload: Record<string, unknown> | null;
  ocPdfPath: string | null;
  /**
   * The Finance handover, both halves of it.
   *
   * ⚠ TWO NAMES, NOT ONE. `fh` is who handed the signed contract over and when;
   *   `fr` is who in Finance confirmed they have it. The database refuses to let
   *   one person record both — a handover with one name on both halves is a note
   *   to self, not a transfer of custody.
   */
  fhAt: string | null;
  fhBy: string | null;
  frAt: string | null;
  frBy: string | null;
  /**
   * The approved SUMMARY sheet — the sibling of `ocPdfPath`, which holds the
   * detailed one. Both are written at the Directors' approval, re-headed and
   * carrying the OC number, and both are what gets printed for signature.
   */
  ocSummaryPdfPath: string | null;

  /** Written ONLY by the update_* RPCs — never by the workflow's own writes. */
  editedAt: string | null;
  editedBy: string | null;

  createdAt: string;
  updatedAt: string;
}

/**
 * One generated quotation revision.
 *
 * `documentPayload` freezes the RESOLVED document — the machine's spec rows and
 * section bodies as they were when this version was generated — not merely the
 * field values. Without it, editing a section's wording would silently rewrite a
 * version the customer already holds.
 */
export interface QuotationVersion {
  id: string;
  dealId: string;
  versionNo: number;
  fieldPayload: Record<string, unknown>;
  documentPayload: Record<string, unknown>;
  /** The resolved DETAILED sheet, frozen with this revision alongside the summary. */
  ocDocumentPayload: Record<string, unknown>;
  pdfPath: string | null;
  /** The detailed sheet's own file. Null when the machine carries no template. */
  ocPdfPath: string | null;
  /**
   * What this revision was priced at, and in what.
   *
   * ⚠ FROZEN HERE, NOT READ THROUGH THE DEAL. The deal carries only its CURRENT
   *   value; a negotiation that went ₹52L → ₹47L → ₹44L is only readable
   *   afterwards because each revision kept its own figure.
   */
  dealValueAmount: number | null;
  dealValueCurrency: string | null;
  /** The USD→INR rate this revision's papers were priced at. Null on a rupee deal. */
  fxRate: number | null;
  generatedAt: string;
  generatedBy: string | null;
}

/** A machine, which is also its order-confirmation template. */
export interface OcpiMachine {
  id: string;
  name: string;
  docTitle: "ORDER CONFIRMATION" | "OFFER QUOTE";
  introText: string | null;
  machineModelNo: string | null;
  supplyDescription: string | null;
  specRows: { label: string; value: string }[];
  composition: string[];
  headerFields: string[];
  signoffStyle: "approved_by" | "checked_by";
  /** False ⇒ quotable, and issued on the summary sheet alone — nothing is blocked. */
  hasTemplate: boolean;
  active: boolean;
  sortOrder: number;
}

export interface OcpiMachineSection {
  id: string;
  machineId: string;
  key: string;
  title: string;
  body: string;
  sortOrder: number;
  active: boolean;
}

/** The selling entity's identity on the printed documents. */
export interface OcpiCompanyProfile {
  id: string;
  companyId: string | null;
  isDefault: boolean;
  legalName: string | null;
  cin: string | null;
  registeredAddress: string | null;
  bankName: string | null;
  bankBranch: string | null;
  bankAccountNo: string | null;
  bankIfsc: string | null;
  exWorksCity: string | null;
  letterheadPath: string | null;
  active: boolean;
  sortOrder: number;
}

export interface OcpiStepOwner {
  id: string;
  stepKey: string;
  departmentIds: string[];
  designationId: string | null;
  employeeIds: string[];
}

export interface OcpiNotification {
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
/*  Setup masters and their governance                                        */
/* -------------------------------------------------------------------------- */

/**
 * The four masters OCPI owns.
 *
 * ⚠ `machine` BEHAVES DIFFERENTLY FROM THE OTHER THREE. A deal points at a
 *   machine by id, so a machine request must be approved before a quotation can
 *   use it. Head / ink / dryer are stored on the deal as TEXT, so a request
 *   there only improves the list for next time and blocks nobody. The database
 *   says the same at length in 20260929121800.
 */
export type OcpiMasterType = "machine" | "head_type" | "ink_type" | "dryer_type";

export const OCPI_MASTER_TYPES: { value: OcpiMasterType; label: string; plural: string }[] = [
  { value: "machine", label: "Machine", plural: "Machines" },
  { value: "head_type", label: "Print-head type", plural: "Print-head types" },
  { value: "ink_type", label: "Ink type", plural: "Ink types" },
  { value: "dryer_type", label: "Dryer type", plural: "Dryer types" },
];

/** A plain name/active/order vocabulary row. Satisfies MasterCrud's contract. */
export interface OcpiNamedMaster {
  id: string;
  name: string;
  active: boolean;
  sortOrder: number;
}

export interface OcpiMasterManager {
  id: string;
  masterType: OcpiMasterType;
  managerUserId: string;
}

export interface OcpiMasterRequest {
  id: string;
  masterType: OcpiMasterType;
  proposedPayload: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  requestedBy: string | null;
  reviewedBy: string | null;
  reviewNote: string | null;
  resolvedMasterId: string | null;
  createdAt: string;
  updatedAt: string;
}
