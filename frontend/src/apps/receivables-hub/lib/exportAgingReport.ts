import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import { AGING_COLUMNS, flattenForExport, type AgingTree, type AgingDimension, DIMENSION_LABELS } from "./agingReport";
import { formatDateDMY } from "./utils";

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
 * the grand total last. Money columns carry the INR number format.
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
  aoa.push(header);

  const firstDataRow = aoa.length + 1; // 1-indexed sheet row of the first data row
  const rows = flattenForExport(tree);
  for (const r of rows) {
    const indent = r.depth > 0 ? `${"    ".repeat(r.depth)}` : "";
    aoa.push([
      `${indent}${r.label}`,
      ...AGING_COLUMNS.map((c) => Math.round(r.metrics[c.key])),
      r.metrics.billCount,
    ]);
  }
  const lastDataRow = firstDataRow + rows.length - 1;

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 34 }, ...AGING_COLUMNS.map(() => ({ wch: 15 })), { wch: 7 }];

  // Apply INR format to the money columns (B … = column index 1 .. AGING_COLUMNS.length).
  for (let row = firstDataRow; row <= lastDataRow; row++) {
    for (let col = 1; col <= AGING_COLUMNS.length; col++) {
      const cell = ws[`${XLSX.utils.encode_col(col)}${row}`];
      if (cell && typeof cell.v === "number") cell.z = INR_FMT;
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Aging Report");
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  saveAs(
    new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `Aging_Report_${meta.asOfDate || "export"}.xlsx`,
  );
}
