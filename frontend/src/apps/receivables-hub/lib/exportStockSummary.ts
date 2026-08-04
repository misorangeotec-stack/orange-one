/**
 * exportStockSummary.ts — writes the Stock Summary to the finance team's supplied layout
 * (Misc/Bushra Reports/Stock Group Summary.xlsx).
 *
 * Sheet 1 uses the WORKBOOK's column order, which is NOT the screen's:
 *   COMPANY NAME | Primary Group | Sub Group 1..4 | Item Name | ITEM CODE | then the 12 numeric
 * columns under four merged block headers. The screen leads with Particulars + Item Code instead,
 * because `position: sticky` only works on a contiguous left run and those are the two columns
 * worth freezing. One data set, two orders — deliberate.
 *
 * QUANTITY CELLS STAY NUMERIC and carry the unit through a per-row custom number format
 * ('#,##0.000" PCS"'), so SUM(), sorting and pivots still work while the sheet prints "1.000 PCS"
 * the way Tally does. A 21st "Unit" column would break the supplied layout.
 *
 * BLANK, NOT ZERO: when a block's quantity AND value are both zero the three cells are written as
 * empty strings, matching Tally — its Inwards/Outwards columns are blank on an item that did not
 * move. SUM() ignores empty cells, so nothing downstream changes.
 *
 * `!autofilter` ANCHORS ON ROW 1 (the measure band), never row 0: row 0 is merged three-wide per
 * block, and an autofilter over merged cells makes Excel show a repair prompt on open.
 *
 * Freeze panes are deliberately omitted — xlsx-js-style ignores `!freeze`, so setting it is a
 * silent no-op (same note as exportSalesRegister.ts). The source workbook DOES carry a frozen
 * header row, so the Report Info sheet says how to restore it by hand; the styled two-row band,
 * explicit row heights and the autofilter are what make an 8,000-row sheet navigable meanwhile.
 */
import * as XLSX from "xlsx-js-style";
import { saveAs } from "file-saver";
import type { StockSummaryRow } from "./stockSummary";
import { periodBand, ymdToIso } from "./stockSummary";

/** Column A..H — the finance workbook's own header row, verbatim. */
const LEAD = [
  "COMPANY NAME", "Primary Group", "Sub Group 1", "Sub Group 2",
  "Sub Group 3", "Sub Group 4", "Item Name", "ITEM CODE",
] as const;

const BLOCKS = ["Opening Balance", "Inwards", "Outwards", "Closing Balance"] as const;
const MEASURES = ["Quantity", "Rate", "Value"] as const;
const NCOLS = LEAD.length + BLOCKS.length * MEASURES.length; // 20

/** Widths lifted from the source workbook's own <cols>, then the numeric block. */
const WIDTHS = [26, 28, 28, 56, 43, 28, 79, 16, ...Array.from({ length: 4 }, () => [15, 13, 15]).flat()];

const MONEY = "#,##0.00";

/** Group band — the same navy the Sales Register export uses, so the two sheets read as a family. */
const BAND_1 = {
  font: { bold: true, color: { rgb: "FFFFFF" }, sz: 10 },
  fill: { fgColor: { rgb: "1F4E79" } },
  alignment: { horizontal: "center", vertical: "center", wrapText: true },
};
/** Measure band — one shade lighter, so the two tiers are distinguishable at a glance. */
const BAND_2 = {
  font: { bold: true, color: { rgb: "FFFFFF" }, sz: 10 },
  fill: { fgColor: { rgb: "2E75B6" } },
  alignment: { horizontal: "center", vertical: "center", wrapText: true },
};

type Cell = { v?: unknown; t?: string; z?: string; s?: Record<string, unknown> };
const cellAt = (ws: XLSX.WorkSheet, r: number, c: number): Cell | undefined =>
  (ws as unknown as Record<string, Cell>)[XLSX.utils.encode_cell({ r, c })];

const styleCell = (ws: XLSX.WorkSheet, r: number, c: number, s: Record<string, unknown>): void => {
  const sheet = ws as unknown as Record<string, Cell>;
  const addr = XLSX.utils.encode_cell({ r, c });
  const cell = sheet[addr] ?? { t: "s", v: "" };
  cell.s = { ...(cell.s ?? {}), ...s };
  sheet[addr] = cell;
};

/** '#,##0.000" PCS"' — numeric cell, Tally's printed unit. Quotes stripped so the format is valid. */
const qtyFmt = (unit: string | null | undefined) =>
  unit ? `#,##0.000" ${unit.replace(/["\\]/g, "")}"` : "#,##0.000";

export interface StockSummaryExportMeta {
  companyLabel: string;
  fy: string;
  from: string;            // YYYYMMDD
  to: string;              // YYYYMMDD
  periodScope: "full-year" | "window";
  builtAt: string | null;
  filterSummary: string[];
}

export function exportStockSummaryXlsx(rows: StockSummaryRow[], meta: StockSummaryExportMeta): void {
  /* ---------- sheet 1: the report ---------- */
  const header0: string[] = [...LEAD];
  const header1: string[] = LEAD.map(() => "");
  for (const b of BLOCKS) {
    header0.push(b, "", "");
    header1.push(...MEASURES);
  }

  const aoa: Array<Array<string | number>> = [header0, header1];
  for (const r of rows) {
    const blocks: Array<[number, number | null, number]> = [
      [r.opening_qty, r.opening_rate, r.opening_value],
      [r.inward_qty, r.inward_rate, r.inward_value],
      [r.outward_qty, r.outward_rate, r.outward_value],
      [r.closing_qty, r.closing_rate, r.closing_value],
    ];
    const numeric: Array<string | number> = [];
    for (const [q, rate, v] of blocks) {
      // Blank-not-zero, per block — matches Tally's own print.
      if (!q && !v) numeric.push("", "", "");
      else numeric.push(q ?? 0, rate ?? "", v ?? 0);
    }
    aoa.push([
      r.company_display,
      r.primary_group ?? "",
      r.sub_group_1 ?? "",
      r.sub_group_2 ?? "",
      r.sub_group_3 ?? "",
      r.sub_group_4 ?? "",
      r.item,
      r.item_code ?? "",
      ...numeric,
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = WIDTHS.map((wch) => ({ wch }));
  ws["!rows"] = [{ hpt: 22 }, { hpt: 18 }];

  // Merges: eight vertical (the text columns span both header rows) + four horizontal (one per block).
  const merges: XLSX.Range[] = [];
  for (let c = 0; c < LEAD.length; c++) merges.push({ s: { r: 0, c }, e: { r: 1, c } });
  BLOCKS.forEach((_, i) => {
    const c0 = LEAD.length + i * 3;
    merges.push({ s: { r: 0, c: c0 }, e: { r: 0, c: c0 + 2 } });
  });
  ws["!merges"] = merges;

  for (let c = 0; c < NCOLS; c++) {
    styleCell(ws, 0, c, BAND_1);
    if (c >= LEAD.length) styleCell(ws, 1, c, BAND_2);
  }

  // Per-cell number formats + the italic rate column, over the data rows.
  for (let i = 0; i < rows.length; i++) {
    const r = i + 2;
    const unitFmt = qtyFmt(rows[i].base_unit);
    for (let b = 0; b < BLOCKS.length; b++) {
      const c0 = LEAD.length + b * 3;
      const qc = cellAt(ws, r, c0);
      if (qc && typeof qc.v === "number") qc.z = unitFmt;
      const rc = cellAt(ws, r, c0 + 1);
      if (rc) {
        if (typeof rc.v === "number") rc.z = MONEY;
        rc.s = { ...(rc.s ?? {}), font: { italic: true } }; // Tally prints Rate in italics
      }
      const vc = cellAt(ws, r, c0 + 2);
      if (vc && typeof vc.v === "number") vc.z = MONEY;
      // A medium rule on the first column of each block, mirroring the screen.
      styleCell(ws, r, c0, { border: { left: { style: "thin", color: { rgb: "D9D9D9" } } } });
    }
  }
  for (let b = 0; b < BLOCKS.length; b++) {
    const c0 = LEAD.length + b * 3;
    for (const r of [0, 1]) {
      styleCell(ws, r, c0, { border: { left: { style: "medium", color: { rgb: "FFFFFF" } } } });
    }
  }

  // Anchor on row 1 — the measure band. Row 0 is merged and would trigger Excel's repair prompt.
  ws["!autofilter"] = {
    ref: XLSX.utils.encode_range({ s: { r: 1, c: 0 }, e: { r: 1 + rows.length, c: NCOLS - 1 } }),
  };

  /* ---------- sheet 2: provenance ---------- */
  const info: Array<Array<string | number>> = [
    ["Report", "Stock Summary (Tally — Stock Group Summary)"],
    ["Company", meta.companyLabel],
    ["Financial year", `FY ${meta.fy}`],
    ["Period", periodBand(meta.from, meta.to)],
    ["Rows exported", rows.length],
    ["Data built at", meta.builtAt ? new Date(meta.builtAt).toLocaleString("en-IN") : "—"],
    ["Exported at", new Date().toLocaleString("en-IN")],
    [],
    [
      "Source",
      "Every figure is Tally's own. Opening and Closing quantity, rate and value come straight from the Tally stock item master; Inwards and Outwards are summed from Tally's own voucher lines. A blank Rate means Tally holds no rate for that item — nothing is computed here.",
    ],
    [
      "Period",
      meta.periodScope === "full-year"
        ? "The period is the full financial year, so every column covers it."
        : "Inwards and Outwards cover the selected period. Opening and Closing are Tally's figures for the full financial year — Tally only holds them at the year's boundaries.",
    ],
    [
      "Note",
      "Opening + Inwards − Outwards ties to Closing on QUANTITY, not on VALUE: outwards are carried at sale price while Tally values closing stock by its own valuation method. That is Tally's behaviour.",
    ],
    [
      "Frozen header",
      "Not set by the writer (the library ignores it). In Excel: View → Freeze Panes → Freeze Panes with cell A3 selected.",
    ],
    [],
    ...(meta.filterSummary.length
      ? ([["Filters applied", ""]] as Array<Array<string | number>>).concat(
          meta.filterSummary.map((f) => ["", f]),
        )
      : [["Filters applied", "None — every item in the book"]]),
  ];
  const wsInfo = XLSX.utils.aoa_to_sheet(info);
  wsInfo["!cols"] = [{ wch: 18 }, { wch: 110 }];
  for (let r = 0; r < info.length; r++) {
    if (info[r]?.[0]) styleCell(wsInfo, r, 0, { font: { bold: true } });
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Stock Summary");
  XLSX.utils.book_append_sheet(wb, wsInfo, "Report Info");
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const slug = meta.companyLabel.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  saveAs(
    new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `Stock_Summary_${slug}_${ymdToIso(meta.from)}_to_${ymdToIso(meta.to)}.xlsx`,
  );
}
