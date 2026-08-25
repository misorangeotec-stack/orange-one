import type { OcpiDeal } from "../types";

/**
 * The quotation form's fields, declared once.
 *
 * WHY A CATALOGUE AND NOT JUST JSX
 *   The same fields are read by four things that must not disagree: the form,
 *   the branch rules, the generated PDF, and the revision diff that tells a
 *   reader what changed between two quotations. Typing a label in the form and
 *   again in the PDF is how "Ink Price" becomes "Ink price" on the document and
 *   the diff reports a change nobody made. So the label, the options and the
 *   grouping live here, and everything else reads them.
 *
 * ⚠ THIS FILE NOW HOLDS BOTH HALVES OF THE DEAL (revision stage B). What used to
 *   be `ocFieldSpec.ts` — the order confirmation's own questions — is merged in
 *   here, because the client asked for ONE form: both papers are generated
 *   together, so both sets of answers are collected together. The DETAIL fields
 *   (the "Document details" card) are OPTIONAL: a salesperson may raise and
 *   send a quotation without them, and the detailed sheet prints ruled blanks
 *   where they are missing. `missingForDetailSheet` names those blanks on screen;
 *   it never blocks.
 *
 * ⚠ TWO WRITERS, STILL. Part A goes to fms_ocpi_write_quotation and part B to
 *   fms_ocpi_write_oc, and neither touches the other's columns — that separation
 *   is load-bearing (see 20260929121000's header). `payloadFromDraft` produces
 *   ONE bag carrying both key sets, and fms_ocpi_save_draft hands it to both
 *   writers in that order. Do not merge the two SQL writers to match this file.
 *
 * ⚠ THE OPTION LISTS ARE THE MICROSOFT FORM'S, VERBATIM. Where the live form
 *   allows a free-text "Other", `allowOther` says so — a salesperson has been
 *   answering "KATANA 600 DPI - HANGLORY" into exactly such a box, and dropping
 *   the escape hatch would lose real answers.
 *
 * ⚠ MACHINE IS NOT AN OPTION LIST HERE. The form's 25 model options and the ten
 *   real order-confirmation templates are different vocabularies (see the
 *   fms_ocpi_machines migration), so the machine comes from the Machine master
 *   at runtime, never from a constant.
 */

/** The draft, as the form holds it: every value a string, as typed. */
export interface QuotationDraft {
  salespersonName: string;

  customerId: string;
  customerName: string;
  customerAddress: string;
  customerAttn: string;
  customerEmail: string;
  customerMobile: string;
  gstAvailable: boolean | null;
  gstNo: string;

  companyId: string;
  locationId: string;

  machineCount: string;
  machineId: string;
  headType: string;
  headCount: string;
  inkType: string;
  inkPrice: string;
  inkCreditTerms: string;

  inclInk: boolean | null;
  inkQtyIncluded: string;
  inclSpares: boolean | null;
  spareDetails: string;
  inclHead: boolean | null;
  headsIncluded: string;
  dryerType: string;

  dealValueCurrency: string;
  dealValueAmount: string;
  paymentType: string;
  paymentTerms: string;
  deliveryDate: string;
  transportTerms: string;
  highSeasVia: string;
  highSeasCostBy: string;
  localCostBy: string;

  /* The FX position, for a dollar deal. Held on the draft so the salesperson can
   * override the fetched rate before generating, and so the rate that was used
   * is the one frozen onto the revision. */
  fxRate: string;
  fxRateAt: string;
  fxRateSource: string;
  fxRateOverridden: boolean | null;

  /* ── Special remarks ────────────────────────────────────────────────────
   * The master form scattered its free-text boxes across three questions with
   * three different names. They are one group now, and Q46's "Remarks or
   * Additional Information" is relabelled *Special remarks* — the column keeps
   * its name, only the label moves. */
  remarks: string;
  headBalanceRemarks: string;
  otherCommitments: string;

  dollarClauseAgreed: boolean | null;

  /* ── Detail fields · OPTIONAL ───────────────────────────────────────────
   * Everything the DETAILED sheet needs and the summary does not. Was
   * ocFieldSpec.ts's OcDraft. None of these blocks a quotation. */
  headShipMode: string;
  headShipVia: string;
  headSeparateInvoice: boolean | null;

  dryerChambers: string;
  heatingMode: string;
  dryerWarranty: string;
  platterDetails: string;

  airBlade: boolean | null;
  externalCentering: boolean | null;
  inkDustExhauster: boolean | null;
  chillingSystem: boolean | null;

  printerWarranty: string;
  headWarranty: string;
  postWarrantyHeadPrice: string;
  consumablesSupplier: string;
  insuranceClauseAgreed: boolean | null;

  refNo: string;
  deliveryDays: string;
  tradeTerm: string;
  machineModelNo: string;
  preparedBy: string;
  approvedBy: string;

  gstRate: string;
  machineValueInr: string;
  gstAmountInr: string;
  totalInr: string;
}

export const EMPTY_DRAFT: QuotationDraft = {
  salespersonName: "",
  customerId: "",
  customerName: "",
  customerAddress: "",
  customerAttn: "",
  customerEmail: "",
  customerMobile: "",
  gstAvailable: null,
  gstNo: "",
  companyId: "",
  locationId: "",
  machineCount: "1",
  machineId: "",
  headType: "",
  headCount: "",
  inkType: "",
  inkPrice: "",
  inkCreditTerms: "",
  inclInk: null,
  inkQtyIncluded: "",
  inclSpares: null,
  spareDetails: "",
  inclHead: null,
  headsIncluded: "",
  dryerType: "",
  dealValueCurrency: "INR",
  dealValueAmount: "",
  paymentType: "",
  paymentTerms: "",
  deliveryDate: "",
  transportTerms: "",
  highSeasVia: "",
  highSeasCostBy: "",
  localCostBy: "",
  fxRate: "",
  fxRateAt: "",
  fxRateSource: "",
  fxRateOverridden: null,
  remarks: "",
  headBalanceRemarks: "",
  otherCommitments: "",
  dollarClauseAgreed: null,

  headShipMode: "",
  headShipVia: "",
  headSeparateInvoice: null,
  dryerChambers: "",
  heatingMode: "",
  dryerWarranty: "",
  platterDetails: "",
  airBlade: null,
  externalCentering: null,
  inkDustExhauster: null,
  chillingSystem: null,
  printerWarranty: "",
  headWarranty: "",
  postWarrantyHeadPrice: "",
  consumablesSupplier: "",
  insuranceClauseAgreed: null,
  refNo: "",
  deliveryDays: "",
  tradeTerm: "",
  machineModelNo: "",
  preparedBy: "",
  approvedBy: "",
  gstRate: "18",
  machineValueInr: "",
  gstAmountInr: "",
  totalInr: "",
};

/* ── Option lists, verbatim from the live Microsoft form ──────────────────── */

/*
 * ⚠ HEAD_TYPES, INK_TYPES AND DRYER_TYPES USED TO LIVE HERE AND ARE NOW MASTERS
 *   (fms_ocpi_head_types / _ink_types / _dryer_types, seeded from exactly these
 *   six / three / three values in migration 20260929121800).
 *
 *   They are deliberately NOT kept here as a fallback. Two copies of a list that
 *   one screen can edit is a list that will disagree with itself: somebody adds
 *   a print head in Masters, the array here still says six, and whichever
 *   consumer reads the wrong one is silently a year out of date. The form reads
 *   the store; there is nothing to fall back to and that is correct.
 *
 *   The lists that REMAIN in this file are the structural ones — currency,
 *   payment type, transport terms, the yes/no vocabularies. Those are branching
 *   logic, not data: adding a value to any of them requires code that knows what
 *   the new value MEANS, so a master would let somebody add an option the app
 *   cannot honour.
 */

export const PAYMENT_TYPES = [
  { value: "advance", label: "Any Advance" },
  { value: "credit", label: "On Credit" },
] as const;

/**
 * The head of Section C, and the choice everything commercial follows from.
 *
 * ⚠ RELABELLED, NOT REPLACED (revision stage C). The stored values stay
 *   `high_seas` / `local` — this is the same column the module has always had.
 *   Do not add a parallel "deal type" field.
 */
export const TRANSPORT_TERMS = [
  { value: "high_seas", label: "High Seas" },
  { value: "local", label: "Others" },
] as const;

export const HIGH_SEAS_VIA = ["CIF", "EX Factory", "FOB"] as const;

export const COST_BEARERS = [
  { value: "customer", label: "Customer" },
  { value: "company", label: "Company" },
] as const;

/**
 * What the deal is quoted in.
 *
 * ⚠ USD IS NOT HYPOTHETICAL. A real submission recorded the total as "1.8 lakh
 *   dollar" in a free-text box, while the order confirmation prints "Machine
 *   Value INR". Treating the quoted figure as rupees would be a ~85× error on a
 *   contract, so the currency is asked explicitly.
 */
export const CURRENCIES = ["INR", "USD"] as const;

/* ── Detail-field option lists (were ocFieldSpec.ts) ──────────────────────── */

export const HEAD_SHIP_MODES = [
  { value: "with_machine", label: "With the machine" },
  { value: "separate", label: "Separate shipment" },
] as const;

export const HEAD_SHIP_VIA = [
  { value: "directly", label: "Directly" },
  { value: "hss", label: "High Seas Sale (HSS)" },
  { value: "local_sales", label: "Local sales" },
] as const;

export const PLATTER_OPTIONS = ["With Platter", "Without Platter", "Not Applicable"] as const;

export const WARRANTY_MONTHS = ["12 Months", "18 Months", "24 Months"] as const;

export const PRINTER_WARRANTY = [
  "12 months warranty → maximum 13 months from the invoice date",
  "18 months warranty → maximum 19 months from the invoice date",
  "24 months warranty → maximum 25 months from the invoice date",
  "36 months warranty → maximum 37 months from the invoice date",
] as const;

export const TRADE_TERMS = ["Ex-Work Surat", "CIF", "FOB", "EX Factory"] as const;

/* ── Standing clauses ─────────────────────────────────────────────────────── */

/**
 * The dollar-exchange clause.
 *
 * ⚠ ASKED AND PRINTED ONLY ON DOLLAR DEALS (revision stage B). It is a USD term;
 *   a rupee customer was being asked to agree to something that could not apply
 *   to them. `branching.ts` hides it and `fms_ocpi_write_quotation` clears it —
 *   both, because either alone would let a stale "Yes" print on a contract the
 *   customer never agreed it for.
 */
export const DOLLAR_CLAUSE =
  "If the payment is cleared within 60 days, Dollar exchange is not applicable. In case " +
  "payment terms exceed 3 months in equal instalments, Dollar exchange will be adjusted " +
  "against Debit Note / Credit Note.";

/** The standing insurance clause, printed verbatim and confirmed by the salesperson. */
export const INSURANCE_CLAUSE =
  "Insurance coverage up to the point of loading will be the responsibility of the company, " +
  "while any coverage required during unloading will be the responsibility of the customer.";

/*
  ⚠ THERE IS NO GROUP TABLE HERE ANY MORE, AND THAT IS DELIBERATE.

    `FORM_GROUPS` and `DETAIL_GROUPS` used to declare which fields sat in which
    card. Nothing read either of them: QuotationForm.tsx lays its own cards out
    by hand, and quotationPdf.ts builds its sections from the deal row. So the
    file carried a second, drifting description of a layout it did not control —
    two lists of the same thing, one of which was already wrong (it had the
    detail fields under groups the form does not use).

    If a grouping table is ever wanted again, make it the thing the form
    ACTUALLY renders from. A table nobody reads is worse than none: the next
    person to add a field updates it, believes they have changed the form, and
    has not.
*/

/** The human label for every field — used by the form, the PDF and the diff. */
export const FIELD_LABEL: Record<keyof QuotationDraft, string> = {
  salespersonName: "Salesperson",
  customerId: "Customer",
  customerName: "Customer / party name",
  customerAddress: "Customer address",
  customerAttn: "Contact person (Attn)",
  customerEmail: "Email",
  customerMobile: "Mobile",
  gstAvailable: "GST registered",
  gstNo: "GST number",
  companyId: "Selling company",
  locationId: "Location",
  machineCount: "No. of machines",
  machineId: "Machine",
  headType: "Type of head",
  headCount: "No. of print heads required",
  inkType: "Type of ink",
  inkPrice: "Ink price",
  inkCreditTerms: "Ink credit terms (future)",
  inclInk: "Deal includes ink",
  inkQtyIncluded: "Quantity of ink included",
  inclSpares: "Deal includes spare parts",
  spareDetails: "Spare part details",
  inclHead: "Deal includes head",
  headsIncluded: "No. of heads included",
  dryerType: "Dryer required",
  dealValueCurrency: "Currency",
  dealValueAmount: "Total deal value (excl. GST)",
  paymentType: "Type of payment",
  paymentTerms: "Terms of payment",
  deliveryDate: "Machine delivery date (tentative)",
  transportTerms: "Deal type",
  highSeasVia: "High seas delivery via",
  highSeasCostBy: "High seas cost borne by",
  localCostBy: "Local delivery cost borne by",
  fxRate: "USD to INR rate",
  fxRateAt: "Rate fetched at",
  fxRateSource: "Rate source",
  fxRateOverridden: "Rate entered by hand",

  // Special remarks — the three free-text boxes the master form scattered.
  remarks: "Special remarks",
  headBalanceRemarks: "Remarks — balance heads to be sold later",
  otherCommitments: "Any other commitments on charges made by us",

  dollarClauseAgreed: "Dollar-exchange clause agreed",

  headShipMode: "How to ship the included head",
  headShipVia: "Later shipment sent via",
  headSeparateInvoice: "Separate invoice for the head",
  dryerChambers: "How many chambers with the dryer",
  heatingMode: "Heating mode",
  dryerWarranty: "Dryer warranty period",
  platterDetails: "Platter",
  airBlade: "Air blade",
  externalCentering: "External centering system",
  inkDustExhauster: "Ink dust exhauster",
  chillingSystem: "Chilling system",
  printerWarranty: "Printer warranty period",
  headWarranty: "Print-head warranty period",
  postWarrantyHeadPrice: "Head price after the warranty",
  consumablesSupplier: "Consumables to be bought from",
  insuranceClauseAgreed: "Insurance clause agreed",
  refNo: "Reference no.",
  deliveryDays: "Delivery days",
  tradeTerm: "Delivery term",
  machineModelNo: "Manufacturer's model no.",
  preparedBy: "Prepared by",
  approvedBy: "Approved by",
  gstRate: "GST %",
  machineValueInr: "Machine value (₹)",
  gstAmountInr: "GST amount (₹)",
  totalInr: "Total (₹)",
};

/* ── Mapping between the row and the form ─────────────────────────────────── */

const s = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

/** Load an existing deal into the form's shape. */
export function draftFromDeal(d: OcpiDeal): QuotationDraft {
  return {
    salespersonName: s(d.salespersonName),
    customerId: s(d.customerId),
    customerName: s(d.customerName),
    customerAddress: s(d.customerAddress),
    customerAttn: s(d.customerAttn),
    customerEmail: s(d.customerEmail),
    customerMobile: s(d.customerMobile),
    gstAvailable: d.gstAvailable,
    gstNo: s(d.gstNo),
    companyId: s(d.companyId),
    locationId: s(d.locationId),
    machineCount: s(d.machineCount),
    machineId: s(d.machineId),
    headType: s(d.headType),
    headCount: s(d.headCount),
    inkType: s(d.inkType),
    inkPrice: s(d.inkPrice),
    inkCreditTerms: s(d.inkCreditTerms),
    inclInk: d.inclInk,
    inkQtyIncluded: s(d.inkQtyIncluded),
    inclSpares: d.inclSpares,
    spareDetails: s(d.spareDetails),
    inclHead: d.inclHead,
    headsIncluded: s(d.headsIncluded),
    dryerType: s(d.dryerType),
    dealValueCurrency: s(d.dealValueCurrency) || "INR",
    dealValueAmount: s(d.dealValueAmount),
    paymentType: s(d.paymentType),
    paymentTerms: s(d.paymentTerms),
    deliveryDate: s(d.deliveryDate),
    transportTerms: s(d.transportTerms),
    highSeasVia: s(d.highSeasVia),
    highSeasCostBy: s(d.highSeasCostBy),
    localCostBy: s(d.localCostBy),
    fxRate: s(d.fxRate),
    fxRateAt: s(d.fxRateAt),
    fxRateSource: s(d.fxRateSource),
    fxRateOverridden: d.fxRateOverridden,
    remarks: s(d.remarks),
    headBalanceRemarks: s(d.headBalanceRemarks),
    otherCommitments: s(d.otherCommitments),
    dollarClauseAgreed: d.dollarClauseAgreed,

    headShipMode: s(d.headShipMode),
    headShipVia: s(d.headShipVia),
    headSeparateInvoice: d.headSeparateInvoice,
    dryerChambers: s(d.dryerChambers),
    heatingMode: s(d.heatingMode),
    dryerWarranty: s(d.dryerWarranty),
    platterDetails: s(d.platterDetails),
    airBlade: d.airBlade,
    externalCentering: d.externalCentering,
    inkDustExhauster: d.inkDustExhauster,
    chillingSystem: d.chillingSystem,
    printerWarranty: s(d.printerWarranty),
    headWarranty: s(d.headWarranty),
    postWarrantyHeadPrice: s(d.postWarrantyHeadPrice),
    consumablesSupplier: s(d.consumablesSupplier),
    insuranceClauseAgreed: d.insuranceClauseAgreed,
    refNo: s(d.refNo),
    deliveryDays: s(d.deliveryDays),
    tradeTerm: s(d.tradeTerm),
    machineModelNo: s(d.machineModelNo),
    preparedBy: s(d.preparedBy),
    approvedBy: s(d.approvedBy),
    gstRate: d.gstRate === null || d.gstRate === undefined ? "18" : String(d.gstRate),
    machineValueInr: s(d.machineValueInr),
    gstAmountInr: s(d.gstAmountInr),
    totalInr: s(d.totalInr),
  };
}

/**
 * The payload the save RPC expects — snake_case keys matching the two writers.
 *
 * ⚠ THE KEYS ARE A WIRE CONTRACT. A typo here does not fail: `p->>'customer_attn'`
 *   simply returns null and the field is silently blanked on save. Change one
 *   side and change the other.
 *
 * ⚠ ONE BAG, TWO WRITERS. fms_ocpi_save_draft passes this to
 *   fms_ocpi_write_quotation and then, because part-B keys are present, to
 *   fms_ocpi_write_oc. Each ignores the other's keys. Removing every part-B key
 *   from this bag would leave part B untouched rather than blanked — that is the
 *   `?|` guard in save_draft, and it is deliberate.
 */
export function payloadFromDraft(d: QuotationDraft): Record<string, unknown> {
  return {
    salesperson_name: d.salespersonName,
    customer_id: d.customerId,
    customer_name: d.customerName,
    customer_address: d.customerAddress,
    customer_attn: d.customerAttn,
    customer_email: d.customerEmail,
    customer_mobile: d.customerMobile,
    gst_available: d.gstAvailable,
    gst_no: d.gstNo,
    company_id: d.companyId,
    location_id: d.locationId,
    machine_count: d.machineCount,
    machine_id: d.machineId,
    head_type: d.headType,
    head_count: d.headCount,
    ink_type: d.inkType,
    ink_price: d.inkPrice,
    ink_credit_terms: d.inkCreditTerms,
    incl_ink: d.inclInk,
    ink_qty_included: d.inkQtyIncluded,
    incl_spares: d.inclSpares,
    spare_details: d.spareDetails,
    incl_head: d.inclHead,
    heads_included: d.headsIncluded,
    dryer_type: d.dryerType,
    deal_value_currency: d.dealValueCurrency,
    deal_value_amount: d.dealValueAmount,
    payment_type: d.paymentType,
    payment_terms: d.paymentTerms,
    delivery_date: d.deliveryDate,
    transport_terms: d.transportTerms,
    high_seas_via: d.highSeasVia,
    high_seas_cost_by: d.highSeasCostBy,
    local_cost_by: d.localCostBy,
    fx_rate: d.fxRate,
    fx_rate_at: d.fxRateAt,
    fx_rate_source: d.fxRateSource,
    fx_rate_overridden: d.fxRateOverridden,
    remarks: d.remarks,
    dollar_clause_agreed: d.dollarClauseAgreed,

    // part B — fms_ocpi_write_oc's keys
    head_ship_mode: d.headShipMode,
    head_ship_via: d.headShipVia,
    head_balance_remarks: d.headBalanceRemarks,
    head_separate_invoice: d.headSeparateInvoice,
    dryer_chambers: d.dryerChambers,
    heating_mode: d.heatingMode,
    dryer_warranty: d.dryerWarranty,
    platter_details: d.platterDetails,
    air_blade: d.airBlade,
    external_centering: d.externalCentering,
    ink_dust_exhauster: d.inkDustExhauster,
    chilling_system: d.chillingSystem,
    other_commitments: d.otherCommitments,
    printer_warranty: d.printerWarranty,
    head_warranty: d.headWarranty,
    post_warranty_head_price: d.postWarrantyHeadPrice,
    consumables_supplier: d.consumablesSupplier,
    insurance_clause_agreed: d.insuranceClauseAgreed,
    ref_no: d.refNo,
    delivery_days: d.deliveryDays,
    trade_term: d.tradeTerm,
    machine_model_no: d.machineModelNo,
    prepared_by: d.preparedBy,
    approved_by: d.approvedBy,
    gst_rate: d.gstRate,
    machine_value_inr: d.machineValueInr,
    gst_amount_inr: d.gstAmountInr,
    total_inr: d.totalInr,
  };
}

/**
 * Work out the GST and the total from the machine value.
 *
 * ⚠ COMPUTED HERE AND STORED, NOT DERIVED WHEN THE DOCUMENT PRINTS. A signed
 *   contract has to keep the arithmetic it was signed under; recomputing from a
 *   rate somebody edits next quarter would silently restate a total the customer
 *   agreed to.
 */
export function withGst(d: QuotationDraft): QuotationDraft {
  const value = Number(d.machineValueInr);
  const rate = Number(d.gstRate);
  if (!Number.isFinite(value) || !Number.isFinite(rate) || d.machineValueInr.trim() === "") {
    return { ...d, gstAmountInr: "", totalInr: "" };
  }
  const gst = Math.round(value * rate) / 100;
  return { ...d, gstAmountInr: String(gst), totalInr: String(value + gst) };
}

/**
 * What still has to be answered before this quotation can be finalised.
 *
 * Returns human sentences, not field keys — they are shown to the salesperson.
 * The table CHECK `fms_ocpi_complete_when_submitted` enforces the same minimum
 * server-side; this exists so the user finds out before pressing the button.
 *
 * ⚠ SECTIONS B AND C ARE MANDATORY (revision stage B), but a CONDITIONAL field
 *   is only required when its own branch is open. A deal that includes no head
 *   must never be blocked on a head count it was never asked for — which is why
 *   each dependent is tested against the answer that reveals it, not on its own.
 */
export function missingForSubmit(d: QuotationDraft): string[] {
  const out: string[] = [];

  if (!d.customerName.trim()) out.push("the customer name");
  if (!d.salespersonName.trim()) out.push("the salesperson");
  if (!d.machineId) out.push("the machine");
  if (!d.machineCount.trim()) out.push("how many machines");

  // Section B · Deal inclusions
  if (d.inclInk === null) out.push("whether the deal includes ink");
  else if (d.inclInk && !d.inkQtyIncluded.trim()) out.push("how much ink is included");
  if (d.inclSpares === null) out.push("whether the deal includes spare parts");
  else if (d.inclSpares && !d.spareDetails.trim()) out.push("which spare parts are included");
  if (d.inclHead === null) out.push("whether the deal includes a head");
  else if (d.inclHead && !d.headsIncluded.trim()) out.push("how many heads are included");

  // Section C · Commercial terms
  if (!d.transportTerms) out.push("the deal type (High Seas or Others)");
  else if (d.transportTerms === "high_seas") {
    if (!d.highSeasVia) out.push("how the printer is delivered on high seas");
    if (!d.highSeasCostBy) out.push("who bears the high-seas cost");
  } else if (d.transportTerms === "local" && !d.localCostBy) {
    out.push("who bears the local delivery cost");
  }
  if (!d.dealValueCurrency) out.push("the currency");
  if (!d.dealValueAmount.trim()) out.push("the total deal value");
  if (!d.paymentType) out.push("the type of payment");
  if (!d.paymentTerms.trim()) out.push("the terms of payment");
  if (!d.deliveryDate) out.push("the machine delivery date");

  return out;
}

/**
 * Which lines the DETAILED sheet will print as ruled blanks.
 *
 * ⚠ THIS IS A WARNING, NEVER A BLOCK. The client asked for the detail fields to
 *   be optional at first so a quotation can go out during a negotiation before
 *   the warranty and delivery terms are settled. The sheet prints a ruled blank
 *   where an answer is missing; this exists so the salesperson knows which lines
 *   are blank BEFORE sending it, rather than discovering it in the customer's
 *   reply.
 *
 * Conditional groups are skipped when their branch is shut, for the same reason
 * missingForSubmit skips them: a deal with no dryer has no dryer warranty to be
 * missing.
 */
export function missingForDetailSheet(d: QuotationDraft): string[] {
  const out: string[] = [];
  const hasDryer = !!d.dryerType && d.dryerType !== "Not Applicable";

  if (!d.printerWarranty.trim()) out.push(FIELD_LABEL.printerWarranty);
  if (!d.headWarranty.trim()) out.push(FIELD_LABEL.headWarranty);
  if (!d.deliveryDays.trim()) out.push(FIELD_LABEL.deliveryDays);
  if (!d.tradeTerm.trim()) out.push(FIELD_LABEL.tradeTerm);
  if (d.inclHead === true && !d.headShipMode) out.push(FIELD_LABEL.headShipMode);
  if (hasDryer && !d.dryerChambers.trim()) out.push(FIELD_LABEL.dryerChambers);
  if (hasDryer && !d.dryerWarranty.trim()) out.push(FIELD_LABEL.dryerWarranty);

  return out;
}
