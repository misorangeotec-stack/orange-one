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

function buildDataSheet<T>(columns: ExportColumn<T>[], rows: T[]): XLSX.WorkSheet {
  const aoa: (string | number)[][] = [
    columns.map((c) => c.header),
    ...rows.map((r) => columns.map((c) => c.value(r))),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = columns.map((c) => ({ wch: c.width ?? 18 }));
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };
  ws["!autofilter"] = { ref: `A1:${XLSX.utils.encode_col(columns.length - 1)}${rows.length + 1}` };
  styleRow(ws, 0, columns.length, HEADER_STYLE);
  return ws;
}

function buildAboutSheet(o: { title: string; count: number; filters: string[]; notes: string[] }): XLSX.WorkSheet {
  const aoa: string[][] = [
    [o.title],
    [`Generated: ${formatDateTimeDMY(new Date())}`],
    [`Rows exported: ${o.count}`],
    [],
    ["Filters applied"],
    ...(o.filters.length ? o.filters.map((f) => [f]) : [["None — everything in the current view"]]),
  ];
  const notesRow = aoa.length + 1;
  if (o.notes.length) {
    aoa.push([], ["What these numbers mean"], ...o.notes.map((n) => [n]));
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 96 }];
  styleRow(ws, 0, 1, HEADER_STYLE);
  styleRow(ws, 4, 1, HEADER_STYLE);
  if (o.notes.length) styleRow(ws, notesRow, 1, HEADER_STYLE);
  return ws;
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
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildDataSheet(columns, rows), sheetName.slice(0, 31));
  XLSX.utils.book_append_sheet(wb, buildAboutSheet({ title, count: rows.length, filters, notes }), "About this export");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  saveAs(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${fileName}_${todayForFileName()}.xlsx`,
  );
}
