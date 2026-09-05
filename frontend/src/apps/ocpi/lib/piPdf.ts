import jsPDF from "jspdf";
import {
  BRAND, MARGIN, contentW, loadBrandAssets, registerBrandFonts,
  setDraw, setFill, text, wrapText,
} from "@/shared/lib/pdfBrand";
import { BODY_TOP, bodyBottom, drawLetterhead, loadLetterhead, type LetterheadAssets } from "./letterhead";
import { DELIVERY_DATE_REMARK, INSURANCE_CLAUSE, type DealFacts } from "./fieldSpec";
import { conditionsFor, render, type Conditions } from "./conditions";
import { tokensFor } from "./tokens";
import { paperDate, paperFileBase, proseCompanyName } from "./format";
import type {
  OcpiCompanyProfile, OcpiDeal, OcpiMachine, OcpiSalesPage, SalesPageBlock,
} from "../types";

/**
 * The Performa Invoice — the third paper, and the one every deal actually has.
 *
 * 🔴 THIS IS THE DOCUMENT THAT ALWAYS GOES OUT. Counted across the 27 folders in
 *    `2026.27 OC&PI`: 25 hold a PI, 12 hold an OC, and 14 customers received a PI
 *    and NO OC at all. Until OCPI-36 the module issued the rarer document and not
 *    the universal one.
 *
 * ⚠ IT IS NOT THE "DETAILED SHEET". `ocPdf.ts` is the ORDER CONFIRMATION, drawn
 *   from each machine's transcribed deck. This is a third, shorter renderer, and
 *   nothing was renamed to make room for it.
 *
 * ── THREE SHAPES, AND ALL THREE ARE REAL ──────────────────────────────────
 *
 *   3 pages · cover letter + sales page + invoice   (101, 102, 120, 124, 127)
 *   2 pages · cover letter + invoice                 — machine has no sales page
 *   1 page  · the invoice alone                      (folder 107's ink and dryer)
 *
 * ⚠ DO NOT DELETE THE 1-PAGE PATH. Separate item PIs are out of scope (OCPI-36
 *   Q4 — ink and dryer are ROWS on one paper, not papers of their own), but the
 *   shape is proven by folder 107 and is what `invoiceOnly` renders. The
 *   2-page form is the one a Pengda or POD deal gets today.
 *
 * ⚠ VECTOR, NOT A SCREENSHOT, for the same reason as the other two papers:
 *   pdfBrand embeds Poppins because jsPDF's Helvetica has no rupee sign, and
 *   every money figure on this page starts with one.
 */

export interface PiDocInput {
  deal: OcpiDeal;
  machine?: OcpiMachine;
  profile?: OcpiCompanyProfile;
  /** Page 2. Absent → the page is skipped entirely, never drawn blank. */
  salesPage?: OcpiSalesPage;
  /**
   * The three category flags, for the `[[if dryer]]` / `[[if centering]]`
   * conditions in a machine's BILLING NAME (OCPI-45).
   *
   * 🔴 REQUIRED, NOT OPTIONAL, AND THAT IS THE POINT. `NO_DEAL_FACTS` is the
   *    OPEN default -- every flag true -- so a caller that forgot to pass this
   *    would print "WITH DRYER" on a machine that has none, silently, on an
   *    invoice. Making it required means `tsc` names any new call site instead.
   *    Every existing caller already computes `factsForDeal(...)` for the
   *    order confirmation a few lines away.
   */
  facts: DealFacts;
  /** ISO date the version was generated; falls back to now for a live preview. */
  generatedAt?: string;
  /**
   * Render the invoice page ALONE — folder 107's ink and dryer form.
   *
   * Defaults to false, which is the machine PI. Nothing in the module passes
   * true today; it exists because the shape is real and the renderer would
   * otherwise have to be reopened to support it.
   */
  invoiceOnly?: boolean;
}

/** Rupees, as the invoice writes them: no symbol, two decimals, Indian grouping. */
const money = (n: number): string =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The company paragraph on page 1.
 *
 * ⚠ A CONSTANT, NOT A DATA ASK. It is identical, word for word, across every one
 *   of the 27 folders — the only part of the cover letter that never varies.
 */
const COMPANY_PARAGRAPH =
  "A Surat based leading digital solutions provider with digital and auxiliary machinery for " +
  "various types of industries. Augmenting the global expertise of the digital era, we provide " +
  "all kind of digital solutions that can help industries keep pace with the increasing " +
  "automation. We provide experts providing specialized services and machinery to our valued " +
  "customers most efficiently and reliably.";

/** One row of the invoice table. */
interface ItemRow {
  qty: number | null;
  /** The description cell, already split into the lines it prints as. */
  lines: string[];
}

/** One line of the money block. */
interface MoneyLine {
  label: string;
  value: string;
  /** The final total — drawn bolder, because it is the figure that is agreed. */
  total?: boolean;
}

/**
 * What the deal is selling, as the table's rows.
 *
 * 🔴 ONE ROW — THE MACHINE — BECAUSE THAT IS WHAT THE REAL PAPERS DO. Counted
 *    across all 42 PI files in the two source folders: **41 carry exactly one
 *    priced line and one table row**; the only exception is folder 124
 *    (Clothera), which lists 30 Epson print heads as a second row and includes
 *    them in its total.
 *
 * 🔴 THIS FUNCTION USED TO ADD A ROW PER OCPI-11 INVOICE ITEM, AND THAT WAS
 *    WRONG IN A WAY THAT SHOWED ON THE FIRST RENDERED INVOICE. `head_invoice_*`,
 *    `ink_invoice_*` and the rest describe items that are **separately
 *    invoiced** — billed on their own document — which is precisely why
 *    `ocPdf.ts` records that they are "NOT PART OF ANY TOTAL … adding it to this
 *    contract would charge the customer twice". Printing a price against each of
 *    them put ₹62.35L of line items above a Total of ₹61.36L that excluded every
 *    one of them: an invoice whose own arithmetic did not agree.
 *
 * ⚠ SO WHERE DO THE EXTRAS GO? Where the real papers put them — in the `Note:`
 *   block, in words. Folders 79, 88, 95 and 97 all read like
 *   "Ink Price- CMY-Rs 475+GST (30 Days Credit)" there, and never as an invoice
 *   row. That text already reaches the PI through `remarks`.
 *
 * ⚠ CLOTHERA'S SHAPE IS NOT REPRODUCED, DELIBERATELY. Charging an extra on this
 *   invoice needs a TOTAL that includes it, and no such figure is stored — the
 *   stored totals exclude separately-invoiced items by design. Raised with
 *   Ritesh Bhai rather than approximated: a total the browser adds up itself is
 *   the one thing this module has consistently refused to do.
 */
function itemRows(
  d: OcpiDeal,
  machine: OcpiMachine | undefined,
  tokens: Record<string, string | null>,
  conditions: Conditions,
): ItemRow[] {
  /*
    The description is the BILLING NAME — the full product wording the invoice
    will carry — falling back to the machine code, because a row with no
    description at all is worse than a terse one.

    ⚠ HSN / MFG / COUNTRY OF ORIGIN PRINT HERE, AND ONLY WHEN THEY ARE FILLED.
      See `machineDetailLines`.

    🔴 IT IS RENDERED THROUGH THE SAME ENGINE AS THE CONTRACT'S SUPPLY LINE
       (OCPI-45), so a billing name may carry `[[if dryer]]`, `[[if centering]]`
       and `{{head_count}}` exactly as `supply_description` already does.

       Found by typing real folder 119 (Modi, Homer K32) into the form. That
       machine is sold WITH a dryer and WITH a centring device, its own paper
       says so — `…WITH 32 PRINTHEAD WITH DRYER WITH CENTRING DEVICE` — and the
       CONTRACT printed it correctly while the INVOICE printed
       `LARGE FORMAT INKJET PRINTER WITH 32 HEADS WITH STD. ACCESSORIES`,
       naming neither. The contract's line was conditional; this one was a flat
       master string that could not vary by deal.

       ⚠ A BILLING NAME WITH NO MARKERS RENDERS BYTE-IDENTICALLY, which is what
         makes this safe for the other machines: 18 of the 23 carry no marker at
         all and their invoices do not change by one character.
  */
  const billing = machine?.billingName
    ? render(machine.billingName, tokens, conditions).text
    : "";
  const desc = [billing || machine?.name || ""].filter(Boolean);
  return [{ qty: d.machineCount, lines: [...desc, ...machineDetailLines(machine)] }];
}

/**
 * The imported-machine lines under the description — HSN, manufacturer, origin.
 *
 * 🔴 EMPTY MEANS OMIT HERE, AND THAT IS THE OPPOSITE OF THE REST OF THIS MODULE.
 *    Everywhere else an unanswered value prints a ruled underscore run on purpose
 *    (`tokens.ts` BLANK, and the note at its head), because there the gap is a
 *    question somebody must go and answer. Here the gap is CORRECT: a Surat-built
 *    Homer K24 has no country of origin to state, and printing
 *    "Country of Origin: ________" would invent a question nobody asked and put
 *    an obviously unfinished document in front of a customer.
 *
 *    The live papers settle it. Of 34 real PI files, 4 carry an HSN code, 2 a
 *    country of origin, 1 a manufacturer, and 30 carry none of the three — every
 *    one that does is an IMPORTED machine (the K64: `HSN CODE: 84433910`,
 *    `MFG: HAN GLORY (HONG KONG) LIMITED`, `Country of Origin: HONG KONG , CHINA`).
 *
 *    ⚠ DO NOT "MAKE THIS CONSISTENT" WITH THE REST OF THE MODULE. That change
 *      would put three blanks on every domestic invoice this company issues.
 */
function machineDetailLines(machine?: OcpiMachine): string[] {
  if (!machine) return [];
  const out: string[] = [];
  const model = machine.machineModelNo?.trim();
  const hsn = machine.hsnCode?.trim();
  /*
    The real papers put the model number and the HSN on one line:
    "(HM1800B-TK64-A1)  HSN CODE: 84433910".

    ⚠ THE MODEL RIDES WITH THE HSN AND NEVER TRAVELS ALONE, which is why this
      is `hsn ? …` and not `model ? …`. The model number is ALREADY on this page,
      in the subject line right above the table. On an imported machine the
      papers repeat it here beside the HSN as part of the customs description,
      and folder 120 does exactly that. On a DOMESTIC machine they do not:
      folder 127's description is two lines with no model in them, because there
      is no customs line for it to belong to. Keying this on `model` printed a
      bare "(OT-1908A)" under the description on every domestic invoice, saying
      a second time what the subject had just said. Verified against both papers.
  */
  if (hsn) out.push([model ? `(${model})` : "", `HSN CODE: ${hsn}`].filter(Boolean).join("  "));
  if (machine.manufacturer?.trim()) out.push(`MFG: ${machine.manufacturer.trim()}`);
  /*
    🔴 COUNTRY OF ORIGIN IS A BULLET, NOT A DESCRIPTION LINE, AND IT USED TO BE
       BOTH. `termsBullets` prints "Country of Origin : X" further down the page;
       printing it here as well put the same fact on folder 120's invoice twice,
       once with a spaced colon and once without. Bushra's paper carries the HSN
       and the MFG in this cell and the country ONLY in the bullet list. The
       bullet is the one true home — do not re-add it here.
  */
  return out;
}

/**
 * The money block — three shapes, decided by ONE existing rule.
 *
 * 🔴 A HIGH SEAS SALE ATTRACTS NO GST, AND A `0%` ROW IS A DIFFERENT LEGAL CLAIM
 *    FROM NO ROW AT ALL. `fms_ocpi_write_oc` sets `gst_rate` to NULL rather than
 *    zero on such a deal precisely so a renderer can tell the two apart, and that
 *    null is the whole test — the same one `quotationPdf.ts` uses for its
 *    Section C rows (OCPI-29). It is NOT re-derived here; a second predicate for
 *    one tax rule is how the two papers end up disagreeing on a contract.
 *
 * ⚠ THE WORDING DIFFERS BETWEEN THE SINGLE-ITEM AND MULTI-ITEM SHAPES, and that
 *   is taken from the real papers rather than tidied: 127 prints
 *   "Machine Value INR / + 18% GST Value INR / Total Value INR" while 124 prints
 *   "Machine Value INR / Print Heads Value INR / +18% GST INR / Total INR".
 *
 * ⚠ `(Fluctuated Rate)`, NOT `(Fluctuate Rate)`. Both appear on real papers —
 *   107 has the second — and this is the grammatical one, on the larger and more
 *   recent K64 deal.
 */
function moneyLines(d: OcpiDeal): MoneyLine[] {
  const out: MoneyLine[] = [];
  const isUsd = d.dealValueCurrency === "USD";

  /*
    A dollar deal states the machine in dollars, then the rate it converts at,
    then the rupee total — and carries no tax line at all. Folder 120 (K64,
    USD 3,85,000 @ 96) is the specimen.
  */
  if (isUsd) {
    if (d.dealValueAmount !== null) {
      out.push({ label: "Machine Value USD", value: money(d.dealValueAmount) });
    }
    if (d.fxRate !== null) {
      /*
        The rate as the PAPER writes it — folder 120 reads "@ 96 (Fluctuated Rate)".

        ⚠ NOT THE FOUR DECIMALS `rateText` USES on the summary sheet. That
          precision is deliberate there, so the rupee figure reproduces from the
          rate printed beside it. This line is a commercial term rather than a
          derivation, and "@ 96.0000" reads as false precision. Trailing zeros
          are trimmed rather than forced, so a real 95.489 still prints in full.
      */
      const rate = String(Number(d.fxRate.toFixed(4)));
      out.push({ label: `@ ${rate} (Fluctuated Rate)`, value: "" });
    }
    if (d.totalInr !== null) {
      out.push({ label: "Total Value INR", value: money(d.totalInr), total: true });
    }
    return out;
  }

  /*
    ── THE RUPEE SHAPE, AND WHY IT IS THIS SHORT ─────────────────────────────

    🔴 EVERY FIGURE HERE IS A STORED COLUMN, AND THE THREE LINES ADD UP. That is
       the whole design constraint. `machine_value_inr` + `gst_amount_inr` =
       `total_inr`, all three derived by `fms_ocpi_write_oc`, so the paper can
       never disagree with the record.

    🔴 IT DOES NOT PRICE THE OCPI-11 INVOICE ITEMS, and an earlier draft of this
       function did. Those columns describe items billed on their OWN document
       and are deliberately excluded from every stored total — see `itemRows`
       for what that produced on the first rendered invoice. 41 of the 42 real
       PIs price the machine and nothing else; the extras are described in the
       `Note:` block instead, which is where the real papers put them.

    ⚠ THE DRYER IS THE ONE GENUINE SECOND LINE, and it is safe because the server
      derives it: `dryer_value_inr`, `dryer_gst_inr` and `grand_total_inr` are
      stored alongside the machine's, exactly as `quotationPdf.ts` prints them in
      Section C. Nothing is added up here. A deal with no separately-charged
      dryer never reaches this branch.
  */
  if (d.machineValueInr !== null) {
    out.push({ label: "Machine Value INR", value: money(d.machineValueInr) });
  }
  if (d.gstRate !== null && d.gstAmountInr !== null) {
    out.push({ label: `+${d.gstRate}% GST Value INR`, value: money(d.gstAmountInr) });
  }

  const dryerCharged = d.dryerValueInr !== null && d.dryerValueInr > 0;
  if (dryerCharged) {
    if (d.totalInr !== null) out.push({ label: "Machine Total INR", value: money(d.totalInr) });
    out.push({ label: "Dryer Value INR", value: money(d.dryerValueInr!) });
    /*
      No tax line on a High Seas deal, which carries none — and a zero-GST line
      and no line are different claims, only one of which is true.

      ⚠ THE RATE IS IN THE LABEL, SO IT HAS TO BE GUARDED LIKE THE MACHINE GST
        LINE ABOVE. This tested `dryerGstInr` alone while the line above tests
        BOTH, so a High Seas deal (gst_rate NULL by design) that carried any
        dryer GST figure at all printed the literal "Dryer GST @ null% INR" on
        a customer invoice.
    */
    if (d.gstRate !== null && d.dryerGstInr !== null) {
      out.push({ label: `Dryer GST @ ${d.gstRate}% INR`, value: money(d.dryerGstInr) });
    }
  }

  const grand = dryerCharged ? d.grandTotalInr : d.totalInr;
  if (grand !== null) {
    out.push({ label: "Total Value INR", value: money(grand), total: true });
  }
  return out;
}

/**
 * The Terms & Conditions bullets.
 *
 * ⚠ CONTENT PRINTS, EMPTINESS DOES NOT — the module's standing rule for a
 *   customer-facing paper, and the reason there is no ruled blank anywhere in
 *   this list.
 *
 * 🔴 THE DELIVERY BULLET DOES NOT RESTORE `delivery_days`. OCPI-18 retired that
 *    field deliberately: a day-count told the customer nothing about WHEN, and
 *    the tentative date replaced it on the contract. The real PIs still read
 *    "30 Days after Order Confirmation" and that wording does not come back —
 *    two papers carrying two different delivery promises on one deal is exactly
 *    the failure OCPI-18 removed. This prints the SAME date the contract's SALE
 *    CONDITIONS clause prints, from the same column.
 *
 * ⚠ FORMATTED WITH `paperDate`, NOT THE SCREEN'S `dmy`. The identical warning is
 *   on `{{delivery_date}}` in tokens.ts, and it is there because the two can
 *   disagree.
 *
 * ⚠ NO DATE → NO BULLET, never "Delivery : ________". The date is optional and a
 *   deal without one has not promised anything to rule a blank about.
 */
function termsBullets(d: OcpiDeal, machine?: OcpiMachine): string[] {
  const out: string[] = [];
  if (d.paymentTerms?.trim()) out.push(`Payment Terms : ${d.paymentTerms.trim()}`);
  if (d.tradeTerm?.trim()) out.push(`Trade Terms : ${d.tradeTerm.trim()}`);
  if (d.deliveryDate) {
    out.push(`Delivery : Tentative delivery ${paperDate(d.deliveryDate)}, ${lowerFirst(DELIVERY_DATE_REMARK)}`);
  }
  /*
    ⚠ THIS IS WHERE THE INSURANCE ANSWER FINALLY PRINTS (OCPI-34 item 1). The
      salesperson has always confirmed it on the form and it reached neither
      paper as an ANSWER — the summary sheet prints the standing clause on every
      quotation whether it was agreed or not. Here the agreement itself is the
      bullet, and an unanswered one prints nothing rather than asserting a term.
  */
  if (d.insuranceClauseAgreed === true) out.push(`Insurance : ${INSURANCE_CLAUSE}`);
  if (machine?.countryOfOrigin?.trim()) {
    out.push(`Country of Origin : ${machine.countryOfOrigin.trim()}`);
  }
  return out;
}

/** "Applicable from the date of signing…" → "applicable from…", mid-sentence. */
const lowerFirst = (s: string): string => (s ? s[0].toLowerCase() + s.slice(1) : s);

/**
 * The `Note:` lines.
 *
 * ⚠ SOURCED FROM `remarks`, AND THE LIVE DATA IS WHAT SETTLED THAT. Real deals
 *   carry "Each machine value is Rs.11,20,000/-+ GST." in Special Remarks, which
 *   is character-for-character the Note line on folders 127 and 124. It is the
 *   same free text, already customer-facing on the summary sheet.
 *
 * ⚠ THE WHOLE BLOCK GOES WHEN THERE IS NOTHING TO SAY. A "Note:" heading with no
 *   note under it reads as something that failed to render.
 */
function noteLines(d: OcpiDeal): string[] {
  return (d.remarks ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Build the document. Returns the jsPDF instance so callers can blob or print it. */
export async function buildPiPdf(input: PiDocInput): Promise<jsPDF> {
  const { deal, machine, profile, salesPage, invoiceOnly } = input;

  /*
    OCPI-45 · the same token and condition context the order confirmation uses,
    so one machine's billing name cannot mean two different things on the two
    papers. Warranty is not passed: no billing name states one, and `tokensFor`
    treats both as optional.
  */
  const tokens = tokensFor({ deal, profile });
  const conditions = conditionsFor({ deal, facts: input.facts });

  const [assets, letterhead] = await Promise.all([loadBrandAssets(), loadLetterhead(profile)]);
  const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  registerBrandFonts(pdf, assets);

  const cw = contentW(pdf);
  const left = MARGIN;
  const right = MARGIN + cw;

  const newPage = (a: LetterheadAssets): number => {
    pdf.addPage();
    drawLetterhead(pdf, a);
    return BODY_TOP;
  };
  const room = (y: number, need: number): number =>
    y + need > bodyBottom(pdf) ? newPage(letterhead) : y;

  drawLetterhead(pdf, letterhead);

  const genIso = input.generatedAt ?? new Date().toISOString();

  /**
   * `Performa No. …` and the date, the line every real PI opens with.
   *
   * 🔴 IT IS NEVER A RULED BLANK. The order-confirmation number is minted at
   *    GENERATE since OCPI-36 — one serial serving the PI and the OC, exactly as
   *    folder 127 does — so a PI always has one by the time it can be rendered.
   *    The `DRAFT` fallback is for a draft that has not been generated at all,
   *    which cannot reach this renderer through the app but must not print
   *    `Performa No. OTPL/OC//26-27` if it ever does.
   */
  const drawPerformaLine = (y: number): number => {
    text(pdf, `Performa No. ${deal.ocNo ?? "DRAFT — not yet issued"}`, left, y, { size: 9.5, bold: true });
    text(pdf, `Date – ${piDate(genIso)}`, right, y, { size: 9.5, bold: true, align: "right" });
    return y + 18;
  };

  /** The *To,* block — name, attention line, address, GST. */
  const drawToBlock = (y: number): number => {
    text(pdf, "TO,", left, y, { size: 9, bold: true });
    y += 13;
    const lines: string[] = [];
    if (deal.customerName) lines.push(deal.customerName);
    /*
      ⚠ THE ATTENTION LINE IS THE ONE PLACE `customer_attn` AND `customer_mobile`
        PRINT (OCPI-34 item 3). Both were captured on the form and reached no
        document at all. Folder 102 is the specimen: "K/a: Mr. Shan
        Moondra-9660518900".
    */
    const attn = [deal.customerAttn?.trim(), deal.customerMobile?.trim()].filter(Boolean).join("-");
    if (attn) lines.push(`K/a: ${attn}`);
    if (deal.customerAddress) lines.push(...deal.customerAddress.split(/\r?\n/));
    for (const raw of lines) {
      for (const l of wrapText(pdf, raw, cw - 8, 9)) {
        text(pdf, l, left, y, { size: 9 });
        y += 12;
      }
    }
    if (deal.gstNo) {
      text(pdf, `GST: ${deal.gstNo}`, left, y, { size: 9, bold: true });
      y += 12;
    }
    return y + 6;
  };

  /* ── Page 1 · the cover letter ─────────────────────────────────────────── */
  let y = 96;
  if (!invoiceOnly) {
    y = drawPerformaLine(y);
    y = drawToBlock(y);
    y += 6;

    text(pdf, "Dear Sir,", left, y, { size: 9.5 });
    y += 18;

    const legal = letterName(profile);
    /*
      ⚠ NO SECOND FULL STOP. The stored legal name is "M/s ORANGE O TEC PVT LTD."
        — it already ends in one — so appending unconditionally printed
        "We are M/s ORANGE O TEC PVT LTD.." on the first rendered cover letter.
        The other four entities may be stored without it, hence the test rather
        than dropping the period outright.
    */
    text(pdf, `We are ${legal}${legal.endsWith(".") ? "" : "."}`, left, y, { size: 9.5, bold: true });
    y += 15;

    for (const l of wrapText(pdf, COMPANY_PARAGRAPH, cw, 9.5)) {
      y = room(y, 13);
      text(pdf, l, left, y, { size: 9.5 });
      y += 13;
    }

    y += 30;
    y = room(y, 40);
    /*
      ⚠ THE SIGN-OFF DROPS THE FULL STOP, AND THIS ONE IS UNANIMOUS — 27 of 27
        real invoices across both years end it "For Orange O Tec Pvt Ltd" with no
        period, while the "We are …" line above keeps one because it closes a
        sentence. Ours inherited the stop from the stored legal name, which ends
        in one. Not a house style being invented: a count with no exceptions.
    */
    text(pdf, `For ${legal.replace(/\.\s*$/, "")}`, left, y, { size: 9.5, bold: true });
    y += 30;
    text(pdf, "Authorized Signatory", left, y, { size: 9.5, bold: true });

    /* ── Page 2 · the sales page, when the machine has one ──────────────── */
    if (salesPage && salesPage.blocks.length) {
      y = newPage(letterhead);
      y = drawSalesPage(pdf, salesPage, y, left, cw, room);
    }

    y = newPage(letterhead);
  }

  /* ── The invoice page ──────────────────────────────────────────────────── */
  y = drawPerformaLine(y);
  y = drawToBlock(y);

  /*
    The subject line.

    ⚠ THE PHRASE IS OMITTED WHEN THERE IS NO MODEL NUMBER, not printed with a
      gap after it. `machine_model_no` is NULL on 16 of the 28 machines, so
      "Subject: Model No:" with nothing after it would be the common case rather
      than the exception. Filling those 16 is a data ask on the machine sheet.
  */
  const model = machine?.machineModelNo?.trim();
  const subject = model
    ? `Subject: Model No: ${model}`
    : machine?.name
      ? `Subject: ${machine.name}`
      : null;
  if (subject) {
    y = room(y, 20);
    text(pdf, subject, left, y, { size: 9.5, bold: true });
    y += 18;
  }

  /* ── The line-item table ───────────────────────────────────────────────── */
  const QTY_W = 58;
  const AMT_W = 96;
  const DESC_W = cw - QTY_W - AMT_W;

  y = room(y, 34);
  setFill(pdf, BRAND.navy);
  pdf.rect(left, y, cw, 18, "F");
  text(pdf, "Quantity", left + QTY_W / 2, y + 12, { size: 8.5, bold: true, color: BRAND.white, align: "center" });
  text(pdf, "Description", left + QTY_W + 6, y + 12, { size: 8.5, bold: true, color: BRAND.white });
  text(pdf, "Amount", right - 6, y + 12, { size: 8.5, bold: true, color: BRAND.white, align: "right" });
  y += 18;

  /*
    ⚠ THE DESCRIPTION CELL WRAPS; IT DOES NOT ELLIPSIZE. `drawTable` in this repo
      truncates a long cell with an ellipsis, which is right in a report and wrong
      in a document — a billing name runs to ~100 characters and losing its tail
      on an invoice loses what the customer is buying.
  */
  for (const r of itemRows(deal, machine, tokens, conditions)) {
    const lines = r.lines.flatMap((l) => wrapText(pdf, l, DESC_W - 12, 9));
    const h = Math.max(22, 8 + lines.length * 11);
    y = room(y, h);
    setDraw(pdf, BRAND.line);
    pdf.setLineWidth(0.6);
    pdf.rect(left, y, cw, h);
    pdf.line(left + QTY_W, y, left + QTY_W, y + h);
    pdf.line(left + QTY_W + DESC_W, y, left + QTY_W + DESC_W, y + h);
    if (r.qty !== null) {
      text(pdf, String(r.qty), left + QTY_W / 2, y + 14, { size: 9, align: "center" });
    }
    lines.forEach((l, i) => text(pdf, l, left + QTY_W + 6, y + 14 + i * 11, { size: 9 }));
    y += h;
  }

  /* ── The money block ───────────────────────────────────────────────────── */
  y += 10;
  for (const m of moneyLines(deal)) {
    y = room(y, 15);
    const bold = !!m.total;
    // The label sits against the amount column, the figure right-aligned under
    // "Amount" — as on every real paper.
    text(pdf, m.label, left + QTY_W + DESC_W - 6, y, { size: 9, bold, align: "right" });
    if (m.value) text(pdf, m.value, right - 6, y, { size: 9, bold, align: "right" });
    y += 14;
  }

  /* ── Note: ─────────────────────────────────────────────────────────────── */
  const notes = noteLines(deal);
  if (notes.length) {
    y = room(y, 26);
    y += 6;
    text(pdf, "Note:", left, y, { size: 9, bold: true });
    y += 13;
    notes.forEach((n, i) => {
      for (const l of wrapText(pdf, `${i + 1}) ${n}`, cw - 14, 9)) {
        y = room(y, 12);
        text(pdf, l, left + 10, y, { size: 9 });
        y += 12;
      }
    });
  }

  /* ── Terms & Conditions ────────────────────────────────────────────────── */
  const terms = termsBullets(deal, machine);
  const bank = bankLines(profile);
  if (terms.length || bank.length) {
    y = room(y, 30);
    y += 8;
    text(pdf, "Terms & Conditions: -", left, y, { size: 9, bold: true });
    y += 14;
    for (const t of terms) {
      const lines = wrapText(pdf, t, cw - 24, 9);
      y = room(y, lines.length * 12);
      lines.forEach((l, i) => {
        text(pdf, i === 0 ? "•" : "", left + 8, y, { size: 9 });
        text(pdf, l, left + 20, y, { size: 9 });
        y += 12;
      });
    }
    if (bank.length) {
      y = room(y, (bank.length + 1) * 12);
      text(pdf, "•", left + 8, y, { size: 9 });
      text(pdf, `Bank Details : ${bank[0]}`, left + 20, y, { size: 9 });
      y += 12;
      for (const b of bank.slice(1)) {
        text(pdf, "▪", left + 28, y, { size: 8, color: BRAND.grey });
        text(pdf, b, left + 40, y, { size: 9 });
        y += 12;
      }
    }
  }

  return pdf;
}

/**
 * The selling entity's bank block.
 *
 * ⚠ THE FOUR ENTITIES WITH NO PROFILE ALREADY WARN BY NAME on every screen that
 *   produces a document (`CompanyProfileWarning`, driven by `profileStatusFor`).
 *   The PI joins that list rather than inventing a fallback: printing Orange O
 *   Tec's account number on a Colorix contract is the failure that warning
 *   exists for. With no profile at all this returns nothing and the bullet is
 *   simply absent — an invoice with no bank block is obviously incomplete, which
 *   is safer than one with a confidently wrong account on it.
 */
/**
 * The company's name as the COVER LETTER says it — "We are …", "For …".
 *
 * 🔴 THE SAME STORED FIELD IS SPELLED TWO WAYS ON THIS PAGE, AND THAT IS
 *    DELIBERATE. `legal_name` reads "M/s ORANGE O TEC PVT LTD.", which is right
 *    where it is a payee — `bankLines` keeps the prefix, and Bushra's papers
 *    print "Bank Details : M/s ORANGE O TEC PVT LTD." — and wrong where the
 *    company is speaking about itself. Reusing it verbatim printed "We are M/s
 *    ORANGE O TEC PVT LTD." and "For M/s ORANGE O TEC PVT LTD."; every one of
 *    the 25 real 2026-27 invoices reads "We are Orange O Tec Pvt Ltd." and
 *    "For Orange O Tec Pvt Ltd". Nobody writes "M/s" about themselves — it is
 *    an address form, used ABOUT a firm, not BY one.
 *
 * ⚠ ONLY THE PREFIX IS TOUCHED. The casing is left exactly as stored: the four
 *   entities without a profile today may be stored differently, and normalising
 *   case here would invent a house style this function has no business setting.
 */
function letterName(profile?: OcpiCompanyProfile): string {
  /*
    ⚠ THE RULE MOVED TO `proseCompanyName` IN format.ts, AND THE BODY IS NOT
      DUPLICATED HERE. The OCPI-42 audit found the identical "M/s" leak a second
      time, inside the composed trade term, which this private copy could never
      have reached. One rule, two callers. The BANK line still keeps the stored
      form untouched — see bankLines.
  */
  return proseCompanyName(profile?.legalName) || "Orange O Tec Pvt Ltd";
}

/**
 * The date as the Performa Invoice prints it — `03/09/2026`.
 *
 * ⚠ NOT `paperDate`, AND THAT IS THE POINT. `paperDate` renders "03 Sept 2026",
 *   which across 56 real invoices appears exactly ZERO times: they run
 *   `dd/mm/yyyy` on 13 and `dd.mm.yyyy` on 6, so the slashed form is the house
 *   style and the spelled month is ours alone.
 *
 * ⚠ IT IS LOCAL TO THIS FILE ON PURPOSE. `paperDate` is also read by
 *   `ocPdf.ts`, `quotationPdf.ts` and `tokens.ts`; changing it here would silently
 *   restyle every date on the signed contract as a side effect of a cosmetic fix
 *   to the invoice. Move it centrally only after the contract has been counted
 *   the same way.
 */
function piDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function bankLines(profile?: OcpiCompanyProfile): string[] {
  if (!profile) return [];
  const out: string[] = [];
  const legal = profile.legalName?.trim();
  if (!legal && !profile.bankName && !profile.bankAccountNo) return [];
  /*
    ⚠ THE PROFILE ALREADY CARRIES THE "M/s". The live legal_name reads
      "M/s ORANGE O TEC PVT LTD.", so prefixing unconditionally printed
      "M/s M/s ORANGE O TEC PVT LTD." on the first rendered invoice. Added only
      when it is not there, because the OTHER four entities may be stored without
      it and the real papers all show the prefix.
  */
  const alreadyPrefixed = /^m\/s\b/i.test(legal ?? "");
  out.push(legal ? (alreadyPrefixed ? legal : `M/s ${legal}`) : "");
  if (profile.bankName?.trim()) out.push(`Bank: ${profile.bankName.trim()}`);
  if (profile.bankBranch?.trim()) out.push(`Branch: ${profile.bankBranch.trim()}`);
  if (profile.bankAccountNo?.trim()) out.push(`A/C no. ${profile.bankAccountNo.trim()}`);
  if (profile.bankIfsc?.trim()) out.push(`IFSC: ${profile.bankIfsc.trim()}`);
  return out;
}

/**
 * Page 2 — the machine's marketing page, drawn from its stored blocks.
 *
 * ⚠ IT DRAWS WHAT THE PAGE DECLARES, IN THE ORDER IT DECLARES IT, and hard-codes
 *   none of the structure. The twelve real pages do not share one shape: 127's
 *   Alpha II page is tagline → paragraph → "Advantages" → bullets, while 120's
 *   K64 page interleaves prose between bullet groups. A renderer that assumed one
 *   shape would have forced the copy to be rewritten to fit it.
 */
function drawSalesPage(
  pdf: jsPDF,
  page: OcpiSalesPage,
  startY: number,
  left: number,
  cw: number,
  room: (y: number, need: number) => number,
): number {
  let y = startY;
  text(pdf, page.heading, left, y, { size: 15, bold: true, color: BRAND.navy });
  y += 22;

  const draw = (b: SalesPageBlock) => {
    switch (b.kind) {
      case "tagline":
        y = room(y, 20);
        text(pdf, b.text, left, y, { size: 11, bold: true, color: BRAND.orange });
        y += 20;
        break;
      case "subhead":
        y = room(y, 20);
        y += 4;
        text(pdf, b.text, left, y, { size: 10.5, bold: true, color: BRAND.navy });
        y += 16;
        break;
      case "bullet": {
        const lines = wrapText(pdf, b.text, cw - 22, 9.5);
        y = room(y, lines.length * 13);
        lines.forEach((l, i) => {
          if (i === 0) text(pdf, "•", left + 6, y, { size: 9.5, color: BRAND.orange });
          text(pdf, l, left + 18, y, { size: 9.5 });
          y += 13;
        });
        break;
      }
      default: {
        const lines = wrapText(pdf, b.text, cw, 9.5);
        y = room(y, lines.length * 13);
        for (const l of lines) {
          text(pdf, l, left, y, { size: 9.5 });
          y += 13;
        }
        y += 4;
      }
    }
  };

  for (const b of page.blocks) draw(b);
  return y;
}

/** The document as a Blob — for preview, download, print and upload alike. */
export async function piPdfBlob(input: PiDocInput): Promise<Blob> {
  const pdf = await buildPiPdf(input);
  return pdf.output("blob");
}

/**
 * The Performa Invoice's file name.
 *
 * ⚠ IT MUST DIFFER FROM THE OTHER TWO. All three papers of a revision land in one
 *   folder with `upsert: true`, so the name is the identity — a shared one means
 *   the third write silently replaces the second and the deal appears to hold
 *   fewer documents than it does.
 */
export function piFileName(deal: OcpiDeal, versionNo?: number): string {
  return `${paperFileBase(deal, versionNo)} - PI.pdf`;
}
