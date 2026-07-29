/**
 * Customer Creation FMS — domain types and the closed vocabularies.
 *
 * Lives inside the Receivables Control Hub (not a separate portal app), but
 * follows the FMS module shape: one wide request row, per-step column triples,
 * statuses that are never step keys.
 *
 * ⚠⚠ THIS MODULE MUST NEVER WRITE TO ORDER-TO-DISPATCH.
 *   There is deliberately no dispatchCustomerId here and no push helper anywhere
 *   in the module. Order-to-Dispatch sources its customer data from elsewhere;
 *   the completed request IS the record, and downstream teams take the Excel
 *   export. Decided 28-Jul-2026. See the migration headers.
 *
 * ⚠ Every vocabulary below is mirrored by a CHECK constraint in
 *   supabase/migrations/20260802120100_add_fms_customer_requests.sql. Adding a
 *   value here without widening the constraint gives a runtime 400 that reads
 *   like a bug in the form. Change both, in the same commit.
 */

// `import type`, deliberately: gstin.ts imports GstState from this file, so a
// value import here would close a real runtime cycle. Types are erased.
import type { GstinSnapshot } from "./gstin";

/* ── Step 1 — customer information ─────────────────────────────────────── */

export type CustomerType =
  | "manufacturer" | "dealer" | "distributor" | "trader" | "exporter" | "end_user";

export const CUSTOMER_TYPE_OPTIONS: { value: CustomerType; label: string }[] = [
  { value: "manufacturer", label: "Manufacturer" },
  { value: "dealer",       label: "Dealer" },
  { value: "distributor",  label: "Distributor" },
  { value: "trader",       label: "Trader" },
  { value: "exporter",     label: "Exporter" },
  { value: "end_user",     label: "End User" },
];

/* ── Step 4 — ink business profile (entirely optional) ─────────────────── */

export type PrintingApplication =
  | "dtf" | "sublimation" | "reactive" | "pigment" | "uv" | "textile" | "other";

export const PRINTING_APPLICATION_OPTIONS: { value: PrintingApplication; label: string }[] = [
  { value: "dtf",         label: "DTF" },
  { value: "sublimation", label: "Sublimation" },
  { value: "reactive",    label: "Reactive" },
  { value: "pigment",     label: "Pigment" },
  { value: "uv",          label: "UV" },
  { value: "textile",     label: "Textile" },
  { value: "other",       label: "Other" },
];

export type ConsumptionBand = "lt_100" | "100_300" | "300_500" | "500_1000" | "gt_1000";

export const CONSUMPTION_BAND_OPTIONS: { value: ConsumptionBand; label: string }[] = [
  { value: "lt_100",    label: "Less than 100 KG" },
  { value: "100_300",   label: "100–300 KG" },
  { value: "300_500",   label: "300–500 KG" },
  { value: "500_1000",  label: "500–1000 KG" },
  { value: "gt_1000",   label: "Above 1000 KG" },
];

/* ── Step 7 — credit request ───────────────────────────────────────────── */

export type PaymentTerms = "advance" | "credit";

export const PAYMENT_TERMS_OPTIONS: { value: PaymentTerms; label: string }[] = [
  { value: "advance", label: "Advance" },
  { value: "credit",  label: "Credit" },
];

/** Optional per the amended spec — "None" is a choice, blank is also allowed. */
export type SecurityOffered = "pdc" | "bank_guarantee" | "none";

export const SECURITY_OFFERED_OPTIONS: { value: SecurityOffered; label: string }[] = [
  { value: "pdc",            label: "PDC" },
  { value: "bank_guarantee", label: "Bank Guarantee" },
  { value: "none",           label: "None" },
];

/* ── Step 8b — sales head ──────────────────────────────────────────────── */

/**
 * A–E, not the source document's A/B/C. The hub's live vocabulary
 * (lib/customerCategory.ts) is A/B/C/D/E and the reports people already read are
 * cut that way; a three-value picker here would produce customers that cannot be
 * placed on the existing category report.
 */
export type CustomerCategory = "A" | "B" | "C" | "D" | "E";
export const CUSTOMER_CATEGORY_OPTIONS: CustomerCategory[] = ["A", "B", "C", "D", "E"];

/* ── Step 9 — customer creation ────────────────────────────────────────── */

export type CustomerLiveStatus = "active" | "hold" | "rejected";

export const CUSTOMER_LIVE_STATUS_OPTIONS: { value: CustomerLiveStatus; label: string }[] = [
  { value: "active",   label: "Active" },
  { value: "hold",     label: "Hold" },
  { value: "rejected", label: "Rejected" },
];

/* ── Workflow ──────────────────────────────────────────────────────────── */

/**
 * ⚠ STATUSES ARE NOT STEP KEYS. `completed`/`rejected`/`rework`/`on_hold`/
 * `cancelled` live here and never in StepKey — a status loose in the queue is
 * work owed by nobody. See lib/customerOnboarding/steps.ts for the step keys.
 */
export type CustomerStatus =
  | "draft"
  | "pending_accounts"
  | "pending_sales_head"
  | "pending_director"
  | "pending_tally"
  | "completed"
  | "rejected"
  | "rework"
  | "on_hold"
  | "cancelled";

export type DecisionStage = "accounts" | "sales_head" | "director";
export type AccountsDecision = "forward" | "reject" | "rework";
export type ApprovalDecision = "approve" | "reject" | "rework";

/** Which of the four KYC uploads a document belongs to. All four are optional. */
export type DocSlot = "gst" | "pan" | "cheque" | "msme";

export const DOC_SLOTS: { slot: DocSlot; label: string }[] = [
  { slot: "gst",    label: "GST Certificate" },
  { slot: "pan",    label: "PAN Card" },
  { slot: "cheque", label: "Cancelled Cheque" },
  { slot: "msme",   label: "MSME Certificate" },
];

/* ── The request row ───────────────────────────────────────────────────── */

/**
 * One onboarding request. Mirrors public.fms_customer_requests, camelCased by
 * data/customerOnboarding/customerFetch.ts.
 *
 * ⚠ Every `numeric` column arrives from PostgREST as a STRING. The mapper
 *   coerces them to number|null — do not remove that, or `"800000" > 500000`
 *   silently evaluates false.
 */
export interface CustomerRequest {
  id: string;
  /** null while draft — an abandoned draft must not burn a CUST-2627-#### number. */
  reqNo: string | null;

  // Step 1
  legalName: string | null;
  tradeName: string | null;
  customerType: CustomerType | null;
  website: string | null;

  // Step 2 — stateCode/stateName are DERIVED from the GSTIN by the submit RPC.
  // There is no `region`: it was dropped from the form on 28-Jul-2026.
  gstNumber: string | null;
  panNumber: string | null;
  msmeUdyamNo: string | null;
  registeredAddress: string | null;
  city: string | null;
  stateCode: string | null;
  stateName: string | null;
  /**
   * What the GST portal said when the request was raised, frozen. Null for every
   * request created before the gate shipped, and for any where no provider
   * answered — so every consumer must render without it.
   */
  gstinSnapshot: GstinSnapshot | null;
  factoryAddress: string | null;
  billingSameAsRegistered: boolean;
  billingAddress: string | null;
  gstDocPath: string | null;    gstDocName: string | null;
  panDocPath: string | null;    panDocName: string | null;
  chequeDocPath: string | null; chequeDocName: string | null;
  msmeDocPath: string | null;   msmeDocName: string | null;

  // Step 3 — all four required once submitted
  contactName: string | null;
  contactDesignation: string | null;
  contactMobile: string | null;
  contactEmail: string | null;

  // Step 4 — fully optional
  printingApplications: PrintingApplication[];
  printingApplicationOther: string | null;
  currentInkBrand: string | null;
  currentSupplier: string | null;
  monthlyInkConsumption: ConsumptionBand | null;

  // Step 5 — optional
  estMonthlyPurchase: number | null;
  expectedFirstOrder: number | null;

  // Step 6 — reference 1 required, reference 2 optional
  ref1Company: string | null; ref1Contact: string | null; ref1Mobile: string | null;
  ref2Company: string | null; ref2Contact: string | null; ref2Mobile: string | null;

  // Step 7
  paymentTerms: PaymentTerms | null;
  requestedCreditLimit: number | null;
  requestedCreditDays: number | null;
  securityOffered: SecurityOffered | null;
  creditReason: string | null;

  /**
   * Assignment, both halves. The id is the portal user (drives notifications and
   * read access); the name is the Tally `customers.sales_person` STRING that the
   * hub's own scoping keys on. Different vocabularies — storing one breaks
   * either the bell or the rep's dashboard.
   */
  assignedSalesExecId: string | null;
  assignedSalesExecName: string | null;

  // Workflow
  status: CustomerStatus;
  currentStep: string;
  raisedBy: string | null;
  raisedByName: string | null;
  submittedAt: string | null;

  // Step 8a — accounts
  accGstVerified: boolean | null;
  accRefsVerified: boolean | null;
  accRecommendedLimit: number | null;
  accRecommendedDays: number | null;
  accRemarks: string | null;
  accVerifiedDate: string | null;
  accVerifiedAt: string | null;
  accVerifiedBy: string | null;

  // Step 8b — sales head
  shCustomerCategory: CustomerCategory | null;
  shBusinessPotential: string | null;
  shDecision: ApprovalDecision | null;
  shForceDirector: boolean;
  shRemarks: string | null;
  shDecidedDate: string | null;
  shDecidedAt: string | null;
  shDecidedBy: string | null;

  // Step 8c — director. dirRequired/dirRequiredReason/dirThresholdAtDecision are
  // FROZEN when the sales head approves, so editing the threshold later can
  // never rewrite why a past request did or didn't need a director.
  dirRequired: boolean;
  dirRequiredReason: "threshold" | "forced" | null;
  dirThresholdAtDecision: number | null;
  dirDecision: ApprovalDecision | null;
  dirRemarks: string | null;
  dirDecidedDate: string | null;
  dirDecidedAt: string | null;
  dirDecidedBy: string | null;

  // Step 9 — customerCode is TYPED IN (Tally issues it); reqNo is ours.
  customerCode: string | null;
  tallyLedgerCreated: boolean | null;
  tallyLedgerName: string | null;
  customerStatus: CustomerLiveStatus | null;
  tallyDate: string | null;
  tallyAt: string | null;
  tallyBy: string | null;

  // Terminal / exception
  rejectedAt: string | null; rejectStage: string | null; rejectReason: string | null;
  reworkAt: string | null;   reworkStage: string | null; reworkReason: string | null;
  reworkCount: number;
  holdAt: string | null;     holdReason: string | null;
  cancelledAt: string | null; cancelReason: string | null;
  editedAt: string | null;   editedBy: string | null;

  createdAt: string;
  updatedAt: string;
}

/* ── Supporting rows ───────────────────────────────────────────────────── */

/** GST state code → name. Seeded reference data, read by the wizard's derivation. */
export interface GstState {
  code: string;
  name: string;
  active: boolean;
  sortOrder: number;
}

/**
 * Owners of one workflow step.
 * ⚠ Authorization comes SOLELY from employeeIds. departmentIds narrows the
 *   people list in the Settings picker and grants nothing.
 */
export interface StepOwner {
  id: string;
  stepKey: string;
  departmentIds: string[];
  designationId: string | null;
  employeeIds: string[];
}

export interface CustomerActivity {
  id: string;
  entityType: string;
  entityId: string;
  type: string;
  actorId: string | null;
  note: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
}

export interface CustomerNotification {
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

/** The `approval` config singleton — drives the director gate. */
export interface ApprovalRules {
  directorThreshold: number;
  exemptAdvanceTerms: boolean;
  exemptWhenNoLimitRequested: boolean;
}

export const DEFAULT_APPROVAL_RULES: ApprovalRules = {
  directorThreshold: 0,
  exemptAdvanceTerms: true,
  exemptWhenNoLimitRequested: true,
};
