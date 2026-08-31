import {
  canCarry,
  isUsdDeal,
  NO_MACHINE_FACTS,
  type MachineFacts,
  type QuotationDraft,
} from "./fieldSpec";

/**
 * The conditional rules from the Microsoft form, as data.
 *
 * The live form ("New Printer Quotation Form", 47 questions) carries eight
 * branch rules. They are reproduced here so the module asks the same questions
 * in the same order — with THREE DELIBERATE CORRECTIONS to the form itself, and
 * FIVE RULES OF OUR OWN added by the revision.
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
 *    ⚠ SUPERSEDED TWICE. First (OCPI-3, stage D) there stopped being a dryer
 *      warranty question at all — the client offers no dryer warranty. Then
 *      (stage E) the DEAL stopped deciding whether there is a dryer at all; see
 *      RULE 7. Kept because the correction explains why the ORIGINAL form was
 *      wrong, which is still worth knowing if anybody works from it again.
 *
 * ── AND FIVE RULES THAT ARE OURS ───────────────────────────────────────────
 *
 * 4. The dollar-exchange clause is asked ONLY on a dollar deal. It is a USD
 *    term, and a rupee customer was being asked to agree to something that could
 *    not apply to them. (Stage B.)
 *
 * 5. High Seas attracts NO GST, so no rate is asked for. (Stage C.)
 *
 * 6. The FX position exists only for a dollar deal. (Stage C.)
 *
 * 7. THE MACHINE DECIDES WHAT IS ASKED, NOT THE SALESPERSON. Whether there is a
 *    dryer, and which of the four extras apply, are properties of the model —
 *    mapped once on the Machine master from the client's own sheet. (Stage E,
 *    and the reason `isVisible` now takes a second argument; see below.)
 *
 * 8. Shipment & invoice asks four items the same four questions, each on its
 *    own condition — two of them the machine’s. (Stage F; written out in full
 *    beside the rules themselves, since the four conditions differ.)
 *
 * All eight are recorded in OCPI.md. If any turns out to be unwanted, delete it
 * here AND in the matching SQL writer — they must not disagree.
 */

/**
 * A field is either shown or hidden; nothing is ever disabled-but-visible.
 *
 * ⚠ TWO ARGUMENTS SINCE STAGE E. A rule may need the chosen MACHINE's mapping as
 *   well as the draft, and `machineFacts` (fieldSpec.ts) is how it gets there —
 *   deliberately a small flat record rather than the whole `OcpiMachine`, so
 *   that what the branches may depend on is visible at a glance and matches the
 *   five columns `fms_ocpi_write_oc` actually reads.
 */
export type Visibility = (d: QuotationDraft, m: MachineFacts) => boolean;

/**
 * Does this deal carry a dryer?
 *
 * ⚠ THIS MOVED OFF THE DEAL AND ONTO THE MACHINE (OCPI-3, stage E). It used to
 *   read `dryerType !== 'Not Applicable'` — the salesperson's own answer to a
 *   "Dryer required" dropdown. The client's sheet settles it per model instead,
 *   so `dryerType` now means the dryer's CATEGORY and this flag comes from the
 *   machine.
 *
 * ⚠ CHANGE THIS AND CHANGE `fms_ocpi_write_oc` IN THE SAME BREATH. The SQL reads
 *   `m.needs_dryer` through a left join and nulls every dryer column when it is
 *   not true. If the two ever disagree the server erases answers the form is
 *   still showing, on every save, with no error.
 *
 * ⚠ NULL IS "NO". An unmapped machine, or no machine yet, asks nothing — which
 *   is also why the Machine master requires the flag.
 */
const hasDryer = (_d: QuotationDraft, m: MachineFacts): boolean => m.needsDryer === true;

/*
 * `isUsdDeal` lives in fieldSpec.ts, beside the currency list and the
 * submit check that also depends on it. High Seas counts as a dollar deal from
 * the moment the type is picked, not from the moment a save comes back — read
 * its header for why, and for what printed blank before it existed.
 */

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

  /*
    ── OCPI-7 · the NO branch, and the module's first show-on-FALSE group ─────

    Every other rule in this map fires on `=== true`. These six fire on
    `=== false`, because "not included in the machine price" is not "not being
    sold": the customer still buys ink and still buys heads, and the rate is
    agreed at the same table as the machine.

    ⚠ `=== false`, NEVER `!d.inclInk`. The third state is real and load-bearing
      here. An unanswered inclusion is `null`, and `!null` is true — so the
      shorthand would present the rate question to somebody who has not
      answered the inclusion at all, reading as though the system had already
      decided the answer was No. `null` must show NOTHING.

    ⚠ The precedent is `dryerPrice` further down: a price only when the dryer
      is NOT part of the deal. Same shape, same reason.

    The rate lines then hang off the rate question, so the chain is
    inclusion=false → offered=true. `clearHidden` iterates this map, so a rate
    typed and then hidden is blanked here as well as by the RPC — but the RPC
    is the authority and carries the inverted guard too.
  */
  inkOfferAgreed: (d) => d.inclInk === false,
  inkOfferQty: (d) => d.inclInk === false && d.inkOfferAgreed === true,
  inkOfferRate: (d) => d.inclInk === false && d.inkOfferAgreed === true,

  headOfferAgreed: (d) => d.inclHead === false,
  headOfferQty: (d) => d.inclHead === false && d.headOfferAgreed === true,
  headOfferRate: (d) => d.inclHead === false && d.headOfferAgreed === true,

  /*
    ⚠ THIS RULE STAYS, THOUGH THE BOX IS GONE (OCPI-3, stage H) — and my own task
      list was wrong to call it an orphan.

      The balance-heads box was removed from the form, so `isVisible` is never
      asked about it any more. But `clearHidden` iterates EVERY key in this map,
      not the ones the form happens to render, so the rule is still live: it is
      what blanks the stored text when a deal that had a head stops including
      one. 13 of the 18 deals on record hold something here, and they can still
      be edited.

      Delete this and that text survives a change it contradicts, invisibly,
      and prints on the next generated paper. `fms_ocpi_write_oc` keeps the
      matching branch for the same reason.
  */
  headBalanceRemarks: (d) => d.inclHead === true,

  /* ── RULE 8 · Shipment & invoice, one row per item ────────────────────────
   *
   * Four items ask the same four questions, and each hangs off a DIFFERENT
   * condition. Reading them together is the point of listing them together:
   *
   *   head              the deal includes a head        d.inclHead
   *   dryer             the MACHINE takes a dryer       m.needsDryer
   *   spare parts       the deal includes spares        d.inclSpares
   *   centering device  the MACHINE can carry one       m.optExternalCentering
   *
   * Two of the four are the machine's answer, not the salesperson's — so a
   * salesperson cannot open the dryer's shipping questions by naming a dryer,
   * and cannot open the centering device's by ticking "external centering
   * system". The client asked for that tick and this device to stay separate;
   * they read the same capability but they are different questions.
   *
   * Within each row:
   *   · the ROUTE is asked only of a SEPARATE shipment — nothing to route when
   *     it travels with the machine;
   *   · QUANTITY and AMOUNT are asked only of a SEPARATE INVOICE, because that
   *     is the only document they would appear on. Asking otherwise invites a
   *     figure being quoted twice, once inside the deal value and once beside it.
   *
   * Every line below has its twin in fms_ocpi_write_oc. Change one, change both.
   */
  headShipMode: (d) => d.inclHead === true,
  headShipVia: (d) => d.inclHead === true && d.headShipMode === "separate",
  headSeparateInvoice: (d) => d.inclHead === true,
  headInvoiceQty: (d) => d.inclHead === true && d.headSeparateInvoice === true,
  headInvoiceAmount: (d) => d.inclHead === true && d.headSeparateInvoice === true,

  dryerShipMode: hasDryer,
  dryerShipVia: (d, m) => hasDryer(d, m) && d.dryerShipMode === "separate",
  dryerSeparateInvoice: hasDryer,
  dryerInvoiceQty: (d, m) => hasDryer(d, m) && d.dryerSeparateInvoice === true,
  dryerInvoiceAmount: (d, m) => hasDryer(d, m) && d.dryerSeparateInvoice === true,

  sparesShipMode: (d) => d.inclSpares === true,
  sparesShipVia: (d) => d.inclSpares === true && d.sparesShipMode === "separate",
  sparesSeparateInvoice: (d) => d.inclSpares === true,
  sparesInvoiceQty: (d) => d.inclSpares === true && d.sparesSeparateInvoice === true,
  sparesInvoiceAmount: (d) => d.inclSpares === true && d.sparesSeparateInvoice === true,

  centeringShipMode: (_d, m) => canCarry(m.optExternalCentering),
  centeringShipVia: (d, m) => canCarry(m.optExternalCentering) && d.centeringShipMode === "separate",
  centeringSeparateInvoice: (_d, m) => canCarry(m.optExternalCentering),
  centeringInvoiceQty: (d, m) =>
    canCarry(m.optExternalCentering) && d.centeringSeparateInvoice === true,
  centeringInvoiceAmount: (d, m) =>
    canCarry(m.optExternalCentering) && d.centeringSeparateInvoice === true,

  // RULE 7 — the whole Dryer details section, machine-driven. `dryerType` is in
  // here too: the CATEGORY is only asked of a machine that takes a dryer, which
  // is why fms_ocpi_write_quotation had to learn the same rule — it owns that
  // column, and write_oc owns the rest.
  dryerType: hasDryer,
  dryerName: hasDryer,
  dryerChambers: hasDryer,
  heatingMode: hasDryer,
  dryerIncluded: hasDryer,
  // A price only when the dryer is NOT part of the deal — otherwise the sheet
  // would carry a charge for something the customer is not being charged for.
  dryerPrice: (d, m) => hasDryer(d, m) && d.dryerIncluded === false,

  /*
    RULE 7 again — ONE extra, where there used to be four (OCPI-10).

    Air blade, ink dust exhauster and chilling system are now asked on EVERY
    deal and have no rule here at all: `isVisible` returns true for a key it
    does not know, which is the whole of their change. Removing the rules also
    takes them out of `clearHidden`'s loop — required, not incidental, or the
    answer would be blanked client-side before the payload was even built.

    ⚠ EXTERNAL CENTERING KEEPS ITS GATE, and the asymmetry is the client's own
      decision rather than an oversight. The centering system follows the
      dryer's logic: if the machine backs it, ask; otherwise do not. So section
      B shows seven pointers on the 5 machines that can carry a centering
      device and six on the other 23. Do not "fix" that by always rendering the
      row, and do not tidy this rule into matching the three that went.

    ⚠ ITS TWIN IS THE SHIPMENT GROUP twenty lines above — `centeringShipMode`
      and the four beside it read the SAME capability, and the client confirmed
      the two hide together. Both survive OCPI-10 untouched.

    ⚠ THE SERVER CARRIES THIS RULE TOO. `fms_ocpi_write_oc` still clears
      `external_centering` on a machine that cannot carry one, and deliberately
      no longer clears the other three — see
      20261025120000_fms_ocpi_extras_stop_being_gated.sql. If this rule and
      that clearing ever disagree, the form asks a question the server throws
      away, which is exactly the bug OCPI-10 existed to remove.
  */
  externalCentering: (_d, m) => canCarry(m.optExternalCentering),

  highSeasVia: (d) => d.transportTerms === "high_seas",
  highSeasCostBy: (d) => d.transportTerms === "high_seas",
  localCostBy: (d) => d.transportTerms === "local",

  // RULE 4 — a dollar term, asked only of dollar deals.
  dollarClauseAgreed: isUsdDeal,

  // RULE 5 — HIGH SEAS ATTRACTS NO GST, so there is no rate to ask for. The
  // server sets gst_rate NULL rather than 0 on such a deal, and the papers omit
  // the tax rows entirely: a zero-tax line on a high-seas contract is a
  // different claim from no line, and only one of them is true.
  gstRate: (d) => d.transportTerms !== "high_seas",

  // RULE 6 — the FX position only exists for a dollar deal. See `isUsdDeal`:
  // High Seas qualifies from the moment the deal type is picked, not from the
  // moment the save comes back with the currency corrected.
  fxRate: isUsdDeal,
};

/** Is this field currently askable? */
export function isVisible(
  field: keyof QuotationDraft,
  draft: QuotationDraft,
  facts: MachineFacts = NO_MACHINE_FACTS,
): boolean {
  const rule = PART_A_VISIBILITY[field];
  return rule ? rule(draft, facts) : true;
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
 *
 * ⚠ PASS THE MACHINE'S FACTS. The default is the CLOSED set, which would blank
 *   every dryer answer and every extra — right for "no machine chosen", wrong
 *   for a caller that simply forgot. `useQuotationDraft` reads them off the
 *   draft's own machine; there is one caller and it does.
 */
export function clearHidden(
  draft: QuotationDraft,
  facts: MachineFacts = NO_MACHINE_FACTS,
): QuotationDraft {
  const out = { ...draft };
  for (const key of Object.keys(PART_A_VISIBILITY) as (keyof QuotationDraft)[]) {
    if (!isVisible(key, draft, facts)) {
      const current = draft[key];
      (out[key] as unknown) = typeof current === "boolean" || current === null ? null : "";
    }
  }
  return out;
}
