import * as XLSX from "xlsx-js-style";
import { saveAs } from "file-saver";
import { dmy, packFinalQty } from "./format";
import type { ProductionRequest } from "../types";

/**
 * REPACKAGING SLIP → Excel + Print.
 *
 * The production issue slip is a raw-material document — "Raw Material Details &
 * Feeding Sequence", seven columns of theoretical weights and feeding order. A
 * repackaging card has no raw material at all, so that form would print an empty
 * table under a heading that doesn't apply.
 *
 * This is its counterpart: same company header and form idiom (deliberately, so
 * the two read as one family), but the material table is the PACKAGING list.
 * Kept as its own module rather than branching inside exportIssueSlip so the
 * live production slip is not touched at all.
 */

export interface RepackSlipLine {
  /** Packaging-item name (from the packaging master). */
  itemName: string;
  qty: number | null;
  extra: number | null;
  /** qty + extra, server-computed. */
  total: number | null;
  unitName: string;
}

export interface RepackSlipExport {
  /** Lot/Batch Card number → "Product Batch Number" on the form. */
  jobcardNo: string;
  reqNo: string;
  /** FG item name → "Product Name & Product Code Number". */
  productName: string;
  /** The ONE quantity: with no wastage, packed qty = FG qty. */
  quantity: number | null;
  unitName: string;
  requesterName: string;
  /** Pre-formatted dd-mm-yyyy (caller uses `dmy`). */
  submittedAtDMY: string;
  remarks: string;
  lines: RepackSlipLine[];
}

export function buildRepackSlipExport(
  r: ProductionRequest,
  lookups: {
    fgItemName: (id: string | null) => string;
    packagingItemName: (id: string | null) => string;
    unitName: (id: string | null) => string;
    fgUnitName: (fgItemId: string | null) => string;
  },
): RepackSlipExport {
  return {
    jobcardNo: r.jobcardNo,
    reqNo: r.reqNo,
    productName: lookups.fgItemName(r.fgItemId),
    quantity: r.fgQty,
    unitName: lookups.fgUnitName(r.fgItemId),
    requesterName: r.requesterName,
    // The JOB date — see issueSlipVm. Falls back for pre-job-date cards.
    submittedAtDMY: dmy(r.issueDate ?? r.submittedAt),
    remarks: r.issueRemarks ?? "",
    lines: r.pmhBomLines.map((l) => ({
      itemName: lookups.packagingItemName(l.packagingItemId),
      qty: l.qty,
      extra: l.extra,
      total: packFinalQty(l),
      unitName: lookups.unitName(l.unitId),
    })),
  };
}

// ── Shared look (mirrors batchCard.ts, which mirrors the paper forms) ─────────
const COMPANY = "Orange O Tec Enterprises Pvt. Ltd.";
const ADDRESS = "Shed No. A2/7111, Road No.71, Gate No.: 01 G.I.D.C Sachin, Surat – 394230, (Guj.) India.";
const NCOLS = 6; // Sr | Packaging Item | Qty | Extra | Total | Unit
const NUM = "0.00";
const round2 = (n: number) => Math.round(n * 100) / 100;

const thin = { style: "thin", color: { rgb: "9AA0A6" } };
const BORDER = { top: thin, bottom: thin, left: thin, right: thin };
const TITLE = { font: { bold: true, sz: 14, color: { rgb: "0B2447" } }, alignment: { horizontal: "center", vertical: "center" } };
const ADDR = { font: { sz: 9, color: { rgb: "555555" } }, alignment: { horizontal: "center" } };
const BANNER = { font: { bold: true, sz: 12, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "0B2447" } }, alignment: { horizontal: "center", vertical: "center" } };
const LABEL = { font: { bold: true, sz: 10, color: { rgb: "1F2937" } }, fill: { fgColor: { rgb: "EDEFF2" } }, alignment: { vertical: "center", horizontal: "left", wrapText: true }, border: BORDER };
const VALUE = { font: { sz: 10 }, alignment: { vertical: "center", horizontal: "left" }, border: BORDER };
const VALUE_R = { font: { sz: 10 }, alignment: { vertical: "center", horizontal: "right" }, border: BORDER };
const COLHEAD = { font: { bold: true, sz: 9.5, color: { rgb: "1F2937" } }, fill: { fgColor: { rgb: "C9D2DE" } }, alignment: { vertical: "center", horizontal: "center", wrapText: true }, border: BORDER };
const CELL_L = { font: { sz: 10 }, alignment: { vertical: "center", horizontal: "left" }, border: BORDER };
const CELL_C = { font: { sz: 10 }, alignment: { vertical: "center", horizontal: "center" }, border: BORDER };
const CELL_R = { font: { sz: 10 }, alignment: { vertical: "center", horizontal: "right" }, border: BORDER };
const TOTAL_L = { font: { bold: true, sz: 10 }, fill: { fgColor: { rgb: "DEE3EA" } }, alignment: { vertical: "center", horizontal: "left" }, border: BORDER };
const TOTAL_R = { font: { bold: true, sz: 10 }, fill: { fgColor: { rgb: "DEE3EA" } }, alignment: { vertical: "center", horizontal: "right" }, border: BORDER };
const NOTE = { font: { sz: 9, italic: true, color: { rgb: "555555" } }, alignment: { horizontal: "left", wrapText: true } };

function style(ws: XLSX.WorkSheet, r: number, c: number, s: object, z?: string): void {
  const addr = XLSX.utils.encode_cell({ r, c });
  const sheet = ws as Record<string, { s?: object; z?: string; t?: string; v?: unknown }>;
  const cell = sheet[addr] ?? { t: "s", v: "" };
  cell.s = { ...(cell.s ?? {}), ...s };
  if (z) cell.z = z;
  sheet[addr] = cell;
}
function styleSpan(ws: XLSX.WorkSheet, r: number, c0: number, c1: number, s: object, z?: string): void {
  for (let c = c0; c <= c1; c++) style(ws, r, c, s, z);
}

const NO_WASTAGE_NOTE =
  "Repacked, not produced — no raw material and no wastage, so the packed quantity equals the FG quantity. " +
  "This card bypasses material handover, RM transfer, quality checking, the log book, production entry and M/C testing.";

export function exportRepackSlipXlsx(vm: RepackSlipExport): void {
  const totalQty = round2(vm.lines.reduce((a, l) => a + (l.qty ?? 0), 0));
  const totalExtra = round2(vm.lines.reduce((a, l) => a + (l.extra ?? 0), 0));
  const totalAll = round2(vm.lines.reduce((a, l) => a + (l.total ?? 0), 0));

  const aoa: (string | number)[][] = [];
  const push = (...cells: (string | number)[]): number => {
    const row = cells.slice(0, NCOLS);
    while (row.length < NCOLS) row.push("");
    aoa.push(row);
    return aoa.length - 1;
  };

  const rCompany = push(COMPANY);
  const rAddr = push(ADDRESS);
  const rBanner = push("REPACKAGING SLIP");
  push();

  const info: [string, string | number][] = [
    ["Product Name & Product Code Number", vm.productName],
    ["LOT No. / Product Batch Number", vm.jobcardNo],
    ["Reference No.", vm.reqNo],
    [`Quantity to Repack${vm.unitName ? ` (in ${vm.unitName})` : ""}`, vm.quantity ?? ""],
    ["Raised By", vm.requesterName],
    ["Date", vm.submittedAtDMY],
    ["Remarks", vm.remarks],
  ];
  const infoRows = info.map(([label, value]) => push(label, "", value));
  push();

  const rHead = push("Sr. No", "Packaging Item", "Qty", "Extra", "Total", "Unit");
  const rDataStart = aoa.length;
  vm.lines.forEach((l, i) => push(i + 1, l.itemName, l.qty ?? "", l.extra ?? "", l.total ?? "", l.unitName));
  const rDataEnd = aoa.length - 1;
  const rTotal = push("", "TOTAL", totalQty, totalExtra, totalAll, "");
  push();
  const rNote = push(NO_WASTAGE_NOTE);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 7 }, { wch: 34 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];

  const merges: XLSX.Range[] = [
    { s: { r: rCompany, c: 0 }, e: { r: rCompany, c: NCOLS - 1 } },
    { s: { r: rAddr, c: 0 }, e: { r: rAddr, c: NCOLS - 1 } },
    { s: { r: rBanner, c: 0 }, e: { r: rBanner, c: NCOLS - 1 } },
    { s: { r: rNote, c: 0 }, e: { r: rNote, c: NCOLS - 1 } },
  ];
  for (const r of infoRows) {
    merges.push({ s: { r, c: 0 }, e: { r, c: 1 } }); // label A:B
    merges.push({ s: { r, c: 2 }, e: { r, c: NCOLS - 1 } }); // value C:F
  }
  ws["!merges"] = merges;

  const rowInfo: { hpt: number }[] = [];
  rowInfo[rCompany] = { hpt: 22 };
  rowInfo[rBanner] = { hpt: 20 };
  rowInfo[rHead] = { hpt: 26 };
  rowInfo[rNote] = { hpt: 28 };
  ws["!rows"] = rowInfo;

  style(ws, rCompany, 0, TITLE);
  style(ws, rAddr, 0, ADDR);
  styleSpan(ws, rBanner, 0, NCOLS - 1, BANNER);
  for (const [i, r] of infoRows.entries()) {
    const isQty = String(info[i][0]).startsWith("Quantity to Repack");
    styleSpan(ws, r, 0, 1, LABEL);
    styleSpan(ws, r, 2, NCOLS - 1, isQty ? VALUE_R : VALUE, isQty ? NUM : undefined);
  }
  styleSpan(ws, rHead, 0, NCOLS - 1, COLHEAD);
  for (let r = rDataStart; r <= rDataEnd; r++) {
    style(ws, r, 0, CELL_C);
    style(ws, r, 1, CELL_L);
    style(ws, r, 2, CELL_R, NUM);
    style(ws, r, 3, CELL_R, NUM);
    style(ws, r, 4, CELL_R, NUM);
    style(ws, r, 5, CELL_C);
  }
  styleSpan(ws, rTotal, 0, NCOLS - 1, TOTAL_L);
  style(ws, rTotal, 2, TOTAL_R, NUM);
  style(ws, rTotal, 3, TOTAL_R, NUM);
  style(ws, rTotal, 4, TOTAL_R, NUM);
  style(ws, rNote, 0, NOTE);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Repackaging Slip");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  saveAs(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `Repackaging-Slip-${vm.jobcardNo.replace(/[\\/:*?"<>|]+/g, "-") || "slip"}.xlsx`,
  );
}

// ── Print ─────────────────────────────────────────────────────────────────────
const n2 = (n: number | null | undefined) => (n == null ? "" : n.toFixed(2));
function esc(v: string | number | null | undefined): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderRepackSlipHtml(vm: RepackSlipExport): string {
  const totalQty = round2(vm.lines.reduce((a, l) => a + (l.qty ?? 0), 0));
  const totalExtra = round2(vm.lines.reduce((a, l) => a + (l.extra ?? 0), 0));
  const totalAll = round2(vm.lines.reduce((a, l) => a + (l.total ?? 0), 0));

  const dataRows = vm.lines
    .map(
      (l, i) => `<tr>
        <td class="c">${i + 1}</td><td>${esc(l.itemName)}</td>
        <td class="r">${esc(n2(l.qty))}</td>
        <td class="r">${esc(n2(l.extra))}</td>
        <td class="r">${esc(n2(l.total))}</td>
        <td class="c">${esc(l.unitName)}</td>
      </tr>`,
    )
    .join("");

  const infoRow = (label: string, value: string) =>
    `<tr><td class="lbl">${esc(label)}</td><td class="val" colspan="5">${esc(value)}</td></tr>`;

  return `<!doctype html>
<html><head><meta charset="utf-8" /><title>Repackaging Slip ${esc(vm.jobcardNo)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; font-size: 10.5px; }
  .company { text-align: center; font-size: 16px; font-weight: bold; color: #0B2447; }
  .addr { text-align: center; font-size: 9px; color: #555; margin: 2px 0 8px; }
  .banner { background: #0B2447; color: #fff; font-weight: bold; text-align: center; padding: 5px; font-size: 12px; }
  table { border-collapse: collapse; width: 100%; }
  table.info td { border: 1px solid #999; padding: 4px 8px; overflow-wrap: anywhere; }
  table.info .lbl { background: #EDEFF2; font-weight: bold; width: 34%; }
  table.pk { margin-top: 8px; table-layout: fixed; }
  table.pk th, table.pk td { border: 1px solid #999; padding: 4px 6px; font-size: 10px; overflow-wrap: anywhere; word-break: break-word; }
  table.pk th { background: #C9D2DE; text-align: center; }
  table.pk td.c { text-align: center; } table.pk td.r { text-align: right; }
  table.pk tr.total td { background: #DEE3EA; font-weight: bold; }
  .note { margin-top: 10px; font-size: 9px; font-style: italic; color: #555; }
</style></head>
<body>
  <div class="company">${esc(COMPANY)}</div>
  <div class="addr">${esc(ADDRESS)}</div>
  <div class="banner">REPACKAGING SLIP</div>
  <table class="info">
    ${infoRow("Product Name & Product Code Number", vm.productName)}
    ${infoRow("LOT No. / Product Batch Number", vm.jobcardNo)}
    ${infoRow("Reference No.", vm.reqNo)}
    ${infoRow(`Quantity to Repack${vm.unitName ? ` (in ${vm.unitName})` : ""}`, n2(vm.quantity))}
    ${infoRow("Raised By", vm.requesterName)}
    ${infoRow("Date", vm.submittedAtDMY)}
    ${infoRow("Remarks", vm.remarks)}
  </table>
  <table class="pk">
    <thead><tr>
      <th style="width:8%">Sr. No</th><th style="width:40%">Packaging Item</th>
      <th style="width:13%">Qty</th><th style="width:13%">Extra</th>
      <th style="width:13%">Total</th><th style="width:13%">Unit</th>
    </tr></thead>
    <tbody>
      ${dataRows}
      <tr class="total"><td></td><td>TOTAL</td>
        <td class="r">${esc(n2(totalQty))}</td><td class="r">${esc(n2(totalExtra))}</td>
        <td class="r">${esc(n2(totalAll))}</td><td></td></tr>
    </tbody>
  </table>
  <div class="note">${esc(NO_WASTAGE_NOTE)}</div>
</body></html>`;
}

export function printRepackSlip(vm: RepackSlipExport): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  iframe.srcdoc = renderRepackSlipHtml(vm);
  iframe.onload = () => {
    const win = iframe.contentWindow;
    if (!win) return;
    const cleanup = () => setTimeout(() => iframe.remove(), 500);
    win.onafterprint = cleanup;
    win.focus();
    win.print();
    setTimeout(cleanup, 60000);
  };
  document.body.appendChild(iframe);
}
