import * as XLSX from "xlsx-js-style";
import { saveAs } from "file-saver";
import { formatDateTimeDMY } from "@/shared/lib/date";

/**
 * Generic "these rows → an .xlsx" export, shared by every FMS table.
 *
 * The Leads dashboard and the receivables reports each grew their own copy of this
 * (same library, same header style, same freeze/autofilter). This is that pattern
 * lifted into `shared/` so a new table gets an export by passing one prop to
 * QueueTable rather than by copying eighty lines a fourth time. `xlsx-js-style` +
 * `file-saver` are already dependencies — no new library.
 *
 * Every export carries a second **"About this export"** sheet. That is not
 * decoration: a spreadsheet emailed to a director outlives the screen it came
 * from, so it has to say what it counted, over what period, and with which filters
 * applied. A number without its denominator is how bad policy gets made.
 */

export interface ExportColumn<T> {
  header: string;
  /** Column width in characters. */
  width?: number;
  /** The cell's plain value. Never a ReactNode — Excel cannot render one. */
  value: (row: T) => string | number;
}

const HEADER_STYLE = {
  font: { bold: true, color: { rgb: "FFFFFF" }, sz: 11 },
  fill: { fgColor: { rgb: "0B1F3A" } },
  alignment: { vertical: "center" },
};

/** Apply a style to every cell of a row, creating blanks so the band is full-width. */
function styleRow(ws: XLSX.WorkSheet, row: number, ncols: number, style: object): void {
  const sheet = ws as Record<string, unknown>;
  for (let c = 0; c < ncols; c++) {
    const addr = XLSX.utils.encode_cell({ r: row, c });
    const cell = (sheet[addr] as { s?: object; t?: string; v?: unknown }) ?? { t: "s", v: "" };
    cell.s = { ...(cell.s ?? {}), ...style };
    sheet[addr] = cell;
  }
}

/** Local dd-mm-yyyy for the file name (never the UTC date — see shared/lib/dueBuckets). */
function todayForFileName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(now.getDate())}-${p(now.getMonth() + 1)}-${now.getFullYear()}`;
}

export interface ExportOptions<T> {
  /** File name stem — the date is appended. e.g. "HR_Requisitions". */
  fileName: string;
  /** Tab name for the data sheet (Excel caps this at 31 chars). */
  sheetName: string;
  /** Human title on the "About" sheet. */
  title: string;
  columns: ExportColumn<T>[];
  rows: T[];
  /** Filters that narrowed this export, in plain English. */
  filters?: string[];
  /**
   * What the numbers mean and what they cover — the definitions the reader needs
   * to not misread the sheet (e.g. "Time to hire counts only people who joined").
   */
  notes?: string[];
}

/**
 * A band for rows that aren't peers of the rows around them — a subtotal or a group
 * header sitting above its members. Light navy tint, bold navy text: reads as structure
 * without competing with the header band above it.
 */
export const GROUP_ROW_STYLE = {
  font: { bold: true, color: { rgb: "0B1F3A" }, sz: 11 },
  fill: { fgColor: { rgb: "DCE4EE" } },
};

/** One data sheet within a multi-sheet workbook. */
export interface ExportSheet<T> {
  /** Tab name (Excel caps this at 31 chars). */
  sheetName: string;
  columns: ExportColumn<T>[];
  rows: T[];
  /**
   * Optional per-row band, e.g. GROUP_ROW_STYLE on a department's roll-up row.
   * Return undefined to leave a row unstyled.
   */
  rowStyle?: (row: T) => object | undefined;
}

export interface ExportSheetsOptions {
  /** File name stem — the date is appended. */
  fileName: string;
  /** Human title on the "About" sheet. */
  title: string;
  /** Data sheets, in tab order. Each gets the same header/freeze/autofilter treatment. */
  // Sheets are heterogeneous by design — each carries its own row type, and the
  // columns are only ever applied to their own sheet's rows.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sheets: ExportSheet<any>[];
  /** Filters that narrowed this export, in plain English. */
  filters?: string[];
  /** What the numbers mean and what they cover. */
  notes?: string[];
}

function buildDataSheet<T>(columns: ExportColumn<T>[], rows: T[], rowStyle?: (row: T) => object | undefined): XLSX.WorkSheet {
  const aoa: (string | number)[][] = [
    columns.map((c) => c.header),
    ...rows.map((r) => columns.map((c) => c.value(r))),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = columns.map((c) => ({ wch: c.width ?? 18 }));
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };
  ws["!autofilter"] = { ref: `A1:${XLSX.utils.encode_col(columns.length - 1)}${rows.length + 1}` };
  styleRow(ws, 0, columns.length, HEADER_STYLE);
  if (rowStyle) {
    // +1 for the header row.
    rows.forEach((r, i) => {
      const s = rowStyle(r);
      if (s) styleRow(ws, i + 1, columns.length, s);
    });
  }
  return ws;
}

function buildAboutSheet(o: {
  title: string;
  /** One entry per data sheet. A single-sheet export reads "Rows exported: N"; a
   *  multi-sheet one names each tab, because a bare total across tabs is a number
   *  that answers no question anyone asked. */
  counts: { sheetName: string; count: number }[];
  filters: string[];
  notes: string[];
}): XLSX.WorkSheet {
  const countLines =
    o.counts.length === 1
      ? [`Rows exported: ${o.counts[0].count}`]
      : o.counts.map((c) => `Rows exported — ${c.sheetName}: ${c.count}`);
  const aoa: string[][] = [[o.title], [`Generated: ${formatDateTimeDMY(new Date())}`], ...countLines.map((l) => [l]), []];
  const filtersRow = aoa.length;
  aoa.push(["Filters applied"], ...(o.filters.length ? o.filters.map((f) => [f]) : [["None — everything in the current view"]]));
  const notesRow = aoa.length + 1;
  if (o.notes.length) {
    aoa.push([], ["What these numbers mean"], ...o.notes.map((n) => [n]));
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 96 }];
  styleRow(ws, 0, 1, HEADER_STYLE);
  styleRow(ws, filtersRow, 1, HEADER_STYLE);
  if (o.notes.length) styleRow(ws, notesRow, 1, HEADER_STYLE);
  return ws;
}

/** Build and download an .xlsx with several data sheets, plus the "About" sheet. */
export function exportSheetsToXlsx({ fileName, title, sheets, filters = [], notes = [] }: ExportSheetsOptions): void {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    XLSX.utils.book_append_sheet(wb, buildDataSheet(s.columns, s.rows, s.rowStyle), s.sheetName.slice(0, 31));
  }
  const counts = sheets.map((s) => ({ sheetName: s.sheetName, count: s.rows.length }));
  XLSX.utils.book_append_sheet(wb, buildAboutSheet({ title, counts, filters, notes }), "About this export");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  saveAs(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${fileName}_${todayForFileName()}.xlsx`,
  );
}

/** Build and download an .xlsx of the given rows. */
export function exportRowsToXlsx<T>({
  fileName,
  sheetName,
  title,
  columns,
  rows,
  filters = [],
  notes = [],
}: ExportOptions<T>): void {
  exportSheetsToXlsx({ fileName, title, sheets: [{ sheetName, columns, rows }], filters, notes });
}
