/**
 * exportSalesRegister.ts — writes the Sales Register to the finance team's "Append1" xlsx layout,
 * matching generate_sales_register.py's output (navy header, #,##0.00 on the numeric columns,
 * one sheet named "Append1", auto-filter over the used range).
 *
 * Freeze panes are deliberately omitted: the community xlsx writer ignores `!freeze`, so setting it
 * would be a silent no-op (see the project note on frozen header rows).
 */
import * as XLSX from "xlsx-js-style";
import { saveAs } from "file-saver";
import type { RegisterRow } from "./salesRegister";
import { ymdToIso } from "./salesRegister";

const COLUMNS = [
  "LOCATION", "COMPANY", "TYPE", "DATE", "PARTY NAME", "PARTICULARS",
  "VOUCHER TYPE", "VOUCHER NO.", "GSTIN/UIN", "QUANTITY", "RATE", "REVENUE",
] as const;

const WIDTHS = [10, 22, 14, 13, 40, 38, 26, 18, 18, 10, 12, 14];
const NUM_FMT = "#,##0.00";

/** Navy header band, matching the source workbook (#1F4E79 fill, bold white). */
const HEADER_STYLE = {
  font: { bold: true, color: { rgb: "FFFFFF" }, sz: 10 },
  fill: { fgColor: { rgb: "1F4E79" } },
  alignment: { horizontal: "center", vertical: "center", wrapText: true },
};

export function exportSalesRegisterXlsx(rows: RegisterRow[], meta: { from: string; to: string }): void {
  const aoa: Array<Array<string | number>> = [[...COLUMNS]];
  for (const r of rows) {
    aoa.push([
      r.location, r.company_label, r.type, r.date_display, r.party, r.particulars,
      r.voucher_type, r.voucher_no, r.gstin ?? "", r.quantity, r.rate, r.revenue,
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = WIDTHS.map((wch) => ({ wch }));

  // Number format on QUANTITY / RATE / REVENUE (0-indexed cols 9,10,11).
  for (let i = 0; i < rows.length; i++) {
    const sheetRow = i + 2; // 1-indexed, +1 header
    for (const col of [9, 10, 11]) {
      const cell = ws[`${XLSX.utils.encode_col(col)}${sheetRow}`];
      if (cell && typeof cell.v === "number") cell.z = NUM_FMT;
    }
  }

  // Header styling (row 0).
  for (let c = 0; c < COLUMNS.length; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    const cell = (ws as Record<string, { s?: object }>)[addr];
    if (cell) cell.s = HEADER_STYLE;
  }

  ws["!autofilter"] = {
    ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: COLUMNS.length - 1 } }),
  };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Append1");
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const fname = `Sales_Register_${ymdToIso(meta.from)}_to_${ymdToIso(meta.to)}.xlsx`;
  saveAs(
    new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    fname,
  );
}
