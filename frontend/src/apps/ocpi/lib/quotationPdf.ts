import jsPDF from "jspdf";
import {
  BRAND, FONT, MARGIN, contentW, loadBrandAssets, pageH, pageW, registerBrandFonts,
  setDraw, setFill, text, widthOf, wrapText,
} from "@/shared/lib/pdfBrand";
import { BODY_TOP, bodyBottom, drawLetterhead, loadLetterhead, type LetterheadAssets } from "./letterhead";
import { DOLLAR_CLAUSE, INSURANCE_CLAUSE } from "./fieldSpec";
import { docHeading, fmtDealValue } from "./format";
import type { OcpiCompanyProfile, OcpiDeal, OcpiMachine } from "../types";

/**
 * The New Machine Quotation, drawn to match the printed sheet.
 *
 * ⚠ VECTOR, NOT A SCREENSHOT. Built on shared/lib/pdfBrand, which embeds Poppins
 *   because jsPDF's built-in Helvetica has NO rupee sign and every money figure
 *   here starts with one. `exportCustomer.ts` in the receivables hub takes the
 *   html2canvas route and produces an image: no selectable text, blurry when
 *   zoomed. A customer-facing quotation cannot be that.
 *
 * ⚠ ONE RENDERER, USED FOR BOTH SCREEN AND PAPER. Print opens this same blob
 *   rather than a parallel HTML layout — which is what `printGatePass.ts` does
 *   for the gate pass, correctly, because that slip is only ever wanted on
 *   paper. A quotation is emailed AND printed, and two renderers for one
 *   document drift apart within a month.
 *
 * ⚠ THE LAYOUT MIRRORS Quotation Format.jpeg: header bar, salesperson /
 *   quotation no / date, To + GST, then boxed sections A Machine Details,
 *   B Deal Inclusions, C Commercial Terms, D Remarks, the standing terms, and
 *   three signature blocks. Someone checking the output against the paper should
 *   find everything in the same place.
 */

export interface QuotationDocInput {
  deal: OcpiDeal;
  machine?: OcpiMachine;
  profile?: OcpiCompanyProfile;
  /** 1-based. Printed as "Rev n" from the second version onwards. */
  versionNo: number;
  /** ISO date the version was generated; falls back to now for a live preview. */
  generatedAt?: string;
}

const dmy = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

const yesNo = (v: boolean | null): string => (v === null ? "" : v ? "Yes" : "No");

/** Rupees — for the figures that are rupees whatever the deal is quoted in. */
const inr = (n: number | null): string =>
  n === null ? "" : `₹ ${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/**
 * The exchange rate as it is written on the paper.
 *
 * Four decimals, because that is what the FX service returns and what the deal
 * was actually converted at — printing it rounded to two would leave a rupee
 * figure that does not reproduce from the rate printed beside it.
 */
const rateText = (n: number | null): string => (n === null ? "" : n.toFixed(4));

/** A label/value pair for the boxed sections. */
type Row = { label: string; value: string; wide?: boolean };

/**
 * What the label cell says on the second and later slices of a split row.
 *
 * Not the label again: repeating "Special Remarks" on page 3 reads as a second
 * remarks field rather than the rest of the first one.
 */
const CONTINUED = ["… continued"];

/**
 * The fewest value lines a page-foot fragment may carry.
 *
 * One orphan line under a heading is worse than starting the row on the next
 * page, and this loop only ever splits a row that cannot fit a whole page
 * anyway — so the floor costs nothing in the common case.
 */
const MIN_SPLIT = 3;

function sectionRows(d: OcpiDeal, machine?: OcpiMachine): { title: string; rows: Row[] }[] {
  const isHighSeas = d.transportTerms === "high_seas";
  const isUsd = d.dealValueCurrency === "USD";

  const transport = isHighSeas
    ? ["High Seas", d.highSeasVia, d.highSeasCostBy ? `cost by ${d.highSeasCostBy}` : null]
        .filter(Boolean)
        .join(" · ")
    : d.transportTerms === "local"
      ? ["Local Delivery", d.localCostBy ? `cost by ${d.localCostBy}` : null].filter(Boolean).join(" · ")
      : "";

  /*
    ⚠ SECTION C IS BUILT, NOT LISTED. Which money rows a deal carries depends on
      the deal type and the currency, and the difference is not cosmetic: a HIGH
      SEAS SALE ATTRACTS NO GST AT ALL, and a row reading "0% GST — ₹ 0" is a
      different claim from no row at all. `gst_rate` is null on such a deal —
      fms_ocpi_write_oc sets it null rather than zero precisely so this renderer
      can tell the two apart — and that null is what decides here.
  */
  const commercial: Row[] = [
    {
      label: "Deal Type",
      value: isHighSeas ? "High Seas" : d.transportTerms === "local" ? "Others" : "",
    },
    { label: "Machine Value", value: fmtDealValue(d.dealValueAmount, d.dealValueCurrency) },
  ];

  // A dollar deal prints BOTH currencies, at the rate this revision was issued
  // under — never at today's. The rate is frozen on the version row.
  if (isUsd) {
    commercial.push({
      label: "Value in INR",
      value:
        d.dealValueInr === null
          ? ""
          : `${inr(d.dealValueInr)}${d.fxRate === null ? "" : `   (at ${rateText(d.fxRate)} per USD)`}`,
    });
  }
  if (d.gstRate !== null) {
    commercial.push({ label: `GST @ ${d.gstRate}%`, value: inr(d.gstAmountInr) });
  }
  /*
    ⚠ THREE LINES WHEN A DRYER IS CHARGED SEPARATELY: machine total → dryer total
      → final total, exactly as the client specified.

    ⚠ EVERY FIGURE HERE IS READ, NOT COMPUTED. The dryer's rupee value, its GST
      and the grand total are all derived in `fms_ocpi_write_oc` and stored, the
      same way the machine's already were. Stage I added the two numbers in the
      browser as a HOLDING POSITION, because nobody had said whether a separately
      charged dryer attracted tax; the client answered on 29-Aug-2026 that it
      does, at the same rate, and the arithmetic moved to the server where the
      rest of the money lives.

      That matters beyond tidiness: only the server knows a High Seas deal
      attracts no GST at all, and that a dollar deal's dryer price must convert
      at the rate frozen onto the revision. A browser-side sum knew neither.
  */
  const dryerCharged = d.dryerValueInr !== null && d.dryerValueInr > 0;
  if (dryerCharged) {
    commercial.push({ label: "Machine Total (INR)", value: inr(d.totalInr) });
    commercial.push({ label: "Dryer Value (INR)", value: inr(d.dryerValueInr) });
    // No tax row on a High Seas deal, which carries none — a zero-GST line and
    // no line are different claims, and only one of them is true.
    if (d.dryerGstInr !== null) {
      commercial.push({ label: `Dryer GST @ ${d.gstRate}% (INR)`, value: inr(d.dryerGstInr) });
    }
    commercial.push({ label: "Final Total (INR)", value: inr(d.grandTotalInr) });
  } else {
    commercial.push({ label: "Total Value (INR)", value: inr(d.totalInr) });
  }
  commercial.push({
    label: "Term of Payment",
    value:
      d.paymentType === "advance" ? "Any Advance" : d.paymentType === "credit" ? "On Credit" : "",
  });
  commercial.push({ label: "Machine Delivery Date", value: dmy(d.deliveryDate) });
  commercial.push({ label: "Payment Terms", value: d.paymentTerms ?? "", wide: true });
  commercial.push({ label: "Term of Delivery", value: transport, wide: true });

  // The dollar-exchange clause is a COMMERCIAL TERM of a dollar deal, so it
  // prints here rather than among the standing conditions at the foot — and on a
  // dollar deal alone. A rupee customer used to be shown, and asked to agree to,
  // a term that could not apply to them.
  if (isUsd) {
    commercial.push({ label: "Dollar Exchange", value: DOLLAR_CLAUSE, wide: true });
    commercial.push({ label: "Clause Agreed", value: yesNo(d.dollarClauseAgreed) });
  }

  /*
    ⚠ SECTION D CARRIES ALL THREE REMARK BOXES. The master form scattered its
      free text across three questions in three places; the client asked for one
      group, headed Special Remarks. The balance-heads box prints only when the
      deal actually includes a head, so a deal without one is not handed a ruled
      blank for a question it was never asked.
  */
  const remarks: Row[] = [{ label: "Special Remarks", value: d.remarks ?? "", wide: true }];

  /*
    ⚠ THE OTHER TWO BOXES PRINT ONLY IF THEY HOLD SOMETHING (OCPI-3, stage H).
      The client removed them from the form; their columns remain, and 13 of the
      18 deals on record carry balance-head remarks with 14 carrying other
      commitments. Two rules are in tension here and both are honoured:

        · A RETIRED QUESTION MUST NOT PRINT A RULED BLANK. Every other row on
          this sheet prints its blank deliberately, so the reader can see what
          was not answered. A question nobody can answer any more is different —
          its blank says "we forgot" about something that was withdrawn.

        · WHAT A DEAL ALREADY RECORDED MUST NOT VANISH. Silently dropping the
          row would remove text from the next generated paper of a deal that had
          it, with nothing to say why.

      So: content prints, emptiness does not. The head condition goes with it —
      it only ever existed to avoid exactly the ruled blank now handled here.
  */
  if (d.headBalanceRemarks?.trim()) {
    remarks.push({
      label: "Balance Heads to be Sold Later",
      value: d.headBalanceRemarks,
      wide: true,
    });
  }
  if (d.otherCommitments?.trim()) {
    remarks.push({ label: "Any Other Commitments", value: d.otherCommitments, wide: true });
  }

  /*
    ⚠ BOTH NAMES PRINT (OCPI-3, stage I). "Machine Name" is the CODE the module
      has always shown — "Homer K24", "P8S". The billing name is the full product
      description that will appear on the invoice: "LARGE FORMAT INKJET PRINTER
      WITH 24 HEADS WITH STD. ACCESSORIES". A customer matching this quotation
      against the invoice it produces needs the second, and until now the paper
      carried only the first.

    ⚠ IT PRINTS ONLY IF THE MACHINE HAS ONE. 21 of the 28 machines are mapped;
      an unmapped machine gets no row rather than a ruled blank, since this is
      not a question anyone failed to answer. It is `wide` because these run to
      ~100 characters and would wrap to four lines in a half-width cell.

    ⚠ NOT AVAILABLE ON A REVISION FROZEN BEFORE THIS. The name is read from the
      machine at render time, so regenerating an old deal picks it up, but a
      revision already frozen keeps the document it was issued with — which is
      the freeze rule the whole module runs on, and the right behaviour.
  */
  const machineRows: Row[] = [{ label: "Machine Name", value: machine?.name ?? "" }];
  if (machine?.billingName) {
    machineRows.push({ label: "Billing Name", value: machine.billingName, wide: true });
  }
  machineRows.push(
    { label: "No. of Print Heads Required", value: d.headCount === null ? "" : String(d.headCount) },
    { label: "Type of Head", value: d.headType ?? "" },
    { label: "Type of Ink Used", value: d.inkType ?? "" },
    { label: "Ink Selling Price", value: d.inkPrice ?? "" },
    { label: "Credit Terms for Included Ink", value: d.inkCreditTerms ?? "" },
    { label: "No. of Machines", value: d.machineCount === null ? "" : String(d.machineCount) },
  );

  /*
    ⚠ THE DRYER ROWS ARE CONDITIONAL NOW, and there used to be exactly one of
      them ("Dryer Required") printed on every deal — a ruled blank on the 17
      machines that take no dryer, asking a question that cannot apply to them.

      Shown when the MACHINE takes a dryer, or when the deal holds a dryer answer
      of its own. The second half matters for a deal quoted before the mapping
      existed: its answers must not disappear because the model was later flagged
      as needing none. Same rule as the retired remark boxes in stage H —
      content prints, emptiness does not.
  */
  const showsDryer =
    machine?.needsDryer === true || !!d.dryerType || !!d.dryerName || !!d.dryerChambers;
  if (showsDryer) {
    machineRows.push(
      { label: "Dryer Category", value: d.dryerType ?? "" },
      { label: "Dryer", value: d.dryerName ?? "" },
      { label: "No. of Chambers", value: d.dryerChambers ?? "" },
      { label: "Heating Medium", value: d.heatingMode ?? "" },
      { label: "Dryer Included in the Deal", value: yesNo(d.dryerIncluded) },
    );
  }
  if (d.platterDetails) {
    machineRows.push({ label: "Platter", value: d.platterDetails });
  }

  return [
    { title: "A.  Machine Details", rows: machineRows },
    {
      title: "B.  Deal Inclusions",
      rows: [
        { label: "Inclusive of Ink?", value: yesNo(d.inclInk) },
        { label: "Qty. of Ink Included in Deal", value: d.inkQtyIncluded ?? "" },
        { label: "Inclusive of Spare Parts?", value: yesNo(d.inclSpares) },
        { label: "Spare Part Details and Quantity", value: d.spareDetails ?? "" },
        { label: "Inclusive of Head?", value: yesNo(d.inclHead) },
        { label: "No. of Heads Included in Deal", value: d.headsIncluded === null ? "" : String(d.headsIncluded) },
      ],
    },
    { title: "C.  Commercial Terms", rows: commercial },
    { title: "D.  Special Remarks", rows: remarks },
  ];
}

/** Build the document. Returns the jsPDF instance so callers can save, blob or print it. */
export async function buildQuotationPdf(input: QuotationDocInput): Promise<jsPDF> {
  const { deal, machine, profile, versionNo } = input;

  const [assets, letterhead] = await Promise.all([loadBrandAssets(), loadLetterhead(profile)]);

  const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  registerBrandFonts(pdf, assets);

  const W = pageW(pdf);
  const cw = contentW(pdf);
  const left = MARGIN;
  const right = MARGIN + cw;

  const newPage = (a: LetterheadAssets) => {
    pdf.addPage();
    drawLetterhead(pdf, a);
    return BODY_TOP;
  };

  drawLetterhead(pdf, letterhead);

  // ── Title bar ────────────────────────────────────────────────────────────
  let y = 96;
  setFill(pdf, BRAND.navy);
  pdf.rect(left, y, cw, 26, "F");
  text(pdf, docHeading(deal), left + cw / 2, y + 17.5, {
    size: 13, bold: true, color: BRAND.white, align: "center",
  });
  // ⚠ ONCE IT IS AN ORDER CONFIRMATION IT MUST CARRY THE NUMBER. The summary's
  //   header block names the QUOTATION number, which stays — it is how the pair
  //   is traced back to the negotiation — but a paper headed ORDER CONFIRMATION
  //   with no OC number on it is not a contract anybody can file against. The
  //   detailed sheet has always shown it in the same place.
  if (deal.ocNo) {
    text(pdf, deal.ocNo, left + cw - 10, y + 17.5, {
      size: 9.5, bold: true, color: BRAND.white, align: "right",
    });
  }
  y += 26;
  setFill(pdf, BRAND.line);
  pdf.rect(left, y, cw, 5, "F");
  y += 22;

  // ── Salesperson · Quotation No. · Date ───────────────────────────────────
  const genIso = input.generatedAt ?? new Date().toISOString();
  const head: [string, string][] = [
    ["Salesperson :", deal.salespersonName ?? ""],
    ["Quotation No. :", deal.quotationNo ?? "DRAFT — not yet issued"],
    ["Date :", dmy(genIso)],
  ];
  const colW = cw / 3;
  head.forEach(([label, value], i) => {
    const x = left + i * colW;
    text(pdf, label, x, y, { size: 8.5, bold: true });
    const lw = widthOf(pdf, label, 8.5, true);
    text(pdf, value, x + lw + 5, y, { size: 8.5 });
    setDraw(pdf, BRAND.grey2);
    pdf.setLineWidth(0.5);
    pdf.line(x + lw + 4, y + 2.5, x + colW - 10, y + 2.5);
  });
  y += 22;

  // Rev marker — only from the second version, so a first quotation is not
  // labelled as though it had already been revised.
  if (versionNo > 1) {
    text(pdf, `Rev ${versionNo - 1}`, right, y - 34, { size: 8, bold: true, color: BRAND.orange, align: "right" });
  }

  // ── To / GST ─────────────────────────────────────────────────────────────
  text(pdf, "To,", left, y, { size: 9, bold: true });
  y += 13;
  const toLines = [deal.customerName, deal.customerAttn ? `Kind Attn: ${deal.customerAttn}` : null, deal.customerAddress]
    .filter(Boolean)
    .join("\n");
  for (const raw of toLines.split("\n")) {
    for (const line of wrapText(pdf, raw, cw - 12, 9)) {
      text(pdf, line, left + 12, y, { size: 9 });
      y += 12;
    }
  }
  y += 2;
  text(pdf, "GST No. :", left, y, { size: 8.5, bold: true });
  text(pdf, deal.gstNo ?? "", left + 52, y, { size: 8.5 });
  setDraw(pdf, BRAND.grey2);
  pdf.line(left + 50, y + 2.5, left + 300, y + 2.5);
  y += 22;

  text(pdf, "Dear Sir / Madam,", left, y, { size: 9 });
  y += 13;
  for (const line of wrapText(
    pdf,
    "We are pleased to submit our quotation for the New Machine as per your requirement. The details are as follows:",
    cw,
    9,
  )) {
    text(pdf, line, left, y, { size: 9 });
    y += 12;
  }
  y += 8;

  // ── Boxed sections ───────────────────────────────────────────────────────
  const LABEL_W = cw * 0.38;
  const HALF = cw / 2;

  /**
   * Draw one row, or one slice of a row that is being split across pages.
   *
   * Pulled out of the loop below so the whole-row case and the split case draw
   * through exactly the same code — two drawing routines for one box is how the
   * split half ends up with a different border weight from the whole one.
   */
  const drawChunk = (
    a: Row,
    b: Row | null,
    labelA: string[],
    labelB: string[],
    valA: string[],
    valB: string[],
    h: number,
    cellW: number,
    aLabelW: number,
    bLabelW: number,
  ) => {
    setDraw(pdf, BRAND.line);
    pdf.setLineWidth(0.6);
    pdf.rect(left, y, cellW, h);
    pdf.line(left + aLabelW, y, left + aLabelW, y + h);
    labelA.forEach((l, k) => text(pdf, l, left + 6, y + 11 + k * 10, { size: 8, bold: true }));
    valA.forEach((l, k) => text(pdf, l, left + aLabelW + 6, y + 11 + k * 10, { size: 8.5 }));

    if (b) {
      const bx = left + HALF;
      pdf.rect(bx, y, HALF, h);
      pdf.line(bx + bLabelW, y, bx + bLabelW, y + h);
      labelB.forEach((l, k) => text(pdf, l, bx + 6, y + 11 + k * 10, { size: 8, bold: true }));
      valB.forEach((l, k) => text(pdf, l, bx + bLabelW + 6, y + 11 + k * 10, { size: 8.5 }));
    }
  };

  for (const sec of sectionRows(deal, machine)) {
    if (y + 46 > bodyBottom(pdf)) y = newPage(letterhead);

    setFill(pdf, BRAND.navy);
    pdf.rect(left, y, cw, 16, "F");
    text(pdf, sec.title, left + 7, y + 11, { size: 8.5, bold: true, color: BRAND.white });
    y += 16;

    // Two per line where both are short; a `wide` row takes the whole width.
    let i = 0;
    while (i < sec.rows.length) {
      const a = sec.rows[i];
      const b = !a.wide && i + 1 < sec.rows.length && !sec.rows[i + 1].wide ? sec.rows[i + 1] : null;

      const cellW = a.wide ? cw : HALF;
      const aLabelW = a.wide ? LABEL_W : LABEL_W / 2;
      const bLabelW = LABEL_W / 2;
      const aValW = (a.wide ? cw - aLabelW : HALF - aLabelW) - 12;
      const bValW = HALF - bLabelW - 12;

      // ⚠ THE ROW IS SIZED FROM THE LABELS TOO, NOT ONLY THE VALUES. Several
      //   labels on this sheet are long — "No. of Print Heads Required",
      //   "Credit Terms for Included Ink" — and wrap to two lines in a column
      //   this narrow. Measuring only the value let a two-line label overflow a
      //   16pt row and print on top of the row beneath it.
      const aLabelLines = wrapText(pdf, a.label, aLabelW - 10, 8, true);
      const bLabelLines = b ? wrapText(pdf, b.label, bLabelW - 10, 8, true) : [];
      let aRest = wrapText(pdf, a.value, aValW, 8.5);
      let bRest = b ? wrapText(pdf, b.value, bValW, 8.5) : [];

      /*
        ⚠ A ROW TALLER THAN A PAGE IS NOW SPLIT ACROSS PAGES (OCPI-3, stage H).

          This loop used to size the row and, if it would not fit, move the WHOLE
          row to a fresh page — with no logic to split one. A row taller than the
          body area therefore overflowed the new page too, and ran off the bottom
          SILENTLY: no error, no marker, the text simply stopped existing below
          the fold.

          That was unreachable while the free-text boxes held a sentence. It
          became reachable the moment the client asked for Special remarks to be
          entered POINT BY POINT — a dozen numbered lines is a tall row, and
          warranty exceptions now land in that same box by instruction, since
          there is no warranty field any more.

          Continuations repeat nothing and re-label the cell "… continued", so a
          reader meeting the second half on page 3 knows it is not a new field.
      */
      let firstChunk = true;
      for (;;) {
        const labelA = firstChunk ? aLabelLines : CONTINUED;
        const labelB = b ? (firstChunk ? bLabelLines : CONTINUED) : [];
        const need = Math.max(labelA.length, labelB.length, aRest.length, bRest.length);
        const fullH = Math.max(17, 7 + need * 10);

        // 1. Fits where we are — the ordinary case, and the only one before this.
        if (fullH <= bodyBottom(pdf) - y) {
          drawChunk(a, b, labelA, labelB, aRest, bRest, fullH, cellW, aLabelW, bLabelW);
          y += fullH;
          break;
        }

        // 2. Fits on a page of its own — move it whole. A break is always tidier
        //    than a split, and this is what the old code did (correctly) for
        //    every row that was merely awkwardly placed.
        if (fullH <= bodyBottom(pdf) - BODY_TOP) {
          y = newPage(letterhead);
          drawChunk(a, b, labelA, labelB, aRest, bRest, fullH, cellW, aLabelW, bLabelW);
          y += fullH;
          break;
        }

        // 3. Taller than ANY page, so it must be split. THIS is the case the old
        //    code had no answer for: it moved the row to a fresh page and let the
        //    overflow run off the bottom.
        //
        //    ⚠ THE TEST IS "TALLER THAN AN EMPTY PAGE", NOT "TALLER THAN WHAT IS
        //      LEFT" — otherwise a row that merely sat low on the page would be
        //      split when moving it whole would do, and every long remark would
        //      arrive in two pieces for no reason.
        let lines = Math.floor((bodyBottom(pdf) - y - 7) / 10);
        const floorLines = Math.max(labelA.length, labelB.length, MIN_SPLIT);
        if (lines < floorLines) {
          // Too little left here to be worth a fragment; start the slice on a
          // fresh page instead. Never reached on a page that is already fresh.
          y = newPage(letterhead);
          lines = Math.floor((bodyBottom(pdf) - y - 7) / 10);
        }
        lines = Math.max(1, lines); // cannot happen on A4; guards the loop's exit
        const h = 7 + lines * 10;
        drawChunk(
          a, b, labelA, labelB,
          aRest.slice(0, lines), bRest.slice(0, lines),
          h, cellW, aLabelW, bLabelW,
        );
        aRest = aRest.slice(lines);
        bRest = bRest.slice(lines);
        y += h;
        firstChunk = false;
        // Only turn the page if something is actually left to draw on it.
        if (!aRest.length && !bRest.length) break;
        y = newPage(letterhead);
      }

      i += b ? 2 : 1;
    }
    y += 10;
  }

  // ── Standing terms ───────────────────────────────────────────────────────
  // ⚠ THE DOLLAR CLAUSE NO LONGER PRINTS HERE. It is a commercial term of a
  //   dollar deal and now prints inside section C, on those deals alone. What
  //   stands on EVERY quotation is the insurance clause — the one standing
  //   condition the salesperson confirms with the customer on the form and
  //   which, until now, appeared on neither sheet.
  const termLines = wrapText(pdf, INSURANCE_CLAUSE, cw, 8);
  if (y + 20 + termLines.length * 10 > bodyBottom(pdf)) y = newPage(letterhead);
  text(pdf, "Terms & Conditions:", left, y, { size: 9, bold: true });
  y += 12;
  for (const l of termLines) {
    text(pdf, l, left, y, { size: 8, color: BRAND.grey });
    y += 10;
  }
  y += 24;

  // ── Signatures ───────────────────────────────────────────────────────────
  if (y + 40 > bodyBottom(pdf)) y = newPage(letterhead);
  const sigs = ["Salesperson Signature", "Customer Signature", "Authorised Signatory"];
  const sigW = cw / 3;
  sigs.forEach((s, i) => {
    const x = left + i * sigW;
    setDraw(pdf, BRAND.grey2);
    pdf.setLineWidth(0.5);
    pdf.line(x, y, x + sigW - 24, y);
    text(pdf, s, x, y + 11, { size: 8, bold: true });
  });
  y += 30;

  text(
    pdf,
    "This is a computer-generated quotation. For queries, please contact your salesperson.",
    left + cw / 2,
    Math.min(y + 6, pageH(pdf) * 0.9),
    { size: 7.5, color: BRAND.grey2, align: "center" },
  );

  return pdf;
}

/** The document as a Blob — for preview, download, print and upload alike. */
export async function quotationPdfBlob(input: QuotationDocInput): Promise<Blob> {
  const pdf = await buildQuotationPdf(input);
  return pdf.output("blob");
}

const fileBase = (deal: OcpiDeal, versionNo: number): string => {
  const base = (deal.quotationNo ?? `DRAFT-${deal.customerName ?? "quotation"}`).replace(/[\\/:*?"<>|]/g, "-");
  return versionNo > 1 ? `${base} Rev ${versionNo - 1}` : base;
};

/** A stable, human file name for the SUMMARY sheet. */
export function quotationFileName(deal: OcpiDeal, versionNo: number): string {
  return `${fileBase(deal, versionNo)}.pdf`;
}

/**
 * The DETAILED sheet's file name — the summary's sibling.
 *
 * ⚠ IT MUST DIFFER FROM `quotationFileName`, and that is the whole reason this
 *   exists rather than a caller passing one name twice. Both papers of a
 *   revision are uploaded to the same folder with `upsert: true`, so a shared
 *   name means the second write silently replaces the first and the revision
 *   ends up holding one document where it should hold two.
 *
 * ⚠ NAMED OFF THE QUOTATION NUMBER, NOT THE OC NUMBER. Both sheets are issued
 *   together, long before `OTPL/OC/…` is minted at the Directors' approval, so
 *   the quotation number is the only identifier the pair can share.
 */
export function quotationDetailFileName(deal: OcpiDeal, versionNo: number): string {
  return `${fileBase(deal, versionNo)} Detailed.pdf`;
}
