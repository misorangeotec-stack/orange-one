/**
 * exportBatchCosting.ts — writes the Batch Costing register to xlsx.
 *
 * COLUMN ORDER: Tally's Voucher Register columns first (Date … Batch), then the five the business
 * asked to be added after them (Type, Category, Colour, Item Group, Item Category). No Company
 * column — production is booked in one company, named on the Report Info sheet.
 *
 * Quantity and Amount stay NUMERIC and signed (consumption negative), so SUM() and pivots work;
 * the unit sits in its own column rather than inside a number format, because one voucher mixes
 * KGS and LTR and a pivot on Unit is the first thing a costing sheet needs.
 *
 * Rows are tinted by Category (the same three tints the Python production tool used), and a
 * category that came from the Tally stock group rather than a naming rule is written in italics.
 */
import * as XLSX from "xlsx-js-style";
import { saveAs } from "file-saver";
import type { BatchCostingRow } from "./batchCosting";
import { periodBand, tallyDate, ymdToIso } from "./stockSummary";

const HEADERS = [
  "Date", "Particulars", "Vch Type", "Vch No.", "Quantity", "Unit", "Rate", "Amount", "Batch",
  "Type", "Category", "Colour", "Item Group", "Item Category",
] as const;
const WIDTHS = [11, 50, 26, 24, 14, 7, 12, 15, 40, 13, 16, 11, 13, 28];

const COL = Object.fromEntries(HEADERS.map((h, i) => [h, i])) as Record<(typeof HEADERS)[number], number>;

const HEAD = {
  font: { bold: true, color: { rgb: "FFFFFF" }, sz: 10 },
  fill: { fgColor: { rgb: "1F4E79" } },
  alignment: { horizontal: "center", vertical: "center", wrapText: true },
};

const TINT: Record<BatchCostingRow["category"], string> = {
  "Finished Good": "E2EFDA",
  Scrap: "FFF2CC",
  "RM Consumption": "FCE4D6",
};

type Cell = { v?: unknown; t?: string; z?: string; s?: Record<string, unknown> };

export interface BatchCostingExportMeta {
  companyLabel: string;
  fy: string;
  from: string; // YYYYMMDD
  to: string;   // YYYYMMDD
  filterSummary: string[];
}

export function exportBatchCostingXlsx(rows: BatchCostingRow[], meta: BatchCostingExportMeta): void {
  const aoa: Array<Array<string | number>> = [[...HEADERS]];
  for (const r of rows) {
    aoa.push([
      tallyDate(r.vch_date),
      r.item,
      r.voucher_type,
      r.voucher_no,
      r.qty,
      r.uom ?? "",
      r.rate ?? "",
      r.amount,
      r.batches.join(", "),
      r.type,
      r.category,
      r.colour,
      r.item_group ?? "",
      r.item_category,
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = WIDTHS.map((wch) => ({ wch }));
  ws["!rows"] = [{ hpt: 20 }];
  const sheet = ws as unknown as Record<string, Cell>;

  for (let c = 0; c < HEADERS.length; c++) {
    const a = XLSX.utils.encode_cell({ r: 0, c });
    sheet[a] = { ...(sheet[a] ?? { t: "s", v: "" }), s: HEAD };
  }

  for (let i = 0; i < rows.length; i++) {
    const r = i + 1;
    const fill = { fgColor: { rgb: TINT[rows[i].category] } };
    for (let c = 0; c < HEADERS.length; c++) {
      const a = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[a] ?? { t: "s", v: "" };
      const s: Record<string, unknown> = { fill };
      if (c === COL.Quantity) cell.z = "#,##0.00";
      if (c === COL.Rate || c === COL.Amount) cell.z = "#,##0.00";
      if (c === COL["Item Category"] && rows[i].category_from_tally) s.font = { italic: true };
      cell.s = { ...(cell.s ?? {}), ...s };
      sheet[a] = cell;
    }
  }

  ws["!autofilter"] = {
    ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: HEADERS.length - 1 } }),
  };

  const vouchers = new Set(rows.map((r) => r.voucher_guid)).size;
  const info: Array<Array<string | number>> = [
    ["Report", "Batch Costing — Stock Journal-Production register"],
    ["Company", meta.companyLabel],
    ["Financial year", `FY ${meta.fy}`],
    ["Period", periodBand(meta.from, meta.to)],
    ["Vouchers", vouchers],
    ["Rows exported", rows.length],
    ["Exported at", new Date().toLocaleString("en-IN")],
    [],
    ["Source", "ConnectWave rpt_batch_line (the Tally mirror), voucher type STOCK JOURNAL-PRODUCTION. A line drawn from several lots is summed back to one row; the lots are listed in Batch."],
    ["Signs", "Output is positive, Consumption negative — as Tally prints it. Amount carries the same sign as Quantity."],
    ["Type", "Output = positive quantity in Tally; Consumption = negative."],
    ["Category", "Output named with SCRAP = Scrap; any other Output = Finished Good; every Consumption line = RM Consumption."],
    ["Colour / Group / Item Category", "Read from the voucher's finished good and filled down the whole entry. Item Group: SUBLIMATION → Sublimation, REACTIVE → Reactive, else Others. An Item Category in italics came from the Tally stock group because no naming rule matched."],
    [],
    ...(meta.filterSummary.length
      ? ([["Filters applied", ""]] as Array<Array<string | number>>).concat(meta.filterSummary.map((f) => ["", f]))
      : [["Filters applied", "None — every production line in the period"]]),
  ];
  const wsInfo = XLSX.utils.aoa_to_sheet(info);
  wsInfo["!cols"] = [{ wch: 30 }, { wch: 120 }];
  const infoSheet = wsInfo as unknown as Record<string, Cell>;
  for (let r = 0; r < info.length; r++) {
    const a = XLSX.utils.encode_cell({ r, c: 0 });
    if (infoSheet[a]) infoSheet[a].s = { font: { bold: true } };
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "SJ Production");
  XLSX.utils.book_append_sheet(wb, wsInfo, "Report Info");
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  saveAs(
    new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `Batch_Costing_${ymdToIso(meta.from)}_to_${ymdToIso(meta.to)}.xlsx`,
  );
}
