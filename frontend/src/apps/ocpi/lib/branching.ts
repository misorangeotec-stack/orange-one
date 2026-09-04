import {
  isUsdDeal,
  NO_DEAL_FACTS,
  type DealFacts,
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
 * 7. THE MACHINE CATEGORY DECIDES WHAT IS ASKED, NOT THE SALESPERSON AND NOT THE
 *    MACHINE. Whether there is a dryer, a centering device, or the three
 *    optional extras is a property of the CATEGORY — Direct carries all three,
 *    Sublimation / Other / POD carry none.
 *    ⚠ SUPERSEDED TWICE. Stage E moved this from the salesperson to the MACHINE
 *      (`needs_dryer` and the four `opt_*` columns); OCPI-14 moved it again, to
 *      the category, at Ritesh Bhai's instruction. The machine columns still
 *      exist and are still edited on the Machines master — they record what a
 *      model can take — but nothing branches on them any more, here or in SQL.
 *
 * 8. Shipment & invoice asks five items the same five questions.
 *    ⚠ ALSO SUPERSEDED (OCPI-14). Each row used to hang off its own condition,
 *      three of them the deal's own inclusions. THERE IS NO CONNECTION NOW: how
 *      a thing ships and whether it is billed on its own document is not the
 *      same question as whether it sits inside the machine price. Head, ink and
 *      spare parts are asked on every deal; the dryer and the centering device
 *      follow the category.
 *
 * All eight are recorded in OCPI.md. If any turns out to be unwanted, delete it
 * here AND in the matching SQL writer — they must not disagree.
 */

/**
 * A field is either shown or hidden; nothing is ever disabled-but-visible.
 *
 * ⚠ TWO ARGUMENTS, DOWN FROM THREE (OCPI-14). There used to be a `MachineFacts`
 *   between these two, holding the five machine columns the SQL read. The
 *   category decides now, so that record had nothing left to decide and was
 *   deleted rather than left as a parameter every caller still had to pass.
 *
 * `DealFacts` (fieldSpec.ts) resolves, once, the four things a rule needs that
 * are not on the draft: the three category flags, and whether the dryer CATEGORY
 * the salesperson picked is one that means there is no dryer. No rule here has
 * to reach for a store.
 */
export type Visibility = (d: QuotationDraft, f: DealFacts) => boolean;

/**
 * Does this deal carry a dryer?
 *
 * ⚠ THIS HAS MOVED TWICE. It began as `dryerType !== 'Not Applicable'` — the
 *   salesperson's own answer. OCPI-3 stage E moved it to the MACHINE, because
 *   the client's sheet settles it per model. OCPI-14 moved it to the CATEGORY,
 *   because the client's newer sheet settles it per type and the two agree on
 *   all 28 machines — every Direct model takes a dryer and no other model does.
 *
 * ⚠ CHANGE THIS AND CHANGE `fms_ocpi_write_oc` IN THE SAME BREATH. The SQL reads
 *   `c.shows_dryer` through a left join and nulls every dryer column when it is
 *   not true. If the two ever disagree the server erases answers the form is
 *   still showing, on every save, with no error.
 *
 * ⚠ NULL IS "NO". No category yet asks nothing — which is the ordinary state of
 *   a brand-new draft, and matches `coalesce(c.shows_dryer, false)` in the SQL.
 */
const hasDryer = (_d: QuotationDraft, f: DealFacts): boolean => f.showsDryer;

/**
 * Does this deal carry a dryer whose DETAILS can be filled in?
 *
 * ⚠ THE MACHINE OPENS THE SECTION; THE CATEGORY DECIDES WHETHER IT HOLDS
 *   ANYTHING (OCPI-8, asked for by Ritesh Bhai). `hasDryer` above is still the
 *   whole answer for `dryerType` itself — the CATEGORY is asked of any machine
 *   that takes a dryer, and it is the one question a "no dryer" deal must keep,
 *   because it is the answer. Everything below it hangs off this.
 *
 * Three conditions, and each earns its place:
 *
 *   · the MACHINE CATEGORY carries a dryer     — was the machine, until OCPI-14;
 *   · a dryer category has been PICKED         — until one is, there is nothing
 *     to name a dryer inside. The old form rendered the Dryer box DISABLED with
 *     a "choose a category first" hint, which this file's own header forbids
 *     ("hidden, never disabled"); hiding it settles that too;
 *   · that dryer category is not one that means NO DRYER.
 *
 * ⚠ IT READS A RESOLVED FLAG, NEVER THE NAME. `dryerType` is TEXT — the
 *   category's name, frozen into every revision payload — so matching the
 *   literal "Not Applicable" would switch this branch off silently the day
 *   somebody renamed the category in Masters. `dealFacts` resolves the name
 *   back to its master row; a database trigger separately refuses that rename,
 *   because deals already saved hold the old text.
 *
 * ⚠ ITS TWIN IS THE THREE-LINE `v_has_dryer` ASSIGNMENT in fms_ocpi_write_oc,
 *   which resolves the same flag through a left join with no `active` filter.
 *   If the two ever disagree the server erases answers the form is still
 *   showing, on every save, with no error.
 */
const hasDryerDetails: Visibility = (d, f) =>
  hasDryer(d, f) && d.dryerType.trim() !== "" && !f.noDryerCategory;

/**
 * Does this deal's DRYER get its own shipment questions?
 *
 * 🔴 TWO TERMS, NOT THREE, AND THE MISSING ONE IS THE POINT (OCPI-14a, reported
 *    by Ritesh Bhai on sight). The Shipment & invoice table showed four rows on
 *    a Direct deal instead of five, because the Dryer row shared
 *    `hasDryerDetails` — which waits for a DRYER CATEGORY to be picked.
 *
 *    That wait is right for the details: you cannot name a dryer, or count its
 *    chambers, inside a category nobody has chosen yet. It is wrong here. How
 *    the dryer travels, and whether it is billed on its own document, are
 *    answerable the moment the deal is known to carry a dryer at all — which is
 *    what the machine category says.
 *
 * ⚠ IT STILL OBEYS A CATEGORY THAT MEANS "NO DRYER", and that term is kept
 *   deliberately: OCPI-8 item 1.5 was an explicit client decision on
 *   01-Sep-2026 that picking such a category hides this row too. So
 *
 *     Direct, no dryer category yet  → shown
 *     Direct, "Not Applicable"       → hidden
 *     Direct, Indian / Chinese       → shown
 *     anything else                  → hidden
 *
 * ⚠ ITS TWIN IS `v_dryer_ships` in fms_ocpi_write_oc, which is the same two
 *   terms and governs the same six columns. `v_has_dryer` there keeps all three
 *   and still governs the detail columns. Change one, change both — showing this
 *   row while the server cleared it on the old gate would erase six answers on
 *   every save.
 */
const hasDryerShipment: Visibility = (d, f) => hasDryer(d, f) && !f.noDryerCategory;

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

  /* ── RULE 8 · Shipment & invoice ───────────────────────────────────────────
   *
   * 🔴 THERE IS NO CONNECTION TO THE DEAL INCLUSIONS ANY MORE (OCPI-14, asked
   *    for by Ritesh Bhai). Until now each row hung off its own condition and
   *    three of them were the deal's own inclusions:
   *
   *      head             d.inclHead              ink   d.inclInk
   *      spare parts      d.inclSpares            dryer the machine
   *      centering        the machine
   *
   *    That coupling was wrong. How a thing ships, and whether it is billed on
   *    its own document, is not the same question as whether it sits inside the
   *    machine price — a customer can be invoiced separately for a head the deal
   *    does not include, which is exactly what OCPI-7's subsidized-rate block
   *    records. So:
   *
   *      head · ink · spare parts    asked on EVERY deal — NO RULE AT ALL
   *      dryer                       the category carries a dryer
   *      centering device            the category carries one
   *
   * ⚠ HEAD, INK AND SPARES HAVE NO ENTRY BELOW, and that absence IS the change.
   *   `isVisible` returns true for a key it does not know, so removing the rule
   *   is what shows the row. It also takes them out of `clearHidden`'s loop —
   *   required, not incidental: a rule left behind would blank the answer
   *   client-side before the payload was even built, while the server kept it.
   *
   * ⚠ THE TABLE IS THEREFORE FIVE ROWS ON A DIRECT DEAL AND THREE ON EVERY
   *   OTHER, and the count no longer varies with what the salesperson ticked.
   *
   * ⚠ ONE GUARANTEE WAS LOST AND THE CLIENT TRADED IT KNOWINGLY. OCPI-11 relied
   *   on ink's two quantity/amount pairs never being on screen together —
   *   `inkOfferQty` fires on `inclInk === false` and the shipment pair used to
   *   fire on `=== true`. A deal can now carry both. The form answers it by
   *   CARRYING THE SUBSIDIZED FIGURES OVER into the shipment row when the
   *   shipment cells are empty, rather than by asking twice.
   *
   * Within each row, unchanged:
   *   · the ROUTE is asked only of a SEPARATE shipment — nothing to route when
   *     it travels with the machine;
   *   · QUANTITY and AMOUNT are asked only of a SEPARATE INVOICE, because that
   *     is the only document they would appear on.
   *
   * Every line below has its twin in fms_ocpi_write_oc. Change one, change both.
   */
  headShipVia: (d) => d.headShipMode === "separate",
  headInvoiceQty: (d) => d.headSeparateInvoice === true,
  headInvoiceAmount: (d) => d.headSeparateInvoice === true,

  inkShipVia: (d) => d.inkShipMode === "separate",
  inkInvoiceQty: (d) => d.inkSeparateInvoice === true,
  inkInvoiceAmount: (d) => d.inkSeparateInvoice === true,

  /*
    ⚠ THE DRYER'S ROW FOLLOWS THE CATEGORY, NOT JUST THE MACHINE (OCPI-8,
      client's decision 01-Sep-2026). It read `hasDryer` alone until then, so a
      salesperson who had answered "no dryer on this deal" was still asked how
      the dryer ships and whether it is invoiced separately.

      This is not an extension of OCPI-8's brief so much as a requirement of it:
      one variable governs every dryer clearing in `fms_ocpi_write_oc`, so the
      moment the detail fields obey the category these six columns do too. A row
      left on screen whose answers the server nulls on the next save is exactly
      the drift this file exists to prevent.

      So the table shows FOUR rows on a "no dryer" deal where it showed five.
      The varying row count is the section's design — see RULE 8 above.
  */
  /*
    ⚠ `hasDryerShipment`, NOT `hasDryerDetails` (OCPI-14a). These five are the
      only dryer fields that do not wait for a dryer category to be chosen — see
      the predicate's own header for why, and for the one term it still keeps.
  */
  dryerShipMode: hasDryerShipment,
  dryerShipVia: (d, f) => hasDryerShipment(d, f) && d.dryerShipMode === "separate",
  dryerSeparateInvoice: hasDryerShipment,
  dryerInvoiceQty: (d, f) => hasDryerShipment(d, f) && d.dryerSeparateInvoice === true,
  dryerInvoiceAmount: (d, f) => hasDryerShipment(d, f) && d.dryerSeparateInvoice === true,

  sparesShipVia: (d) => d.sparesShipMode === "separate",
  sparesInvoiceQty: (d) => d.sparesSeparateInvoice === true,
  sparesInvoiceAmount: (d) => d.sparesSeparateInvoice === true,

  centeringShipMode: (_d, f) => f.showsCentering,
  centeringShipVia: (d, f) => f.showsCentering && d.centeringShipMode === "separate",
  centeringSeparateInvoice: (_d, f) => f.showsCentering,
  centeringInvoiceQty: (d, f) => f.showsCentering && d.centeringSeparateInvoice === true,
  centeringInvoiceAmount: (d, f) => f.showsCentering && d.centeringSeparateInvoice === true,

  // RULE 7 — the whole Dryer details section, machine-driven. `dryerType` is in
  // here too: the CATEGORY is only asked of a machine that takes a dryer, which
  // is why fms_ocpi_write_quotation had to learn the same rule — it owns that
  // column, and write_oc owns the rest.
  /*
    ⚠ THE CATEGORY IS THE ONE QUESTION THAT STAYS ON `hasDryer` (OCPI-8). It is
      asked of every machine that takes a dryer, because it is where the
      salesperson SAYS whether this deal carries one. Hiding it on its own
      answer would make the answer unreachable and unchangeable.

      Everything under it moved to `hasDryerDetails`. Before OCPI-8 all five sat
      on `hasDryer`, so picking the category that means "no dryer" left the name,
      chambers, heating medium, included-in-deal and price on screen, unfillable,
      with the completeness warning still asking for a dryer name that could not
      be given. Reported by Ritesh Bhai, 31-Aug-2026.
  */
  dryerType: hasDryer,
  dryerName: hasDryerDetails,
  dryerChambers: hasDryerDetails,
  heatingMode: hasDryerDetails,
  dryerIncluded: hasDryerDetails,
  /*
    🔴 THIS RULE WAS MISSING AND THE BROWSER FOUND IT (OCPI-14).

       `dryer_warranty` has been cleared by `fms_ocpi_write_oc` on
       `not v_has_dryer` since stage E — but nothing in this map ever mentioned
       it, because between OCPI-3 stage D and OCPI-14 the field was not on the
       form at all, so `isVisible` was never asked about it. Putting the question
       back without putting the rule back left the form showing a Dryer warranty
       box on a Sublimation deal, which the server nulls on every save.

       That is precisely the form/server disagreement this whole change exists to
       remove, and it survived a green build, a clean typecheck and the SQL
       switch-back test — none of which look at what the form renders.
  */
  dryerWarranty: hasDryerDetails,
  /*
    ⚠ `dryerPrice` USED TO BE THE SIXTH RULE HERE and it is deliberately gone
      (OCPI-14). It fired on `dryerIncluded === false` — a price only when the
      dryer is NOT part of the deal — and it was the precedent the OCPI-7
      show-on-false group was written from. All pricing is asked once now, in
      Shipment & invoice, where the Dryer row already collects a quantity and an
      amount; asking again here was the second place to type the same figure.

      The COLUMN survives and so does its derivation in fms_ocpi_write_oc. The
      form simply stops sending the key, so `dryer_value_inr` and
      `dryer_gst_inr` resolve to null and `grand_total_inr` collapses to
      `total_inr` through guards that already existed. Removing the rule is what
      takes it out of `clearHidden` too — leaving the rule behind would have
      blanked a column the form no longer populates, on every save, forever.
  */

  /*
    RULE 7 again — THE THREE EXTRAS, RE-GATED ON THE CATEGORY (OCPI-14).

    ⚠ THIS REVERSES OCPI-10, FOUR DAYS OLD, AND THE REVERSAL IS THE CLIENT'S.
      OCPI-10 ungated air blade / ink dust exhauster / chilling system because
      the per-machine mapping was hiding questions people needed to answer. The
      01-09 sheet settles it properly instead: the extras are mapped against
      DIRECT machines only and read "no" for every Sublimation, Other and POD
      model. So they are asked on a Direct deal and nowhere else.

    🔴 THEY ARE THE ONE PLACE IN THIS FILE WHERE A HIDDEN FIELD CLEARS TO
       `false` RATHER THAN `null` — see `clearHidden` below. Ritesh Bhai asked
       for a definite "No" on a machine that cannot take one, not an unanswered
       question, so the papers can state it. `fms_ocpi_write_oc` carries the
       matching `else false`; if the two disagree the answer flickers between
       null and false on alternate saves.

    ⚠ `externalCentering` HAS NO RULE HERE ANY MORE — the field is gone from the
      form. It was the fourth of these ticks and the only one OCPI-10 left
      gated; OCPI-14 promotes it to a full deal inclusion
      (`inclCentering` / `centeringDetails`, in section B beside spare parts).
      The COLUMN is frozen history: `fms_ocpi_write_oc` no longer writes it, so
      the 15 deals that answered it keep their answer. A rule left here would
      have blanked it on the first re-save of every one of them.
  */
  airBlade: (_d, f) => f.showsExtras,
  inkDustExhauster: (_d, f) => f.showsExtras,
  chillingSystem: (_d, f) => f.showsExtras,

  /*
    OCPI-14 · the centering device as a deal inclusion, shaped on spare parts.
    A "No" ends it — there is no subsidized-rate branch, which is why this pair
    reads like `spareDetails` above and not like the ink block.
  */
  inclCentering: (_d, f) => f.showsCentering,
  centeringDetails: (d, f) => f.showsCentering && d.inclCentering === true,

  /*
    ⚠ highSeasVia HAS NO CONTROL ANY MORE, AND KEEPS ITS RULE ANYWAY (OCPI-35).
      The question merged into `deliveryVia` below, but the COLUMN is still
      written -- see payloadFromDraft -- and `fms_ocpi_transport_coherent`
      forbids it on an Others deal outright. This rule is what makes
      `clearHidden` blank it when the deal type moves, matching the server. Do
      not delete it as dead just because nothing renders it.
  */
  highSeasVia: (d) => d.transportTerms === "high_seas",
  highSeasCostBy: (d) => d.transportTerms === "high_seas",
  localCostBy: (d) => d.transportTerms === "local",

  /*
    OCPI-35 · THE ONE DELIVERY QUESTION AND ITS THREE FOLLOW-UPS.

    ⚠ `deliveryVia` IS DELIBERATELY ABSENT FROM THIS MAP. A field with no rule
      is always shown, and being asked on BOTH deal types is the entire point of
      the change. Adding `() => true` would read as a rule somebody could
      "tighten" later.

    The three below mirror fms_ocpi_write_quotation conjunct for conjunct. The
    server is the backstop; these are the courtesy copy, and they must agree.
  */
  deliveryPort: (d) => d.deliveryVia === "CIF",
  deliveryFactoryCity: (d) => d.deliveryVia === "EX Factory",
  // 🔴 TWO CONDITIONS, NOT ONE. Both answers end "to customer premises", so the
  //    question is meaningless once the COMPANY bears the cost -- settled with
  //    Ritesh Bhai: "when we select a company, we don't have to ask this thing."
  deliveryLeg: (d) => d.transportTerms === "high_seas" && d.highSeasCostBy === "customer",

  // RULE 4 — a dollar term, asked only of dollar deals.
  dollarClauseAgreed: isUsdDeal,

  /*
    RULE 5 — NO GST ON A HIGH SEAS SALE, AND NONE ON A DOLLAR DEAL EITHER.

    The server sets gst_rate NULL rather than 0 on such a deal, and the papers
    omit the tax rows entirely: a zero-tax line on a contract is a different
    claim from no line, and only one of them is true.

    🔴 THE DOLLAR HALF IS OCPI-45, AND IT IS RITESH BHAI'S DECISION, 04-09-2026:
       "a dollar deal should never be taxed … it should just be the amount
       multiplied by the conversion rate."

       Found by typing real folder 121 (Modi Rocket) into the form. Its own
       paper reads `USD 11,50,000 @96 → Total INR 11,04,00,000` — exactly
       amount × rate. Ours added 18% and printed ₹13,02,72,000, while the PI's
       dollar layout deliberately carries no tax line at all, so **the page's own
       figures did not reconcile** and nothing on it explained ₹1,98,72,000.

       ⚠ SIX REAL DOLLAR PAPERS WERE CHECKED AND EVERY ONE IS EXACT: folders
         105, 106, 107, 109, 120 and 121. Not one carries tax.

    ⚠ `isUsdDeal`, NOT `dealValueCurrency === "USD"`. High Seas counts as a
      dollar deal from the moment the type is picked rather than from the moment
      a save comes back with the currency corrected — so the first disjunct is
      strictly redundant now and is KEPT anyway: it is the rule the papers and
      the RPC state, and deleting it would leave High Seas depending on a
      currency that the writer, not the form, sets.
  */
  gstRate: (d) => d.transportTerms !== "high_seas" && !isUsdDeal(d),

  // RULE 6 — the FX position only exists for a dollar deal. See `isUsdDeal`:
  // High Seas qualifies from the moment the deal type is picked, not from the
  // moment the save comes back with the currency corrected.
  fxRate: isUsdDeal,
};

/** Is this field currently askable? */
export function isVisible(
  field: keyof QuotationDraft,
  draft: QuotationDraft,
  deal: DealFacts = NO_DEAL_FACTS,
): boolean {
  const rule = PART_A_VISIBILITY[field];
  return rule ? rule(draft, deal) : true;
}

/**
 * The three fields a hidden state answers "No" rather than "unanswered".
 *
 * 🔴 THE ONLY EXCEPTION IN THIS MODULE, and it is the client's instruction, not
 *    a convenience. Every other hidden boolean clears to `null` because an
 *    unanswered question and a question answered No are different facts — the
 *    header of `YesNoButtons` says so, and the RPCs read `coalesce(x,'no')`
 *    precisely so they never have to guess. Here Ritesh Bhai asked for a
 *    definite No: a Sublimation machine cannot take an air blade, so the deal
 *    should record that it has none rather than that nobody was asked.
 *
 * ⚠ ITS TWIN IS `case when coalesce(v_shows_extras, false) then … else false end`
 *   in fms_ocpi_write_oc — three of them. If this set and those three ever
 *   disagree, the value flips between null and false on alternate saves and the
 *   revision diff reports a change on every single save.
 */
const CLEARS_TO_FALSE = new Set<keyof QuotationDraft>([
  "airBlade",
  "inkDustExhauster",
  "chillingSystem",
]);

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
 * ⚠ THE DEAL FACTS DEFAULT TO THE *OPEN* SET, and that is deliberate — see
 *   `NO_DEAL_FACTS`. A caller that forgets to pass them therefore blanks
 *   nothing; the closed default would erase every dryer, centering and extras
 *   answer from any screen not yet updated. The server still clears correctly
 *   either way, because it always knows.
 *
 * ⚠ THE MACHINE'S FACTS USED TO BE A THIRD ARGUMENT and are gone (OCPI-14) —
 *   the category decides now, and it travels in `deal`.
 */
export function clearHidden(
  draft: QuotationDraft,
  deal: DealFacts = NO_DEAL_FACTS,
): QuotationDraft {
  const out = { ...draft };
  for (const key of Object.keys(PART_A_VISIBILITY) as (keyof QuotationDraft)[]) {
    if (!isVisible(key, draft, deal)) {
      const current = draft[key];
      // See CLEARS_TO_FALSE — three fields answer "No" when hidden; everything
      // else goes back to unanswered.
      (out[key] as unknown) = CLEARS_TO_FALSE.has(key)
        ? false
        : typeof current === "boolean" || current === null
          ? null
          : "";
    }
  }
  return out;
}
