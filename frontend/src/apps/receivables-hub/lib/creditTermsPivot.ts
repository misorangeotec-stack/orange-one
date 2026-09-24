import type { GridColumn } from "@hub/lib/useColumnGrid";
import { fmtINRMoney } from "@hub/lib/utils";

/**
 * Credit Terms Not Set — the pure half of the By customer view (RC-19).
 *
 * No React and no fetching here, so every rule below can be proved in Node against live data before a
 * pixel is drawn. The page maps ledgers to rows; this file turns those rows into one line per customer
 * with a block per book, and decides what each cell of a block says.
 *
 * ── Last activity, per book and across the customer ──
 *
 *  The newest of the last Tally voucher (rpt_ledger_voucher_dates, which sees credit notes, journals
 *  and settled bills), the last receipt and the newest open bill. Post-dated vouchers are left out
 *  until their day — 24 ledgers carried post-dated bank receipts on 17-09-2026.
 *
 * ⚠ THE BLOCKS USED TO CARRY "CUSTOMER SINCE" AND NO LONGER DO (client's call, 18-09-2026).
 *   Tally exports no ledger creation date, so it could only be filled for customers created after the
 *   masters sync's bulk load of 14-08-2026 — blank for about 98% of the report, which is a column nobody
 *   can read. Last activity is known for every ledger that has ever traded, so the fourth column of each
 *   block is that instead. The finding itself is written up in WORKLIST (RC-19), and getting a real
 *   creation date for older customers is RC-20: a Tally edit-log probe, a connector FETCH change and a
 *   full re-pull. ⚠ Do NOT "solve" it with APPLICABLEFROM — nested in LEDMAILINGDETAILS.LIST, it looks
 *   like a creation date and is not (every value is a 1 April; it records when address/GST details were
 *   last set) — nor with MASTERID, which is creation ORDER, per book, and wrapped JSON.
 */

/* ── Dates ──────────────────────────────────────────────────────────────────────────────────── */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Today as "YYYY-MM-DD" in IST, whatever the browser's own zone. */
export function todayIst(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** A timestamptz as its IST calendar date, "YYYY-MM-DD". "" when unparseable. */
export function istDateOf(ts: string | null | undefined): string {
  const d = new Date(ts ?? "");
  return Number.isNaN(d.getTime()) ? "" : todayIst(d);
}

/** Tally's "20260812" -> "2026-08-12". Anything else -> "". */
export function ymdToIso(ymd: string | null | undefined): string {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(ymd ?? "");
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

/** "2026-08-12" -> "12-Aug-26". Anything unparseable comes back empty, never "Invalid Date". */
export function isoToDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const name = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && name ? `${m[3]}-${name}-${m[1].slice(2)}` : "";
}

/** "2026-08-12" -> "Aug-26" — what the Last activity filters offer. */
export function isoToMonthLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(iso);
  const name = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && name ? `${name}-${m[1].slice(2)}` : "";
}

/** Sortable integer for either form: "2026-08-12" -> 20260812, "Aug-26" -> 20260800. 0 when neither. */
export function activityOrd(iso: string, monthLabel = ""): number {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (d) return Number(d[1] + d[2] + d[3]);
  const m = /^([A-Za-z]{3})-(\d{2})$/.exec(monthLabel);
  const month = m ? MONTHS.indexOf(m[1]) + 1 : 0;
  return m && month ? Number("20" + m[2]) * 10000 + month * 100 : 0;
}

/* ── Voucher dates, from ConnectWave ────────────────────────────────────────────────────────── */

export interface VoucherDates {
  /** ISO dates. `last` is never after the day the table was rebuilt. */
  first: string;
  last: string;
  lastType: string;
}

/* ── Last activity ──────────────────────────────────────────────────────────────────────────── */

export type TxnKind = "voucher" | "receipt" | "bill";

export interface LastTxn {
  iso: string;
  kind: TxnKind | "";
  ord: number;
}

export const NO_TXN: LastTxn = { iso: "", kind: "", ord: 0 };

export const TXN_KIND_LABEL: Record<TxnKind, string> = {
  voucher: "Tally voucher",
  receipt: "receipt",
  bill: "open bill",
};

/** Hover text for a Last activity cell. */
export function lastTxnTip(iso: string, kind: TxnKind | "", monthFallback = ""): string {
  if (iso && kind) return `Newest ${TXN_KIND_LABEL[kind]} on record`;
  if (monthFallback) return "Turnover in this month, but no dated document";
  return "Nothing in the history we hold (it begins April 2024)";
}

/**
 * The newest dated candidate that is not in the future. Candidates are tried in order, so on a tie the
 * earlier one names the kind — pass the voucher first, since it is the most specific.
 */
export function lastTransaction(candidates: { iso: string; kind: TxnKind }[], today: string): LastTxn {
  let best = NO_TXN;
  for (const c of candidates) {
    if (c.iso && c.iso <= today && c.iso > best.iso) best = { iso: c.iso, kind: c.kind, ord: activityOrd(c.iso) };
  }
  return best;
}

/* ── One customer, one row ──────────────────────────────────────────────────────────────────── */

/** The fields of a page row the pivot reads. The page's Row satisfies it structurally. */
export interface PivotLedger {
  id: string;
  customer: string;
  book: string;
  creditDays: number;
  creditLimit: number;
  billWiseBills: number;
  outstanding: number;
  redMark: boolean;
  /** This ledger's own last activity: newest voucher, receipt or open bill, never in the future. */
  lastTxnIso: string;
  lastTxnKind: TxnKind | "";
  /** "Aug-26" when a month carries turnover but no dated document exists. */
  lastActivityMonth: string;
  lastTxnOrd: number;
}

export type DaysState = "na" | "set" | "bills" | "missing";
export type LimitState = "na" | "set" | "blocked" | "missing";

/** No ledger in the book -> NA. Days on the ledger -> set. None, but every open bill dated -> bills. */
export function daysState(l: PivotLedger | undefined): DaysState {
  if (!l) return "na";
  if (l.creditDays > 0) return "set";
  return l.billWiseBills > 0 ? "bills" : "missing";
}

/** A limit of ₹1 is the legacy Tally block flag, not a limit — "blocked", and counted as not set. */
export function limitState(l: PivotLedger | undefined): LimitState {
  if (!l) return "na";
  if (l.creditLimit > 1) return "set";
  return l.creditLimit === 1 ? "blocked" : "missing";
}

export interface CustomerRow<L extends PivotLedger = PivotLedger> {
  name: string;
  /** Book -> this customer's ledger in it. A book with no key is a book the customer is not open in. */
  cells: Record<string, L>;
  /** Books in the page's block order. */
  bookNames: string[];
  /** Books where the same name appeared twice (0 on 17-09-2026); the cell keeps the larger balance. */
  dupBooks: string[];
  redMarkBooks: string[];
  /** Across every book the customer is open in — not only the books shown. */
  lastTxn: LastTxn;
}

/**
 * Block order, read from the data: most ledgers first, then by name. Never a constant, so a sixth book
 * appears without a code change. On 17-09-2026: O-tec Surat 1,204 · Enterprise Surat 312 · O-tec Noida
 * 177 · Enterprise Noida 108 · Colorix Surat 81 — the company panel's own order.
 */
export function buildBooks(rows: { book: string }[]): string[] {
  const count = new Map<string, number>();
  for (const r of rows) count.set(r.book, (count.get(r.book) ?? 0) + 1);
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([book]) => book);
}

/**
 * One row per customer NAME, matched exactly. "VAIBHAV ENTERPRISES MACHINE" is a separate ledger and a
 * separate credit decision from "VAIBHAV ENTERPRISES", so it gets its own row — the same rule the
 * report's "set in another company" test already uses. Rows come back A→Z.
 */
export function pivotCustomers<L extends PivotLedger>(rows: L[], bookOrder: string[]): CustomerRow<L>[] {
  const byName = new Map<string, CustomerRow<L>>();
  for (const l of rows) {
    let c = byName.get(l.customer);
    if (!c) {
      c = { name: l.customer, cells: {}, bookNames: [], dupBooks: [], redMarkBooks: [], lastTxn: NO_TXN };
      byName.set(l.customer, c);
    }
    const prev = c.cells[l.book];
    if (prev) {
      if (!c.dupBooks.includes(l.book)) c.dupBooks.push(l.book);
      if (Math.abs(l.outstanding) > Math.abs(prev.outstanding)) c.cells[l.book] = l;
    } else {
      c.cells[l.book] = l;
    }
    if (l.redMark && !c.redMarkBooks.includes(l.book)) c.redMarkBooks.push(l.book);
    if (l.lastTxnIso > c.lastTxn.iso) c.lastTxn = { iso: l.lastTxnIso, kind: l.lastTxnKind, ord: l.lastTxnOrd };
  }
  const rank = new Map(bookOrder.map((b, i) => [b, i]));
  const byRank = (a: string, b: string) => (rank.get(a) ?? 99) - (rank.get(b) ?? 99) || a.localeCompare(b);
  const out = [...byName.values()];
  for (const c of out) {
    c.bookNames = Object.keys(c.cells).sort(byRank);
    c.redMarkBooks.sort(byRank);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/* ── The grid's columns ─────────────────────────────────────────────────────────────────────── */

export type CellField = "days" | "limit" | "activity" | "outstanding";
export const CELL_FIELDS: CellField[] = ["days", "limit", "activity", "outstanding"];
export const FIELD_LABEL: Record<CellField, string> = {
  days: "Days",
  limit: "Limit",
  activity: "Last activity",
  outstanding: "Outstanding",
};

export const cellKey = (book: string, field: CellField) => `${book}|${field}`;

export interface CustomerColumn<L extends PivotLedger = PivotLedger> extends GridColumn<CustomerRow<L>> {
  label: string;
  book?: string;
  field?: CellField;
}

/** What a Days cell filters on. "On the bills" is filterable even though the cell itself reads blank. */
export function daysText(l: PivotLedger | undefined): string {
  const s = daysState(l);
  return s === "na" ? "NA" : s === "set" ? String(l!.creditDays) : s === "bills" ? "On the bills" : "";
}

export function limitText(l: PivotLedger | undefined): string {
  const s = limitState(l);
  return s === "na" ? "NA" : s === "set" ? fmtINRMoney(l!.creditLimit) : s === "blocked" ? "₹1 blocked" : "";
}

/** What a Last activity cell shows: the date, else the bare month, else nothing. */
export function activityText(l: PivotLedger | undefined): string {
  return !l ? "" : isoToDisplay(l.lastTxnIso) || l.lastActivityMonth;
}

const NA_MONEY = -1e15;

export function customerColumns<L extends PivotLedger>(shownBooks: string[]): CustomerColumn<L>[] {
  const cols: CustomerColumn<L>[] = [
    { key: "customer", label: "Customer", value: (c) => c.name },
    { key: "books", label: "Books", value: (c) => String(c.bookNames.length), sortValue: (c) => c.bookNames.length },
    {
      key: "lastTxn", label: "Last activity (any book)",
      value: (c) => isoToMonthLabel(c.lastTxn.iso),
      sortValue: (c) => c.lastTxn.ord,
    },
  ];
  for (const book of shownBooks) {
    const cell = (c: CustomerRow<L>) => c.cells[book];
    cols.push(
      {
        key: cellKey(book, "days"), label: FIELD_LABEL.days, book, field: "days",
        value: (c) => daysText(cell(c)),
        sortValue: (c) => {
          const l = cell(c);
          const s = daysState(l);
          return s === "set" ? l!.creditDays : s === "bills" ? -1 : s === "missing" ? -2 : -3;
        },
      },
      {
        key: cellKey(book, "limit"), label: FIELD_LABEL.limit, book, field: "limit",
        value: (c) => limitText(cell(c)),
        sortValue: (c) => {
          const l = cell(c);
          const s = limitState(l);
          return s === "set" ? l!.creditLimit : s === "blocked" ? -1 : s === "missing" ? -2 : -3;
        },
      },
      {
        key: cellKey(book, "activity"), label: FIELD_LABEL.activity, book, field: "activity",
        // Filters by MONTH, like the customer-level column: a dropdown of 600 distinct dates is a
        // list, not a filter, while "Aug-26" answers "who has gone quiet in this book?".
        value: (c) => {
          const l = cell(c);
          return !l ? "NA" : isoToMonthLabel(l.lastTxnIso) || l.lastActivityMonth;
        },
        sortValue: (c) => {
          const l = cell(c);
          return !l ? -1 : l.lastTxnOrd;
        },
      },
      {
        key: cellKey(book, "outstanding"), label: FIELD_LABEL.outstanding, book, field: "outstanding",
        // Every balance is its own value; a dropdown of them would restate the column. It still sorts.
        filter: false,
        value: (c) => (cell(c) ? String(Math.round(cell(c)!.outstanding)) : ""),
        sortValue: (c) => cell(c)?.outstanding ?? NA_MONEY,
      },
    );
  }
  return cols;
}
