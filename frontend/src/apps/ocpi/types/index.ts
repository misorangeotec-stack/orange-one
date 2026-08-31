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
  /* ── Ink, the NO branch (OCPI-7) ──────────────────────────────────────────
   * Asked only when `inclInk` is literally FALSE. "Not included in the machine
   * price" is not "not being sold" — the customer still buys ink, and the rate
   * is agreed at the same table. `null` means never asked, which is NOT No.
   *
   * ⚠ THE SUB-TOTAL IS NOT PART OF THE DEAL VALUE AND MUST NEVER BE ADDED TO
   *   IT. This is only ever asked when the item is NOT in the deal, so its
   *   money is not the deal's money — `dealValueAmount`, the GST derivation,
   *   the frozen FX conversion, `totalInr` and `grandTotalInr` all exclude it
   *   by construction. Two sub-totals beside a deal value are an obvious thing
   *   for a later "grand total" to sweep up, and that would be a commercial
   *   error on a customer contract, not a display bug.
   *
   * ⚠ ALWAYS RUPEES, whatever the deal is quoted in (client, 31-Aug-2026), and
   *   never converted — `fxRate` is not consulted anywhere in this block. So a
   *   dollar machine and a rupee ink rate can appear on one sheet, each with its
   *   own symbol.
   *
   * ⚠ IT STILL CARRIES NO `Inr` SUFFIX, and that is deliberate rather than an
   *   oversight now that it IS rupees: in this module `…Inr` marks a figure on
   *   the DERIVED MONEY PATH (`machineValueInr`, `gstAmountInr`, `totalInr`,
   *   `grandTotalInr`). This is rupees but is not on that path, and naming it
   *   `…Inr` would file it with the very figures it must never join. */
  inkOfferAgreed: boolean | null;
  /** Litres. Numeric, unlike the free-text `inkQtyIncluded` of the YES branch. */
  inkOfferQty: number | null;
  /** Rupees per litre, always. Not `inkPrice`, which is Section A. */
  inkOfferRate: number | null;
  /** DERIVED by `fms_ocpi_write_quotation`, never computed here. Read only. */
  inkOfferSubtotal: number | null;
  inclSpares: boolean | null;
  spareDetails: string | null;
  inclHead: boolean | null;
  headsIncluded: number | null;
  /* ── Head, the NO branch (OCPI-7) ─────────────────────────────────────────
   * ⚠ NOT `headInvoiceQty` / `headInvoiceAmount`, which mean the OPPOSITE: a
   *   head that IS included but is billed on a separate invoice. These are for
   *   a head the deal does not include at all. The two pairs are mutually
   *   exclusive by construction — the invoice pair survives only when
   *   `inclHead` is true, this pair only when it is false. Same money rule as
   *   the ink block above. */
  headOfferAgreed: boolean | null;
  /** A plain count of heads, like `headsIncluded` next door. */
  headOfferQty: number | null;
  /** Rupees per head, always. */
  headOfferRate: number | null;
  /** DERIVED by `fms_ocpi_write_quotation`, never computed here. Read only. */
  headOfferSubtotal: number | null;
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

  /* ── Shipment & invoice ───────────────────────────────────────────────────
   * FIVE items, the same five questions each, in the order they are asked on
   * screen: head, ink, dryer, spare parts, centering device. `HeadShipMode` /
   * `HeadShipVia` keep their names — they were the head's alone before the
   * section existed — but the vocabulary is shared by all five, so they are
   * used across the group rather than copied per item.
   *
   * ⚠ EACH ROW HANGS OFF A DIFFERENT CONDITION, and two of the five are the
   *   MACHINE's answer rather than the salesperson's. The list lives in
   *   branching.ts beside the rules, and every one of them has its twin in
   *   fms_ocpi_write_oc, which nulls what the form hides on every save.
   *
   * ⚠ THE SUB-TOTALS ARE READ-ONLY. They are derived by fms_ocpi_write_oc as
   *   round(qty * amount, 2) and never sent up — they are absent from
   *   `QuotationDraft` and from both payloads on purpose. The form recomputes
   *   the same product live as a PREVIEW; this is the figure that prints. */
  headShipMode: HeadShipMode | null;
  headShipVia: HeadShipVia | null;
  headBalanceRemarks: string | null;
  headSeparateInvoice: boolean | null;
  /** Quantity and amount exist ONLY on a separate invoice — see fms_ocpi_write_oc. */
  headInvoiceQty: number | null;
  headInvoiceAmount: number | null;
  /** DERIVED by `fms_ocpi_write_oc`, never computed here. Read only. */
  headInvoiceSubtotal: number | null;

  /**
   * ⚠ NOT `inkOfferQty` / `inkOfferRate`, which mean the OPPOSITE: ink the deal
   *   does NOT include, offered at a subsidized rate. These are ink that IS
   *   included and is billed on its own invoice. The two can never both hold a
   *   value — that pair needs `inclInk === false`, this one needs `true` — so a
   *   salesperson never sees both at once, but the labels still have to differ.
   */
  inkShipMode: HeadShipMode | null;
  inkShipVia: HeadShipVia | null;
  inkSeparateInvoice: boolean | null;
  inkInvoiceQty: number | null;
  inkInvoiceAmount: number | null;
  /** DERIVED by `fms_ocpi_write_oc`, never computed here. Read only. */
  inkInvoiceSubtotal: number | null;

  dryerShipMode: HeadShipMode | null;
  dryerShipVia: HeadShipVia | null;
  dryerSeparateInvoice: boolean | null;
  dryerInvoiceQty: number | null;
  dryerInvoiceAmount: number | null;
  /** DERIVED by `fms_ocpi_write_oc`. NOT `dryerValueInr`, which is the dryer's
   *  own price on the machine contract and IS on the money path. Read only. */
  dryerInvoiceSubtotal: number | null;

  sparesShipMode: HeadShipMode | null;
  sparesShipVia: HeadShipVia | null;
  sparesSeparateInvoice: boolean | null;
  sparesInvoiceQty: number | null;
  sparesInvoiceAmount: number | null;
  /** DERIVED by `fms_ocpi_write_oc`, never computed here. Read only. */
  sparesInvoiceSubtotal: number | null;

  centeringShipMode: HeadShipMode | null;
  centeringShipVia: HeadShipVia | null;
  centeringSeparateInvoice: boolean | null;
  centeringInvoiceQty: number | null;
  centeringInvoiceAmount: number | null;
  /** DERIVED by `fms_ocpi_write_oc`, never computed here. Read only. */
  centeringInvoiceSubtotal: number | null;

  /**
   * The dryer model, inside the category `dryerType` names.
   *
   * ⚠ TEXT, NOT A FOREIGN KEY, exactly like `headType` / `inkType` / `dryerType`
   *   beside it. A deal is a frozen record of what was quoted; renaming or
   *   retiring a dryer in the master must not rewrite a contract already signed.
   */
  dryerName: string | null;
  /** Is the dryer part of the deal? If not, `dryerPrice` is what it costs. */
  dryerIncluded: boolean | null;
  /**
   * The dryer’s price when it is NOT part of the deal, IN THE DEAL’S CURRENCY.
   *
   * ⚠ IT DOES ATTRACT GST — client-answered 29-Aug-2026, reversing the holding
   *   position this comment used to describe. `dryerGstInr` carries the tax and
   *   `grandTotalInr` the sum; `totalInr` still means the MACHINE total alone,
   *   so the papers can print machine total → dryer total → final total.
   */
  dryerPrice: number | null;
  /**
   * The dryer money, DERIVED server-side like the machine’s (29-Aug-2026).
   *
   * ⚠ `dryerPrice` is in the DEAL’S CURRENCY; `dryerValueInr` is the rupee
   *   figure, converted at the same frozen rate as `machineValueInr`. Reading
   *   the price as rupees on a dollar deal would be an ~85x error on a contract.
   *
   * ⚠ `totalInr` STILL MEANS THE MACHINE TOTAL. `grandTotalInr` is what the
   *   customer pays: machine + its GST + dryer + its GST. The papers print all
   *   three lines, and read these figures rather than adding any of them.
   */
  dryerValueInr: number | null;
  dryerGstInr: number | null;
  grandTotalInr: number | null;
  dryerChambers: string | null;
  heatingMode: string | null;
  platterDetails: string | null;
  dryerWarranty: string | null;

  airBlade: boolean | null;
  externalCentering: boolean | null;
  inkDustExhauster: boolean | null;
  chillingSystem: boolean | null;

  /* Section B's eighth pointer (OCPI-10). Free text, asked on every deal.
   * NOT `otherCommitments` below, which is retired: it still prints on old
   * deals that carry a value, but the form offers no input for it. */
  otherInclusions: string | null;

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
/**
 * Whether a machine can carry an optional extra at all.
 *
 * ⚠ THREE STATES, NOT A BOOLEAN, and the third is the useful one. It is the
 *   client's own vocabulary from the machine sheet: `no` means the machine
 *   cannot have it, so the question is never asked; `optional` means ask the
 *   salesperson; `yes` means it is always included. Before this, all four
 *   extras were asked on every deal regardless of what the machine can take.
 */
export type MachineOption = "no" | "optional" | "yes";

export const MACHINE_OPTIONS: { value: MachineOption; label: string }[] = [
  { value: "no", label: "No — never offered" },
  { value: "optional", label: "Optional — ask on the quotation" },
  { value: "yes", label: "Yes — always included" },
];

export interface OcpiMachine {
  id: string;
  /**
   * The machine CODE, and what the quotation dropdown has always shown.
   * ⚠ Untouched by OCPI-3 — `billingName` was added beside it, not over it.
   */
  name: string;
  /** The full product name as it reads on an invoice. NOT unique. */
  billingName: string | null;
  /** Direct / Sublimation / Other. Chosen first on the quotation; narrows the list. */
  categoryId: string | null;
  /**
   * Does this machine take a dryer?
   *
   * ⚠ PER MACHINE, NOT PER CATEGORY. It was specified on the category and the
   *   client's own sheet disproved it: in "Other", Position Printer needs one
   *   while all three Pengda machines do not.
   */
  needsDryer: boolean | null;
  optAirBlade: MachineOption | null;
  /** Also decides whether the centering device is asked about at all. */
  optExternalCentering: MachineOption | null;
  optInkDustExhauster: MachineOption | null;
  optChillingSystem: MachineOption | null;
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

/**
 * A dryer model, belonging to one dryer CATEGORY.
 *
 * `fms_ocpi_dryer_types` holds the categories — Indian / Chinese / Not
 * Applicable — and keeps its table name; this is the list of actual dryers
 * within each. The quotation picks the category first and filters this by it.
 */
export interface OcpiDryer {
  id: string;
  dryerTypeId: string;
  name: string;
  active: boolean;
  sortOrder: number;
}

/**
 * One machine ↔ one print head. A machine may have SEVERAL.
 *
 * ⚠ The client's sheet lists two heads in a single cell for five machines
 *   ("EX600 RC Katan & Homer", "MS & Kyocera both"), and confirmed a machine
 *   genuinely offers more than one. The quotation shows them all and the
 *   salesperson does not choose.
 */
export interface OcpiMachineHead {
  machineId: string;
  headTypeId: string;
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
