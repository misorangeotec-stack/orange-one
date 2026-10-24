/**
 * exportPurchaseRegister.ts — the Purchase Register as xlsx, in the Sales Register's "Append1" style
 * (lib/exportSalesRegister.ts): navy header, #,##0.00 on the numbers, auto-filter over the used range.
 * The first twelve columns sit where the Sales Register puts them, with AMOUNT in place of REVENUE, so
 * the two workbooks line up column for column; the Bushra columns follow.
 */
import * as XLSX from "xlsx-js-style";
import { saveAs } from "file-saver";
import { ymdToIso } from "./salesRegister";
import type { BushraPurchaseRow } from "./bushraPurchaseRegister";

const COLUMNS: { header: string; width: number; get: (r: BushraPurchaseRow) => string | number }[] = [
  { header: "LOCATION", width: 10, get: (r) => r.location_name },
  { header: "COMPANY", width: 22, get: (r) => r.company },
  { header: "TYPE", width: 20, get: (r) => r.type },
  { header: "DATE", width: 13, get: (r) => r.date_display },
  { header: "PARTY NAME", width: 40, get: (r) => r.party },
  { header: "PARTICULARS", width: 38, get: (r) => r.particulars },
  { header: "VOUCHER TYPE", width: 26, get: (r) => r.voucher_type },
  { header: "VOUCHER NO.", width: 18, get: (r) => r.voucher_no },
  { header: "GSTIN/UIN", width: 18, get: (r) => r.gstin ?? "" },
  { header: "QUANTITY", width: 10, get: (r) => r.quantity },
  { header: "RATE", width: 12, get: (r) => r.rate },
  { header: "AMOUNT", width: 14, get: (r) => r.amount },
  { header: "PURCHASE-TYPE", width: 16, get: (r) => r.purchase_type },
  { header: "INK TYPE", width: 22, get: (r) => r.ink_type },
  { header: "GROUP", width: 22, get: (r) => r.item_group },
  { header: "CATEGORY", width: 22, get: (r) => r.item_category },
  { header: "COLOUR", width: 12, get: (r) => r.colour },
];

const NUMBER_COLS = [9, 10, 11];
const NUM_FMT = "#,##0.00";

const HEADER_STYLE = {
  font: { bold: true, color: { rgb: "FFFFFF" }, sz: 10 },
  fill: { fgColor: { rgb: "1F4E79" } },
  alignment: { horizontal: "center", vertical: "center", wrapText: true },
};

export function exportPurchaseRegisterXlsx(rows: BushraPurchaseRow[], meta: { from: string; to: string }): void {
  const aoa: Array<Array<string | number>> = [COLUMNS.map((c) => c.header)];
  for (const r of rows) aoa.push(COLUMNS.map((c) => c.get(r)));

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = COLUMNS.map((c) => ({ wch: c.width }));

  for (let i = 0; i < rows.length; i++) {
    for (const col of NUMBER_COLS) {
      const cell = ws[`${XLSX.utils.encode_col(col)}${i + 2}`];
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
  XLSX.utils.book_append_sheet(wb, ws, "Append1");
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  saveAs(
    new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `Bushra_Purchase_Register_${ymdToIso(meta.from)}_to_${ymdToIso(meta.to)}.xlsx`,
  );
}
