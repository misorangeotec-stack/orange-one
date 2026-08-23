import type { OcpiDeal } from "../types";

/**
 * The quotation form's fields, declared once.
 *
 * WHY A CATALOGUE AND NOT JUST JSX
 *   The same 40-odd fields are read by four things that must not disagree: the
 *   form, the branch rules, the generated PDF, and the revision diff that tells
 *   a reader what changed between two quotations. Typing a label in the form and
 *   again in the PDF is how "Ink Price" becomes "Ink price" on the document and
 *   the diff reports a change nobody made. So the label, the options and the
 *   grouping live here, and everything else reads them.
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

/** The part-A draft, as the form holds it: every value a string, as typed. */
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
  remarks: string;
  dollarClauseAgreed: boolean | null;
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
  remarks: "",
  dollarClauseAgreed: null,
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

export const TRANSPORT_TERMS = [
  { value: "high_seas", label: "High Seas" },
  { value: "local", label: "Local Delivery" },
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
 *   contract, so the currency is asked explicitly and the rupee figure the OC
 *   prints is captured separately at the order-confirmation step.
 */
export const CURRENCIES = ["INR", "USD"] as const;

/* ── Field grouping, for the form and the PDF's sections ──────────────────── */

export interface FieldGroup {
  key: string;
  title: string;
  /** Which box of the printed quotation this group feeds, where it feeds one. */
  documentSection?: "A" | "B" | "C" | "D";
  fields: (keyof QuotationDraft)[];
}

/**
 * ⚠ THE GROUPS MIRROR THE PRINTED QUOTATION, not the Microsoft form's order.
 *   The paper sheet reads: Machine Details (A), Deal Inclusions (B), Commercial
 *   Terms (C), Remarks (D). Someone checking a generated PDF against the sheet
 *   should find the fields in the same places, which they will not if the form
 *   follows the questionnaire's order instead.
 */
export const PART_A_GROUPS: FieldGroup[] = [
  {
    key: "customer",
    title: "Customer",
    fields: [
      "customerId", "customerName", "customerAttn", "customerAddress",
      "customerEmail", "customerMobile", "gstAvailable", "gstNo",
    ],
  },
  {
    key: "machine",
    title: "Machine details",
    documentSection: "A",
    fields: [
      "machineCount", "machineId", "headType", "headCount",
      "inkType", "inkPrice", "inkCreditTerms", "dryerType",
    ],
  },
  {
    key: "inclusions",
    title: "Deal inclusions",
    documentSection: "B",
    fields: [
      "inclInk", "inkQtyIncluded", "inclSpares", "spareDetails",
      "inclHead", "headsIncluded",
    ],
  },
  {
    key: "commercial",
    title: "Commercial terms",
    documentSection: "C",
    fields: [
      "dealValueCurrency", "dealValueAmount", "paymentType", "paymentTerms",
      "deliveryDate", "transportTerms", "highSeasVia", "highSeasCostBy", "localCostBy",
    ],
  },
  {
    key: "remarks",
    title: "Remarks & terms",
    documentSection: "D",
    fields: ["remarks", "dollarClauseAgreed"],
  },
];

/** The human label for every field — the one used by the form, the PDF and the diff. */
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
  transportTerms: "Transportation terms",
  highSeasVia: "High seas delivery via",
  highSeasCostBy: "High seas cost borne by",
  localCostBy: "Local delivery cost borne by",
  remarks: "Remarks / additional information",
  dollarClauseAgreed: "Dollar-exchange clause agreed",
};

/**
 * The standing clause the salesperson confirms on every quotation. It is printed
 * verbatim on the sheet, so it lives here rather than in the JSX.
 */
export const DOLLAR_CLAUSE =
  "If the payment is cleared within 60 days, Dollar exchange is not applicable. In case " +
  "payment terms exceed 3 months in equal instalments, Dollar exchange will be adjusted " +
  "against Debit Note / Credit Note.";

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
    remarks: s(d.remarks),
    dollarClauseAgreed: d.dollarClauseAgreed,
  };
}

/**
 * The payload the save RPC expects — snake_case keys matching
 * fms_ocpi_write_quotation.
 *
 * ⚠ THE KEYS ARE A WIRE CONTRACT WITH THAT FUNCTION. A typo here does not fail:
 *   `p->>'customer_attn'` simply returns null and the field is silently blanked
 *   on save. Change one side and change the other.
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
    remarks: d.remarks,
    dollar_clause_agreed: d.dollarClauseAgreed,
  };
}

/**
 * What still has to be answered before this quotation can be finalised.
 *
 * Returns human sentences, not field keys — they are shown to the salesperson.
 * The table CHECK `fms_ocpi_complete_when_submitted` enforces the same minimum
 * server-side; this exists so the user finds out before pressing the button.
 */
export function missingForSubmit(d: QuotationDraft): string[] {
  const out: string[] = [];
  if (!d.customerName.trim()) out.push("the customer name");
  if (!d.salespersonName.trim()) out.push("the salesperson");
  if (!d.machineId) out.push("the machine");
  if (!d.machineCount.trim()) out.push("how many machines");
  if (!d.dealValueAmount.trim()) out.push("the total deal value");
  if (!d.dealValueCurrency) out.push("the currency");
  return out;
}
