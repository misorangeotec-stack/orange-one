import type { QuotationDraft } from "./fieldSpec";

/**
 * The conditional rules from the Microsoft form, as data.
 *
 * The live form ("New Printer Quotation Form", 47 questions) carries eight
 * branch rules. They are reproduced here so the module asks the same questions
 * in the same order — with TWO DELIBERATE CORRECTIONS, below.
 *
 * ⚠ THIS IS THE COURTESY COPY. The same clearing happens server-side in
 *   public.fms_ocpi_write_quotation, which nulls every field a branch hides on
 *   every write. That is the backstop: pick High Seas, answer CIF, switch to
 *   Local, and without it the row would still carry CIF and print "Local
 *   Delivery … CIF" on a customer's contract. Here the point is only that the
 *   user should not SEE a question that cannot apply to them.
 *
 * ── THE TWO CORRECTIONS ────────────────────────────────────────────────────
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
 *    head is included. Here, "No" hides the head count AND the whole shipment
 *    group (which is part B, so this rule is enforced again there).
 *
 * Both are recorded in OCPI.md as open items; if either turns out to be
 * deliberate, delete the correction here and in fms_ocpi_write_quotation
 * together — they must not disagree.
 */

/** A field is either shown or hidden; nothing is ever disabled-but-visible. */
export type Visibility = (d: QuotationDraft) => boolean;

/**
 * Which part-A fields are conditional, and on what.
 *
 * A field absent from this map is ALWAYS shown. Only the exceptions are listed,
 * so reading it answers "what can disappear?" directly.
 */
export const PART_A_VISIBILITY: Partial<Record<keyof QuotationDraft, Visibility>> = {
  // CORRECTION 1 — this hides the GST number and nothing else.
  gstNo: (d) => d.gstAvailable === true,

  inkQtyIncluded: (d) => d.inclInk === true,
  spareDetails: (d) => d.inclSpares === true,

  // CORRECTION 2 — see the header. The head SHIPMENT questions are part B and
  // carry the same condition there.
  headsIncluded: (d) => d.inclHead === true,

  highSeasVia: (d) => d.transportTerms === "high_seas",
  highSeasCostBy: (d) => d.transportTerms === "high_seas",
  localCostBy: (d) => d.transportTerms === "local",
};

/** Is this part-A field currently askable? */
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
 */
export function clearHidden(draft: QuotationDraft): QuotationDraft {
  const out = { ...draft };
  for (const key of Object.keys(PART_A_VISIBILITY) as (keyof QuotationDraft)[]) {
    if (!isVisible(key, draft)) {
      (out[key] as unknown) = key === "gstNo" ? "" : "";
    }
  }
  return out;
}
