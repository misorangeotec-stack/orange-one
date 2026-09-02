import { FIELD_LABEL, NO_DEAL_FACTS, type DealFacts, type QuotationDraft } from "./fieldSpec";
import { isVisible } from "./branching";

/**
 * What is still needed on a quotation, and WHEN it is needed.
 *
 * ⚠ THIS FILE EXISTS BECAUSE OF AN IMPORT CYCLE, and that is worth stating so
 *   nobody helpfully folds it back. The rule table below has to ask `isVisible`
 *   — see the note on `isAsked` — and `branching.ts` already imports `isUsdDeal`
 *   FROM `fieldSpec.ts`. Putting these functions in `fieldSpec.ts`, where they
 *   used to live, would make fieldSpec → branching → fieldSpec a cycle.
 *
 * ── THE TWO TIERS (OCPI-15) ────────────────────────────────────────────────
 *
 * A salesperson must be able to work on a quotation without being blocked by
 * questions they cannot answer yet. So completeness is enforced twice, at two
 * different strengths:
 *
 *   `missingForGenerate` — BLOCKS. Seven answers, and the reason each one is
 *     here is that the customer-facing PDF is unusable without it: a document
 *     addressed to nobody, for no machine, at no price is not a draft of
 *     anything.
 *
 *   `missingForSubmit`   — BLOCKS AT SEND FOR APPROVAL. Every requirement,
 *     including the seven above. An approver cannot sign off an incomplete
 *     deal, but a salesperson mid-negotiation can still put a paper in front of
 *     a customer.
 *
 *   `missingForDetailSheet` — WARNS, NEVER BLOCKS. Unchanged in substance; see
 *     its own note.
 *
 * ⚠ THE PRICE IS IN THE GENERATE TIER AND THAT WAS A LATE REVERSAL. OCPI-15 was
 *   specified with customer name and machine as the only blocks, deliberately
 *   accepting that a PDF could reach a customer with no price on it. The client
 *   overruled it while it was being planned — "a quotation cannot be generated
 *   without the pricing, otherwise we already have the save draft option" — so
 *   the currency, the total and the dollar rate came back. Save draft remains
 *   the free path and enforces nothing at all.
 *
 * ⚠ THE USD RATE IS PART OF "THE PRICE". Without it the RUPEE total is derived
 *   as null server-side and prints blank on both papers, which is the same
 *   fault as a blank price with one indirection in front of it.
 */

/**
 * One thing still to be answered.
 *
 * ⚠ THE KEY IS THE POINT. This used to be a bare sentence — "the total deal
 *   value" — which named a field the reader then had to hunt for on a form this
 *   long. The key is what lets the screen scroll to the box and focus it, and
 *   it is what drives the asterisks, so a required marker and a blocker are
 *   incapable of disagreeing.
 */
export interface MissingField {
  key: keyof QuotationDraft;
  label: string;
}

type Tier = "generate" | "approval";

interface Requirement {
  key: keyof QuotationDraft;
  tier: Tier;
  /**
   * Only where the form's own label differs from `FIELD_LABEL`. The list is
   * there to be clicked, so it must read as the caption above the box it jumps
   * to, not as the module's canonical name for the column.
   */
  label?: string;
  /**
   * An extra condition `isVisible` cannot evaluate, because it depends on
   * something outside the draft. Exactly one rule needs it today.
   */
  extra?: (d: QuotationDraft, deal: DealFacts, headOptions: number) => boolean;
}

/**
 * Every answer a finished quotation carries, in the order the form asks them.
 *
 * ⚠ ORDER IS THE READING ORDER OF THE FORM, so somebody working down the panel
 *   works down the page rather than jumping about it. It is NOT `FIELD_LABEL`'s
 *   order, which belongs to the revision diff and must not be disturbed.
 */
const REQUIREMENTS: readonly Requirement[] = [
  // ── Blocks Generate ──────────────────────────────────────────────────────
  { key: "customerName", tier: "generate" },
  { key: "salespersonName", tier: "generate" },

  /*
    OCPI-27 · THE ASTERISK IS THE POINT, AND THIS RULE WILL ALMOST NEVER FIRE.

    🟢 Choosing a machine already sets the category — `chooseMachine` snaps it
       (OCPI-14) — and every existing deal was back-filled, so a deal that has a
       machine always has a category and a deal with no machine is already
       blocked on `machineId` below. Only 2 deals on record carry no category,
       and both are blocked on the machine anyway.

    That is not a reason to leave it out. What Ritesh Bhai asked for is the
    SCREEN SAYING THIS FIELD MATTERS, plus a guard against a future path that
    sets a machine without a category. ⚠ DO NOT delete it later on the grounds
    that it never catches anything — never firing is the expected behaviour, and
    this note is here so that is not mistaken for dead code.
  */
  { key: "machineCategoryId", tier: "approval" },
  { key: "machineId", tier: "generate" },
  { key: "machineCount", tier: "generate" },

  /*
    OCPI-27 · It prints on the CUSTOMER's summary sheet — "No. of Print Heads
    Required" (`quotationPdf.ts`) — as an empty string when it is null, so a
    blank is a hole in a document rather than an unasked question.

    ⚠ APPROVAL, NOT GENERATE. OCPI-15 settled that only the barest identity and
      the price block Generate, so a specification can still go out
      mid-negotiation before this is settled.

    ⚠ ZERO IS A LEGAL ANSWER. 5 machines have no head type mapped at all — the
      three Pengda models, Label Printer and Book Printer — and the box takes
      digits, so a machine that genuinely carries none is answered with 0 rather
      than left blank. `isAnswered` reads "0" as answered; the column's own CHECK
      allows `>= 0`.
  */
  { key: "headCount", tier: "approval" },

  /*
    OCPI-14 · ONLY A CHOICE CAN BE MISSING. A model with ONE mapped head fills
    `headType` in itself and a model with NONE — the three Pengda and both POD
    printers — legitimately has no head at all. Only the seven models whose
    sheet says "EX600 or RC" can leave this unanswered, and on those a blank
    would print a contract that does not say which head the customer is getting.

    ⚠ THIS IS THE ONE RULE `isVisible` CANNOT ANSWER: the head count is a fact
      about the MACHINE MASTER, not about the draft, so it arrives as an
      argument. `headOptions` defaults to 0, so a caller that does not know asks
      for nothing.
  */
  {
    key: "headType",
    tier: "approval",
    // The form captions this "Print head" when it offers a choice, which is
    // exactly when it is required. `FIELD_LABEL` says "Type of head".
    label: "Print head",
    extra: (_d, _deal, headOptions) => headOptions > 1,
  },

  // ── Section B · Deal inclusions ──────────────────────────────────────────
  { key: "inclInk", tier: "approval" },
  { key: "inkQtyIncluded", tier: "approval" },
  { key: "inclSpares", tier: "approval" },
  { key: "spareDetails", tier: "approval" },
  { key: "inclCentering", tier: "approval" },
  { key: "centeringDetails", tier: "approval" },
  { key: "inclHead", tier: "approval" },
  { key: "headsIncluded", tier: "approval" },

  /*
    OCPI-7 · the NO branch. Answering the rate question at all is OPTIONAL —
    silence means it was never discussed — but a Yes must carry its numbers, or
    the quotation prints a promise with no figure beside it.

    The chain `inclX === false && xOfferAgreed === true` is not repeated here:
    `PART_A_VISIBILITY` already states it, and these four inherit it.
  */
  { key: "inkOfferQty", tier: "approval" },
  { key: "inkOfferRate", tier: "approval" },
  { key: "headOfferQty", tier: "approval" },
  { key: "headOfferRate", tier: "approval" },

  // ── Section C · Commercial terms ─────────────────────────────────────────
  { key: "transportTerms", tier: "approval" },
  { key: "highSeasVia", tier: "approval" },
  { key: "highSeasCostBy", tier: "approval" },
  { key: "localCostBy", tier: "approval" },

  { key: "dealValueCurrency", tier: "generate" },
  { key: "dealValueAmount", tier: "generate" },
  { key: "fxRate", tier: "generate" },

  { key: "paymentTerms", tier: "approval" },
  { key: "deliveryDate", tier: "approval" },
];

/**
 * Is this question on the salesperson's screen at all?
 *
 * 🔴 IT ASKS `isVisible`, AND NOTHING HERE RESTATES A BRANCH RULE. Every
 *    conditional in this table — the ink quantity on a Yes, the six OCPI-7
 *    show-on-`false` rate fields, the centering pair, the high-seas and local
 *    cost bearers, the dollar rate — is already declared once in
 *    `PART_A_VISIBILITY`. Writing them again here is how the panel comes to
 *    name a box that is not on the page: OCPI-8 is the module's own record of
 *    that happening, where a salesperson was told the sheet would print a blank
 *    dryer name on a deal whose form had no dryer name to fill in.
 *
 *    So there is exactly one source for "is this asked", and `extra` exists
 *    only for the head count, which is not a fact about the draft.
 */
function isAsked(
  r: Requirement,
  d: QuotationDraft,
  deal: DealFacts,
  headOptions: number,
): boolean {
  return isVisible(r.key, d, deal) && (r.extra ? r.extra(d, deal, headOptions) : true);
}

/**
 * Has it been answered?
 *
 * ⚠ NULL IS NOT NO. The inclusion answers are `boolean | null` and the third
 *   state is real: an unanswered question and a question answered No are
 *   different facts, which is why this tests for null rather than for falsiness.
 *   Everything else on the draft is a string, and blank means unanswered.
 */
function isAnswered(d: QuotationDraft, key: keyof QuotationDraft): boolean {
  const v = d[key];
  if (typeof v === "string") return v.trim() !== "";
  return v !== null && v !== undefined;
}

const labelOf = (r: Requirement): string => r.label ?? FIELD_LABEL[r.key];

function missing(
  tiers: readonly Tier[],
  d: QuotationDraft,
  deal: DealFacts,
  headOptions: number,
): MissingField[] {
  return REQUIREMENTS.filter(
    (r) => tiers.includes(r.tier) && isAsked(r, d, deal, headOptions) && !isAnswered(d, r.key),
  ).map((r) => ({ key: r.key, label: labelOf(r) }));
}

/**
 * What must be answered before a document can be produced at all.
 *
 * The mirror of this list lives in `fms_ocpi_generate_quotation`, which refuses
 * the same seven. If the two ever disagree the salesperson is offered a button
 * that the database then rejects.
 */
export function missingForGenerate(
  d: QuotationDraft,
  deal: DealFacts = NO_DEAL_FACTS,
  headOptions = 0,
): MissingField[] {
  return missing(["generate"], d, deal, headOptions);
}

/**
 * What must be answered before the quotation can be sent for approval.
 *
 * ⚠ THE NAME AND THE THREE ARGUMENTS ARE UNCHANGED from when this was the only
 *   list, because "submit" IS Send for approval in this module — `submitQuotation`
 *   calls `fms_ocpi_submit_quotation` — and OCPI-14's head-count rule rides on
 *   the third argument. Only the RETURN TYPE changed, from prose to `{key,label}`.
 *
 * ⚠ IT IS A SUPERSET OF `missingForGenerate`, deliberately. The panel at Send
 *   for approval must name everything that is still needed, not only the part
 *   that was not needed earlier.
 *
 * The server's own version of this is the table CHECK
 * `fms_ocpi_complete_when_submitted`, which is written `status = 'draft' OR (…)`
 * and so fires only once the row leaves draft. This list is deliberately a
 * little STRICTER than that CHECK — it also asks for the print head and the
 * centering inclusion, neither of which the constraint has ever carried — so the
 * form always refuses first, with field names, rather than letting the database
 * refuse with a constraint violation that names nothing.
 */
export function missingForSubmit(
  d: QuotationDraft,
  deal: DealFacts = NO_DEAL_FACTS,
  headOptions = 0,
): MissingField[] {
  return missing(["generate", "approval"], d, deal, headOptions);
}

/**
 * Every field this deal is required to answer, whether or not it is filled in.
 *
 * This is what puts the asterisk on the form. It reads the SAME table as the
 * two lists above, so a field cannot be marked required and not block, or block
 * without being marked.
 *
 * ⚠ THE ASTERISK MEANS MANDATORY, NOT "BLOCKS GENERATE". A field in the approval
 *   tier still carries one — it IS required, just later. The panels are what say
 *   when. Marking only the Generate tier would leave twenty mandatory questions
 *   unmarked, which is the hunt OCPI-15 exists to end.
 */
export function requiredKeys(
  d: QuotationDraft,
  deal: DealFacts = NO_DEAL_FACTS,
  headOptions = 0,
): Set<keyof QuotationDraft> {
  const out = new Set<keyof QuotationDraft>();
  for (const r of REQUIREMENTS) if (isAsked(r, d, deal, headOptions)) out.add(r.key);
  return out;
}

/**
 * Which lines the DETAILED sheet will print as ruled blanks.
 *
 * ⚠ THIS IS A WARNING, NEVER A BLOCK. The client asked for the detail fields to
 *   be optional so a quotation can go out during a negotiation before the
 *   warranty and delivery terms are settled. The sheet prints a ruled blank
 *   where an answer is missing; this exists so the salesperson knows which lines
 *   are blank BEFORE sending it, rather than discovering it in the customer's
 *   reply.
 *
 * ⚠ IT STAYS `string[]`, AND STAYS UNCLICKABLE, deliberately (OCPI-15). Four of
 *   these seven are shipment answers that live in `<td>`s inside `ShipmentRow`,
 *   not inside a `FieldLabel`, so they carry no anchor to jump to. A list where
 *   three entries move the page and four do nothing is worse than a list that
 *   never claims to.
 *
 * ⚠ THE GATES ARE `isVisible` NOW, not hand-written copies of them. The dryer
 *   pair used to read `deal.showsDryer && d.dryerType.trim() !== "" &&
 *   !deal.noDryerCategory`, which is `hasDryerDetails` in branching.ts spelled
 *   out a second time — the same rule the form branches on and the same one
 *   `fms_ocpi_write_oc` asks before it nulls those columns. All three must
 *   agree: a field this warns about must be one the form shows and the server
 *   keeps. Now two of the three cannot drift.
 *
 * ⚠ THE THREE WARRANTY CHECKS ARE STILL ABSENT, and their absence is still the
 *   point (OCPI-14). They are a per-machine default now, and a machine whose
 *   warranty is NULL means NOT APPLICABLE, so the question is not asked and no
 *   line is printed.
 * ⚠ THE DELIVERY DAYS WARNING IS STILL GONE (OCPI-18) because the line it warned
 *   about is gone — all 21 decks carry the delivery DATE now. The delivery TERM
 *   below is a different field and still prints.
 */
const DETAIL_SHEET_FIELDS: readonly (keyof QuotationDraft)[] = [
  "tradeTerm",
  "headShipMode",
  "inkShipMode",
  "sparesShipMode",
  "centeringShipMode",
  "dryerName",
  "dryerChambers",
];

export function missingForDetailSheet(
  d: QuotationDraft,
  deal: DealFacts = NO_DEAL_FACTS,
): string[] {
  return DETAIL_SHEET_FIELDS.filter(
    (k) => isVisible(k, d, deal) && !isAnswered(d, k),
  ).map((k) => FIELD_LABEL[k]);
}

/* ── Finding the field on the page ────────────────────────────────────────── */

/**
 * The id a field's `FieldLabel` carries, and the one the missing list jumps to.
 *
 * ⚠ ONE FUNCTION, BOTH ENDS. The form writes these ids and the panel reads them;
 *   a literal template string typed at either end is a link that silently stops
 *   working the day somebody renames a field.
 */
export const FIELD_ANCHOR = (key: keyof QuotationDraft | string): string => `ocpi-f-${key}`;

/** The form's own container, used when a field somehow has no anchor. */
export const QUOTATION_FORM_ANCHOR = "ocpi-quotation-form";

/** How long the ring stays on. Matches the animation in index.css. */
const FLASH_MS = 1600;

/**
 * Draw the eye to an element that has just been scrolled to.
 *
 * ⚠ ONE COPY, because the editor flashes the whole "not ready to send" panel
 *   when the button is pressed and `focusField` flashes a single field, and two
 *   hand-written copies of a remove / reflow / re-add dance are two places for
 *   it to stop restarting on a second click.
 */
export function flashElement(el: HTMLElement | null | undefined): void {
  if (!el) return;
  el.classList.remove("ocpi-field-flash");
  // Reading offsetWidth restarts the animation when the same target is hit
  // twice; without it the second click scrolls but does not flash.
  void el.offsetWidth;
  el.classList.add("ocpi-field-flash");
  window.setTimeout(() => el.classList.remove("ocpi-field-flash"), FLASH_MS);
}

/**
 * Scroll to a field, focus it, and flash it.
 *
 * ⚠ THE FLASH IS NOT DECORATION. Several of these fields are Yes/No pairs or
 *   choice buttons, and moving the caret into one button among a dozen is not a
 *   visible event — without the ring the page appears to have scrolled somewhere
 *   for no reason.
 *
 * ⚠ IT FALLS BACK TO THE FORM RATHER THAN DOING NOTHING. Every requirement is
 *   supposed to have an anchor, but a list entry that silently ignores a click
 *   reads as a broken page, so an unanchored field at least scrolls the form
 *   into view.
 */
export function focusField(key: keyof QuotationDraft | string): void {
  const el = document.getElementById(FIELD_ANCHOR(key));
  if (!el) {
    document
      .getElementById(QUOTATION_FORM_ANCHOR)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  el.scrollIntoView({ behavior: "smooth", block: "center" });

  // The first thing inside that can take the caret. Covers TextInput, TextArea,
  // Combobox and the button pairs alike, because all of them sit inside the
  // FieldLabel this id is on.
  el.querySelector<HTMLElement>(
    'input:not([type="hidden"]), textarea, select, button, [tabindex]:not([tabindex="-1"])',
  )?.focus({ preventScroll: true });

  flashElement(el);
}
