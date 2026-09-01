import type { MachineOption, OcpiDeal, OcpiMachine } from "../types";

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
  /**
   * The portal user behind the name, blank when it was typed rather than picked.
   *
   * ⚠ ON THE DRAFT, NOT BESIDE IT. It has to travel through `payloadFromDraft`
   *   to reach `fms_ocpi_write_quotation`, and holding it in separate component
   *   state would be a second thing for `clearHidden` and the revision freeze to
   *   not know about.
   */
  salespersonUserId: string;

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
  /**
   * Direct / Sublimation / Other / POD — and THE BRANCH INPUT for the dryer
   * section, the centering inclusion, the three optional extras and the whole
   * Shipment & invoice card (OCPI-14).
   *
   * ⚠ THIS USED TO BE LOCAL STATE IN `QuotationForm`, and moving it here is the
   *   whole reason OCPI-14 is not a one-line change. It was a filter that
   *   narrowed the machine dropdown and was deliberately never stored. But
   *   `fms_ocpi_write_quotation` and `fms_ocpi_write_oc` null every column their
   *   branches hide, on every save, and they can only see the row — so a branch
   *   keyed on something the server cannot read means the server erases answers
   *   the form is still showing.
   *
   * ⚠ IT SNAPS TO THE CHOSEN MACHINE'S CATEGORY. `chooseMachine` sets it on
   *   every pick and the RPC coalesces onto the machine's own category, so the
   *   form and the server can never hold different answers. Clearing it still
   *   lists every machine, which is how a salesperson browses across types.
   */
  machineCategoryId: string;
  headType: string;
  headCount: string;
  inkType: string;
  inkPrice: string;
  inkCreditTerms: string;

  inclInk: boolean | null;
  inkQtyIncluded: string;
  /*
    OCPI-7 · the NO branch. Six keys, not eight: the two SUB-TOTALS are
    deliberately absent from the draft and from the payload. They are derived
    by fms_ocpi_write_quotation and live on OcpiDeal alone, so there is exactly
    one authoritative figure. The form shows a live preview computed from these
    two factors; the paper prints the stored column.
  */
  inkOfferAgreed: boolean | null;
  inkOfferQty: string;
  inkOfferRate: string;
  inclSpares: boolean | null;
  spareDetails: string;
  /**
   * OCPI-14 · the centering device becomes a deal inclusion in its own right.
   *
   * Shaped on SPARE PARTS, not on ink: a Yes/No and one free-text box for the
   * details and quantity, with No ending the conversation. There is no
   * subsidized-rate branch — the client asked for the spare-parts shape.
   *
   * ⚠ IT REPLACES the `externalCentering` tick that sat in "Also included".
   *   That tick read the MACHINE's capability and was one of four; the group is
   *   three now. `external_centering` on the deal is frozen history — the RPC
   *   stopped writing it, and the answers of 11 deals were copied into this
   *   field by the migration.
   */
  inclCentering: boolean | null;
  centeringDetails: string;
  inclHead: boolean | null;
  headsIncluded: string;
  headOfferAgreed: boolean | null;
  headOfferQty: string;
  headOfferRate: string;
  dryerType: string;

  dealValueCurrency: string;
  dealValueAmount: string;
  /**
   * ⚠ RETIRED, NOT REMOVED (OCPI-18). No input renders this any more, and no
   *   paper prints it. It stays in the draft — with its default, label,
   *   `draftFromDeal` and `payloadFromDraft` entries — so the 23 deals that
   *   recorded an answer round-trip it byte-identically through an edit instead
   *   of being silently cleared. Same shape as `otherCommitments` below.
   */
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
  /* ── Shipment & invoice ───────────────────────────────────────────────────
   * Four items can leave the factory on their own terms: the print head, the
   * dryer, the spare parts and the centering device. Each answers the SAME four
   * questions — how it ships, the route when it ships separately, whether it is
   * invoiced separately, and (only then) the quantity and the amount EXCLUDING
   * tax.
   *
   * ⚠ FLAT COLUMNS PER ITEM, NOT A CHILD TABLE. `payloadFromDraft`, the frozen
   *   `field_payload` and `revisionDiff` are all flat key/value, so a child
   *   table would simply vanish from the revision comparison — a reader would
   *   see "nothing changed" between two quotations that ship the head
   *   differently. The repetition is the price of the diff working.
   *
   * ⚠ EACH ITEM BRANCHES ON ITS OWN CONDITION, and they are not the same one:
   *   the head on "deal includes a head", ink on "deal includes ink", spares on
   *   "deal includes spare parts", the dryer on the MACHINE's needs_dryer flag,
   *   and the centering device on the machine's opt_external_centering
   *   capability. See branching.ts.
   *
   * ⚠ NO SUB-TOTAL LIVES HERE. Each row's sub-total is derived by
   *   fms_ocpi_write_oc from the qty and amount below and lives on `OcpiDeal`
   *   alone, so there is exactly one answer for one price. The form recomputes
   *   the same product live as a preview and never sends it up. */
  headShipMode: string;
  headShipVia: string;
  headSeparateInvoice: boolean | null;
  headInvoiceQty: string;
  headInvoiceAmount: string;

  /* ⚠ NOT `inkOfferQty` / `inkOfferRate` above — those are ink the deal does
   *   NOT include, offered at a subsidized rate. These are ink that IS included
   *   and billed on its own invoice. Mutually exclusive by construction. */
  inkShipMode: string;
  inkShipVia: string;
  inkSeparateInvoice: boolean | null;
  inkInvoiceQty: string;
  inkInvoiceAmount: string;

  dryerShipMode: string;
  dryerShipVia: string;
  dryerSeparateInvoice: boolean | null;
  dryerInvoiceQty: string;
  dryerInvoiceAmount: string;

  sparesShipMode: string;
  sparesShipVia: string;
  sparesSeparateInvoice: boolean | null;
  sparesInvoiceQty: string;
  sparesInvoiceAmount: string;

  centeringShipMode: string;
  centeringShipVia: string;
  centeringSeparateInvoice: boolean | null;
  centeringInvoiceQty: string;
  centeringInvoiceAmount: string;

  /* ── Dryer details ────────────────────────────────────────────────────────
   * `dryerType` sits up in part A and now means the dryer's CATEGORY (Indian /
   * Chinese); `dryerName` is the model inside that category, from the new
   * fms_ocpi_dryers master. Whether the section is asked at all is decided by
   * the MACHINE's `needs_dryer` flag — see branching.ts. */
  dryerName: string;
  /**
   * Is the dryer part of the deal?
   *
   * ⚠ A "No" USED TO REVEAL A DRYER PRICE, and OCPI-14 removed that box. All
   *   pricing is asked once, in Shipment & invoice, where the Dryer row already
   *   collects a quantity and an amount. `dryer_price` survives as a column and
   *   its derivation still stands in `fms_ocpi_write_oc`, but the form no longer
   *   sends the key, so the two rupee figures resolve to null and
   *   `grand_total_inr` collapses to `total_inr`. No deal on record carried a
   *   price and no machine template references the token, so nothing was lost.
   */
  dryerIncluded: boolean | null;
  dryerChambers: string;
  heatingMode: string;
  dryerWarranty: string;
  platterDetails: string;

  airBlade: boolean | null;
  externalCentering: boolean | null;
  inkDustExhauster: boolean | null;
  chillingSystem: boolean | null;
  otherInclusions: string;

  printerWarranty: string;
  headWarranty: string;
  postWarrantyHeadPrice: string;
  consumablesSupplier: string;
  insuranceClauseAgreed: boolean | null;

  refNo: string;
  /**
   * ⚠ RETIRED, NOT REMOVED (OCPI-18) — see `paymentType` above for the shape and
   *   the reason. `{{delivery_days}}` was rewritten out of all 21 SALE CONDITIONS
   *   sections in the same change, so nothing prints it; the 20 deals that
   *   answered it keep their answer.
   */
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

/**
 * Who consumables are bought from — SHOWN, NEVER TYPED (OCPI-19, 01-Sep-2026).
 *
 * It was a free-text box, and the only answer anybody ever gave was this company,
 * spelled two different ways on customers' contracts. So it stopped being a
 * question and became a statement.
 *
 * ⚠ IT LIVES HERE, NOT WITH THE OTHER STANDING CLAUSES, because `EMPTY_DRAFT`
 *   below reads it. A `const` declared further down the file cannot be read by an
 *   object literal evaluated at module load — it is a temporal-dead-zone error,
 *   not merely untidy. If this is ever moved, it must stay ABOVE `EMPTY_DRAFT`.
 *
 * ⚠ THE TEMPLATES SUPPLY THE "M/s " PREFIX, so this constant must not carry one.
 *   The 12 machine sections using `{{consumables_supplier}}` read
 *   "Consumable items: To be purchased directly from M/s {{…}}." — a prefix here
 *   would print "M/s M/s Orange O Tec Pvt Ltd".
 *
 * 🔴 IT DELIBERATELY DIFFERS FROM `fms_ocpi_company_profiles.legal_name`, which is
 *    "M/s ORANGE O TEC PVT LTD." and prints as the seller on the same page. Ritesh
 *    Bhai was shown both spellings and picked this one. **DO NOT "harmonise" them**
 *    — the divergence is the decision, not an oversight.
 *
 * ⚠ IT IS A CONSTANT, NOT A LOOKUP on the deal's selling entity. Settled:
 *   consumables always come from Orange O Tec, whichever entity sells the machine.
 */
export const CONSUMABLES_SUPPLIER = "Orange O Tec Pvt Ltd";

export const EMPTY_DRAFT: QuotationDraft = {
  salespersonName: "",
  salespersonUserId: "",
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
  machineCategoryId: "",
  headType: "",
  headCount: "",
  inkType: "",
  inkPrice: "",
  inkCreditTerms: "",
  inclInk: null,
  inkQtyIncluded: "",
  inkOfferAgreed: null,
  inkOfferQty: "",
  inkOfferRate: "",
  inclSpares: null,
  spareDetails: "",
  inclCentering: null,
  centeringDetails: "",
  inclHead: null,
  headsIncluded: "",
  headOfferAgreed: null,
  headOfferQty: "",
  headOfferRate: "",
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
  headInvoiceQty: "",
  headInvoiceAmount: "",
  inkShipMode: "",
  inkShipVia: "",
  inkSeparateInvoice: null,
  inkInvoiceQty: "",
  inkInvoiceAmount: "",
  dryerShipMode: "",
  dryerShipVia: "",
  dryerSeparateInvoice: null,
  dryerInvoiceQty: "",
  dryerInvoiceAmount: "",
  sparesShipMode: "",
  sparesShipVia: "",
  sparesSeparateInvoice: null,
  sparesInvoiceQty: "",
  sparesInvoiceAmount: "",
  centeringShipMode: "",
  centeringShipVia: "",
  centeringSeparateInvoice: null,
  centeringInvoiceQty: "",
  centeringInvoiceAmount: "",
  dryerName: "",
  dryerIncluded: null,
  dryerChambers: "",
  heatingMode: "",
  dryerWarranty: "",
  platterDetails: "",
  airBlade: null,
  externalCentering: null,
  inkDustExhauster: null,
  chillingSystem: null,
  otherInclusions: "",
  printerWarranty: "",
  headWarranty: "",
  postWarrantyHeadPrice: "",
  // ⚠ NOT "" — the field is read-only now, so nobody can fill it in. A blank here
  //   would store NULL and print a ruled blank into the consumables clause of the
  //   12 templates that carry `{{consumables_supplier}}` (OCPI-19).
  consumablesSupplier: CONSUMABLES_SUPPLIER,
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

/*
  ⚠ `PAYMENT_TYPES` IS RETIRED (OCPI-18, 01-Sep-2026) — Any Advance / On Credit.
    The client asked for the question to go: "Terms of payment" below it is a
    free-text box that carries the real answer ("30% advance and rest PDC
    cheque"), and a two-button summary of it added nothing the paper did not
    already say better.

    It is deleted rather than left standing because nothing rendered it any more,
    and a vocabulary with no control behind it is exactly the orphan the FIX-4
    rule in CLAUDE.md is about. What stays:

      · the `payment_type` COLUMN, and the `paymentType` draft field, default,
        label and payload entry — additive-only, so the 23 deals that recorded an
        answer keep it and still round-trip it through an edit;
      · the `PaymentType` type in types/index.ts, which `OcpiDeal` still reads.

    What went with it: the ChoiceButtons block in Commercial terms, the
    "Term of Payment" row on the summary sheet, the `missingForSubmit` entry, and
    the `payment_type is not null` conjunct of fms_ocpi_complete_when_submitted.
    Removing the form field without the last of those would have left the
    database demanding an answer the form had stopped asking for, and nothing
    could have been submitted.
*/

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

/**
 * Is this a dollar deal?
 *
 * ⚠ HIGH SEAS COUNTS EVEN BEFORE THE CURRENCY SAYS SO, and that is the whole
 *   point of this predicate. `fms_ocpi_write_quotation` forces
 *   `deal_value_currency = 'USD'` on a high-seas deal — but only ON SAVE. Every
 *   caller here used to test the currency alone, so between choosing High Seas
 *   and saving, the draft still read "INR": the currency box sat greyed out
 *   showing rupees underneath a note promising dollars, and the FX block never
 *   rendered. That left NO WAY TO ENTER A RATE on the one deal type that is
 *   always in dollars. The deal then saved as USD with a null rate, which nulls
 *   `deal_value_inr`, which nulls `machine_value_inr`, `gst_amount_inr` and
 *   `total_inr` in fms_ocpi_write_oc — and BOTH PAPERS PRINTED A BLANK TOTAL.
 *
 *   Mirrors the SQL's own `case when v_transport = 'high_seas' then 'USD'`.
 *   The two must agree: change one and change the other.
 */
export const isUsdDeal = (d: QuotationDraft): boolean =>
  d.dealValueCurrency === "USD" || d.transportTerms === "high_seas";

/**
 * Everything a branch rule needs that is NOT on the draft.
 *
 * ⚠ THE MACHINE STOPPED DECIDING THIS (OCPI-14). Until then there were two
 *   records here — a `MachineFacts` holding `needs_dryer` and the four `opt_*`
 *   capability columns, and this one. The client's rule is now that the machine
 *   CATEGORY decides: Direct carries a dryer, a centering device and the three
 *   optional extras; Sublimation, Other and POD carry none of them. So the
 *   machine record had nothing left to decide and was deleted rather than left
 *   as a parameter every caller still had to pass.
 *
 *   `fms_ocpi_machines.needs_dryer` and `.opt_external_centering` still exist and
 *   are still edited on the Machines master — they record what a model can take.
 *   They are INFORMATION ONLY; nothing branches on them, in this file or in SQL.
 *
 * ⚠ ITS TWIN IS THE `select … c.shows_dryer, c.shows_centering, c.shows_extras`
 *   IN `fms_ocpi_write_oc`, which nulls what it hides on every save. If the two
 *   ever disagree the server erases answers the form is still showing, with no
 *   error and nothing in a log. Change one, change both.
 */
export interface DealFacts {
  /** The chosen dryer category means "this deal carries no dryer". */
  noDryerCategory: boolean;
  /** The Dryer details card, and the Dryer row in Shipment & invoice. */
  showsDryer: boolean;
  /** The Centering device inclusion, and its Shipment & invoice row. */
  showsCentering: boolean;
  /** Air blade · ink dust exhauster · chilling system. */
  showsExtras: boolean;
}

/**
 * No category chosen, or one nobody recognises.
 *
 * ⚠ THE SAFE DEFAULT IS THE *OPEN* ONE — every flag true, and `noDryerCategory`
 *   false. A caller that forgets to pass these therefore HIDES NOTHING and, more
 *   importantly, CLEARS nothing: `clearHidden` iterates this map and would
 *   otherwise erase every dryer, centering and extras answer from any screen not
 *   yet updated. The server always knows the real answer and still clears
 *   correctly, so an open default costs nothing and a closed one silently eats
 *   data.
 */
export const NO_DEAL_FACTS: DealFacts = {
  noDryerCategory: false,
  showsDryer: true,
  showsCentering: true,
  showsExtras: true,
};

/**
 * Resolve the deal's dryer category name, and its machine category, back to
 * their master rows.
 *
 * ⚠ THE DRYER CATEGORY SEARCHES INACTIVE ROWS TOO, and that is load-bearing.
 *   Deactivating the "no dryer" category must not flip deals already sitting on
 *   it back to "a real category" — the form would un-hide five fields the server
 *   has already nulled, and the two engines would be showing different answers.
 *
 * ⚠ A DRYER-CATEGORY NAME NOBODY RECOGNISES IS A REAL CATEGORY. That is the
 *   steady state of the form's "+ Other" path between a request and its
 *   approval, and `fms_ocpi_write_oc`'s left join resolves it to null and
 *   coalesces the same way.
 *
 * ⚠ A MACHINE CATEGORY NOBODY RECOGNISES ASKS NOTHING EXTRA — the opposite
 *   default, and it matches `coalesce(c.shows_dryer, false)` in the SQL. The two
 *   differ because they answer different questions: an unknown dryer category is
 *   a category the master has not caught up with yet, while an unknown machine
 *   category is no category at all.
 */
export function dealFacts(
  dryerTypes: { name: string; meansNoDryer: boolean }[],
  dryerType: string,
  categories: { id: string; showsDryer: boolean | null; showsCentering: boolean | null; showsExtras: boolean | null }[],
  machineCategoryId: string,
): DealFacts {
  const name = dryerType.trim();
  const cat = machineCategoryId ? categories.find((c) => c.id === machineCategoryId) : undefined;
  return {
    noDryerCategory: !!name && dryerTypes.some((t) => t.name === name && t.meansNoDryer),
    showsDryer: cat?.showsDryer === true,
    showsCentering: cat?.showsCentering === true,
    showsExtras: cat?.showsExtras === true,
  };
}

/**
 * Can the machine carry this extra at all?
 *
 * `"optional"` and `"yes"` both mean ASK — "yes" is standard equipment, and the
 * deal still has to record that it is included. `"no"` and an unmapped machine
 * mean the question never appears.
 */
export const canCarry = (o: MachineOption | null): boolean => o === "optional" || o === "yes";

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

/**
 * ⚠ "NOT APPLICABLE" WAS REMOVED (OCPI-17, 01-Sep-2026) AND MUST NOT COME BACK.
 *   The strip is `clearable`, so the ✕ already meant "no answer" — which is all
 *   "Not Applicable" ever stood for. Three buttons for two answers plus a clear.
 *
 * ⚠ A DEAL QUOTED WITH IT STILL HOLDS IT. `platter_details` is free text with no
 *   CHECK constraint, and nothing rewrites the stored value. `QuotationForm`
 *   feeds this list through `optsWithCurrent`, so such a deal opens with its own
 *   answer offered as a third button rather than looking unanswered.
 */
export const PLATTER_OPTIONS = ["With Platter", "Without Platter"] as const;

/*
  ⚠ WARRANTY_MONTHS AND PRINTER_WARRANTY ARE GONE (OCPI-3, stage D), and are
    recorded here rather than silently deleted because their SHAPE was the bug.

    They were the option lists behind two dropdowns on the quotation. The
    template clauses read "will be of {{machine_warranty_months}} months from the
    date of installation" and "a Print Head Warranty of {{head_warranty_months}}
    months", so a real contract printed:

      "will be of 24 months warranty → maximum 25 months from the invoice date
       months from the date of installation"        (from PRINTER_WARRANTY)
      "of 24 Months months starting from …"          (from WARRANTY_MONTHS)

    Warranty is now a fixed company setting — machine 12 months, head 18 — read
    by lib/tokens.ts as a bare number, which is what the sentences expect. There
    is no dryer or spare-parts warranty at all. Do not reintroduce a list of
    prose warranty options: whatever fills these tokens must be a NUMBER.
*/

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

/**
 * The standing note that bounds a subsidized rate to the quantity it was agreed
 * for (OCPI-7, 31-Aug-2026).
 *
 * ⚠ A RATE WITHOUT A QUANTITY IS AN OPEN-ENDED COMMITMENT. "Ink at ₹900 a litre"
 *   on a signed quotation, with nothing limiting it, is a price the customer can
 *   hold the company to for any quantity and for as long as they like. The rate
 *   is agreed against a specific quantity at the table; this says so on the paper.
 *
 * ⚠ IT NAMES THE QUANTITY, which is why the printed line carries the figure even
 *   though the client asked for "the final price only". A note reading "valid for
 *   the stated quantity" is empty if the quantity is nowhere on the page — it
 *   would bound the rate by something the customer cannot see.
 */
export const SUBSIDIZED_RATE_NOTE =
  "This is a subsidized rate, agreed for the quantity stated above and valid for that " +
  "quantity only. Any further quantity will be charged at the rate prevailing at the time " +
  "of that order.";

/** The standing insurance clause, printed verbatim and confirmed by the salesperson. */
export const INSURANCE_CLAUSE =
  "Insurance coverage up to the point of loading will be the responsibility of the company, " +
  "while any coverage required during unloading will be the responsibility of the customer.";

/*
  The consumables supplier is a standing answer too, but it is declared UP BESIDE
  `EMPTY_DRAFT` rather than here — see `CONSUMABLES_SUPPLIER`. It is a default on a
  new draft, and a const cannot be read before the line that initialises it.
*/

/**
 * The house wording for the terms of payment (OCPI-20, 01-Sep-2026).
 *
 * ⚠ ONE CONSTANT FOR THREE USES — the placeholder, the persistent hint under the
 *   box, and the "Use this format" button. They were allowed to drift once
 *   already: the old placeholder read "25% advance, 75% before delivery", which
 *   is not the wording anybody actually uses, so the box was teaching a format
 *   nobody follows.
 *
 * ⚠ THE FIELD STAYS FREE TEXT. This is guidance, never a constraint — a
 *   negotiated deal must still be able to say something else. `payment_terms`
 *   remains one free-text column feeding `{{payment_terms}}` on ~21 templates.
 */
export const PAYMENT_TERMS_FORMAT =
  "25% advance with the order, 75% against the shipping documents.";

/**
 * The condition the machine delivery date is given under (OCPI-18, 01-Sep-2026).
 *
 * 🔴 THIS SENTENCE PRINTS ON A SIGNED CONTRACT. It is shown under the date on the
 *    form, printed under the date on the summary sheet, and written into the SALE
 *    CONDITIONS OF THE SUPPLY clause of all 21 machine decks that have one. The
 *    form and the contract must state the delivery condition in the SAME WORDS —
 *    a customer reading two slightly different sentences about when a date starts
 *    running has two different answers to which one governs.
 *
 * ⚠ THERE IS A THIRD COPY, IN SQL, AND THERE HAS TO BE. The 21 template bodies
 *   hold the sentence as literal text — a migration cannot import a TypeScript
 *   const. It was written by
 *   `supabase/migrations/20261102120000_fms_ocpi_delivery_date_on_the_contract.sql`,
 *   whose post-flight assertion counts 21 bodies carrying this exact string.
 *   Changing the wording here means a new migration rewriting those 21 bodies;
 *   changing only one of the two is how the form and the paper drift apart.
 */
export const DELIVERY_DATE_REMARK = "Applicable from the date of signing of this contract.";

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
  // Never rendered: `revisionDiff` skips this key with the other identity
  // columns, because a uuid changing tells a reader nothing. The entry exists
  // because the type demands one for every draft field — which is the point of
  // typing it that way.
  salespersonUserId: "Salesperson (user)",
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
  machineCategoryId: "Machine category",
  headType: "Type of head",
  headCount: "No. of print heads required",
  inkType: "Type of ink",
  inkPrice: "Ink selling price",
  inkCreditTerms: "Ink credit terms (future)",
  inclInk: "Deal includes ink",
  // ⚠ NO UNIT ON THIS ONE, and that is deliberate rather than an omission.
  //   `inkOfferQty` three lines down IS in litres — the client fixed that — and
  //   the two measure the same substance, so the temptation is to label both.
  //   But this field is FREE TEXT and the data disagrees: of the 17 deals on
  //   record, 15 say litres and two say "25 Kgs" and "3000kg". A label reading
  //   "(litres)" is also the revision diff's heading, so it would restate two
  //   real deals in a unit they never agreed. The form's hint asks for the unit
  //   instead of asserting one.
  inkQtyIncluded: "Quantity of ink included",
  // OCPI-7 · the NO branch. Positioned here, not appended at the end, because
  // this object's KEY ORDER is the revision diff's sort order (revisionDiff.ts)
  // — a reader scanning a diff and a reader scanning the form travel the same
  // path. Each label names its ITEM as well as its question, the convention the
  // Shipment & invoice labels below set.
  inkOfferAgreed: "Ink — offered at a subsidized rate",
  inkOfferQty: "Ink — subsidized quantity (litres)",
  inkOfferRate: "Ink — subsidized rate (₹ per litre)",
  inclSpares: "Deal includes spare parts",
  spareDetails: "Spare part details and quantity",
  inclCentering: "Deal includes centering device",
  centeringDetails: "Centering device details and quantity",
  inclHead: "Deal includes head",
  headsIncluded: "No. of heads included",
  headOfferAgreed: "Head — offered at a subsidized rate",
  headOfferQty: "Head — subsidized quantity (nos.)",
  headOfferRate: "Head — subsidized rate (₹ per head)",
  dryerType: "Dryer category",
  dealValueCurrency: "Currency",
  dealValueAmount: "Total deal value (excl. GST)",
  paymentType: "Type of payment",
  paymentTerms: "Terms of payment",
  deliveryDate: "Tentative machine delivery date",
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

  // ── Shipment & invoice ──────────────────────────────────────────────────
  // ⚠ THESE LABELS ARE ALSO THE REVISION DIFF'S HEADINGS AND ITS ORDER
  //   (revisionDiff.ts derives both from this object by camel→snake), so each
  //   one names its ITEM as well as its question. "Sent via" alone, repeated
  //   four times, would tell a reader comparing two quotations nothing.
  headShipMode: "Head — how it ships",
  headShipVia: "Head — separate shipment sent via",
  headSeparateInvoice: "Head — separate invoice",
  headInvoiceQty: "Head — invoice quantity",
  headInvoiceAmount: "Head — invoice amount (excl. tax)",

  /* ⚠ "INVOICE", NOT "SUBSIDIZED". `inkOfferQty` / `inkOfferRate` above read
   *   "Ink — subsidized quantity / rate" and mean the opposite: ink the deal
   *   does NOT include. These two are the included ink's own invoice. The
   *   wording is the only thing separating them in an error message, since a
   *   missing-fields list gives no other context. */
  inkShipMode: "Ink — how it ships",
  inkShipVia: "Ink — separate shipment sent via",
  inkSeparateInvoice: "Ink — separate invoice",
  inkInvoiceQty: "Ink — invoice quantity",
  inkInvoiceAmount: "Ink — invoice amount (excl. tax)",

  dryerShipMode: "Dryer — how it ships",
  dryerShipVia: "Dryer — separate shipment sent via",
  dryerSeparateInvoice: "Dryer — separate invoice",
  dryerInvoiceQty: "Dryer — invoice quantity",
  dryerInvoiceAmount: "Dryer — invoice amount (excl. tax)",

  sparesShipMode: "Spare parts — how they ship",
  sparesShipVia: "Spare parts — separate shipment sent via",
  sparesSeparateInvoice: "Spare parts — separate invoice",
  sparesInvoiceQty: "Spare parts — invoice quantity",
  sparesInvoiceAmount: "Spare parts — invoice amount (excl. tax)",

  centeringShipMode: "Centering device — how it ships",
  centeringShipVia: "Centering device — separate shipment sent via",
  centeringSeparateInvoice: "Centering device — separate invoice",
  centeringInvoiceQty: "Centering device — invoice quantity",
  centeringInvoiceAmount: "Centering device — invoice amount (excl. tax)",

  dryerName: "Dryer",
  dryerIncluded: "Dryer included in the deal",
  dryerChambers: "How many chambers with the dryer",
  heatingMode: "Heating medium",
  dryerWarranty: "Dryer warranty period",
  platterDetails: "Platter",
  airBlade: "Air blade",
  externalCentering: "External centering system",
  inkDustExhauster: "Ink dust exhauster",
  chillingSystem: "Chilling system",
  // Section B's eighth pointer (OCPI-10). Positioned with the four extras
  // rather than appended, because THIS OBJECT'S KEY ORDER IS THE REVISION
  // DIFF'S SORT ORDER (revisionDiff.ts) - a reader scanning a diff and a
  // reader scanning the form travel the same path.
  otherInclusions: "Other inclusions",
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
    salespersonUserId: s(d.salespersonUserId),
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
    machineCategoryId: s(d.machineCategoryId),
    headType: s(d.headType),
    headCount: s(d.headCount),
    inkType: s(d.inkType),
    inkPrice: s(d.inkPrice),
    inkCreditTerms: s(d.inkCreditTerms),
    inclInk: d.inclInk,
    inkQtyIncluded: s(d.inkQtyIncluded),
    inkOfferAgreed: d.inkOfferAgreed,
    inkOfferQty: s(d.inkOfferQty),
    inkOfferRate: s(d.inkOfferRate),
    inclSpares: d.inclSpares,
    spareDetails: s(d.spareDetails),
    inclCentering: d.inclCentering,
    centeringDetails: s(d.centeringDetails),
    inclHead: d.inclHead,
    headsIncluded: s(d.headsIncluded),
    headOfferAgreed: d.headOfferAgreed,
    headOfferQty: s(d.headOfferQty),
    headOfferRate: s(d.headOfferRate),
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
    headInvoiceQty: s(d.headInvoiceQty),
    headInvoiceAmount: s(d.headInvoiceAmount),
    inkShipMode: s(d.inkShipMode),
    inkShipVia: s(d.inkShipVia),
    inkSeparateInvoice: d.inkSeparateInvoice,
    inkInvoiceQty: s(d.inkInvoiceQty),
    inkInvoiceAmount: s(d.inkInvoiceAmount),
    dryerShipMode: s(d.dryerShipMode),
    dryerShipVia: s(d.dryerShipVia),
    dryerSeparateInvoice: d.dryerSeparateInvoice,
    dryerInvoiceQty: s(d.dryerInvoiceQty),
    dryerInvoiceAmount: s(d.dryerInvoiceAmount),
    sparesShipMode: s(d.sparesShipMode),
    sparesShipVia: s(d.sparesShipVia),
    sparesSeparateInvoice: d.sparesSeparateInvoice,
    sparesInvoiceQty: s(d.sparesInvoiceQty),
    sparesInvoiceAmount: s(d.sparesInvoiceAmount),
    centeringShipMode: s(d.centeringShipMode),
    centeringShipVia: s(d.centeringShipVia),
    centeringSeparateInvoice: d.centeringSeparateInvoice,
    centeringInvoiceQty: s(d.centeringInvoiceQty),
    centeringInvoiceAmount: s(d.centeringInvoiceAmount),
    dryerName: s(d.dryerName),
    dryerIncluded: d.dryerIncluded,
    dryerChambers: s(d.dryerChambers),
    heatingMode: s(d.heatingMode),
    dryerWarranty: s(d.dryerWarranty),
    platterDetails: s(d.platterDetails),
    airBlade: d.airBlade,
    externalCentering: d.externalCentering,
    inkDustExhauster: d.inkDustExhauster,
    chillingSystem: d.chillingSystem,
    otherInclusions: s(d.otherInclusions),
    printerWarranty: s(d.printerWarranty),
    headWarranty: s(d.headWarranty),
    postWarrantyHeadPrice: s(d.postWarrantyHeadPrice),
    /*
      ⚠ A DEAL RAISED BEFORE OCPI-19 STORED NOTHING HERE, and the field is now a
        read-out nobody can type into. Without this fallback the form would SHOW
        the company name while saving back NULL, and the contract would print
        "M/s " followed by a ruled blank — a field that displays one thing and
        stores another. A deal that already recorded wording keeps its own,
        because `s()` returns it and it is truthy.
    */
    consumablesSupplier: s(d.consumablesSupplier) || CONSUMABLES_SUPPLIER,
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
    salesperson_user_id: d.salespersonUserId,
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
    machine_category_id: d.machineCategoryId,
    head_type: d.headType,
    head_count: d.headCount,
    ink_type: d.inkType,
    ink_price: d.inkPrice,
    ink_credit_terms: d.inkCreditTerms,
    incl_ink: d.inclInk,
    ink_qty_included: d.inkQtyIncluded,
    /*
      ⚠ THE PART-A TWIN OF THE SNIFF-ARRAY TRAP, and it is the worse of the two.
        A part-B key missing from fms_ocpi_save_draft's key array is silently
        never written and the old value survives. A part-A key missing from
        HERE is BLANKED ON EVERY SAVE: the payload lookup returns null, the
        writer's `case` stores null, and an agreed rate erases itself with no
        error and nothing in a log.

      ⚠ SIX KEYS, NOT EIGHT. The two sub-totals are derived by
        fms_ocpi_write_quotation and are deliberately not sent — sending them
        would let the browser dictate a figure that contradicts its own two
        factors, which is what `withGst` was deleted for.
    */
    ink_offer_agreed: d.inkOfferAgreed,
    ink_offer_qty: d.inkOfferQty,
    ink_offer_rate: d.inkOfferRate,
    incl_spares: d.inclSpares,
    spare_details: d.spareDetails,
    incl_centering: d.inclCentering,
    centering_details: d.centeringDetails,
    incl_head: d.inclHead,
    heads_included: d.headsIncluded,
    head_offer_agreed: d.headOfferAgreed,
    head_offer_qty: d.headOfferQty,
    head_offer_rate: d.headOfferRate,
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
    head_invoice_qty: d.headInvoiceQty,
    head_invoice_amount: d.headInvoiceAmount,
    // ⚠ THESE FIVE KEY NAMES ARE ALSO IN fms_ocpi_save_draft's part-B array.
    //   That array is what decides whether write_oc runs at all; a key missing
    //   from it is never written and says nothing about it.
    ink_ship_mode: d.inkShipMode,
    ink_ship_via: d.inkShipVia,
    ink_separate_invoice: d.inkSeparateInvoice,
    ink_invoice_qty: d.inkInvoiceQty,
    ink_invoice_amount: d.inkInvoiceAmount,
    dryer_ship_mode: d.dryerShipMode,
    dryer_ship_via: d.dryerShipVia,
    dryer_separate_invoice: d.dryerSeparateInvoice,
    dryer_invoice_qty: d.dryerInvoiceQty,
    dryer_invoice_amount: d.dryerInvoiceAmount,
    spares_ship_mode: d.sparesShipMode,
    spares_ship_via: d.sparesShipVia,
    spares_separate_invoice: d.sparesSeparateInvoice,
    spares_invoice_qty: d.sparesInvoiceQty,
    spares_invoice_amount: d.sparesInvoiceAmount,
    centering_ship_mode: d.centeringShipMode,
    centering_ship_via: d.centeringShipVia,
    centering_separate_invoice: d.centeringSeparateInvoice,
    centering_invoice_qty: d.centeringInvoiceQty,
    centering_invoice_amount: d.centeringInvoiceAmount,
    dryer_name: d.dryerName,
    dryer_included: d.dryerIncluded,
    dryer_chambers: d.dryerChambers,
    heating_mode: d.heatingMode,
    dryer_warranty: d.dryerWarranty,
    platter_details: d.platterDetails,
    air_blade: d.airBlade,
    external_centering: d.externalCentering,
    ink_dust_exhauster: d.inkDustExhauster,
    chilling_system: d.chillingSystem,
    other_inclusions: d.otherInclusions,
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

/*
  ⚠ `withGst` IS GONE (OCPI-3, stage E), and it is recorded here rather than
    silently deleted because of what it was about to cost.

    It recomputed the GST amount and the total in the browser from
    `machine_value_inr × gst_rate`. NOTHING CALLED IT — checked across all of
    src — and nothing should have: those three figures are DERIVED SERVER-SIDE
    in fms_ocpi_write_oc, which alone knows that a High Seas deal attracts no
    GST at all and that a USD deal is valued at amount × fx_rate rather than at
    the amount itself. This function knew neither, so wiring it up would have
    produced a SECOND, different answer for one price — on a contract.

    `noUnusedLocals` is false in this project and there is no test runner, so an
    exported function nobody calls fails nothing and still reads as live code.
    If the browser ever needs the total, read it back off the row after the
    save — useQuotationDraft.generate already does exactly that, and its comment
    says why.
*/

/*
  ⚠ `missingForSubmit` AND `missingForDetailSheet` NOW LIVE IN lib/completeness.ts
    (OCPI-15). Recorded here rather than silently deleted, because both are named
    by comments all over this module and by the two RPCs they mirror.

    THE MOVE WAS FORCED, NOT TIDY-MINDED. OCPI-15 splits completeness into two
    tiers — what blocks GENERATE and what blocks SEND FOR APPROVAL — and drives
    the form's own required markers from the same table, so a marker and a
    blocker cannot disagree. To do that the table has to ask `isVisible` whether
    a field is on the salesperson's screen at all, and `branching.ts` already
    imports `isUsdDeal` FROM this file. Keeping them here would have made
    fieldSpec → branching → fieldSpec a cycle.

    `missingForDetailSheet` went with it because the two are a pair whose
    comments explain each other: one blocks and the other only warns, and reading
    either without the other loses the reason for both.

    Both keep their names and their signatures. `missingForSubmit` now returns
    `{ key, label }` instead of prose sentences — the key is what lets the panel
    scroll to the field and focus it, which is the whole of what OCPI-15 asked
    for.
*/
