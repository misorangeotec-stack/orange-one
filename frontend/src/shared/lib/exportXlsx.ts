import * as XLSX from "xlsx-js-style";
import JSZip from "jszip";
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
  /**
   * Optional per-CELL style, merged over `rowStyle`.
   *
   * ⚠ `rowStyle` paints the full width — it is a band, and a band cannot say
   *   "this one cell disagrees with its neighbours". A diff grid needs exactly
   *   that: one fill on one cell. `xlsx-js-style` supports per-cell fills
   *   already, so this is a helper gap rather than a library one.
   *
   * `colIndex` is the index into `columns`, so a caller does not have to know
   *   where the sheet's rows start.
   */
  cellStyle?: (row: T, colIndex: number) => object | undefined;
  /**
   * Rows written ABOVE the header — a summary block, a legend, a caption.
   *
   * ⚠ THE HEADER, THE AUTOFILTER AND THE FROZEN ROW ALL SHIFT BY ITS LENGTH.
   *   Nothing else about the sheet changes, and a sheet that declares no
   *   preamble is byte-for-byte what it was before this existed.
   */
  preamble?: (string | number)[][];
  /** Row height in points, per data row. Undefined leaves Excel's default. */
  rowHeights?: (row: T) => number | undefined;
  /**
   * Merged over the standard header band — for a sheet whose column headers are
   * not short words. A diff grid's headers are machine names, which run to
   * forty-odd characters and need to wrap rather than clip.
   */
  headerStyle?: object;
  /**
   * Freeze this many LEADING COLUMNS as well as the header row.
   *
   * 🔴 OPT-IN, AND THAT IS DELIBERATE. See `freezeWorkbookPanes` below: panes
   *    have never actually been written by this helper, so switching them on for
   *    every existing export would quietly change four modules' spreadsheets at
   *    once. A sheet that does not ask still gets no pane — exactly as today.
   */
  freezeCols?: number;
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

/** Merge one style onto one cell, creating the cell if the row is short. */
function styleCell(ws: XLSX.WorkSheet, row: number, col: number, style: object): void {
  const sheet = ws as Record<string, unknown>;
  const addr = XLSX.utils.encode_cell({ r: row, c: col });
  const cell = (sheet[addr] as { s?: object; t?: string; v?: unknown }) ?? { t: "s", v: "" };
  cell.s = { ...(cell.s ?? {}), ...style };
  sheet[addr] = cell;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildDataSheet<T>(sheet: ExportSheet<T>): XLSX.WorkSheet {
  const { columns, rows, rowStyle, cellStyle, rowHeights, headerStyle } = sheet;
  const preamble = sheet.preamble ?? [];
  // Where the header lands once the preamble is above it. Zero preamble ⇒ row 0,
  // which is what every existing export already produces.
  const headerRow = preamble.length;
  const firstDataRow = headerRow + 1;

  const aoa: (string | number)[][] = [
    ...preamble,
    columns.map((c) => c.header),
    ...rows.map((r) => columns.map((c) => c.value(r))),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = columns.map((c) => ({ wch: c.width ?? 18 }));
  ws["!autofilter"] = {
    ref: `${XLSX.utils.encode_cell({ r: headerRow, c: 0 })}:${XLSX.utils.encode_cell({
      r: headerRow + rows.length,
      c: columns.length - 1,
    })}`,
  };
  styleRow(ws, headerRow, columns.length, { ...HEADER_STYLE, ...(headerStyle ?? {}) });

  if (rowStyle || cellStyle) {
    rows.forEach((r, i) => {
      const band = rowStyle?.(r);
      if (band) styleRow(ws, firstDataRow + i, columns.length, band);
      if (!cellStyle) return;
      // Per cell AFTER the band, so a single disagreeing cell can still be
      // marked inside a row that is otherwise banded.
      columns.forEach((_, c) => {
        const st = cellStyle(r, c);
        if (st) styleCell(ws, firstDataRow + i, c, st);
      });
    });
  }

  if (rowHeights) {
    // `!rows` IS honoured by the writer (verified in the bundle) — unlike
    // `!freeze`, which is not. Only the data rows are sized; the preamble and
    // the header keep Excel's default.
    const heights: ({ hpt: number } | null)[] = new Array(firstDataRow).fill(null);
    rows.forEach((r) => {
      const h = rowHeights(r);
      heights.push(h ? { hpt: h } : null);
    });
    ws["!rows"] = heights as XLSX.RowInfo[];
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

/* -------------------------------------------------------------------------- */
/*  Freeze panes — which this helper has never actually written                */
/* -------------------------------------------------------------------------- */

/**
 * 🔴 `ws["!freeze"]` WRITES NOTHING, and this file used to set it and imply
 *    otherwise. Read the writer in `xlsx-js-style/dist/xlsx.bundle.js`: every
 *    sheet comes out as
 *      `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`
 *    — a self-closing `sheetView` with no `pane` child — and no key the
 *    community writer reads produces one. So every "the header row freezes"
 *    comment in this codebase has been wrong, silently, in every spreadsheet it
 *    ever produced. Nobody noticed because nobody scrolled far enough to care.
 *
 *    On a diff grid it is not cosmetic: scrolled across to the tenth machine
 *    with column A gone, the reader cannot tell which line they are on, and the
 *    sheet is useless. So the workbook is written, re-opened as a zip, and the
 *    pane element injected into the sheets that asked for one.
 *
 * ⚠ VERIFY BY OPENING THE FILE, NEVER BY READING THIS CODE. Reading the code is
 *   exactly the mistake this function exists to undo.
 *
 * JSZip is already a runtime dependency and already used in the browser by
 * receivables-hub's salesperson export — no new library.
 */
async function freezeWorkbookPanes(
  buf: ArrayBuffer,
  /** Sheet NAME → how many leading columns to freeze, header row included. */
  panes: Map<string, { cols: number; headerRow: number }>,
): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(buf);

  /*
    Sheet name → its XML part, resolved through the workbook and its rels.

    ⚠ NOT BY POSITION. `sheet1.xml` happens to be the first tab today, but the
      mapping belongs to the relationship table — and guessing it wrong would
      freeze column A of "About this export", a one-column sheet where a pane is
      simply wrong.
  */
  const unescape = (v: string) =>
    v
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&");

  const wbXml = await zip.file("xl/workbook.xml")?.async("string");
  const relsXml = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
  if (!wbXml || !relsXml) return buf;

  const target = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"[^>]*?\/>/g)) {
    target.set(m[1], m[2].replace(/^\/?xl\//, "").replace(/^\.\//, ""));
  }

  for (const m of wbXml.matchAll(/<sheet\b[^>]*?\/>/g)) {
    const tag = m[0];
    const name = /name="([^"]*)"/.exec(tag)?.[1];
    const rid = /r:id="([^"]*)"/.exec(tag)?.[1];
    if (!name || !rid) continue;
    const want = panes.get(unescape(name));
    if (!want) continue;
    const path = `xl/${target.get(rid) ?? ""}`;
    const file = zip.file(path);
    if (!file) continue;

    const ySplit = want.headerRow + 1;
    const xSplit = want.cols;
    const topLeft = XLSX.utils.encode_cell({ r: ySplit, c: xSplit });
    // With both splits set the live quadrant is bottom-right; with only one, it
    // is the other one. Naming the wrong quadrant draws the split but leaves the
    // wrong pane scrolling, which looks like the freeze half-worked.
    const active = xSplit > 0 && ySplit > 0 ? "bottomRight" : xSplit > 0 ? "topRight" : "bottomLeft";
    const pane =
      `<pane xSplit="${xSplit}" ySplit="${ySplit}" topLeftCell="${topLeft}" activePane="${active}" state="frozen"/>` +
      `<selection pane="${active}" activeCell="${topLeft}" sqref="${topLeft}"/>`;

    const xml = await file.async("string");
    const patched = xml.replace(
      /<sheetViews>\s*<sheetView([^>]*?)\/>\s*<\/sheetViews>/,
      (_all, attrs) => `<sheetViews><sheetView${attrs}>${pane}</sheetView></sheetViews>`,
    );
    // A no-op replace means the writer changed shape. Leave the sheet alone
    // rather than write a half-patched part Excel would refuse to open.
    if (patched !== xml) zip.file(path, patched);
  }

  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}

/**
 * The workbook as bytes, before the browser is involved.
 *
 * Split out from `exportSheetsToXlsx` so the file can be produced and inspected
 * without a browser — the only way to settle a claim like "column A freezes",
 * which reading the code cannot.
 */
export async function buildWorkbookBuffer({
  title,
  sheets,
  filters = [],
  notes = [],
}: Omit<ExportSheetsOptions, "fileName">): Promise<ArrayBuffer> {
  const wb = XLSX.utils.book_new();
  const panes = new Map<string, { cols: number; headerRow: number }>();
  for (const s of sheets) {
    const tab = s.sheetName.slice(0, 31);
    XLSX.utils.book_append_sheet(wb, buildDataSheet(s), tab);
    if (s.freezeCols) panes.set(tab, { cols: s.freezeCols, headerRow: (s.preamble ?? []).length });
  }
  const counts = sheets.map((s) => ({ sheetName: s.sheetName, count: s.rows.length }));
  XLSX.utils.book_append_sheet(wb, buildAboutSheet({ title, counts, filters, notes }), "About this export");

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  // ⚠ THE ZIP PASS ONLY RUNS FOR A SHEET THAT ASKED. Every export predating
  //   `freezeCols` therefore leaves here byte-for-byte as it did before.
  return panes.size ? freezeWorkbookPanes(buf, panes) : buf;
}

/**
 * Build and download an .xlsx with several data sheets, plus the "About" sheet.
 *
 * ⚠ ASYNC SINCE THE PANE FIX. The three callers that predate it invoke this as
 *   a statement and are unaffected; `saveAs` after an await is already how
 *   receivables-hub's zipped export downloads.
 */
export async function exportSheetsToXlsx({
  fileName,
  title,
  sheets,
  filters = [],
  notes = [],
}: ExportSheetsOptions): Promise<void> {
  const buf = await buildWorkbookBuffer({ title, sheets, filters, notes });
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
}: ExportOptions<T>): Promise<void> {
  return exportSheetsToXlsx({ fileName, title, sheets: [{ sheetName, columns, rows }], filters, notes });
}
