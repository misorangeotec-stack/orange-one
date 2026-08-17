import * as XLSX from "xlsx-js-style";
import { saveAs } from "file-saver";
import { dmy } from "./format";
import type { ProductionRequest } from "../types";

/**
 * Batch Card report — generated AFTER the Log Book Entry step (transfer_slip) is
 * done. It reprises the issue slip's raw-material list but with the ACTUAL numbers
 * captured through material handover + log book: Actual Transfer (handover qty),
 * Actual Use (log-book use), Variance (transfer − use), plus the output metrics
 * (expected/actual output, scrap, lab testing, packed, loosed) and the packaging
 * used. Same company header + form idiom as the issue slip export/print.
 *
 * Sources (all on ProductionRequest, written by the log-book RPC):
 *   line.theoretical = requestedQty · transfer = handoverQty · use = actualUse ·
 *   variance = transfer − use · batch = lotNo (from tsBomLines / LogBookLine)
 *   metrics = peExpectedQty / scrapQty+tsProductionLoss / actualQty / peLabQty /
 *             tsPackedQty / tsLooseQty ; packaging = pmhBomLines
 */

export interface BatchCardLine {
  itemName: string;
  proportionPct: number | null; // derived from theoretical
  theoreticalKg: number | null; // requestedQty
  actualTransfer: number | null; // handoverQty
  actualUse: number | null; // actualUse
  variance: number | null; // transfer − use
  batchNo: string; // lotNo
}

export interface BatchCardExport {
  productName: string;
  lotNo: string; // jobcardNo (Lot/Batch Card number)
  batchNumber: string; // batchCardNo (captured at the log book)
  productionQty: number | null; // fgQty + AIS top-ups
  dateStart: string; // dd-mm-yyyy (handover / raised)
  dateEnd: string; // dd-mm-yyyy (log book done)
  lines: BatchCardLine[];
  metrics: {
    expectedOutput: number | null;
    scrap: number | null;
    actualOutput: number | null;
    labTesting: number | null;
    packedQty: number | null;
    loosedQty: number | null;
  };
  packaging: { name: string; qty: number | null }[];
}

/** Build the Batch Card view-model from a completed (log-book-done) request. */
export function buildBatchCardExport(
  r: ProductionRequest,
  lookups: {
    fgItemName: (id: string | null) => string;
    rawMaterialName: (id: string | null) => string;
    packagingItemName: (id: string | null) => string;
  },
): BatchCardExport {
  const totalTheo = r.tsBomLines.reduce((a, l) => a + (l.requestedQty ?? 0), 0);
  const aisAdditional = r.aisRounds.reduce((a, rd) => a + (rd.aisQty ?? 0), 0);
  const productionQty = r.fgQty != null ? r.fgQty + aisAdditional : null;

  /**
   * ⚠ Proportion is a share of the BATCH, not of the line total.
   *
   * This used to normalise the requested quantities to their own sum, which
   * matched the real split only while the intake form forced the lines to add up
   * to the FG quantity. They no longer have to — a formulation totalling a third
   * of the batch is legitimate — and normalising would inflate every line and
   * still print a confident 100%, disagreeing with both the BOM master and the
   * issue slip. Falls back to the old behaviour only when the batch quantity is
   * unknown (there is nothing better to divide by).
   */
  const proportionOf = (qty: number | null): number | null => {
    if (qty == null) return null;
    const base = productionQty && productionQty > 0 ? productionQty : totalTheo;
    return base > 0 ? Math.round((qty / base) * 10000) / 100 : null;
  };

  return {
    productName: lookups.fgItemName(r.fgItemId),
    lotNo: r.jobcardNo,
    batchNumber: r.batchCardNo ?? "",
    productionQty,
    // Handover date if there is one, else the JOB date — same chain as the issue
    // slip, so a back-dated card doesn't print two different "start" dates.
    dateStart: dmy(r.mhActualDate ?? r.issueDate ?? r.submittedAt),
    dateEnd: dmy(r.tsActualDate ?? r.tsAt),
    lines: r.tsBomLines.map((l) => {
      const transfer = l.handoverQty;
      const use = l.actualUse;
      return {
        itemName: l.rawMaterialName || lookups.rawMaterialName(l.rawMaterialId),
        proportionPct: proportionOf(l.requestedQty),
        theoreticalKg: l.requestedQty,
        actualTransfer: transfer,
        actualUse: use,
        variance: transfer != null && use != null ? Math.round((transfer - use) * 1000) / 1000 : null,
        batchNo: l.lotNo ?? "",
      };
    }),
    metrics: {
      expectedOutput: r.peExpectedQty,
      // "Scrap (Expected − Actual)" = scrap + production loss (the two loss terms).
      scrap:
        r.scrapQty == null && r.tsProductionLoss == null
          ? null
          : (r.scrapQty ?? 0) + (r.tsProductionLoss ?? 0),
      actualOutput: r.actualQty,
      labTesting: r.peLabQty,
      packedQty: r.tsPackedQty,
      loosedQty: r.tsLooseQty,
    },
    // Packaging shows the TOTAL used (qty + extra), not just the base qty — use the
    // server-computed line total, falling back to qty+extra for legacy rows.
    packaging: r.pmhBomLines
      .filter((p) => p.packagingItemId || p.qty != null || p.total != null)
      .map((p) => ({
        name: lookups.packagingItemName(p.packagingItemId),
        qty: p.total != null ? p.total : p.qty != null || p.extra != null ? (p.qty ?? 0) + (p.extra ?? 0) : null,
      })),
  };
}

// ── Excel export ──────────────────────────────────────────────────────────────
const NCOLS = 8; // Sr | Item | Prop% | Theoretical | Transfer | Use | Variance | Batch No
const NUM = "0.00";
const PCT = '0.00"%"';
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
const SUBHEAD = { font: { bold: true, sz: 10, color: { rgb: "0B2447" } } };

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

export function exportBatchCardXlsx(vm: BatchCardExport): void {
  const totalTheo = round2(vm.lines.reduce((a, l) => a + (l.theoreticalKg ?? 0), 0));
  const totalTransfer = round2(vm.lines.reduce((a, l) => a + (l.actualTransfer ?? 0), 0));
  const totalUse = round2(vm.lines.reduce((a, l) => a + (l.actualUse ?? 0), 0));
  const totalVar = round2(totalTransfer - totalUse);

  const aoa: (string | number)[][] = [];
  const push = (...cells: (string | number)[]): number => {
    const row = cells.slice(0, NCOLS);
    while (row.length < NCOLS) row.push("");
    aoa.push(row);
    return aoa.length - 1;
  };

  const rCompany = push("Orange O Tec Enterprises Pvt. Ltd.");
  const rAddr = push("Shed No. A2/7111, Road No.71, Gate No.: 01 G.I.D.C Sachin, Surat – 394230, (Guj.) India.");
  const rBanner = push("BATCH CARD");
  push();

  const info: [string, string | number][] = [
    ["Product Name & Product Code Number", vm.productName],
    ["LOT No.", vm.lotNo],
    ["Batch Number", vm.batchNumber],
    ["Production Quantity (In Kgs.)", vm.productionQty ?? ""],
    ["Date Start", vm.dateStart],
    ["Date End", vm.dateEnd],
  ];
  const infoRows = info.map(([label, value]) => push(label, "", "", value));
  push();

  const rHead = push(
    "Sr. No",
    "Item Name",
    "Proportion Per%",
    "Theoretical WT (In Kgs.)",
    "Actual Transfer (In Kgs.)",
    "Actual Use (In Kgs.)",
    "Variance",
    "Batch No.",
  );
  const rDataStart = aoa.length;
  vm.lines.forEach((l, i) =>
    push(
      i + 1,
      l.itemName,
      l.proportionPct ?? "",
      l.theoreticalKg ?? "",
      l.actualTransfer ?? "",
      l.actualUse ?? "",
      l.variance ?? "",
      l.batchNo || "",
    ),
  );
  const rDataEnd = aoa.length - 1;
  const rTotal = push("", "TOTAL", "", totalTheo, totalTransfer, totalUse, totalVar, "");
  push();

  // Output metrics (left) + packaging (right), side by side.
  const rMetricsHead = push("Output Metrics", "", "", "", "Packaging", "", "", "");
  const metricRows: [string, number | null][] = [
    ["Expected Output (In KG)", vm.metrics.expectedOutput],
    ["Scrap (Expected − Actual)", vm.metrics.scrap],
    ["Actual Output (In KG)", vm.metrics.actualOutput],
    ["Lab Testing (In KG)", vm.metrics.labTesting],
    ["Packed Quantity (In KG)", vm.metrics.packedQty],
    ["Loosed Quantity (In KG)", vm.metrics.loosedQty],
  ];
  const nBlock = Math.max(metricRows.length, vm.packaging.length);
  const blockStart = aoa.length;
  for (let i = 0; i < nBlock; i++) {
    const m = metricRows[i];
    const p = vm.packaging[i];
    push(
      m ? m[0] : "",
      "",
      m ? (m[1] ?? "") : "",
      "",
      p ? p.name : "",
      "",
      p ? (p.qty ?? "") : "",
      "",
    );
  }
  const blockEnd = aoa.length - 1;

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 6 }, { wch: 28 }, { wch: 12 }, { wch: 15 }, { wch: 15 }, { wch: 13 }, { wch: 11 }, { wch: 18 }];

  const merges: XLSX.Range[] = [
    { s: { r: rCompany, c: 0 }, e: { r: rCompany, c: NCOLS - 1 } },
    { s: { r: rAddr, c: 0 }, e: { r: rAddr, c: NCOLS - 1 } },
    { s: { r: rBanner, c: 0 }, e: { r: rBanner, c: NCOLS - 1 } },
  ];
  for (const r of infoRows) {
    merges.push({ s: { r, c: 0 }, e: { r, c: 2 } }); // label A:C
    merges.push({ s: { r, c: 3 }, e: { r, c: NCOLS - 1 } }); // value D:H
  }
  merges.push({ s: { r: rMetricsHead, c: 0 }, e: { r: rMetricsHead, c: 3 } });
  merges.push({ s: { r: rMetricsHead, c: 4 }, e: { r: rMetricsHead, c: NCOLS - 1 } });
  for (let r = blockStart; r <= blockEnd; r++) {
    merges.push({ s: { r, c: 0 }, e: { r, c: 1 } }); // metric label A:B
    merges.push({ s: { r, c: 2 }, e: { r, c: 3 } }); // metric value C:D
    merges.push({ s: { r, c: 4 }, e: { r, c: 5 } }); // pkg label E:F
    merges.push({ s: { r, c: 6 }, e: { r, c: NCOLS - 1 } }); // pkg value G:H
  }
  ws["!merges"] = merges;

  const rowInfo: { hpt: number }[] = [];
  rowInfo[rCompany] = { hpt: 22 };
  rowInfo[rBanner] = { hpt: 20 };
  rowInfo[rHead] = { hpt: 30 };
  ws["!rows"] = rowInfo;

  style(ws, rCompany, 0, TITLE);
  style(ws, rAddr, 0, ADDR);
  styleSpan(ws, rBanner, 0, NCOLS - 1, BANNER);
  for (const [i, r] of infoRows.entries()) {
    styleSpan(ws, r, 0, 2, LABEL);
    styleSpan(ws, r, 3, NCOLS - 1, info[i][0] === "Production Quantity (In Kgs.)" ? VALUE_R : VALUE, info[i][0] === "Production Quantity (In Kgs.)" ? NUM : undefined);
  }
  styleSpan(ws, rHead, 0, NCOLS - 1, COLHEAD);
  for (let r = rDataStart; r <= rDataEnd; r++) {
    style(ws, r, 0, CELL_C);
    style(ws, r, 1, CELL_L);
    style(ws, r, 2, CELL_R, PCT);
    style(ws, r, 3, CELL_R, NUM);
    style(ws, r, 4, CELL_R, NUM);
    style(ws, r, 5, CELL_R, NUM);
    style(ws, r, 6, CELL_R, NUM);
    style(ws, r, 7, CELL_L);
  }
  styleSpan(ws, rTotal, 0, NCOLS - 1, TOTAL_L);
  style(ws, rTotal, 3, TOTAL_R, NUM);
  style(ws, rTotal, 4, TOTAL_R, NUM);
  style(ws, rTotal, 5, TOTAL_R, NUM);
  style(ws, rTotal, 6, TOTAL_R, NUM);
  style(ws, rMetricsHead, 0, SUBHEAD);
  style(ws, rMetricsHead, 4, SUBHEAD);
  for (let r = blockStart; r <= blockEnd; r++) {
    styleSpan(ws, r, 0, 1, LABEL);
    styleSpan(ws, r, 2, 3, VALUE_R, NUM);
    styleSpan(ws, r, 4, 5, LABEL);
    styleSpan(ws, r, 6, NCOLS - 1, VALUE_R, NUM);
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Batch Card");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  saveAs(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `Batch-Card-${vm.lotNo.replace(/[\\/:*?"<>|]+/g, "-") || "card"}.xlsx`,
  );
}

// ── Print ─────────────────────────────────────────────────────────────────────
const n2 = (n: number | null | undefined) => (n == null ? "" : n.toFixed(2));
const pctTxt = (n: number | null) => (n == null ? "" : `${n.toFixed(2)}%`);
function esc(v: string | number | null | undefined): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderBatchCardHtml(vm: BatchCardExport): string {
  const totalTheo = round2(vm.lines.reduce((a, l) => a + (l.theoreticalKg ?? 0), 0));
  const totalTransfer = round2(vm.lines.reduce((a, l) => a + (l.actualTransfer ?? 0), 0));
  const totalUse = round2(vm.lines.reduce((a, l) => a + (l.actualUse ?? 0), 0));
  const totalVar = round2(totalTransfer - totalUse);

  const dataRows = vm.lines
    .map(
      (l, i) => `<tr>
        <td class="c">${i + 1}</td><td>${esc(l.itemName)}</td>
        <td class="r">${esc(pctTxt(l.proportionPct))}</td>
        <td class="r">${esc(n2(l.theoreticalKg))}</td>
        <td class="r">${esc(n2(l.actualTransfer))}</td>
        <td class="r">${esc(n2(l.actualUse))}</td>
        <td class="r">${esc(n2(l.variance))}</td>
        <td>${esc(l.batchNo)}</td>
      </tr>`,
    )
    .join("");

  const infoRow = (label: string, value: string) =>
    `<tr><td class="lbl">${esc(label)}</td><td class="val" colspan="7">${esc(value)}</td></tr>`;

  const metrics: [string, number | null][] = [
    ["Expected Output (In KG)", vm.metrics.expectedOutput],
    ["Scrap (Expected − Actual)", vm.metrics.scrap],
    ["Actual Output (In KG)", vm.metrics.actualOutput],
    ["Lab Testing (In KG)", vm.metrics.labTesting],
    ["Packed Quantity (In KG)", vm.metrics.packedQty],
    ["Loosed Quantity (In KG)", vm.metrics.loosedQty],
  ];
  const nBlock = Math.max(metrics.length, vm.packaging.length);
  const blockRows = Array.from({ length: nBlock }, (_, i) => {
    const m = metrics[i];
    const p = vm.packaging[i];
    return `<tr>
      <td class="mlbl">${m ? esc(m[0]) : ""}</td><td class="mval">${m ? esc(n2(m[1])) : ""}</td>
      <td class="mlbl">${p ? esc(p.name) : ""}</td><td class="mval">${p ? esc(n2(p.qty)) : ""}</td>
    </tr>`;
  }).join("");

  return `<!doctype html>
<html><head><meta charset="utf-8" /><title>Batch Card ${esc(vm.lotNo)}</title>
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
  /* Fixed layout so the 8 percentage-width columns always fit the page and never
     overflow off the right edge (long item names wrap instead of forcing width). */
  table.rm { margin-top: 8px; table-layout: fixed; }
  table.rm th, table.rm td { border: 1px solid #999; padding: 4px 6px; font-size: 10px; overflow-wrap: anywhere; word-break: break-word; }
  table.rm th { background: #C9D2DE; text-align: center; }
  table.rm td.c { text-align: center; } table.rm td.r { text-align: right; }
  table.rm tr.total td { background: #DEE3EA; font-weight: bold; }
  .blocks { margin-top: 10px; }
  .blocks td { border: 1px solid #999; padding: 4px 8px; }
  .blocks .mlbl { background: #EDEFF2; font-weight: bold; width: 30%; }
  .blocks .mval { text-align: right; width: 20%; }
  .subhead { font-weight: bold; color: #0B2447; margin: 10px 0 4px; }
</style></head>
<body>
  <div class="company">Orange O Tec Enterprises Pvt. Ltd.</div>
  <div class="addr">Shed No. A2/7111, Road No.71, Gate No.: 01 G.I.D.C Sachin, Surat – 394230, (Guj.) India.</div>
  <div class="banner">BATCH CARD</div>
  <table class="info">
    ${infoRow("Product Name & Product Code Number", vm.productName)}
    ${infoRow("LOT No.", vm.lotNo)}
    ${infoRow("Batch Number", vm.batchNumber)}
    ${infoRow("Production Quantity (In Kgs.)", n2(vm.productionQty))}
    ${infoRow("Date Start", vm.dateStart)}
    ${infoRow("Date End", vm.dateEnd)}
  </table>
  <table class="rm">
    <thead><tr>
      <th style="width:5%">Sr. No</th><th style="width:22%">Item Name</th>
      <th style="width:11%">Proportion Per%</th><th style="width:13%">Theoretical WT (In Kgs.)</th>
      <th style="width:13%">Actual Transfer (In Kgs.)</th><th style="width:12%">Actual Use (In Kgs.)</th>
      <th style="width:10%">Variance</th><th style="width:14%">Batch No.</th>
    </tr></thead>
    <tbody>
      ${dataRows}
      <tr class="total"><td></td><td>TOTAL</td><td></td>
        <td class="r">${esc(n2(totalTheo))}</td><td class="r">${esc(n2(totalTransfer))}</td>
        <td class="r">${esc(n2(totalUse))}</td><td class="r">${esc(n2(totalVar))}</td><td></td></tr>
    </tbody>
  </table>
  <table class="blocks">
    <tr><td class="subhead" colspan="2">Output Metrics</td><td class="subhead" colspan="2">Packaging</td></tr>
    ${blockRows}
  </table>
</body></html>`;
}

export function printBatchCard(vm: BatchCardExport): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  iframe.srcdoc = renderBatchCardHtml(vm);
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
