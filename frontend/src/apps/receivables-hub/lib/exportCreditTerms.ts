import { exportSheetsToXlsx, GROUP_ROW_STYLE, type ExportColumn, type ExportSheet } from "@/shared/lib/exportXlsx";
import {
  CELL_FIELDS, daysState, FIELD_LABEL, limitState,
  type CellField, type CustomerRow, type PivotLedger,
} from "@hub/lib/creditTermsPivot";

/**
 * Credit Terms Not Set — the Excel workbook (RC-19).
 *
 * Built on the shared exportSheetsToXlsx, not by hand, for one reason: FREEZE PANES. The report used to
 * write its own workbook with xlsx-js-style, and `ws["!freeze"]` writes nothing in that library — the
 * shared helper injects the pane into the sheet XML after writing (see freezeWorkbookPanes). A By
 * customer sheet runs 23 columns wide; scrolled to Colorix with the name column gone, it is unreadable.
 *
 * The workbook mirrors the view on screen: By customer (the pivot, shown books only) or By ledger, plus
 * the per-ledger Company Summary, plus the helper's "About this export" sheet carrying the filters and
 * what every colour and blank means — a spreadsheet emailed on outlives the screen it came from.
 */

/** Everything the By ledger sheet prints beyond what the pivot already needs. */
export interface LedgerExportRow extends PivotLedger {
  company: string;
  location: string;
  salesPerson: string;
  category: string;
  limitIsFlag: boolean;
  setElsewhere: boolean;
  overdue: number;
  maxOverdueDays: number;
  lastActivityMonth: string;
}

export interface SummaryExportRow {
  book: string;
  customers: number;
  none: number;
  days: number;
  limit: number;
  billwise: number;
  complete: number;
  owed: number;
}

/* ── Styles ─────────────────────────────────────────────────────────────────────────────────── */

const fill = (rgb: string) => ({ fill: { patternType: "solid", fgColor: { rgb } } });
/** Pale enough to read and print across 23 columns; a strong red makes the sheet unreadable. */
const RED = fill("FFF2F2");
const BILLS = fill("EAF3FB");
const ALT = fill("F4F6F9");
const DATE = { numFmt: "dd-mmm-yy" };
const MONEY = { numFmt: "#,##0;-#,##0" };
const TITLE = { font: { bold: true, sz: 12, color: { rgb: "0B1F3A" } } };
const BAND = {
  font: { bold: true, color: { rgb: "FFFFFF" }, sz: 11 },
  fill: { patternType: "solid", fgColor: { rgb: "0B1F3A" } },
  alignment: { horizontal: "center", vertical: "center" },
};
const BAND_ALT = { ...GROUP_ROW_STYLE, alignment: { horizontal: "center", vertical: "center" } };

/** "2026-08-12" -> the Excel serial for that day, so the column sorts and filters as dates. */
function excelDate(iso: string): number | "" {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return "";
  return (Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - Date.UTC(1899, 11, 30)) / 86_400_000;
}

const merge = (...styles: (object | undefined)[]) => {
  const parts = styles.filter(Boolean) as object[];
  return parts.length ? Object.assign({}, ...parts) : undefined;
};

/* ── By customer ────────────────────────────────────────────────────────────────────────────── */

const LEAD_COLS = 3; // Customer, Books, Last activity (any book)

function customerSheet<L extends PivotLedger>(rows: CustomerRow<L>[], shownBooks: string[], fyLabel: string): ExportSheet<CustomerRow<L>> {
  const cellOf = (c: CustomerRow<L>, book: string) => c.cells[book];
  const fieldValue = (c: CustomerRow<L>, book: string, field: CellField): string | number => {
    const l = cellOf(c, book);
    if (field === "days") {
      const s = daysState(l);
      // "On bills" in words: a blue blank cell explains nothing in a spreadsheet either.
      return s === "na" ? "NA" : s === "set" ? l!.creditDays : s === "bills" ? "On bills" : "";
    }
    if (field === "limit") {
      const s = limitState(l);
      // ₹1 exports as words, never as the number 1 — a 1 in a rupee column reads as a real limit.
      return s === "na" ? "NA" : s === "set" ? Math.round(l!.creditLimit) : s === "blocked" ? "₹1 blocked" : "";
    }
    if (!l) return "";
    return field === "activity" ? (excelDate(l.lastTxnIso) || l.lastActivityMonth) : Math.round(l.outstanding);
  };

  const WIDTH: Record<CellField, number> = { days: 9, limit: 13, activity: 14, outstanding: 14 };
  const columns: ExportColumn<CustomerRow<L>>[] = [
    { header: "Customer", width: 42, value: (c) => c.name },
    { header: "Books", width: 7, value: (c) => c.bookNames.length },
    { header: "Last activity (any book)", width: 18, value: (c) => excelDate(c.lastTxn.iso) },
    ...shownBooks.flatMap((book) =>
      CELL_FIELDS.map((field): ExportColumn<CustomerRow<L>> => ({
        header: FIELD_LABEL[field],
        width: WIDTH[field],
        value: (c) => fieldValue(c, book, field),
      })),
    ),
  ];

  // Column index -> which book block and field it belongs to.
  const slot = (col: number) => {
    if (col < LEAD_COLS) return null;
    const i = Math.floor((col - LEAD_COLS) / CELL_FIELDS.length);
    return { i, book: shownBooks[i], field: CELL_FIELDS[(col - LEAD_COLS) % CELL_FIELDS.length] };
  };

  const band: (string | number)[] = ["", "", ""];
  shownBooks.forEach((book) => band.push(book, "", "", ""));

  return {
    sheetName: "By customer",
    columns,
    rows,
    freezeCols: 1,
    preamble: [
      [`Credit Terms Not Set — by customer — ${fyLabel}.   Red = open in that book with the term not set (or the ₹1 "blocked" flag) · Blue "On bills" = no credit days on the ledger, but every open bill carries its own due date · NA = not open in that book`],
      band,
    ],
    preambleStyle: (r, c) => {
      if (r === 0) return c === 0 ? TITLE : undefined;
      const s = slot(c);
      return s && s.i % 2 === 1 ? BAND_ALT : BAND;
    },
    merges: shownBooks.map((_, i) => ({
      s: { r: 1, c: LEAD_COLS + i * CELL_FIELDS.length },
      e: { r: 1, c: LEAD_COLS + i * CELL_FIELDS.length + CELL_FIELDS.length - 1 },
    })),
    headerStyle: { alignment: { horizontal: "center", vertical: "center" } },
    cellStyle: (c, col) => {
      if (col === 2) return c.lastTxn.iso ? DATE : undefined;
      const s = slot(col);
      if (!s) return undefined;
      const l = cellOf(c, s.book);
      const alt = s.i % 2 === 1 ? ALT : undefined;
      // ONE fill per cell, same priority as the screen: red, then blue, then the alternate block.
      if (s.field === "days") {
        const st = daysState(l);
        return st === "missing" ? RED : st === "bills" ? BILLS : alt;
      }
      if (s.field === "limit") {
        const st = limitState(l);
        return st === "missing" || st === "blocked" ? RED : merge(alt, st === "set" ? MONEY : undefined);
      }
      // A bare month ("Aug-26") is text, so only a real date gets the date format.
      if (s.field === "activity") return merge(alt, l?.lastTxnIso ? DATE : undefined);
      return merge(alt, l ? MONEY : undefined);
    },
  };
}

/* ── By ledger ──────────────────────────────────────────────────────────────────────────────── */

function ledgerSheet<L extends LedgerExportRow>(
  rows: L[],
  fyLabel: string,
  text: { status: (r: L) => string; saleTypes: (r: L) => string },
): ExportSheet<L> {
  const outstanding = rows.reduce((s, r) => s + r.outstanding, 0);
  const overdue = rows.reduce((s, r) => s + r.overdue, 0);
  const columns: ExportColumn<L>[] = [
    { header: "Customer", width: 38, value: (r) => r.customer },
    { header: "Company", width: 14, value: (r) => r.company },
    { header: "Location", width: 11, value: (r) => r.location },
    { header: "Sales Person", width: 16, value: (r) => r.salesPerson },
    { header: "Category", width: 9, value: (r) => r.category },
    { header: "Sale Types", width: 22, value: (r) => text.saleTypes(r) },
    { header: "Credit Days", width: 11, value: (r) => (r.creditDays > 0 ? r.creditDays : "") },
    // ₹1 exports as the words, never as the number 1.
    { header: "Credit Limit", width: 16, value: (r) => (r.creditLimit > 1 ? Math.round(r.creditLimit) : r.limitIsFlag ? "₹1 flag (Tally)" : "") },
    { header: "Status", width: 16, value: (r) => text.status(r) },
    { header: "Bill-wise Due Dates", width: 18, value: (r) => r.billWiseBills || "" },
    { header: "Set Elsewhere", width: 13, value: (r) => (r.setElsewhere ? "Yes" : "") },
    { header: "Red Mark", width: 10, value: (r) => (r.redMark ? "Red Mark" : "") },
    { header: "Outstanding", width: 14, value: (r) => Math.round(r.outstanding) },
    { header: "Overdue", width: 14, value: (r) => Math.round(r.overdue) },
    { header: "Max OD Days", width: 12, value: (r) => r.maxOverdueDays },
    { header: "Last Activity", width: 16, value: (r) => excelDate(r.lastTxnIso) || r.lastActivityMonth },
  ];
  return {
    sheetName: "By ledger",
    columns,
    rows,
    freezeCols: 1,
    // The total sits ABOVE the header, not as a last data row, so sorting the sheet cannot move it.
    preamble: [
      [`Credit Terms Not Set — by ledger — ${fyLabel}.   Total (${rows.length} rows): outstanding ${Math.round(outstanding).toLocaleString("en-IN")} · overdue ${Math.round(overdue).toLocaleString("en-IN")}`],
    ],
    preambleStyle: (r, c) => (r === 0 && c === 0 ? TITLE : undefined),
    cellStyle: (r, col) => {
      if (col === 12 || col === 13) return MONEY;
      if (col === 7 && r.creditLimit > 1) return MONEY;
      if (col === 15 && r.lastTxnIso) return DATE;
      return undefined;
    },
  };
}

/* ── Company Summary ────────────────────────────────────────────────────────────────────────── */

function summarySheet(rows: SummaryExportRow[], total: SummaryExportRow, fyLabel: string, pctSet: (s: SummaryExportRow) => string): ExportSheet<SummaryExportRow> {
  const all = [...rows, total];
  return {
    sheetName: "Company Summary",
    columns: [
      { header: "Company", width: 24, value: (s) => s.book },
      { header: "Customers", width: 11, value: (s) => s.customers },
      { header: "Neither set", width: 12, value: (s) => s.none },
      { header: "Days missing", width: 13, value: (s) => s.days },
      { header: "Limit missing", width: 14, value: (s) => s.limit },
      { header: "Set on the bills", width: 16, value: (s) => s.billwise },
      { header: "Complete", width: 10, value: (s) => s.complete },
      { header: "% set", width: 8, value: (s) => pctSet(s) },
      { header: "Owed with nothing set", width: 22, value: (s) => Math.round(s.owed) },
    ],
    rows: all,
    preamble: [[`Credit Terms Not Set — company summary, counted per ledger per book — ${fyLabel}`]],
    preambleStyle: (r, c) => (r === 0 && c === 0 ? TITLE : undefined),
    rowStyle: (s) => (s === total ? GROUP_ROW_STYLE : undefined),
    cellStyle: (_s, col) => (col === 8 ? MONEY : undefined),
  };
}

/* ── The workbook ───────────────────────────────────────────────────────────────────────────── */

export function exportCreditTermsXlsx<L extends LedgerExportRow>(o: {
  view: "customer" | "ledger";
  fyLabel: string;
  customers: CustomerRow<L>[];
  shownBooks: string[];
  ledgers: L[];
  summaries: SummaryExportRow[];
  summaryTotal: SummaryExportRow;
  pctSet: (s: SummaryExportRow) => string;
  text: { status: (r: L) => string; saleTypes: (r: L) => string };
  filters: string[];
  scoped: boolean;
}): Promise<void> {
  const notes = [
    "A credit limit of ₹1 is an old Tally marker for a BLOCKED party, not a limit. It is counted as NOT set and printed as \"₹1 blocked\".",
    "Credit days can be set on the ledger or typed on each bill. \"Set on the bills\" (blue on By customer) means no days on the ledger but every open bill carries its own due date — those customers are controlled.",
    `NA means no debtor ledger for this customer in that book. The balances behind this report hold debtors only, so a customer filed under another group in a book also reads NA there${
      o.scoped ? ", as does a book where the customer is tagged to a salesperson or team outside the exporter's view" : ""}.`,
"Last activity: the newest Tally voucher (any type, including credit notes and journals), receipt or open bill we hold. Each book block shows that book's own ledger; the column on the left is the newest across every book. Post-dated entries are not counted until their date, and the voucher history held begins April 2024.",
    "Outstanding on By customer is each book's balance as it stands; a minus is money held for the customer (an advance). The Company Summary's \"Owed with nothing set\" sums positive balances only.",
    "The Company Summary counts ledgers, per book: one customer can be Complete in one book and Neither set in another.",
  ];
  return exportSheetsToXlsx({
    fileName: `credit-terms-not-set-${o.fyLabel.replace(/\s+/g, "")}`,
    title: `Credit Terms Not Set — ${o.fyLabel}`,
    sheets: [
      o.view === "customer" ? customerSheet(o.customers, o.shownBooks, o.fyLabel) : ledgerSheet(o.ledgers, o.fyLabel, o.text),
      summarySheet(o.summaries, o.summaryTotal, o.fyLabel, o.pctSet),
    ],
    filters: o.filters,
    notes,
  });
}
