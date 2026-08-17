/**
 * The wizard's validation, in one place.
 *
 * ⚠ ALL VALIDATION LOGIC LIVES HERE, never inside a step component. The wizard's
 *   core mechanic is `form.trigger(STEP_FIELDS[i])` — one line — and that only
 *   works while the rules are declarative and addressable by field name.
 *
 * This is the one place in the hub that uses react-hook-form + zod. Everything
 * else here (FollowupModal and friends) is useState + hand-rolled checks, which
 * is right for a five-field modal and wrong for forty-five fields across eight
 * panes. RHF, zod, @hookform/resolvers and components/ui/form.tsx were already
 * installed and shipped in every bundle, used by nothing; this is the feature
 * that justifies them.
 *
 * ⚠ MIRRORS THE SERVER. Every rule below is also enforced by
 *   fms_customer_submit_request, which re-derives and re-checks everything. If
 *   the two disagree the server wins and the user sees a worse error message —
 *   so keep them in step.
 */
import { z } from "zod";
import { gstinChecksumOk, isGstinFormatValid, normaliseGstin, type GstinSnapshot } from "./gstin";

/** Bare 10 digits. `+91 90333 01207`, `09033301207` and `9033301207` are one person. */
export function normaliseMobile(raw: string): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.replace(/^(91|0)(?=\d{10}$)/, "");
}

const optionalText = z.string().trim().optional().default("");

/** Money/number fields are held as strings so an empty box is not NaN. */
const optionalNumeric = z
  .string()
  .trim()
  .optional()
  .default("")
  .refine((v) => v === "" || (Number.isFinite(Number(v)) && Number(v) >= 0), {
    message: "Enter a number, or leave it blank",
  });

const mobile = (label: string) =>
  z
    .string()
    .trim()
    .transform(normaliseMobile)
    .refine((v) => /^[0-9]{10}$/.test(v), { message: `${label} must be a 10-digit mobile number` });

const optionalMobile = z
  .string()
  .trim()
  .optional()
  .default("")
  .transform(normaliseMobile)
  .refine((v) => v === "" || /^[0-9]{10}$/.test(v), {
    message: "Enter a 10-digit mobile number, or leave it blank",
  });

/* ── Step 1 ────────────────────────────────────────────────────────────── */
export const step1Schema = z.object({
  /**
   * Which of OUR Tally companies this customer's ledger will be created in.
   *
   * ⚠ FIRST, deliberately — it is the framing question for the whole request,
   *   asked at the gate before the GSTIN. Held as a uuid (`mst_companies.id`),
   *   rendered as the alias.
   *
   * An empty string fails `.uuid()`, which is what makes it required. RHF runs
   * `mode: "onTouched"`, so a fresh form is not red on arrival.
   */
  company_id: z.string().uuid("Choose the company this customer is for"),
  /**
   * The salesperson who owns this customer, asked at the gate beside the company.
   *
   * ⚠ THE SAME COLUMN THE TALLY STEP WRITES (`assigned_sales_exec_name`), on
   *   purpose — one salesperson per request, not a "proposed" and an "actual"
   *   that can drift. Step 9 opens with it filled and may still correct it.
   *
   * Free text, not an enum: the picker offers the Tally vocabulary plus "Other",
   * and a genuinely new rep must be typeable on the day they join.
   */
  assigned_sales_exec_name: z.string().trim().min(2, "Choose or enter the salesperson"),
  legal_name: z.string().trim().min(2, "Enter the legal company name"),
  trade_name: optionalText,
  customer_type: z.enum(
    ["manufacturer", "dealer", "distributor", "trader", "exporter", "end_user"],
    { errorMap: () => ({ message: "Choose a customer type" }) },
  ),
  website: optionalText,
});

/* ── Step 2 ────────────────────────────────────────────────────────────── */
export const step2Schema = z.object({
  gst_number: z
    .string()
    .trim()
    .min(1, "Enter the GST number")
    .transform(normaliseGstin)
    .refine((v) => v.length === 15, { message: "A GSTIN is 15 characters" })
    .refine(isGstinFormatValid, { message: "That does not look like a GSTIN" })
    .refine(gstinChecksumOk, { message: "This GSTIN fails its check digit — one character is mistyped" }),
  // Auto-filled from the GSTIN and editable. Kept validated because a manual
  // override that is not a real PAN is silently discarded by the submit RPC.
  pan_number: z
    .string()
    .trim()
    .min(1, "PAN is required")
    .transform((v) => v.toUpperCase())
    .refine((v) => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v), { message: "PAN must look like AAAAA9999A" }),
  msme_udyam_no: optionalText,
  registered_address: z.string().trim().min(5, "Enter the registered address"),
  city: z.string().trim().min(1, "Enter the city"),
  // Derived, never typed — present so the value round-trips through the form.
  state_code: optionalText,
  state_name: optionalText,
  /**
   * What the GST portal said, frozen at the gate. Carried through the form only
   * so autosave persists it; it is never rendered as an input and can never fail
   * validation, which is why — like state_code above — it is absent from
   * STEP_FIELDS.
   */
  gstin_snapshot: z.custom<GstinSnapshot | null>(() => true).nullable().default(null),
  factory_address: z.string().trim().min(5, "Enter the factory address"),
  billing_same_as_registered: z.boolean().default(true),
  billing_address: optionalText,
});

/* ── Step 3 — all four mandatory ───────────────────────────────────────── */
export const step3Schema = z.object({
  contact_name: z.string().trim().min(2, "Enter the contact person's name"),
  contact_designation: z.string().trim().min(2, "Enter their designation"),
  contact_mobile: mobile("Contact"),
  contact_email: z.string().trim().toLowerCase().email("Enter a valid email address"),
});

/* ── Step 4 — ENTIRELY optional ────────────────────────────────────────── */
export const step4Schema = z.object({
  printing_applications: z
    .array(z.enum(["dtf", "sublimation", "reactive", "pigment", "uv", "textile", "other"]))
    .default([]),
  printing_application_other: optionalText,
  current_ink_brand: optionalText,
  current_supplier: optionalText,
  // The source document asterisks this one, but the instruction was "entire
  // step 4 optional" — optional wins. Do not add a min() here.
  monthly_ink_consumption: z
    .enum(["lt_100", "100_300", "300_500", "500_1000", "gt_1000"])
    .or(z.literal(""))
    .default(""),
});

/* ── Step 5 — optional ─────────────────────────────────────────────────── */
export const step5Schema = z.object({
  est_monthly_purchase: optionalNumeric,
  expected_first_order: optionalNumeric,
});

/* ── Step 6 — reference 1 required, reference 2 optional ───────────────── */
export const step6Schema = z.object({
  ref1_company: z.string().trim().min(2, "Enter the reference company name"),
  ref1_contact: z.string().trim().min(2, "Enter the reference contact person"),
  ref1_mobile: mobile("Reference"),
  ref2_company: optionalText,
  ref2_contact: optionalText,
  ref2_mobile: optionalMobile,
});

/* ── Step 7 — payment terms only; security is optional ─────────────────── */
export const step7Schema = z.object({
  payment_terms: z.enum(["advance", "credit"], {
    errorMap: () => ({ message: "Choose advance or credit" }),
  }),
  requested_credit_limit: optionalNumeric,
  requested_credit_days: optionalNumeric,
  security_offered: z.enum(["pdc", "bank_guarantee", "none"]).or(z.literal("")).default(""),
  credit_reason: optionalText,
});

/**
 * The whole form.
 *
 * Cross-field rules go here rather than in a step schema because they span
 * panes; each is also attached to the field the user must fix, so the rail can
 * mark the right step red.
 */
export const fullSchema = step1Schema
  .merge(step2Schema)
  .merge(step3Schema)
  .merge(step4Schema)
  .merge(step5Schema)
  .merge(step6Schema)
  .merge(step7Schema)
  .superRefine((v, ctx) => {
    if (!v.billing_same_as_registered && !v.billing_address.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["billing_address"],
        message: "Enter the billing address, or tick “same as registered”",
      });
    }
    if (v.printing_applications.includes("other") && !v.printing_application_other.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["printing_application_other"],
        message: "Describe the other printing application, or untick “Other”",
      });
    }
    // NOTE: a credit request with no limit is deliberately NOT an error. The
    // Review pane raises an amber note instead — Accounts are the ones who
    // propose a number, and blocking here would stop a legitimate submission.
  });

export type CustomerFormValues = z.infer<typeof fullSchema>;

/**
 * Which fields each pane owns. This is what `trigger()` is called with, and what
 * decides which rail node turns red.
 * ⚠ A field missing here is validated by the full schema but belongs to no step,
 *   so its error is invisible and Submit refuses with nothing highlighted.
 */
export const STEP_FIELDS: (keyof CustomerFormValues)[][] = [
  ["company_id", "assigned_sales_exec_name", "legal_name", "trade_name", "customer_type", "website"],
  ["gst_number", "pan_number", "msme_udyam_no", "registered_address", "city",
   "factory_address", "billing_same_as_registered", "billing_address"],
  ["contact_name", "contact_designation", "contact_mobile", "contact_email"],
  ["printing_applications", "printing_application_other", "current_ink_brand",
   "current_supplier", "monthly_ink_consumption"],
  ["est_monthly_purchase", "expected_first_order"],
  ["ref1_company", "ref1_contact", "ref1_mobile", "ref2_company", "ref2_contact", "ref2_mobile"],
  ["payment_terms", "requested_credit_limit", "requested_credit_days",
   "security_offered", "credit_reason"],
];

/** Steps 4 and 5 have no required field — Next is pure navigation there. */
export const OPTIONAL_STEP_INDEXES = [3, 4];

export function emptyFormValues(): CustomerFormValues {
  return {
    company_id: "", assigned_sales_exec_name: "",
    legal_name: "", trade_name: "", customer_type: undefined as never, website: "",
    gst_number: "", pan_number: "", msme_udyam_no: "", registered_address: "",
    city: "", state_code: "", state_name: "", gstin_snapshot: null, factory_address: "",
    billing_same_as_registered: true, billing_address: "",
    contact_name: "", contact_designation: "", contact_mobile: "", contact_email: "",
    printing_applications: [], printing_application_other: "",
    current_ink_brand: "", current_supplier: "", monthly_ink_consumption: "",
    est_monthly_purchase: "", expected_first_order: "",
    ref1_company: "", ref1_contact: "", ref1_mobile: "",
    ref2_company: "", ref2_contact: "", ref2_mobile: "",
    payment_terms: undefined as never, requested_credit_limit: "",
    requested_credit_days: "", security_offered: "", credit_reason: "",
  };
}

/** An existing request → form values, for Edit and for resuming a draft. */
export function toFormValues(r: {
  companyId: string | null;
  assignedSalesExecName: string | null;
  legalName: string | null; tradeName: string | null; customerType: string | null; website: string | null;
  gstNumber: string | null; panNumber: string | null; msmeUdyamNo: string | null;
  registeredAddress: string | null; city: string | null; stateCode: string | null; stateName: string | null;
  gstinSnapshot: GstinSnapshot | null;
  factoryAddress: string | null; billingSameAsRegistered: boolean; billingAddress: string | null;
  contactName: string | null; contactDesignation: string | null; contactMobile: string | null; contactEmail: string | null;
  printingApplications: string[]; printingApplicationOther: string | null;
  currentInkBrand: string | null; currentSupplier: string | null; monthlyInkConsumption: string | null;
  estMonthlyPurchase: number | null; expectedFirstOrder: number | null;
  ref1Company: string | null; ref1Contact: string | null; ref1Mobile: string | null;
  ref2Company: string | null; ref2Contact: string | null; ref2Mobile: string | null;
  paymentTerms: string | null; requestedCreditLimit: number | null; requestedCreditDays: number | null;
  securityOffered: string | null; creditReason: string | null;
}): CustomerFormValues {
  const s = (v: string | null) => v ?? "";
  const n = (v: number | null) => (v === null ? "" : String(v));
  return {
    company_id: s(r.companyId),
    assigned_sales_exec_name: s(r.assignedSalesExecName),
    legal_name: s(r.legalName), trade_name: s(r.tradeName),
    customer_type: (r.customerType ?? undefined) as never, website: s(r.website),
    gst_number: s(r.gstNumber), pan_number: s(r.panNumber), msme_udyam_no: s(r.msmeUdyamNo),
    registered_address: s(r.registeredAddress), city: s(r.city),
    state_code: s(r.stateCode), state_name: s(r.stateName),
    gstin_snapshot: r.gstinSnapshot ?? null,
    factory_address: s(r.factoryAddress),
    billing_same_as_registered: r.billingSameAsRegistered,
    billing_address: s(r.billingAddress),
    contact_name: s(r.contactName), contact_designation: s(r.contactDesignation),
    contact_mobile: s(r.contactMobile), contact_email: s(r.contactEmail),
    printing_applications: (r.printingApplications ?? []) as never,
    printing_application_other: s(r.printingApplicationOther),
    current_ink_brand: s(r.currentInkBrand), current_supplier: s(r.currentSupplier),
    monthly_ink_consumption: (r.monthlyInkConsumption ?? "") as never,
    est_monthly_purchase: n(r.estMonthlyPurchase), expected_first_order: n(r.expectedFirstOrder),
    ref1_company: s(r.ref1Company), ref1_contact: s(r.ref1Contact), ref1_mobile: s(r.ref1Mobile),
    ref2_company: s(r.ref2Company), ref2_contact: s(r.ref2Contact), ref2_mobile: s(r.ref2Mobile),
    payment_terms: (r.paymentTerms ?? undefined) as never,
    requested_credit_limit: n(r.requestedCreditLimit),
    requested_credit_days: n(r.requestedCreditDays),
    security_offered: (r.securityOffered ?? "") as never,
    credit_reason: s(r.creditReason),
  };
}

/**
 * Form values → the jsonb bag the save/submit RPCs read.
 *
 * ⚠ WIRE CONTRACT: each key below is read VERBATIM by fms_customer_write_form.
 *   Add a field to the form without adding it here and it is SILENTLY DROPPED —
 *   the save succeeds, the value never lands, and nothing errors.
 *
 * Document paths are deliberately absent: they move only through
 * fms_customer_set_document, so a routine autosave can never blank an upload.
 */
export function toRpcPayload(v: Partial<CustomerFormValues>): Record<string, unknown> {
  return {
    company_id: v.company_id ?? "",
    // ⚠ Shared with the Tally step, which writes the same column through
    //   record_tally / assign_sales_exec. Those run later than any path that
    //   reaches write_form, so they are not raced — see the migration header.
    assigned_sales_exec_name: v.assigned_sales_exec_name ?? "",
    legal_name: v.legal_name ?? "",
    trade_name: v.trade_name ?? "",
    customer_type: v.customer_type ?? "",
    website: v.website ?? "",

    gst_number: v.gst_number ?? "",
    pan_number: v.pan_number ?? "",
    msme_udyam_no: v.msme_udyam_no ?? "",
    registered_address: v.registered_address ?? "",
    city: v.city ?? "",
    // ⚠ Sent as null when absent, NOT omitted and NOT "". write_form only
    //   overwrites on a jsonb object, so null preserves whatever is stored —
    //   which is what a routine autosave must do. See the migration.
    gstin_snapshot: v.gstin_snapshot ?? null,
    factory_address: v.factory_address ?? "",
    billing_same_as_registered: v.billing_same_as_registered ?? true,
    billing_address: v.billing_address ?? "",

    contact_name: v.contact_name ?? "",
    contact_designation: v.contact_designation ?? "",
    contact_mobile: v.contact_mobile ?? "",
    contact_email: v.contact_email ?? "",

    printing_applications: v.printing_applications ?? [],
    printing_application_other: v.printing_application_other ?? "",
    current_ink_brand: v.current_ink_brand ?? "",
    current_supplier: v.current_supplier ?? "",
    monthly_ink_consumption: v.monthly_ink_consumption ?? "",

    est_monthly_purchase: v.est_monthly_purchase ?? "",
    expected_first_order: v.expected_first_order ?? "",

    ref1_company: v.ref1_company ?? "",
    ref1_contact: v.ref1_contact ?? "",
    ref1_mobile: v.ref1_mobile ?? "",
    ref2_company: v.ref2_company ?? "",
    ref2_contact: v.ref2_contact ?? "",
    ref2_mobile: v.ref2_mobile ?? "",

    payment_terms: v.payment_terms ?? "",
    requested_credit_limit: v.requested_credit_limit ?? "",
    requested_credit_days: v.requested_credit_days ?? "",
    security_offered: v.security_offered ?? "",
    credit_reason: v.credit_reason ?? "",
  };
}
