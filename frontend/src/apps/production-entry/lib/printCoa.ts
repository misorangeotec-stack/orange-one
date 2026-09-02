import { buildCoaDocument, COA_LOGO_PATH, COA_SIGN_OFFS, type CoaDocument } from "./coaVm";
import type { Coa, CoaAudience } from "../types";

/**
 * Print a COA — the certificate rendered as HTML and sent to the browser print
 * dialog through a hidden iframe. The iframe idiom (and the cleanup dance) is
 * lifted from printIssueSlip.ts.
 *
 * ⚠ THE LAYOUT IS THE FACTORY'S SHEET, reproduced: logo top-left, company and
 *   address to its right, centred title, three label/value rows, the analysis
 *   grid whose FIRST HEADER CELL IS BLANK (as in the sheet — the parameter column
 *   is unlabelled), the conclusion row, then two signature rules. Do not
 *   "improve" any of that; it is a controlled QC document and the format is the
 *   thing being matched.
 */

function esc(v: string | number | null | undefined): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The logo, as an absolute URL.
 *
 * ⚠ A RELATIVE PATH CANNOT BE USED HERE. The document is handed to the iframe as
 *   `srcdoc`, which gives it an about:srcdoc base URL — "/assets/…" resolves
 *   against nothing and the image silently fails to load, leaving the printed
 *   certificate with a broken box where the letterhead should be.
 */
const logoUrl = (): string =>
  typeof window === "undefined" ? COA_LOGO_PATH : `${window.location.origin}${COA_LOGO_PATH}`;

export function renderCoaHtml(doc: CoaDocument): string {
  const dataRows = doc.lines
    .map(
      (l) => `<tr>
        <td class="p">${esc(l.name)}</td>
        <td class="c">${esc(l.standard)}</td>
        <td class="c">${esc(l.observed)}</td>
        <td class="c">${esc(l.equipment)}</td>
      </tr>`,
    )
    .join("");

  const infoRow = (label: string, value: string) =>
    `<tr><td class="lbl">${esc(label)} :</td><td class="val" colspan="3">${esc(value)}</td></tr>`;

  const signOffs = COA_SIGN_OFFS.map(
    (label) => `<div class="sig-block"><div class="sig-rule"></div><div class="sig-lbl">${esc(label)} :</div></div>`,
  ).join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>COA ${esc(doc.lotNo)} — Test ${doc.round}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; font-size: 11px; }

  /* Letterhead: logo left, company + address right — the sheet's own arrangement. */
  .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
  .head img { width: 168px; height: auto; display: block; }
  .head .who { text-align: right; }
  .head .co { font-size: 12.5px; font-weight: bold; color: #1F3564; }
  .head .addr { font-size: 9.5px; color: #333; line-height: 1.45; margin-top: 2px; }

  h1.title { text-align: center; font-size: 17px; font-weight: bold; color: #111;
             margin: 20px 0 14px; letter-spacing: .2px; }

  /* THE SHEET'S GEOMETRY: on the source sheet the label of every label/value row
     and the parameter column of the analysis grid BOTH span A:C of nine columns,
     so the first vertical rule sits at exactly one third in both tables and the
     lines under "Product Name :" and under the parameter column are the same
     line. table-layout:fixed is what makes the browser honour that instead of
     re-sizing the first column around its content.
     (No backticks in here: this block lives inside a JS template literal, and one
     would end the string mid-stylesheet.) */
  table { border-collapse: collapse; width: 100%; table-layout: fixed; }
  table td, table th { border: 1px solid #000; padding: 5px 8px; font-size: 11px;
                       word-wrap: break-word; overflow-wrap: break-word; }
  table td.lbl { width: 33.3333%; font-weight: bold; }
  table.an { margin-top: 12px; }
  table.an th { font-weight: bold; text-align: center; }
  table.an th.p, table.an td.p { width: 33.3333%; text-align: left; }
  table.an th.c, table.an td.c { width: 22.2222%; }
  table.an td.c { text-align: center; }
  table.concl { margin-top: 12px; }

  .sig { margin-top: 64px; display: flex; justify-content: space-between; gap: 80px; }
  .sig-block { flex: 1; }
  .sig-rule { border-top: 1px solid #000; }
  .sig-lbl { font-size: 11px; font-weight: bold; padding-top: 4px; }
  table td.res { font-weight: bold; }

  /*
    THE VERDICT, STAMPED ACROSS THE PAGE — the browser's half of the watermark
    the PDF draws with rotated text.

    ⚠ z-index:-1 IS WHAT PUTS IT BEHIND THE CERTIFICATE. A position:fixed
      box is positioned, so without it the stamp paints OVER the parameter
      names instead of under them; with it the stamp paints above the page
      canvas and below every (transparent) block box.
    ⚠ print-color-adjust is set because a reader with "Background graphics"
      switched off must still get the marking — it is the whole point of the page.
    (No backticks anywhere in this block: it lives inside a JS template literal
     and one would end the string mid-stylesheet — the warning above the table
     rules, learned twice now.)
  */
  .wm { position: fixed; top: 50%; left: 50%;
        transform: translate(-50%, -50%) rotate(-40deg);
        font-size: 104px; font-weight: bold; letter-spacing: 4px;
        color: #DDDDDD; white-space: nowrap; z-index: -1; pointer-events: none;
        -webkit-print-color-adjust: exact; print-color-adjust: exact; }
</style>
</head>
<body>
  ${doc.watermark ? `<div class="wm">${esc(doc.watermark)}</div>` : ""}

  <div class="head">
    <img src="${esc(logoUrl())}" alt="" />
    <div class="who">
      <div class="co">${esc(doc.company)}</div>
      <div class="addr">${doc.addressLines.map((l) => esc(l)).join("<br />")}</div>
    </div>
  </div>

  <h1 class="title">${esc(doc.title)}</h1>

  <table class="info">
    ${infoRow("Product Name", doc.productName)}
    ${infoRow("Lot No", doc.lotNo)}
    ${infoRow("Issue Date", doc.issueDateDmy)}
  </table>

  <table class="an">
    <thead>
      <tr>
        <!-- Blank on purpose: the sheet leaves the parameter column unlabelled. -->
        <th class="p"></th>
        <th class="c">Standard</th>
        <th class="c">Observed</th>
        <th class="c">Test Equipment</th>
      </tr>
    </thead>
    <tbody>${dataRows}</tbody>
  </table>

  <table class="concl">
    <tr><td class="lbl">Conclusion :</td><td colspan="3">${esc(doc.conclusion)}</td></tr>
    <!-- The plain-text statement under the visual. On BOTH copies: a customer
         whose lot failed is told so on the paper, not only by a pale stamp. -->
    <tr><td class="lbl">Result :</td><td colspan="3" class="res">${esc(doc.resultText)}</td></tr>
    ${
      // INTERNAL COPY ONLY. coaVm decided that; nothing here re-checks the audience.
      doc.remarks === null
        ? ""
        : `<tr><td class="lbl">Remarks :</td><td colspan="3">${esc(doc.remarks)}</td></tr>`
    }
  </table>

  <div class="sig">${signOffs}</div>
</body>
</html>`;
}

/** Render one copy to a hidden iframe and open the browser print dialog. */
export function printCoa(coa: Coa, audience: CoaAudience): void {
  const html = renderCoaHtml(buildCoaDocument(coa, audience));
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  iframe.srcdoc = html;
  iframe.onload = () => {
    const win = iframe.contentWindow;
    if (!win) return;
    const cleanup = () => setTimeout(() => iframe.remove(), 500);
    win.onafterprint = cleanup;
    /**
     * ⚠ WAIT FOR THE LOGO. `onload` fires when the DOCUMENT is parsed, which on a
     *   srcdoc iframe can precede the image finishing — and printing then produces
     *   a certificate with no letterhead. Give the image its own load/error hook
     *   and print from there; the timeout is the backstop for a cached or broken
     *   image that never fires either.
     */
    const img = win.document.querySelector("img");
    let printed = false;
    const go = () => {
      if (printed) return;
      printed = true;
      win.focus();
      win.print();
    };
    if (img && !img.complete) {
      img.addEventListener("load", go, { once: true });
      img.addEventListener("error", go, { once: true });
      setTimeout(go, 2000);
    } else {
      go();
    }
    // Fallback cleanup in case afterprint never fires (some browsers).
    setTimeout(cleanup, 60000);
  };
  document.body.appendChild(iframe);
}
