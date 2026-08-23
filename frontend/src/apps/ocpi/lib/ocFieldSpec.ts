import type { OcpiDeal } from "../types";

/**
 * The order confirmation's own fields — part B.
 *
 * Everything the quotation already answered is NOT here. The order confirmation
 * inherits it by being the same row, so the salesperson never retypes the
 * customer, the machine, the price or the delivery terms.
 *
 * ⚠ THIS FORM BRANCHES ON PART-A ANSWERS IT DOES NOT OWN. Whether to ask about
 *   head shipment depends on "does the deal include a head", which was decided
 *   on the quotation; whether to ask about dryer chambers depends on which dryer
 *   was chosen. So visibility takes the whole DEAL, not just this draft — and
 *   fms_ocpi_write_oc reads the same two columns off the row rather than
 *   trusting the payload.
 */

export interface OcDraft {
  // head shipment — only when the deal includes a head
  headShipMode: string;
  headShipVia: string;
  headBalanceRemarks: string;
  headSeparateInvoice: boolean | null;

  // dryer — only when one is being supplied
  dryerChambers: string;
  heatingMode: string;
  dryerWarranty: string;
  platterDetails: string;

  // options
  airBlade: boolean | null;
  externalCentering: boolean | null;
  inkDustExhauster: boolean | null;
  chillingSystem: boolean | null;

  // warranty & commitments
  otherCommitments: string;
  printerWarranty: string;
  headWarranty: string;
  postWarrantyHeadPrice: string;
  consumablesSupplier: string;
  insuranceClauseAgreed: boolean | null;

  // order-confirmation only
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

export const EMPTY_OC: OcDraft = {
  headShipMode: "", headShipVia: "", headBalanceRemarks: "", headSeparateInvoice: null,
  dryerChambers: "", heatingMode: "", dryerWarranty: "", platterDetails: "",
  airBlade: null, externalCentering: null, inkDustExhauster: null, chillingSystem: null,
  otherCommitments: "", printerWarranty: "", headWarranty: "", postWarrantyHeadPrice: "",
  consumablesSupplier: "", insuranceClauseAgreed: null,
  refNo: "", deliveryDays: "", tradeTerm: "", machineModelNo: "", preparedBy: "", approvedBy: "",
  gstRate: "18", machineValueInr: "", gstAmountInr: "", totalInr: "",
};

/* ── Option lists, from the live Microsoft form ───────────────────────────── */

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

export const FIELD_LABEL_OC: Record<keyof OcDraft, string> = {
  headShipMode: "How to ship the included head",
  headShipVia: "Later shipment sent via",
  headBalanceRemarks: "Remarks — balance heads to be sold later",
  headSeparateInvoice: "Separate invoice for the head",
  dryerChambers: "How many chambers with the dryer",
  heatingMode: "Heating mode",
  dryerWarranty: "Dryer warranty period",
  platterDetails: "Platter",
  airBlade: "Air blade",
  externalCentering: "External centering system",
  inkDustExhauster: "Ink dust exhauster",
  chillingSystem: "Chilling system",
  otherCommitments: "Other commitments made",
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

/**
 * The standing insurance clause, printed verbatim on the order confirmation and
 * confirmed by the salesperson.
 */
export const INSURANCE_CLAUSE =
  "Insurance coverage up to the point of loading will be the responsibility of the company, " +
  "while any coverage required during unloading will be the responsibility of the customer.";

/* ── Branching ────────────────────────────────────────────────────────────── */

/**
 * Which part-B fields apply, given the whole deal.
 *
 * ⚠ THE HEAD-SHIPMENT GROUP IS HIDDEN WHEN NO HEAD IS INCLUDED. The live
 *   Microsoft form asks "How to ship the Head included with the deal?" even
 *   after the salesperson has said no head is included — question 19 branches
 *   "No" straight into it. That is one of the two form bugs this module
 *   deliberately does not reproduce.
 *
 * ⚠ THE DRYER GROUP IS HIDDEN WHEN THE DRYER IS "Not Applicable" — including
 *   the dryer WARRANTY. The form skips chambers and heating mode but still asks
 *   for a dryer warranty period, which cannot mean anything when no dryer is
 *   being supplied and would print a warranty for equipment that is not in the
 *   deal. Recorded in OCPI.md as a third deliberate correction.
 */
export function ocVisible(field: keyof OcDraft, deal: OcpiDeal, draft: OcDraft): boolean {
  const hasHead = deal.inclHead === true;
  const hasDryer = !!deal.dryerType && deal.dryerType !== "Not Applicable";

  switch (field) {
    case "headShipMode":
    case "headBalanceRemarks":
    case "headSeparateInvoice":
      return hasHead;
    case "headShipVia":
      return hasHead && draft.headShipMode === "separate";
    case "dryerChambers":
    case "heatingMode":
    case "dryerWarranty":
      return hasDryer;
    default:
      return true;
  }
}

/** Blank whatever the current answers have hidden, before saving. */
export function clearHiddenOc(deal: OcpiDeal, draft: OcDraft): OcDraft {
  const out = { ...draft };
  (Object.keys(draft) as (keyof OcDraft)[]).forEach((k) => {
    if (!ocVisible(k, deal, draft)) {
      const v = draft[k];
      (out[k] as unknown) = typeof v === "boolean" || v === null ? null : "";
    }
  });
  return out;
}

/* ── Row ⇄ form ───────────────────────────────────────────────────────────── */

const s = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

export function ocFromDeal(d: OcpiDeal): OcDraft {
  return {
    headShipMode: s(d.headShipMode),
    headShipVia: s(d.headShipVia),
    headBalanceRemarks: s(d.headBalanceRemarks),
    headSeparateInvoice: d.headSeparateInvoice,
    dryerChambers: s(d.dryerChambers),
    heatingMode: s(d.heatingMode),
    dryerWarranty: s(d.dryerWarranty),
    platterDetails: s(d.platterDetails),
    airBlade: d.airBlade,
    externalCentering: d.externalCentering,
    inkDustExhauster: d.inkDustExhauster,
    chillingSystem: d.chillingSystem,
    otherCommitments: s(d.otherCommitments),
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
    gstRate: d.gstRate === null ? "18" : String(d.gstRate),
    machineValueInr: s(d.machineValueInr),
    gstAmountInr: s(d.gstAmountInr),
    totalInr: s(d.totalInr),
  };
}

/**
 * ⚠ THE KEYS ARE A WIRE CONTRACT WITH fms_ocpi_write_oc. A typo does not fail —
 *   `p->>'trade_term'` simply returns null and the field is blanked on save.
 */
export function ocPayload(d: OcDraft): Record<string, unknown> {
  return {
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
export function withGst(d: OcDraft): OcDraft {
  const value = Number(d.machineValueInr);
  const rate = Number(d.gstRate);
  if (!Number.isFinite(value) || !Number.isFinite(rate) || d.machineValueInr.trim() === "") {
    return { ...d, gstAmountInr: "", totalInr: "" };
  }
  const gst = Math.round(value * rate) / 100;
  return { ...d, gstAmountInr: String(gst), totalInr: String(value + gst) };
}

/** What still has to be answered before the order confirmation can be submitted. */
export function missingForOc(d: OcDraft): string[] {
  const out: string[] = [];
  if (!d.machineValueInr.trim()) out.push("the machine value in rupees");
  if (!d.printerWarranty.trim()) out.push("the printer warranty period");
  if (!d.deliveryDays.trim()) out.push("the delivery days");
  if (!d.tradeTerm.trim()) out.push("the delivery term");
  return out;
}
