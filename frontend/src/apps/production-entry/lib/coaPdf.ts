import jsPDF from "jspdf";
import { loadBrandAssets, registerBrandFonts, safeText, text, widthOf, wrapText } from "@/shared/lib/pdfBrand";
import {
  buildCoaDocument, coaFileName, COA_LOGO_PATH, COA_SIGN_OFFS,
  type CoaDocument,
} from "./coaVm";
import type { Coa, CoaAudience } from "../types";

/**
 * The Certificate of Analysis as a real, downloadable PDF.
 *
 * ⚠ THIS DELIBERATELY DOES NOT USE `headerBand` / `metaStrip` / `drawTable`.
 *   Those give a page the Orange One REPORT chrome — a navy gradient band, tinted
 *   row fills, an orange rule. The COA is not a report: it is a controlled QC
 *   document whose format is fixed by the factory's own sheet ("Daily Quality
 *   Monitoring Sheet OOT QC FMT 002", tab "COA (Both)"), and it has to come out of
 *   the PDF, the Excel and the printer looking like the same piece of paper. So
 *   the grid is drawn here, plainly, in black on white.
 *
 * ⚠ EVERY STRING GOES THROUGH `safeText`. The embedded Poppins carries the micro
 *   sign (U+00B5) and superscript three (U+00B3) that two parameter names use —
 *   both verified against the shipped cmap — but the parameter master is free
 *   text, and a codepoint the font lacks does not throw. It renders as a blank,
 *   which on a customer-facing certificate is the defect nobody reports.
 *
 * ⚠ CELLS WRAP, THEY DO NOT TRUNCATE. The longest real parameter ("10% Ink
 *   Solution in Water Foam Volume in Millilitre (1 g ink + 9 g water)") does not
 *   fit one line at any sane column width, and a certificate that abbreviates the
 *   name of the test it certifies is worse than one that runs to two lines.
 *
 * ⚠ A FAILED LOT STILL GETS A CERTIFICATE, and it says so. The COA is the
 *   test-results record, not only the certificate, so a rejected round keeps its
 *   observed values — and the page carries both a pale rotated watermark and a
 *   Result row under the Conclusion. A certificate whose round has no verdict yet
 *   is marked too; see coaWatermark in coaVm.ts.
 */

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 40;
const W = PAGE_W - M * 2;

const INK = "#000000";
const NAVY = "#1F3564";
const GREY = "#333333";
/** Pale enough to read straight through, dark enough to survive a photocopy —
 *  the compromise the client accepted when they chose a watermark over a band. */
const WATERMARK = "#DDDDDD";

/**
 * THE SHEET'S OWN GEOMETRY, and the reason these two constants are related.
 *
 * On the source sheet every block is laid over the same nine columns: the label
 * of each label/value row spans A:C, and so does the parameter column of the
 * analysis grid. Standard, Observed and Test Equipment take two columns each.
 *
 * ⚠ SO THE FIRST DIVIDER IS AT EXACTLY ONE THIRD IN BOTH TABLES, and the vertical
 *   rule under "Product Name :" must land on the vertical rule under the parameter
 *   column. Give the parameter column its own width and the two lines miss each
 *   other by a few millimetres — which is the sort of thing that makes a
 *   controlled document look like a draft.
 */
const LABEL_W = 1 / 3;
const COLS = [LABEL_W, 2 / 9, 2 / 9, 2 / 9];

const BODY = 9;
const PAD = 6;
const LINE_H = 12;

/** Memoised, like loadBrandAssets: the letterhead is fetched once per session. */
let logoPromise: Promise<string> | null = null;
function loadCoaLogo(): Promise<string> {
  if (!logoPromise) {
    logoPromise = (async () => {
      try {
        const res = await fetch(COA_LOGO_PATH);
        if (!res.ok) return "";
        const buf = new Uint8Array(await res.arrayBuffer());
        let bin = "";
        for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
        return `data:image/jpeg;base64,${btoa(bin)}`;
      } catch {
        // A missing letterhead must not cost the whole download.
        return "";
      }
    })();
  }
  return logoPromise;
}

interface Cell {
  text: string;
  align?: "left" | "center";
  bold?: boolean;
}

/** Draw one bordered row of cells at `y`, wrapping each cell to its column.
 *  Returns the y just below the row. */
function row(pdf: jsPDF, y: number, widths: number[], cells: Cell[]): number {
  const wrapped = cells.map((c, i) => wrapText(pdf, safeText(c.text), widths[i] - PAD * 2, BODY, !!c.bold));
  const lines = Math.max(1, ...wrapped.map((w) => w.length));
  const h = lines * LINE_H + PAD;

  pdf.setDrawColor(INK);
  pdf.setLineWidth(0.7);
  let x = M;
  for (const [i, w] of widths.entries()) {
    pdf.rect(x, y, w, h);
    const align = cells[i].align ?? "left";
    wrapped[i].forEach((ln, j) => {
      text(pdf, ln, align === "center" ? x + w / 2 : x + PAD, y + PAD + 3 + j * LINE_H, {
        size: BODY,
        bold: cells[i].bold,
        color: INK,
        align: align === "center" ? "center" : "left",
      });
    });
    x += w;
  }
  return y + h;
}

const widthsFrom = (ratios: number[]): number[] => ratios.map((r) => W * r);


/**
 * The verdict, stamped across the page — pale, rotated, BEHIND the certificate.
 *
 * ⚠ DRAWN BEFORE THE CONTENT OF EACH PAGE, never at the end. jsPDF paints in
 *   call order, so stamping last would put the word over the parameter names
 *   instead of under them.
 *
 * ⚠ THE SIZE IS MEASURED, NOT PICKED. "REJECTED" is eight characters and
 *   "NOT VERIFIED" is twelve; one fixed size that suits the first runs off the
 *   page with the second, and a watermark whose ends are missing looks like a
 *   rendering fault rather than a stamp.
 */
function stampWatermark(pdf: jsPDF, doc: CoaDocument): void {
  if (!doc.watermark) return;
  const angle = 38;
  const diagonal = Math.sqrt(PAGE_W * PAGE_W + PAGE_H * PAGE_H);
  // Size the word to the page's diagonal rather than picking a number:
  // "REJECTED" is eight characters and "NOT VERIFIED" is twelve, and one size
  // that suits the first runs the second off the page.
  const at60 = widthOf(pdf, doc.watermark, 60, true) || 1;
  const size = Math.min(130, (60 * (diagonal * 0.62)) / at60);
  const w = widthOf(pdf, doc.watermark, size, true);
  /**
   * ⚠ THE START POINT IS COMPUTED, NOT `align: "center"`. jsPDF applies the
   *   alignment offset in the UNROTATED frame and then rotates about the anchor,
   *   so a centred rotated string lands off the page corner — proved on a real
   *   render, where "REJECTED" printed as "ECTED" off the top edge. Walk back
   *   half the string's width ALONG the baseline instead: with y growing
   *   downwards, a counter-clockwise angle a gives the direction (cos a, -sin a).
   */
  const a = (angle * Math.PI) / 180;
  const x = PAGE_W / 2 - (w / 2) * Math.cos(a);
  const y = PAGE_H / 2 + (w / 2) * Math.sin(a) + (size * 0.35) * Math.cos(a);
  text(pdf, doc.watermark, x, y, { size, bold: true, color: WATERMARK, angle });
}

function build(doc: CoaDocument, assets: Awaited<ReturnType<typeof loadBrandAssets>>, logo: string): jsPDF {
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  registerBrandFonts(pdf, assets);
  stampWatermark(pdf, doc);

  let y = M;

  // ---- letterhead: logo left, company + address right -----------------------
  const logoW = 150;
  let headBottom = y;
  if (logo) {
    try {
      const p = pdf.getImageProperties(logo);
      const logoH = (p.height / p.width) * logoW;
      pdf.addImage(logo, "JPEG", M, y, logoW, logoH);
      headBottom = y + logoH;
    } catch {
      /* a broken image must not take the certificate with it */
    }
  }
  text(pdf, safeText(doc.company), M + W, y + 9, { size: 10.5, bold: true, color: NAVY, align: "right" });
  doc.addressLines.forEach((ln, i) => {
    text(pdf, safeText(ln), M + W, y + 23 + i * 11, { size: 8, color: GREY, align: "right" });
  });
  headBottom = Math.max(headBottom, y + 23 + doc.addressLines.length * 11);

  // ---- title ---------------------------------------------------------------
  y = headBottom + 26;
  text(pdf, safeText(doc.title), PAGE_W / 2, y, { size: 15, bold: true, color: INK, align: "center" });
  y += 18;

  // ---- product / lot / issue date -----------------------------------------
  const infoW = widthsFrom([LABEL_W, 1 - LABEL_W]);
  for (const [label, value] of [
    ["Product Name :", doc.productName],
    ["Lot No :", doc.lotNo],
    ["Issue Date :", doc.issueDateDmy],
  ] as const) {
    y = row(pdf, y, infoW, [{ text: label, bold: true }, { text: value }]);
  }

  // ---- analysis grid -------------------------------------------------------
  y += 14;
  const anW = widthsFrom(COLS);
  // The first header cell is BLANK on the sheet — the parameter column carries no
  // column name. Kept, rather than invented, because this is a controlled format.
  y = row(pdf, y, anW, [
    { text: "" },
    { text: "Standard", align: "center", bold: true },
    { text: "Observed", align: "center", bold: true },
    { text: "Test Equipment", align: "center", bold: true },
  ]);
  for (const l of doc.lines) {
    // Nine parameters at this size cannot reach a page break, but guard rather
    // than silently overflow if the master grows.
    if (y > PAGE_H - 190) {
      pdf.addPage();
      stampWatermark(pdf, doc);
      y = M;
    }
    y = row(pdf, y, anW, [
      { text: l.name },
      { text: l.standard, align: "center" },
      { text: l.observed, align: "center" },
      { text: l.equipment, align: "center" },
    ]);
  }

  // ---- conclusion ----------------------------------------------------------
  y += 14;
  y = row(pdf, y, infoW, [{ text: "Conclusion :", bold: true }, { text: doc.conclusion }]);
  // ---- the test result -----------------------------------------------------
  // Immediately under the Conclusion, on BOTH copies: the plain-text statement
  // that a pale watermark cannot be relied on to make for a photocopy.
  y = row(pdf, y, infoW, [{ text: "Result :", bold: true }, { text: doc.resultText, bold: true }]);
  // ---- remarks: INTERNAL COPY ONLY ----------------------------------------
  // No audience test here — coaVm has already made it, and a second one is how
  // the two copies start diverging in two places.
  if (doc.remarks !== null) {
    y = row(pdf, y, infoW, [{ text: "Remarks :", bold: true }, { text: doc.remarks }]);
  }


  // ---- signatures: ruled lines to sign, as on the paper form ---------------
  y += 62;
  const half = (W - 60) / 2;
  COA_SIGN_OFFS.forEach((label, i) => {
    const x = M + i * (half + 60);
    pdf.setDrawColor(INK);
    pdf.setLineWidth(0.7);
    pdf.line(x, y, x + half, y);
    text(pdf, `${label} :`, x, y + 12, { size: 9, bold: true, color: INK });
  });

  return pdf;
}

async function render(coa: Coa, audience: CoaAudience): Promise<jsPDF> {
  const [assets, logo] = await Promise.all([loadBrandAssets(), loadCoaLogo()]);
  return build(buildCoaDocument(coa, audience), assets, logo);
}

/** The document as a blob — for a preview pane, and for checking what was actually
 *  drawn without going through a download. */
export async function coaPdfBlob(coa: Coa, audience: CoaAudience): Promise<Blob> {
  return (await render(coa, audience)).output("blob");
}

/** Render one copy and hand it to the reader. */
export async function downloadCoaPdf(coa: Coa, audience: CoaAudience): Promise<void> {
  (await render(coa, audience)).save(coaFileName(coa, audience, "pdf"));
}
