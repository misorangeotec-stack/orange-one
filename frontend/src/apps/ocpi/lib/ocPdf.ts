import jsPDF from "jspdf";
import {
  BRAND, MARGIN, contentW, loadBrandAssets, pageH, pageW, registerBrandFonts,
  setDraw, setFill, text, widthOf, wrapText,
} from "@/shared/lib/pdfBrand";
import { BODY_TOP, bodyBottom, drawLetterhead, loadLetterhead, type LetterheadAssets } from "./letterhead";
import { tokensFor } from "./tokens";
import { conditionsFor, render, type Conditions } from "./conditions";
import { isUsdDealRow, type DealFacts } from "./fieldSpec";
import { docHeading, paperDate, paperFileBase, paperNo } from "./format";
import type { OcpiCompanyProfile, OcpiDeal, OcpiMachine, OcpiMachineSection } from "../types";

/**
 * The Order Confirmation — the document the customer signs.
 *
 * ⚠ ITS STRUCTURE COMES FROM THE MACHINE, NOT FROM THIS FILE. The ten templates
 *   genuinely differ: Pengda puts its warranty first and has no print-head
 *   policy at all, P8D is headed OFFER QUOTE, K24 prints no `Ref:` line, and the
 *   Alpha decks close "Checked By" where Homer and P8 close "Approved By". So
 *   the renderer draws whatever the machine declares, in the order it declares
 *   it, and hard-codes none of it.
 *
 * ⚠ EVERY BLANK IS A TOKEN. The decks carry literal fill-in gaps — "warranty of
 *   _______months" — and those are now {{machine_warranty_months}} and the rest
 *   of the list in tokens.ts. An unanswered token prints as a ruled blank,
 *   exactly as the paper version does, never as the braces themselves.
 *
 *   (The deck’s other gap, "INR ____________ plus GST", was
 *   {{post_warranty_head_price}} until stage J.1 replaced the sentence around it
 *   with one that needs no figure. Both the token and the field are gone.)
 *
 * ⚠ OPTIONAL EQUIPMENT IS APPENDED FROM THE DEAL, not baked into the machine.
 *   K32's own deck lists an air blade and a centring device as though every K32
 *   had them; the old form asks about each separately. The machine carries what
 *   is always true, and this adds what THIS customer bought.
 */

export interface OcDocInput {
  deal: OcpiDeal;
  machine: OcpiMachine;
  sections: OcpiMachineSection[];
  /**
   * What this deal carries — the input to every `[[if …]]` in the template.
   *
   * 🔴 REQUIRED, AND NOT OPTIONAL LIKE `warranty` AND `profile` BESIDE IT
   *    (OCPI-31). Everything else here fails visibly when a caller forgets it: a
   *    missing profile prints no bank block, a missing warranty prints a ruled
   *    blank. These flags decide whether the contract SELLS A DRYER, so a
   *    forgotten caller would print a plausible, wrong document. The module's
   *    `NO_DEAL_FACTS` open default is right where the cost of forgetting is
   *    "nothing is hidden"; here it is "the customer signs for equipment they are
   *    not buying", so the compiler is made to ask instead.
   *
   *    All four `ocPdfBlob` call sites already computed these for the SUMMARY
   *    sheet a few lines earlier and simply did not pass them on — including the
   *    two rebuild-from-template paths nobody looks at. Requiring it is what
   *    turned that from a thing to remember into a build error.
   *
   * ⚠ BUILD IT WITH `factsForDeal`, NOT `dealFacts` — the machine's own category
   *   is the fallback on the render side, mirroring the SQL's `coalesce`.
   */
  facts: DealFacts;
  profile?: OcpiCompanyProfile;
  /** From module config, for the {{quotation_validity_days}} token. */
  validityDays?: number;
  /** From module config, as the FALLBACK for the warranty tokens (OCPI-14 made
   *  them per machine, frozen on the deal). */
  warranty?: { machineMonths: number; headMonths: number };
  /** From module config — the standing sentence beside every warranty. */
  warrantyNote?: string;
}

// ⚠ THE PRIVATE `dmy` CONST IS GONE (OCPI-18) — it is `paperDate` in format.ts
//   now, byte-for-byte the same function, imported instead of copied. It was one
//   of three identical copies; the third was about to be written for the
//   `{{delivery_date}}` token. Nothing was printing wrongly — see `paperDate`.
const dmy = paperDate;

const inr = (n: number | null): string =>
  n === null ? "" : `₹ ${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const usd = (n: number | null): string =>
  n === null ? "" : `$ ${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** How a shipment mode / route reads on a contract, not as it is stored. */
const SHIP_MODE_TEXT: Record<string, string> = {
  with_machine: "With the machine",
  separate: "Separate shipment",
};
const SHIP_VIA_TEXT: Record<string, string> = {
  directly: "Directly",
  hss: "High Seas Sale (HSS)",
  local_sales: "Local sales",
};

export interface ShipmentLine {
  item: string;
  mode: string;
  via: string;
  separateInvoice: boolean | null;
  qty: number | null;
  amount: number | null;
  /**
   * DERIVED SERVER-SIDE by `fms_ocpi_write_oc` as round(qty * amount, 2), and
   * printed from the stored column — never recomputed here.
   *
   * ⚠ One price, one answer. The form shows the same product live while the
   *   figures are typed, but that is a preview; if this file multiplied the two
   *   again, a contract could print an arithmetic the database disagrees with.
   *   Same rule that had `withGst` deleted in stage E.
   *
   * 🔴 NOT PART OF ANY TOTAL. It is not in `total_inr` or `grand_total_inr` and
   *   must never be: a separately-invoiced item is billed on its own document,
   *   so adding it to this contract would charge the customer twice.
   */
  subtotal: number | null;
}

/**
 * What ships on its own terms, and what is billed on its own.
 *
 * ⚠ THIS ANSWERS A GAP, NOT A REQUEST FOR MORE DETAIL. Before stage I these
 *   answers were asked on the form, branch-gated in BOTH engines, written by
 *   fms_ocpi_write_oc and frozen into every revision payload — and printed in
 *   NEITHER paper, in no template token, and in no register column. Four
 *   questions a salesperson answered on every head-inclusive deal, and no
 *   document ever stated what was agreed.
 *
 * ⚠ A LINE APPEARS ONLY IF THE DEAL CARRIES ONE — which this filter decides for
 *   itself, on the two cells, and NOT because the branch rules guarantee it.
 *
 * 🔴 THIS NOTE USED TO CLAIM THE GUARANTEE, and it does not hold. It read "the
 *    branch rules already guarantee a null for anything that does not apply —
 *    the head's columns are nulled when no head is included". True of the DRYER
 *    (gated on the deal's own answer, and cleared to match in
 *    `fms_ocpi_write_oc`) and true of CENTERING (gated on the category). NOT
 *    true of head, ink or spares: OCPI-14 severed those from `inclHead` /
 *    `inclInk` / `inclSpares` on purpose — RULE 8 in branching.ts — so nothing
 *    nulls them, and an ink row prints on a deal with no ink the moment either
 *    of its two cells is answered.
 *
 *    Corrected by the OCPI-40 re-audit. The FILTER below is unchanged and is
 *    right: mode set, or separate-invoice answered, and otherwise no row. It is
 *    the reasoning above it that was wrong, and `missingForDetailSheet` in
 *    completeness.ts had been written against that reasoning — it warned about
 *    blank lines this function never prints.
 */
export function shipmentLines(d: OcpiDeal): ShipmentLine[] {
  // Ordered head · ink · dryer · spare parts · centering device, matching the
  // form's table and the client's stated order (OCPI-11).
  const rows: [string, string | null, string | null, boolean | null, number | null, number | null, number | null][] = [
    ["Print head", d.headShipMode, d.headShipVia, d.headSeparateInvoice, d.headInvoiceQty, d.headInvoiceAmount, d.headInvoiceSubtotal],
    ["Ink", d.inkShipMode, d.inkShipVia, d.inkSeparateInvoice, d.inkInvoiceQty, d.inkInvoiceAmount, d.inkInvoiceSubtotal],
    ["Dryer", d.dryerShipMode, d.dryerShipVia, d.dryerSeparateInvoice, d.dryerInvoiceQty, d.dryerInvoiceAmount, d.dryerInvoiceSubtotal],
    ["Spare parts", d.sparesShipMode, d.sparesShipVia, d.sparesSeparateInvoice, d.sparesInvoiceQty, d.sparesInvoiceAmount, d.sparesInvoiceSubtotal],
    ["Centering device", d.centeringShipMode, d.centeringShipVia, d.centeringSeparateInvoice, d.centeringInvoiceQty, d.centeringInvoiceAmount, d.centeringInvoiceSubtotal],
  ];
  return rows
    .filter(([, mode, , inv]) => !!mode || inv !== null)
    .map(([item, mode, via, inv, qty, amount, subtotal]) => ({
      item,
      mode: mode ? (SHIP_MODE_TEXT[mode] ?? mode) : "",
      via: via ? (SHIP_VIA_TEXT[via] ?? via) : "",
      separateInvoice: inv,
      qty,
      amount,
      subtotal,
    }));
}

/**
 * What this deal ADDS to the machine's standard composition.
 *
 * ⚠ A No CONTRIBUTES NOTHING, and that is deliberate even now that a No is a
 *   deliberate answer on every deal rather than a hidden question (OCPI-10,
 *   confirmed with the client 31-Aug-2026). These lines become bullets under
 *   "THE MACHINE IS COMPOSED AS FOLLOWS", which is a list of what the machine
 *   HAS. "Air Blade: No" is not a thing the machine has. The quotation is
 *   where the Yes/No answers are stated in full — this paper states the
 *   outcome.
 *
 * ⚠ `otherInclusions` IS FREE TEXT AND GOES IN AS TYPED, so it reads as one
 *   more line of the composition. It is the only entry here the salesperson
 *   words themselves.
 */
export function optionalExtras(d: OcpiDeal): string[] {
  const out: string[] = [];
  if (d.airBlade) out.push("Air Blade");
  /*
    ⚠ THE CENTERING BULLET NOW READS THE DEAL INCLUSION (OCPI-14). It read
      `externalCentering` — the bare tick that used to sit in "Also included",
      which `fms_ocpi_write_oc` no longer writes at all. Left pointing there,
      this bullet would silently stop appearing on every new deal that includes
      a centering device, on the DETAILED CONTRACT, with nothing in the build to
      complain: the field still exists and still type-checks, it is simply never
      set again.

    ⚠ THE DETAILS GO INTO THE BULLET, because unlike the old tick this question
      has an answer worth printing. "External Centring Device — 2 x rail, 1.9m"
      states what is being supplied; a bare bullet does not.
  */
  if (d.inclCentering) {
    const detail = d.centeringDetails?.trim();
    out.push(detail ? `External Centring Device — ${detail}` : "External Centring Device");
  }
  if (d.inkDustExhauster) out.push("Ink Dust Exhauster");
  if (d.chillingSystem) out.push("Chilling System");
  if (d.otherInclusions?.trim()) out.push(d.otherInclusions.trim());
  return out;
}

/**
 * The note under the priced line saying what ink the price includes.
 *
 * 🔴 THE ANSWER WAS CAPTURED, REQUIRED AND PRINTED ON THE WRONG PAPER (OCPI-37).
 *    `inkQtyIncluded` is asked on every ink-inclusive deal, is required to get
 *    past approval, and prints on the SUMMARY sheet as "Qty. of Ink Included in
 *    Deal" — and appeared nowhere on the ORDER CONFIRMATION, which is the paper
 *    the customer signs. There was no token for it either, so no machine's
 *    template could have printed it. Three real contracts state it plainly under
 *    the price — "Note: 1) 300 Kgs ink included in above value." — and ours
 *    stated nothing, so nothing on the signed page capped how much ink the price
 *    covered.
 *
 * ⚠ IT IS DRAWN HERE RATHER THAN OFFERED AS A `{{token}}`, and that is the whole
 *   design. `resolve()` prints a ruled blank for an unanswered token, so a
 *   `{{ink_qty_included}}` written into 21 templates would put
 *   "Note: ________ included in above value" on every contract that does NOT
 *   include ink — which is precisely the `{{post_warranty_head_price}}` failure
 *   stage J.1 had to undo. An `[[if ink]]` conditional would avoid that and
 *   cannot be used either: the deployed frontend is behind on `conditions.ts`
 *   and would print the markers literally. Drawn from the deal, the line simply
 *   does not exist when there is nothing to say.
 *
 * ⚠ THE FIELD IS FREE TEXT AND SALESPEOPLE USE IT THREE WAYS, so the sentence is
 *   completed rather than assembled blindly. Measured on the live rows:
 *     · a whole sentence — "14,000 Kgs ink Included in Above Value."
 *     · a quantity       — "135 Kgs", "3000kg", "FOC 135 Kgs ink"
 *     · a bare number    — "1000", "4000"
 *   Appending the tail unconditionally would print "…Included in Above Value.
 *   included in above value." on the first kind. So a value that already says
 *   "included" is printed as the salesperson wrote it, and only a bare quantity
 *   is completed into the sentence the real contracts use.
 *
 * ⚠ A BARE NUMBER IS COMPLETED TO KILOS — "1000" prints as "1000 Kgs ink
 *   included in above value." Ink is always sold by weight, confirmed by Ritesh
 *   Bhai 03-Sep-2026 and borne out by the live rows: of the deals that state a
 *   unit, EVERY REAL ONE says Kgs (6 of 6), and every "litres" value on record
 *   is a `ZZ TEST` seed row (14 of 14) written by an audit, not by a
 *   salesperson. Supplying the unit is therefore reading the deal correctly, not
 *   guessing at it — and a contract reading "1000 ink included" states a
 *   quantity of nothing.
 *
 *   🔴 IT ONLY EVER FILLS A UNIT THAT IS ABSENT. A value that names any unit at
 *      all — Kgs, kg, litres, drums — is left exactly as the salesperson wrote
 *      it. The default can therefore never overwrite an agreed term; it can only
 *      finish a sentence that would otherwise have no unit in it.
 */
const DEFAULT_INK_UNIT = "Kgs";

export function includedInkNote(d: OcpiDeal): string | null {
  if (d.inclInk !== true) return null;
  const typed = d.inkQtyIncluded?.trim();
  if (!typed) return null;
  if (/\bincluded\b/i.test(typed)) return `Note: ${typed}`;
  // No letters at all ⇒ a bare quantity, so the unit is missing rather than
  // different. Anything carrying a letter has named its own unit and is left be.
  const withUnit = /[A-Za-z]/.test(typed) ? typed : `${typed} ${DEFAULT_INK_UNIT}`;
  const withInk = /\bink\b/i.test(withUnit) ? withUnit : `${withUnit} ink`;
  return `Note: ${withInk} included in above value.`;
}

/**
 * Everything the template is resolved against, built once.
 *
 * ⚠ THE TWO RENDERERS USED TO BUILD THE TOKEN TABLE SEPARATELY, in two
 *   byte-identical blocks that nothing stopped from drifting. Adding a second
 *   table beside it — the conditions — would have made that two things to keep
 *   in step in two places, so it is one function now. The snapshot and the paper
 *   are resolved against the same values by construction.
 */
function docContext(input: OcDocInput): { tokens: Record<string, string | null>; conditions: Conditions } {
  const { deal, machine, profile } = input;
  return {
    tokens: {
      ...tokensFor({ deal, profile, warranty: input.warranty, warrantyNote: input.warrantyNote }),
      quotation_validity_days: input.validityDays ? String(input.validityDays) : null,
      /*
        🔴 `{{machine_model_no}}` WAS RULING A BLANK ON EVERY CONTRACT THAT USED
           IT (OCPI-37, finding 08). `tokensFor` reads it off the DEAL, and the
           deal's box is free text that nothing prefills — **blank on all 30
           deals, checked 03-Sep-2026**. Two live templates print it on the
           priced supply line: `Homer K24` ("…AND CHINES DRYER (Model No:
           {{machine_model_no}})") and `P8D`. Both were therefore printing
           "(Model No: ________)" on the one line the customer signs under,
           while the manufacturer's code sat filled in on the machine master all
           along. The real K24 contract prints "(Model No: HM1800B-TK24)".

        ⚠ THE DEAL STILL WINS WHERE IT HAS AN ANSWER, and that ordering is the
          point — `tokensFor` carries the standing rule that a revision prints
          what was QUOTED, not what the master says today, and a frozen revision
          reads its own payload rather than this. The master is a FALLBACK for
          the box nobody fills, not a replacement for it.

        ⚠ IT IS OVERRIDDEN HERE RATHER THAN INSIDE `tokensFor`, which is given
          the deal, the profile and the warranty and deliberately not the
          machine — see the note there. This is the one place that already holds
          both, so nothing is threaded through and the note stands.

        ⚠ STILL NULL WHEN THE MASTER IS BLANK TOO. 8 of the 21 templated
          machines have no model number on record and no real paper states one
          (P8S is the exception and is being filled from its contract), so the
          honest answer for the rest is the blank — not an invented code on a
          signed contract.
      */
      machine_model_no:
        deal.machineModelNo?.trim() || machine.machineModelNo?.trim() || null,
    },
    conditions: conditionsFor({ deal, facts: input.facts }),
  };
}

/**
 * The specification table as it will print.
 *
 * ⚠ A ROW A CONDITION EMPTIED IS REMOVED, NOT LEFT BLANK (OCPI-31). Five
 *   machines carry a whole `Dryer` row — "Dryer | Oil + Electric" — and jsPDF's
 *   `splitTextToSize("")` returns one empty line rather than none, so an emptied
 *   value would draw a fully bordered row labelled "Dryer" with nothing beside
 *   it. `emptied` is only ever true where the template said something and a
 *   condition took it away: `resolve()` cannot shrink a non-empty string to
 *   empty, because an unanswered token becomes a ruled blank. Checked live —
 *   no machine has an empty spec-row value, so this can only fire on purpose.
 *
 * ⚠ LABELS ARE STILL NOT TOKENISED, exactly as before. That is a pre-existing
 *   gap (a `{{token}}` in a label prints its braces) and no machine has one; it
 *   is not this change's to close, and the whole-row case is carried by the
 *   value.
 */
function renderSpecRows(
  rows: { label: string; value: string }[],
  tokens: Record<string, string | null>,
  conditions: Conditions,
): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  for (const r of rows) {
    const done = render(r.value ?? "", tokens, conditions);
    if (done.emptied) continue;
    out.push({ label: r.label, value: done.text });
  }
  return out;
}

/**
 * The composition bullets as they will print.
 *
 * 🔴 THE SNAPSHOT DID NOT RESOLVE THESE AND THE PAGE DID, which was invisible
 *    only because no bullet held a token. A conditional bullet — Rocket's
 *    "Dryer System" is one — would have been frozen as its own markup while the
 *    paper dropped it, so the archive and the contract would describe different
 *    machines. One function, both callers.
 *
 * ⚠ THE DEAL'S OWN EXTRAS ARE APPENDED UNRESOLVED, and that is deliberate. They
 *   are free text a salesperson typed — "External Centring Device — 2 x rail,
 *   1.9m", the Others box — and running template syntax over deal data is the
 *   one thing `render`'s header forbids. The page used to resolve them by
 *   accident; no deal carries a token or a marker in those fields, so nothing
 *   printed changes.
 */
function renderComposition(
  machine: OcpiMachine,
  deal: OcpiDeal,
  tokens: Record<string, string | null>,
  conditions: Conditions,
): string[] {
  const out: string[] = [];
  for (const item of machine.composition) {
    const done = render(item, tokens, conditions);
    if (done.emptied) continue;
    out.push(done.text);
  }
  return [...out, ...optionalExtras(deal)];
}

/**
 * The manufacturer's model number and the HSN code, as they print under the
 * priced supply line — or null when neither is on record.
 *
 * ⚠ BOTH ARE FACTS ABOUT THE MACHINE, NOT THE DEAL, so they come off the
 *   machine master rather than out of 21 templates. The master already holds a
 *   column for each — `machine_model_no` and `hsn_code` — and the PERFORMA
 *   INVOICE already prints exactly this pair from exactly these two columns
 *   (`piPdf.ts` · `machineDetailLines`). The real contracts put them on this
 *   line: K32 prints "MODEL (HM1800B- TK32-B1) (HSN CODE 84433910)" directly
 *   under the description, K24 "(Model No: HM1800B-TK24)", P8S the bare code
 *   "HM1800R-P8S-A1".
 *
 * 🔴 THE GUARD IS LOAD-BEARING — FIVE TEMPLATES ALREADY CARRY THIS TEXT and
 *    without it they would print it twice. `Homer K24` and `P8D` resolve it
 *    through `{{machine_model_no}}`; `K64` and `Rocket` have the code typed into
 *    `supply_description` as a literal, and Rocket's carries the HSN too;
 *    `MP5000` names it inline ("MODEL MS-JP7"). Rather than rewrite five decks —
 *    the "moving a block leaves the old one" failure in reverse — whatever the
 *    description already says is skipped here.
 *
 * ⚠ COMPARED ON LETTERS AND DIGITS ONLY, because the papers and the decks
 *   disagree on punctuation and spacing: the real K32 reads "HM1800B- TK32-B1"
 *   against the master's "HM1800B-TK32-B1", and Rocket's deck
 *   "HMSINGLEPASS 1800-ROCKET-K" against the paper's "HMSINGLEPASS 1800 ROCKETK".
 *
 * ⚠ NOTHING PRINTS WHEN THE MASTER HOLDS NEITHER. 8 of the 21 templated
 *   machines have no model number on record and no real paper states one, so
 *   those contracts print exactly what they printed before — a blank line is not
 *   the answer, and an invented code on a signed contract certainly is not.
 */
export function machineDetailLine(
  deal: OcpiDeal,
  machine: OcpiMachine,
  supplyText: string,
): string | null {
  const fold = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const said = fold(supplyText);
  const absent = (v: string) => v !== "" && !said.includes(fold(v));
  const modelNo = (deal.machineModelNo?.trim() || machine.machineModelNo?.trim()) ?? "";
  const hsnCode = machine.hsnCode?.trim() ?? "";
  const parts = [
    absent(modelNo) ? `(Model No: ${modelNo})` : "",
    absent(hsnCode) ? `(HSN Code: ${hsnCode})` : "",
  ].filter(Boolean);
  return parts.length ? parts.join("  ") : null;
}

/**
 * The document as plain data — what gets frozen onto the deal.
 *
 * Built here rather than in the caller so the snapshot and the PDF are produced
 * from one source and cannot describe different documents.
 */
export function resolvedOcDocument(input: OcDocInput): Record<string, unknown> {
  const { deal, machine, sections, profile } = input;
  const { tokens, conditions } = docContext(input);
  return {
    doc_title: docHeading(deal),
    oc_no: deal.ocNo,
    /*
      WHAT THE TITLE BAR ACTUALLY PRINTED, which from 03-09-2026 is `QT-M####`
      before the approval and `OTPL/OC/…` after it — see `paperNo`. `oc_no` above
      stays as it is: it is the deal's serial, always present from Generate, and
      the register is filed under it whether or not a given paper showed it.
      Revisions frozen before this carry no `paper_no` key at all, which is
      honest — on those, the bar printed `oc_no`.
    */
    paper_no: paperNo(deal),
    /*
      ⚠ BOTH NAMES ARE FROZEN, not just the code (OCPI-3, stage I). The billing
        name is read off the MACHINE at render time, so a machine renamed or
        re-described next year would otherwise change what an already-issued
        contract appears to have said. Revisions frozen BEFORE this carry
        neither key — they are simply absent, which is honest; there is nothing
        to invent them from.
    */
    machine_name: machine.name,
    /* ⚠ THE RENDERED BILLING NAME, matching what the Product header prints
         (OCPI-45). Freezing the raw string would record `[[if dryer]]` as the
         document's own wording on any machine that carries a condition. */
    machine_billing_name: machine.billingName
      ? render(machine.billingName, tokens, conditions).text
      : null,
    intro_text: machine.introText ? render(machine.introText, tokens, conditions).text : null,
    header_fields: machine.headerFields,
    signoff_style: machine.signoffStyle,
    spec_rows: renderSpecRows(machine.specRows, tokens, conditions),
    composition: renderComposition(machine, deal, tokens, conditions),
    supply_description: machine.supplyDescription
      ? render(machine.supplyDescription, tokens, conditions).text
      : null,
    /*
      ⚠ FROZEN BECAUSE IT PRINTS, and because both halves are read from the
        MASTER at render time. A machine re-coded or re-classified next year
        would otherwise change what an already-issued contract appears to have
        stated — and the HSN in particular is a customs heading the buyer
        reconciles their invoice against.
    */
    machine_detail_line: machineDetailLine(
      deal,
      machine,
      machine.supplyDescription ? render(machine.supplyDescription, tokens, conditions).text : "",
    ),
    /*
      ⚠ FROZEN BECAUSE IT NOW PRINTS, the same rule the shipment table follows.
        This is a term of the supply — how much ink the price covers — so a
        snapshot that omitted it could not afterwards say what the customer was
        promised, which is the one thing a dispute about it would turn on.
    */
    included_ink_note: includedInkNote(deal),
    /*
      ⚠ FROZEN FOR THE SAME REASON, and only when it prints. The GSTIN on a
        signed contract is the number the buyer's accounts team reconciles the
        invoice against, so a snapshot that dropped it could not afterwards say
        which registration the contract was struck under — and a customer can
        hold more than one.
    */
    customer_gstin: deal.gstNo?.trim() || null,
    sections: sections.map((s) => ({
      key: s.key,
      title: s.title,
      body: render(s.body ?? "", tokens, conditions).text,
    })),
    /*
      ⚠ WHY THE CLAUSE WAS LEFT OUT IS PART OF THE RECORD (OCPI-31 / OCPI-33).
        The same argument the money block below makes for the currency and the
        rate: a snapshot that cannot afterwards say whether this contract was
        printed with a dryer, a centering device or a dollar clause cannot answer
        the one question a dispute about those words would turn on. Three
        booleans, frozen beside the money they belong with.
    */
    conditions,
    /*
      ⚠ THE CURRENCY AND THE RATE ARE PART OF THE MONEY, not context around it.
        A frozen snapshot recording only rupees cannot afterwards say whether the
        contract was struck in dollars or what it was converted at, and those are
        the two facts a disputed total turns on.
    */
    money: {
      deal_value_amount: deal.dealValueAmount,
      deal_value_currency: deal.dealValueCurrency,
      fx_rate: deal.fxRate,
      machine_value_inr: deal.machineValueInr,
      gst_rate: deal.gstRate,
      gst_amount_inr: deal.gstAmountInr,
      total_inr: deal.totalInr,
      /*
        ⚠ THE DRYER MONEY IS PART OF THE MONEY. A snapshot recording only
          `total_inr` could not afterwards say what the customer was actually
          asked to pay, which is the one thing a disputed total turns on.
          `total_inr` is the MACHINE total; `grand_total_inr` is the sum.
          `dryer_price` is in the DEAL’S CURRENCY and `dryer_value_inr` is the
          rupee figure it converted to — both are frozen, because the second
          cannot be re-derived once a rate moves.
      */
      dryer_price: deal.dryerPrice,
      dryer_included: deal.dryerIncluded,
      dryer_value_inr: deal.dryerValueInr,
      dryer_gst_inr: deal.dryerGstInr,
      grand_total_inr: deal.grandTotalInr,
    },
    /*
      ⚠ FROZEN BECAUSE IT NOW PRINTS. Before stage I these answers were frozen
        into `field_payload` but appeared on no document; they are part of the
        resolved contract now, so the snapshot has to carry what was printed.
    */
    shipment: shipmentLines(deal),
    dryer: {
      category: deal.dryerType,
      name: deal.dryerName,
      chambers: deal.dryerChambers,
      heating_medium: deal.heatingMode,
      included: deal.dryerIncluded,
      price: deal.dryerPrice,
    },
    company_profile: profile
      ? {
          legal_name: profile.legalName,
          cin: profile.cin,
          registered_address: profile.registeredAddress,
          ex_works_city: profile.exWorksCity,
          letterhead_path: profile.letterheadPath,
        }
      : null,
  };
}

export async function buildOcPdf(input: OcDocInput): Promise<jsPDF> {
  const { deal, machine, sections, profile } = input;

  const [assets, letterhead] = await Promise.all([loadBrandAssets(), loadLetterhead(profile)]);
  const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  registerBrandFonts(pdf, assets);

  const cw = contentW(pdf);
  const left = MARGIN;

  const { tokens, conditions } = docContext(input);

  const newPage = (a: LetterheadAssets): number => {
    pdf.addPage();
    drawLetterhead(pdf, a);
    return BODY_TOP;
  };
  const room = (y: number, need: number): number =>
    y + need > bodyBottom(pdf) ? newPage(letterhead) : y;

  drawLetterhead(pdf, letterhead);
  let y = 96;

  // ── Title ────────────────────────────────────────────────────────────────
  setFill(pdf, BRAND.navy);
  pdf.rect(left, y, cw, 24, "F");
  // ⚠ THE HEADING COMES FROM THE STAGE, NOT THE MACHINE. See docHeading.
  // ⚠ AND SO DOES THE NUMBER BESIDE IT — `paperNo`, not `ocNo`. Before the
  //   approval this bar reads ORDER QUOTATION over `QT-M0055`; after it, ORDER
  //   CONFIRMATION over `OTPL/OC/10/26-27`. The two moved apart when OCPI-36
  //   pushed the mint back to Generate, and Ritesh Bhai closed the gap on
  //   03-09-2026. Do not reach for `deal.ocNo` here again.
  text(pdf, docHeading(deal), left + 10, y + 16.5, { size: 12, bold: true, color: BRAND.white });
  const headNo = paperNo(deal);
  if (headNo) {
    text(pdf, headNo, left + cw - 10, y + 16.5, {
      size: 10, bold: true, color: BRAND.white, align: "right",
    });
  }
  y += 34;

  // ── Header lines, only the ones this machine declares ────────────────────
  const header: [string, string][] = [];
  const wants = (k: string) => machine.headerFields.includes(k);
  if (wants("attn")) header.push(["Attn:", deal.customerAttn ?? ""]);
  if (wants("date")) header.push(["Date:", dmy(deal.ocAt ?? new Date().toISOString())]);
  if (wants("ref")) header.push(["Ref:", deal.refNo ?? ""]);
  if (wants("address")) header.push(["Address:", [deal.customerName, deal.customerAddress].filter(Boolean).join(", ")]);

  /*
    🔴 THE CUSTOMER'S GSTIN IS HELD AND WAS NOT PRINTED (OCPI-37, finding 07).
       `gstNo` is collected by `CustomerPicker` — pre-filled straight off Tally,
       which holds a GSTIN on about a quarter of parties — validated by
       `GstinField` against the checksum and the GST portal, and printed on the
       PERFORMA INVOICE (`piPdf.ts`) and the quotation summary. It appeared
       nowhere on the ORDER CONFIRMATION. All six real 2026.27 contracts read
       "GST:24AASCA8419N1Z0" as the last line of the address block; ours ended at
       the address, so the paper the customer signs was missing the one number
       their own accounts team looks for.

    ⚠ IT IS NOT IN `headerFields`, and does not need to be. Those four — attn,
      date, ref, address — are a per-deck choice; ALL 28 machines declare
      `address`, so a GSTIN drawn immediately after it lands on every contract
      with no template edited and no row updated. Same reasoning as
      `includedInkNote`: drawn from the deal rather than offered as a
      `{{token}}`, so nothing is printed — not a ruled blank, not an empty label
      — on a deal that has no GSTIN. That is the ordinary case on a high seas
      sale and on an unregistered buyer, where `clearHidden` blanks the field
      because `branching.ts` hides it behind `gstAvailable`.
  */
  const gstin = deal.gstNo?.trim();
  if (gstin) header.push(["GST:", gstin]);

  /*
    ⚠ THE BILLING NAME IS NOT IN `headerFields`, AND THAT IS THE POINT (OCPI-3,
      stage I). Those four — attn, date, ref, address — are a per-machine choice
      about what a given deck happens to want at the top. This is not optional in
      the same way: it is the product description the INVOICE will carry, and a
      contract that does not state it cannot be matched against the bill it
      produces.

      The machine CODE is already on this paper — every one of the ten intros
      reads "we are glad to confirm the supply of <code> Digital Printing
      Machine…", and each deck carries two naming spec rows — so only the billing
      name was missing. Nothing prints when the machine has no billing name; 21
      of the 28 are mapped.
  */
  /*
    🔴 RENDERED, NOT PRINTED RAW — AND THAT IS A SAME-DAY CORRECTION (OCPI-45).

       `billing_name` gained `[[if dryer]]` / `[[if centering]]` conditions so the
       Performa Invoice could stop omitting equipment the deal actually carries.
       piPdf.ts was taught to render them. THIS LINE WAS NOT, and it prints the
       same column — so a freshly generated contract came out reading

           Product: STANDARD DIGITAL DIRECT TO FABRIC TEXTILE PRINTING MACHINE
                    WITH STD. ACC WITH 224 PRINTHEADS[[if

       caught by reading the PDF back with pdf.js. The markers were taken out of
       the database within the hour; they come back only when this line and
       piPdf's item row ship TOGETHER.

    ⚠ TWO PLACES PRINT ONE COLUMN. That is the whole lesson: teaching one of them
      to render is not "adding a feature to billing_name", it is leaving a trap
      in the other. Before putting a marker into any master string, grep for
      EVERY read of that column and prove each one renders.

    ⚠ A NAME WITH NO MARKERS RENDERS BYTE-IDENTICALLY, so every contract issued
      today prints exactly what it printed yesterday.
  */
  if (machine.billingName) {
    header.push(["Product:", render(machine.billingName, tokens, conditions).text]);
  }

  for (const [label, value] of header) {
    const lines = wrapText(pdf, value, cw - 62, 9);
    y = room(y, Math.max(13, lines.length * 11 + 2));
    text(pdf, label, left, y, { size: 9, bold: true });
    lines.forEach((l, i) => text(pdf, l, left + 58, y + i * 11, { size: 9 }));
    y += Math.max(13, lines.length * 11 + 2);
  }
  y += 6;

  // ── Intro ────────────────────────────────────────────────────────────────
  if (machine.introText) {
    const intro = render(machine.introText, tokens, conditions).text;
    const lines = wrapText(pdf, intro, cw, 9);
    y = room(y, lines.length * 11 + 8);
    for (const l of lines) {
      text(pdf, l, left, y, { size: 9 });
      y += 11;
    }
    y += 10;
  }

  // ── Specification table ──────────────────────────────────────────────────
  const LABEL_W = cw * 0.42;
  for (const spec of renderSpecRows(machine.specRows, tokens, conditions)) {
    const value = spec.value;
    const labelLines = wrapText(pdf, spec.label, LABEL_W - 12, 8.5, true);
    // Values carry newlines on the electrical rows; honour them.
    const valueLines = value
      .split("\n")
      .flatMap((seg) => wrapText(pdf, seg, cw - LABEL_W - 12, 8.5));
    const h = Math.max(17, 7 + Math.max(labelLines.length, valueLines.length) * 10);
    y = room(y, h);

    setDraw(pdf, BRAND.line);
    pdf.setLineWidth(0.6);
    pdf.rect(left, y, cw, h);
    pdf.line(left + LABEL_W, y, left + LABEL_W, y + h);
    labelLines.forEach((l, i) => text(pdf, l, left + 6, y + 11 + i * 10, { size: 8.5, bold: true }));
    valueLines.forEach((l, i) => text(pdf, l, left + LABEL_W + 6, y + 11 + i * 10, { size: 8.5 }));
    y += h;
  }
  y += 14;

  // ── Composition ──────────────────────────────────────────────────────────
  const composition = renderComposition(machine, deal, tokens, conditions);
  if (composition.length > 0) {
    y = room(y, 30);
    text(pdf, "THE MACHINE IS COMPOSED AS FOLLOWS:", left, y, { size: 9.5, bold: true });
    y += 14;
    for (const item of composition) {
      const lines = wrapText(pdf, item, cw - 14, 8.5);
      y = room(y, lines.length * 11 + 2);
      setFill(pdf, BRAND.orange);
      pdf.circle(left + 3, y - 2.6, 1.4, "F");
      lines.forEach((l, i) => text(pdf, l, left + 14, y + i * 11, { size: 8.5 }));
      y += lines.length * 11 + 2;
    }
    y += 12;
  }

  // ── Total net amount ─────────────────────────────────────────────────────
  y = room(y, 76);
  text(pdf, "TOTAL NET AMOUNT OF THE SUPPLY", left, y, { size: 9.5, bold: true });
  y += 14;
  const supplyText = machine.supplyDescription
    ? render(machine.supplyDescription, tokens, conditions).text
    : "";
  if (supplyText) {
    const lines = wrapText(pdf, supplyText, cw, 8.5);
    y = room(y, lines.length * 11 + 4);
    for (const l of lines) {
      text(pdf, l, left, y, { size: 8.5 });
      y += 11;
    }
    y += 4;
  }
  // ⚠ The model number and the HSN, off the machine master — see machineDetailLine.
  const detail = machineDetailLine(deal, machine, supplyText);
  if (detail) {
    y = room(y, 15);
    text(pdf, detail, left, y, { size: 8.5 });
    y += 15;
  }
  /*
    ⚠ THE INK NOTE SITS BETWEEN THE PRICED LINE AND THE MONEY, which is where
      every real contract that carries it puts it — directly under the product
      description and above "Machine Value". Below the totals it would read as a
      footnote to the arithmetic instead of a term of the supply.
  */
  const inkNote = includedInkNote(deal);
  if (inkNote) {
    const lines = wrapText(pdf, inkNote, cw, 8.5);
    y = room(y, lines.length * 11 + 6);
    for (const l of lines) {
      text(pdf, l, left, y, { size: 8.5 });
      y += 11;
    }
    y += 6;
  }
  /*
    ⚠ THE TAX ROW IS OMITTED ON A HIGH SEAS SALE, NOT SET TO ZERO. This block
      used to read `deal.gstRate === null ? 18 : deal.gstRate`, which printed
      "+ 18% GST Value INR" with a blank figure beside it on exactly the deals
      that carry no tax — the renderer "remembering" a default the data had
      deliberately cleared. A null rate now means there is no row.

    ⚠ A DOLLAR DEAL PRINTS BOTH CURRENCIES, and the rate it was converted at, so
      the arithmetic on the paper can be checked from the paper. The rate is the
      one frozen onto this revision, never today's.
  */
  const moneyRows: [string, string, boolean][] = [];
  // ⚠ ONE PREDICATE WITH THE `usd` TEMPLATE CONDITION (OCPI-33) — see
  //   `isUsdDealRow`. The forex clause prints a few inches below these rows and
  //   must not be able to disagree with them about the currency.
  if (isUsdDealRow(deal)) {
    moneyRows.push(["Machine Value USD", usd(deal.dealValueAmount), false]);
    moneyRows.push([
      deal.fxRate === null
        ? "Machine Value INR"
        : `Machine Value INR (at ${deal.fxRate.toFixed(4)} per USD)`,
      inr(deal.machineValueInr),
      false,
    ]);
  } else {
    moneyRows.push(["Machine Value INR", inr(deal.machineValueInr), false]);
  }
  if (deal.gstRate !== null) {
    moneyRows.push([`+ ${deal.gstRate}% GST Value INR`, inr(deal.gstAmountInr), false]);
  }
  /*
    ⚠ MACHINE TOTAL → DRYER TOTAL → FINAL TOTAL when a dryer is charged outside
      the deal, exactly as the client specified, and matching the summary sheet
      row for row.

    ⚠ EVERY FIGURE IS READ, NOT COMPUTED. The dryer's rupee value, its GST and
      the grand total are derived in `fms_ocpi_write_oc` and stored, like the
      machine's. Stage I added them in the browser as a holding position while
      the dryer's tax treatment was unanswered; the client settled it on
      29-Aug-2026 — GST applies, at the same rate — and the arithmetic moved to
      the server. Only the server knows that High Seas carries no GST at all and
      that a dollar deal's dryer converts at the rate frozen onto the revision.
  */
  const dryerCharged = deal.dryerValueInr !== null && deal.dryerValueInr > 0;
  if (dryerCharged) {
    moneyRows.push(["Machine Total INR", inr(deal.totalInr), false]);
    moneyRows.push(["Dryer Value INR", inr(deal.dryerValueInr), false]);
    // Omitted, not zeroed, on a High Seas deal — see the note above the machine's
    // own tax row for why a zero-tax line is a different claim from no line.
    if (deal.dryerGstInr !== null) {
      moneyRows.push([`+ ${deal.gstRate}% GST on Dryer INR`, inr(deal.dryerGstInr), false]);
    }
    moneyRows.push(["Final Total INR", inr(deal.grandTotalInr), true]);
  } else {
    moneyRows.push(["Total Value INR", inr(deal.totalInr), true]);
  }
  for (const [label, value, strong] of moneyRows) {
    y = room(y, 18);
    if (strong) {
      setFill(pdf, BRAND.orangeSoft);
      pdf.rect(left, y - 11, cw, 17, "F");
    }
    text(pdf, label, left + 6, y, { size: strong ? 9.5 : 9, bold: strong });
    text(pdf, value, left + cw - 6, y, { size: strong ? 9.5 : 9, bold: strong, align: "right" });
    y += 18;
  }
  y += 12;

  /*
    ── Shipment & invoice ───────────────────────────────────────────────────

    ⚠ THE CLIENT ASKED FOR THESE ANSWERS TO PRINT ON THE DETAILED PAPER, and
      until now they printed on neither. See `shipmentLines` for what was
      missing. Five columns, because "invoiced separately: yes" without the
      quantity and the amount states an intention and not a term.

    ⚠ AMOUNTS ARE EXCLUSIVE OF TAX, by instruction, and the heading says so —
      an amount on a contract with no tax status is not a figure anybody can act
      on. They are NOT added into the totals above: a separately-invoiced item is
      billed on its own document, and rolling it into this one would double it.
  */
  const shipment = shipmentLines(deal);
  if (shipment.length > 0) {
    const COLS: [string, number][] = [
      ["Item", 0.2], ["How it ships", 0.17], ["Sent via", 0.16],
      ["Separate invoice", 0.11], ["Qty", 0.07], ["Amount (excl. tax)", 0.14],
      ["Sub-total", 0.15],
    ];
    // ⚠ FRACTIONS MUST SUM TO 1, so the seven columns fill the content width
    //   exactly. They were six until OCPI-11 added the sub-total; every other
    //   fraction was reduced to make room rather than the new one being
    //   squeezed in, because a column narrower than its figures wraps every
    //   row and doubles the height of the table.
    const w = COLS.map(([, f]) => cw * f);
    const x: number[] = [];
    for (let i = 0, at = left; i < w.length; at += w[i], i++) x.push(at);

    y = room(y, 46);
    text(pdf, "SHIPMENT & INVOICE", left, y, { size: 9.5, bold: true });
    y += 6;
    // ⚠ THE CAPTION HAS TO SAY THE SUB-TOTALS ARE NOT IN THE TOTAL. This table
    //   sits below the deal's own money on the same page, and a rupee column a
    //   customer cannot account for reads as an unexplained extra charge.
    text(
      pdf,
      "Amounts exclude tax and are billed on their own invoice. Sub-totals are not included in the totals above.",
      left, y + 5, { size: 8, color: BRAND.grey },
    );
    y += 14;

    setFill(pdf, BRAND.navy);
    pdf.rect(left, y, cw, 16, "F");
    COLS.forEach(([label], i) =>
      text(pdf, label, x[i] + 5, y + 11, { size: 7.5, bold: true, color: BRAND.white }),
    );
    y += 16;

    for (const line of shipment) {
      const cells = [
        line.item,
        line.mode,
        line.via,
        line.separateInvoice === null ? "" : line.separateInvoice ? "Yes" : "No",
        line.qty === null ? "" : String(line.qty),
        line.amount === null ? "" : inr(line.amount),
        // The STORED figure, not a fresh multiplication — see ShipmentLine.
        line.subtotal === null ? "" : inr(line.subtotal),
      ];
      const wrapped = cells.map((c, i) => wrapText(pdf, c, w[i] - 10, 8.5));
      const h = Math.max(17, 7 + Math.max(...wrapped.map((l) => l.length)) * 10);
      y = room(y, h);

      setDraw(pdf, BRAND.line);
      pdf.setLineWidth(0.6);
      pdf.rect(left, y, cw, h);
      wrapped.forEach((lines, i) => {
        if (i > 0) pdf.line(x[i], y, x[i], y + h);
        // The three numeric columns right-align, so figures line up to be read
        // down the column rather than compared character by character.
        // (Two until OCPI-11 added the sub-total; the index is unchanged
        // because the sub-total was appended after Amount.)
        const numeric = i >= 4;
        lines.forEach((l, k) =>
          text(pdf, l, numeric ? x[i] + w[i] - 5 : x[i] + 5, y + 11 + k * 10, {
            size: 8.5,
            align: numeric ? "right" : undefined,
          }),
        );
      });
      y += h;
    }
    y += 14;
  }

  // ── The machine's own sections, in its own order ─────────────────────────
  for (const sec of sections) {
    const body = render(sec.body ?? "", tokens, conditions).text;
    y = room(y, 30);
    text(pdf, sec.title.toUpperCase(), left, y, { size: 9.5, bold: true, color: BRAND.navy });
    y += 13;

    for (const para of body.split("\n")) {
      if (para.trim() === "") {
        y += 5;
        continue;
      }
      const lines = wrapText(pdf, para, cw, 8.5);
      y = room(y, lines.length * 10.5 + 2);
      for (const l of lines) {
        text(pdf, l, left, y, { size: 8.5, color: BRAND.grey });
        y += 10.5;
      }
      y += 3;
    }
    y += 10;
  }

  // ── Signatures ───────────────────────────────────────────────────────────
  y = room(y, 96);
  const sellerName = profile?.legalName ?? "M/s Orange O Tec Pvt. Ltd.";
  const half = cw / 2;
  text(pdf, sellerName, left, y, { size: 9, bold: true });
  text(pdf, `M/s ${deal.customerName ?? ""}`, left + half, y, { size: 9, bold: true });
  y += 40;
  setDraw(pdf, BRAND.grey2);
  pdf.setLineWidth(0.5);
  pdf.line(left, y, left + half - 24, y);
  pdf.line(left + half, y, left + cw - 24, y);
  y += 11;
  text(pdf, "Authorised Signatory Name", left, y, { size: 8, bold: true });
  text(pdf, "Authorised Signatory Name", left + half, y, { size: 8, bold: true });
  y += 26;

  const secondLabel = machine.signoffStyle === "checked_by" ? "Checked By:" : "Approved By:";
  text(pdf, "Prepared By:", left, y, { size: 8.5, bold: true });
  text(pdf, deal.preparedBy ?? "", left + widthOf(pdf, "Prepared By:", 8.5, true) + 6, y, { size: 8.5 });
  y += 14;
  text(pdf, secondLabel, left, y, { size: 8.5, bold: true });
  text(pdf, deal.approvedBy ?? "", left + widthOf(pdf, secondLabel, 8.5, true) + 6, y, { size: 8.5 });

  // Page x of y, so a six-page contract cannot be signed a page short.
  const total = pdf.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    pdf.setPage(p);
    text(pdf, `Page ${p} of ${total}`, pageW(pdf) - MARGIN, pageH(pdf) - 16, {
      size: 7, color: BRAND.grey2, align: "right",
    });
  }

  return pdf;
}

export async function ocPdfBlob(input: OcDocInput): Promise<Blob> {
  const pdf = await buildOcPdf(input);
  return pdf.output("blob");
}

/**
 * The approved DETAILED sheet's file name.
 *
 * ⚠ THE STEM IS `paperFileBase` IN format.ts NOW (OCPI-36) — the private
 *   `ocBase` here and `fileBase` in quotationPdf.ts were two copies that differed
 *   only in which number they read, because the OC number did not exist until
 *   the approval. It exists from Generate, so there is one stem.
 */
export function ocFileName(deal: OcpiDeal): string {
  return `${paperFileBase(deal)} - OC.pdf`;
}

/**
 * The approved SUMMARY sheet's file name.
 *
 * ⚠ IT MUST DIFFER FROM `ocFileName`. Every approved paper is uploaded to the
 *   deal's `oc/` folder with `upsert: true`, so one shared name would mean the
 *   detailed sheet silently replaced the summary and the deal would appear to
 *   have part of a contract.
 */
export function ocSummaryFileName(deal: OcpiDeal): string {
  return `${paperFileBase(deal)} - Summary.pdf`;
}
