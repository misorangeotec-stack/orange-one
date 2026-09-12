/**
 * exportSoaRegister.ts — writes the SOA Sales Register to xlsx, in the same house style as the
 * Sales Register export (navy header band, #,##0.00 on the numerics, auto-filter, one sheet).
 *
 * The sheet is named after the tab that produced it — "All SOA", "Pending", … — so a workbook
 * saved from the Pending tab says on its face that it is the pending view and not the whole
 * register. The columns are identical across tabs, so the four exports stack.
 *
 * Freeze panes are deliberately omitted: the community xlsx writer ignores `!freeze`, so setting
 * it would be a silent no-op (same note as the Sales Register export).
 */
import * as XLSX from "xlsx-js-style";
import { saveAs } from "file-saver";
import type { SoaRow } from "./soaRegister";
import { ymdToIso } from "./salesRegister";

const COLUMNS = [
  "LOCATION", "COMPANY", "DATE", "TRACKING NUMBER", "NAME OF ITEM", "PARTY",
  "SOA VOUCHER TYPE", "SOA VOUCHER NO.",
  "INITIAL QUANTITY", "BILLED QUANTITY", "REJECTED QUANTITY", "PENDING QUANTITY",
  "RATE", "INITIAL VALUE", "PENDING VALUE", "STATUS",
  "BILLED VOUCHER NO.", "BILLED DATE", "REJECTED VOUCHER NO.", "REJECTED DATE",
] as const;

const WIDTHS = [10, 22, 13, 20, 40, 34, 30, 22, 16, 16, 18, 17, 12, 15, 15, 14, 24, 14, 24, 14];
/** 0-indexed columns that carry numbers: the four quantities, rate and the two values. */
const NUM_COLS = [8, 9, 10, 11, 12, 13, 14];
const NUM_FMT = "#,##0.00";

const HEADER_STYLE = {
  font: { bold: true, color: { rgb: "FFFFFF" }, sz: 10 },
  fill: { fgColor: { rgb: "1F4E79" } },
  alignment: { horizontal: "center", vertical: "center", wrapText: true },
};

export function exportSoaRegisterXlsx(
  rows: SoaRow[],
  meta: { from: string; to: string; tabLabel: string },
): void {
  const aoa: Array<Array<string | number>> = [[...COLUMNS]];
  for (const r of rows) {
    aoa.push([
      r.location_name, r.company, r.soa_date_display, r.tracking_no, r.item, r.party ?? "",
      r.soa_voucher_type ?? "", r.soa_voucher_no ?? "",
      r.issued_qty, r.billed_qty, r.rejected_qty, r.pending_qty,
      r.rate, r.issued_value, r.pending_value, r.status,
      r.billed_voucher_no ?? "", r.billed_date_display ?? "",
      r.rejected_voucher_no ?? "", r.rejected_date_display ?? "",
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = WIDTHS.map((wch) => ({ wch }));

  for (let i = 0; i < rows.length; i++) {
    const sheetRow = i + 2; // 1-indexed, +1 for the header
    for (const col of NUM_COLS) {
      const cell = ws[`${XLSX.utils.encode_col(col)}${sheetRow}`];
      if (cell && typeof cell.v === "number") cell.z = NUM_FMT;
    }
  }

  for (let c = 0; c < COLUMNS.length; c++) {
    const cell = (ws as Record<string, { s?: object }>)[XLSX.utils.encode_cell({ r: 0, c })];
    if (cell) cell.s = HEADER_STYLE;
  }

  ws["!autofilter"] = {
    ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: COLUMNS.length - 1 } }),
  };

  const wb = XLSX.utils.book_new();
  // Excel rejects a sheet name over 31 chars or containing : \ / ? * [ ]; every tab label is short
  // and plain, but the guard keeps a future label from producing a corrupt workbook.
  const sheet = meta.tabLabel.replace(/[:\\/?*[\]]/g, " ").slice(0, 31) || "SOA";
  XLSX.utils.book_append_sheet(wb, ws, sheet);
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const slug = meta.tabLabel.replace(/[^A-Za-z0-9]+/g, "_");
  saveAs(
    new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `SOA_Sales_Register_${slug}_${ymdToIso(meta.from)}_to_${ymdToIso(meta.to)}.xlsx`,
  );
}
