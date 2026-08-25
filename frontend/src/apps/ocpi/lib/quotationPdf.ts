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
  commercial.push({ label: "Total Value (INR)", value: inr(d.totalInr) });
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
  if (d.inclHead === true) {
    remarks.push({
      label: "Balance Heads to be Sold Later",
      value: d.headBalanceRemarks ?? "",
      wide: true,
    });
  }
  remarks.push({ label: "Any Other Commitments", value: d.otherCommitments ?? "", wide: true });

  return [
    {
      title: "A.  Machine Details",
      rows: [
        { label: "Machine Name", value: machine?.name ?? "" },
        { label: "No. of Print Heads Required", value: d.headCount === null ? "" : String(d.headCount) },
        { label: "Type of Head", value: d.headType ?? "" },
        { label: "Type of Ink Used", value: d.inkType ?? "" },
        { label: "Ink Price", value: d.inkPrice ?? "" },
        { label: "Credit Terms for Included Ink", value: d.inkCreditTerms ?? "" },
        { label: "Dryer Required", value: d.dryerType ?? "" },
        { label: "No. of Machines", value: d.machineCount === null ? "" : String(d.machineCount) },
      ],
    },
    {
      title: "B.  Deal Inclusions",
      rows: [
        { label: "Inclusive of Ink?", value: yesNo(d.inclInk) },
        { label: "Qty. of Ink Included in Deal", value: d.inkQtyIncluded ?? "" },
        { label: "Inclusive of Spare Parts?", value: yesNo(d.inclSpares) },
        { label: "Spare Part Details", value: d.spareDetails ?? "" },
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
      const aLines = wrapText(pdf, a.value, aValW, 8.5);
      const bLines = b ? wrapText(pdf, b.value, bValW, 8.5) : [];
      const tallest = Math.max(aLabelLines.length, bLabelLines.length, aLines.length, bLines.length);
      const rowH = Math.max(17, 7 + tallest * 10);

      if (y + rowH > bodyBottom(pdf)) y = newPage(letterhead);

      setDraw(pdf, BRAND.line);
      pdf.setLineWidth(0.6);
      pdf.rect(left, y, cellW, rowH);
      pdf.line(left + aLabelW, y, left + aLabelW, y + rowH);
      aLabelLines.forEach((l, k) => text(pdf, l, left + 6, y + 11 + k * 10, { size: 8, bold: true }));
      aLines.forEach((l, k) => text(pdf, l, left + aLabelW + 6, y + 11 + k * 10, { size: 8.5 }));

      if (b) {
        const bx = left + HALF;
        pdf.rect(bx, y, HALF, rowH);
        pdf.line(bx + bLabelW, y, bx + bLabelW, y + rowH);
        bLabelLines.forEach((l, k) => text(pdf, l, bx + 6, y + 11 + k * 10, { size: 8, bold: true }));
        bLines.forEach((l, k) => text(pdf, l, bx + bLabelW + 6, y + 11 + k * 10, { size: 8.5 }));
      }

      y += rowH;
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
