import type { IssueSlipExport } from "./exportIssueSlip";

/**
 * Print an issue slip — the same "Raw Material Details & Feeding Sequence" form as
 * the Excel export, rendered as HTML and sent to the browser print dialog via a
 * hidden iframe. Used for the original issue slip and (with an AIS view-model)
 * for an Additional Issue Slip; the layout is identical, only the data differs.
 *
 * The "Raw Material Batch Number" column shows the issued lot number captured at
 * the Material Handover step once the card has progressed (blank before that).
 */

const COMPANY = "Orange O Tec Enterprises Pvt. Ltd.";
const ADDRESS =
  "Shed No. A2/7111, Road No.71, Gate No.: 01 G.I.D.C Sachin, Surat – 394230, (Guj.) India.";
const SIGN_OFFS = ["RM Slip Provider", "Store Verify", "Batch Operator", "Chemist"];

const round2 = (n: number) => Math.round(n * 100) / 100;
const n2 = (n: number | null | undefined) => (n == null ? "" : n.toFixed(2));
const pct = (n: number | null) => (n == null ? "" : `${n.toFixed(2)}%`);

function esc(v: string | number | null | undefined): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Build the printable HTML document for an issue slip. */
export function renderIssueSlipHtml(vm: IssueSlipExport): string {
  // Same rule as the Excel export: the card's own split wins; the normalised
  // fallback is only for legacy cards. See IssueSlipLine.proportionPct.
  const totalTheo = vm.lines.reduce((a, l) => a + (l.theoreticalKg ?? 0), 0);
  const rows = vm.lines.map((l) => ({
    name: l.productName,
    prop:
      l.proportionPct != null
        ? round2(l.proportionPct)
        : totalTheo > 0 && l.theoreticalKg != null
          ? round2((l.theoreticalKg / totalTheo) * 100)
          : null,
    theo: l.theoreticalKg,
    batch: l.rmBatchNo,
    actual: l.actualIssued,
  }));
  const propTotal = round2(rows.reduce((a, r) => a + (r.prop ?? 0), 0));
  const theoTotal = round2(totalTheo);

  const dataRows = rows
    .map(
      (r, i) => `<tr>
        <td class="c">${i + 1}</td>
        <td>${esc(r.name)}</td>
        <td class="r">${esc(pct(r.prop))}</td>
        <td class="r">${esc(n2(r.theo))}</td>
        <td>${esc(r.batch)}</td>
        <td class="r">${esc(n2(r.actual))}</td>
        <td></td>
      </tr>`,
    )
    .join("");

  // Two blank spare rows (hand additions), matching the paper form.
  const spareRows = `<tr class="spare"><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`.repeat(2);

  const infoRow = (label: string, value: string) =>
    `<tr><td class="lbl">${esc(label)}</td><td class="val" colspan="6">${esc(value)}</td></tr>`;

  const signOffRows = SIGN_OFFS.map(
    (label, i) => `<tr>
      <td class="so-n">${i + 1}</td>
      <td class="so-lbl">${esc(label)}</td>
      <td class="so-c">:</td>
      <td class="so-line"></td>
    </tr>`,
  ).join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Issue Slip ${esc(vm.jobcardNo)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; font-size: 11px; }
  .company { text-align: center; font-size: 16px; font-weight: bold; color: #0B2447; }
  .addr { text-align: center; font-size: 9px; color: #555; margin: 2px 0 10px; }
  table { border-collapse: collapse; width: 100%; }
  table.info td { border: 1px solid #999; padding: 4px 8px; font-size: 11px; }
  table.info .lbl { background: #EDEFF2; font-weight: bold; width: 36%; }
  .sectitle { background: #0B2447; color: #fff; font-weight: bold; padding: 5px 8px; font-size: 12px; margin: 10px 0 0; }
  table.rm th, table.rm td { border: 1px solid #999; padding: 4px 6px; font-size: 10.5px; vertical-align: middle; }
  table.rm th { background: #C9D2DE; text-align: center; }
  table.rm td.c { text-align: center; }
  table.rm td.r { text-align: right; }
  table.rm tr.band td { background: #DEE3EA; height: 16px; }
  table.rm tr.spare td { height: 16px; }
  table.rm tr.total td { background: #DEE3EA; font-weight: bold; }
  .sig { margin-top: 22px; display: flex; justify-content: space-between; gap: 40px; }
  .sig .block { flex: 1; }
  .sig .line { border-top: 1px solid #000; margin-top: 26px; padding-top: 3px; font-size: 10px; color: #555; }
  table.signoffs { margin-top: 16px; }
  table.signoffs td { padding: 2px 4px; font-size: 11px; vertical-align: bottom; height: 22px; }
  table.signoffs .so-n { width: 22px; text-align: center; }
  table.signoffs .so-lbl { width: 150px; font-weight: bold; white-space: nowrap; }
  table.signoffs .so-c { width: 12px; }
  table.signoffs .so-line { border-bottom: 1px solid #000; }
  .trace { margin-top: 14px; font-size: 9px; font-style: italic; color: #777; }
</style>
</head>
<body>
  <div class="company">${esc(COMPANY)}</div>
  <div class="addr">${esc(ADDRESS)}</div>

  <table class="info">
    ${infoRow("Product Name & Product Code Number", vm.productName)}
    ${infoRow("Print Head Type", "")}
    ${infoRow("Product Batch Number", vm.jobcardNo)}
    ${infoRow("Production Quantity (In Kgs.)", n2(vm.productionQty))}
    ${infoRow("Date", vm.submittedAtDMY)}
  </table>

  <div class="sectitle">1&nbsp;&nbsp;&nbsp;Raw Material Details &amp; Feeding Sequence</div>
  <table class="rm">
    <thead>
      <tr>
        <th style="width:36px">Sr. No</th>
        <th>Product Name</th>
        <th style="width:80px">Proportion Dosage (In %)</th>
        <th style="width:90px">Theoretical Weighing (In Kgs.)</th>
        <th style="width:120px">Raw Material Batch Number</th>
        <th style="width:80px">Actual Issued (In Kgs.)</th>
        <th style="width:120px">Remarks</th>
      </tr>
    </thead>
    <tbody>
      <tr class="band"><td colspan="7"></td></tr>
      ${dataRows}
      ${spareRows}
      <tr class="total">
        <td></td><td>TOTAL</td>
        <td class="r">${esc(pct(propTotal))}</td>
        <td class="r">${esc(n2(theoTotal))}</td>
        <td></td><td></td><td></td>
      </tr>
    </tbody>
  </table>

  <div class="sig">
    <div class="block"><div class="line">Prepared by / Sign</div></div>
    <div class="block"><div class="line">Approved by / Sign</div></div>
  </div>

  <table class="signoffs">${signOffRows}</table>

  <div class="trace">Raised by ${esc(vm.requesterName)} on ${esc(vm.submittedAtDMY)}</div>
</body>
</html>`;
}

/** Render the issue slip to a hidden iframe and open the browser print dialog. */
export function printIssueSlip(vm: IssueSlipExport): void {
  const html = renderIssueSlipHtml(vm);
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  iframe.srcdoc = html;
  iframe.onload = () => {
    const win = iframe.contentWindow;
    if (!win) return;
    const cleanup = () => setTimeout(() => iframe.remove(), 500);
    win.onafterprint = cleanup;
    win.focus();
    win.print();
    // Fallback cleanup in case afterprint never fires (some browsers).
    setTimeout(cleanup, 60000);
  };
  document.body.appendChild(iframe);
}
