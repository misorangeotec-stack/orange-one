import * as XLSX from "xlsx-js-style";
import { saveAs } from "file-saver";
import { AGING_COLUMNS, flattenForExport, type AgingTree, type AgingDimension, DIMENSION_LABELS } from "./agingReport";
import { formatDateDMY } from "./utils";
import { HEADER_STYLE, TOTAL_STYLE, GRAND_TOTAL_STYLE, styleRow } from "./xlsxStyle";

/** INR cell number format (whole rupees, "₹" prefixed, dash for zero). */
const INR_FMT = '_-"₹"* #,##0_-;-"₹"* #,##0_-;_-"₹"* "-"_-;_-@_-';

export interface AgingExportMeta {
  groupBy: AgingDimension[];
  asOfDate: string;
  /** Human-readable active-filter summary lines, e.g. ["Company: OTEC-SURAT"]. */
  filterSummary: string[];
}

/**
 * Export the aging roll-up as a single-sheet workbook. Group-by, as-of date and
 * active filters sit in a header block; each tree row is indented by depth, with
 * the grand total last. Money columns carry the INR number format. The title +
 * column-header rows are styled black/white/bold; subtotal & On-Account rows
 * light green; the grand total a stronger, distinct green.
 */
export function exportAgingReportXlsx(tree: AgingTree, meta: AgingExportMeta): void {
  const aoa: Array<Array<string | number>> = [];

  aoa.push(["Aging Report"]);
  aoa.push(["As of", formatDateDMY(meta.asOfDate)]);
  aoa.push(["Grouped by", meta.groupBy.map((d) => DIMENSION_LABELS[d]).join(" → ") || "Sale Type"]);
  aoa.push(["Basis", "Bill-wise / gross (sum of bill pending)"]);
  for (const line of meta.filterSummary) aoa.push([line]);
  aoa.push([]);

  const header = ["Group", ...AGING_COLUMNS.map((c) => c.label), "Bills"];
  const headerRow0 = aoa.length; // 0-indexed row of the column-header row
  aoa.push(header);

  const firstData0 = aoa.length; // 0-indexed first data row
  const rows = flattenForExport(tree);
  for (const r of rows) {
    const indent = r.depth > 0 ? `${"    ".repeat(r.depth)}` : "";
    aoa.push([
      `${indent}${r.label}`,
      ...AGING_COLUMNS.map((c) => Math.round(r.metrics[c.key])),
      r.metrics.billCount,
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const ncols = header.length;
  ws["!cols"] = [{ wch: 34 }, ...AGING_COLUMNS.map(() => ({ wch: 15 })), { wch: 7 }];

  // INR number format on the money columns (1 .. AGING_COLUMNS.length).
  for (let i = 0; i < rows.length; i++) {
    const sheetRow = firstData0 + i + 1; // 1-indexed
    for (let col = 1; col <= AGING_COLUMNS.length; col++) {
      const cell = ws[`${XLSX.utils.encode_col(col)}${sheetRow}`];
      if (cell && typeof cell.v === "number") cell.z = INR_FMT;
    }
  }

  // Styling: title + column header black/white/bold; rows by tier.
  styleRow(ws, 0, ncols, HEADER_STYLE);
  styleRow(ws, headerRow0, ncols, HEADER_STYLE);
  rows.forEach((r, i) => {
    const style = r.tier === "grand" ? GRAND_TOTAL_STYLE : r.tier === "detail" ? null : TOTAL_STYLE;
    if (style) styleRow(ws, firstData0 + i, ncols, style);
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Aging Report");
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  saveAs(
    new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `Aging_Report_${meta.asOfDate || "export"}.xlsx`,
  );
}
