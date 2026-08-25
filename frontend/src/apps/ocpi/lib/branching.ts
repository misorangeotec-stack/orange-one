import type { QuotationDraft } from "./fieldSpec";

/**
 * The conditional rules from the Microsoft form, as data.
 *
 * The live form ("New Printer Quotation Form", 47 questions) carries eight
 * branch rules. They are reproduced here so the module asks the same questions
 * in the same order — with THREE DELIBERATE CORRECTIONS to the form itself, and
 * THREE RULES OF OUR OWN added by the revision.
 *
 * ⚠ THIS IS THE COURTESY COPY. The same clearing happens server-side, in
 *   public.fms_ocpi_write_quotation for part A and public.fms_ocpi_write_oc for
 *   the detail fields — each nulls every column its branches hide, on every
 *   write. That is the backstop: pick High Seas, answer CIF, switch to Others,
 *   and without it the row would still carry CIF and print "Local Delivery …
 *   CIF" on a customer's contract. Here the point is only that the user should
 *   not SEE a question that cannot apply to them.
 *
 * ── THE THREE CORRECTIONS ──────────────────────────────────────────────────
 *
 * 1. GST = "No" must NOT skip "No. of Machine".
 *    The live form branches Q6 "GST No. Available" = No straight to Q9 "Name of
 *    the Printer", silently stepping over Q8 "No. of Machine". That field is
 *    needed on every deal and prints on every order confirmation as "No. of
 *    Machine Supply". A customer without a GST registration would produce a
 *    contract that does not say how many machines they are buying. Here, "No"
 *    hides only the GST NUMBER.
 *
 * 2. "Deal does not include a head" must NOT go on to ask how to ship the head.
 *    The live form branches Q19 = No to Q21 "How to ship the Head included with
 *    the deal?", and on through Q22–Q24. Those questions are meaningless when no
 *    head is included.
 *
 * 3. "Dryer = Not Applicable" must NOT ask for a dryer warranty period.
 *    The form skips chambers and heating mode but still asks the warranty, which
 *    would print a warranty for equipment that is not in the deal.
 *
 * ── AND THREE RULES THAT ARE OURS ──────────────────────────────────────────
 *
 * 4. The dollar-exchange clause is asked ONLY on a dollar deal. It is a USD
 *    term, and a rupee customer was being asked to agree to something that could
 *    not apply to them — then having their answer printed. (Stage B.)
 *
 * 5. High Seas attracts NO GST, so no rate is asked for. (Stage C.)
 *
 * 6. The FX position exists only for a dollar deal. (Stage C.)
 *
 * All six are recorded in OCPI.md. If any turns out to be unwanted, delete it
 * here AND in the matching SQL writer — they must not disagree.
 */

/** A field is either shown or hidden; nothing is ever disabled-but-visible. */
export type Visibility = (d: QuotationDraft) => boolean;

/** Does this deal actually carry a dryer? "Not Applicable" is a real answer. */
const hasDryer = (d: QuotationDraft): boolean =>
  !!d.dryerType && d.dryerType !== "Not Applicable";

/**
 * Which fields are conditional, and on what.
 *
 * A field absent from this map is ALWAYS shown. Only the exceptions are listed,
 * so reading it answers "what can disappear?" directly.
 *
 * ⚠ SINCE THE REVISION THIS COVERS BOTH HALVES OF THE FORM. The detail fields
 *   used to branch in ocFieldSpec.ts's `ocVisible`, which read the answers off
 *   the DEAL ROW rather than the draft — so a salesperson who un-ticked "deal
 *   includes a head" and had not yet saved still saw the head-shipment
 *   questions. One form, one draft, one source for the condition.
 */
export const PART_A_VISIBILITY: Partial<Record<keyof QuotationDraft, Visibility>> = {
  // CORRECTION 1 — this hides the GST number and nothing else.
  gstNo: (d) => d.gstAvailable === true,

  inkQtyIncluded: (d) => d.inclInk === true,
  spareDetails: (d) => d.inclSpares === true,

  // CORRECTION 2 — the head count and the whole shipment group.
  headsIncluded: (d) => d.inclHead === true,
  headShipMode: (d) => d.inclHead === true,
  headSeparateInvoice: (d) => d.inclHead === true,
  headBalanceRemarks: (d) => d.inclHead === true,
  // Only a SEPARATE shipment needs a route.
  headShipVia: (d) => d.inclHead === true && d.headShipMode === "separate",

  // CORRECTION 3 — no dryer, no dryer questions, warranty included.
  dryerChambers: hasDryer,
  heatingMode: hasDryer,
  dryerWarranty: hasDryer,

  highSeasVia: (d) => d.transportTerms === "high_seas",
  highSeasCostBy: (d) => d.transportTerms === "high_seas",
  localCostBy: (d) => d.transportTerms === "local",

  // RULE 4 — a dollar term, asked only of dollar deals.
  dollarClauseAgreed: (d) => d.dealValueCurrency === "USD",

  // RULE 5 — HIGH SEAS ATTRACTS NO GST, so there is no rate to ask for. The
  // server sets gst_rate NULL rather than 0 on such a deal, and the papers omit
  // the tax rows entirely: a zero-tax line on a high-seas contract is a
  // different claim from no line, and only one of them is true.
  gstRate: (d) => d.transportTerms !== "high_seas",

  // RULE 6 — the FX position only exists for a dollar deal.
  fxRate: (d) => d.dealValueCurrency === "USD",
};

/** Is this field currently askable? */
export function isVisible(field: keyof QuotationDraft, draft: QuotationDraft): boolean {
  const rule = PART_A_VISIBILITY[field];
  return rule ? rule(draft) : true;
}

/**
 * Blank whatever the current answers have hidden.
 *
 * Called before a save so the payload matches what the user can actually see.
 * The server does this again — see the header — but sending a coherent payload
 * means the form's own state, the draft it restores from, and the row all agree.
 *
 * A hidden boolean is cleared to null and a hidden string to "": the two are
 * different absences, and collapsing them would turn an unanswered yes/no into
 * an empty string the row cannot store.
 */
export function clearHidden(draft: QuotationDraft): QuotationDraft {
  const out = { ...draft };
  for (const key of Object.keys(PART_A_VISIBILITY) as (keyof QuotationDraft)[]) {
    if (!isVisible(key, draft)) {
      const current = draft[key];
      (out[key] as unknown) = typeof current === "boolean" || current === null ? null : "";
    }
  }
  return out;
}
