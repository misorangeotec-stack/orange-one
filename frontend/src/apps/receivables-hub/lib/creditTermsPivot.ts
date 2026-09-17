import type { GridColumn } from "@hub/lib/useColumnGrid";
import { fmtINRMoney } from "@hub/lib/utils";

/**
 * Credit Terms Not Set — the pure half of the By customer view (RC-19).
 *
 * No React and no fetching here, so every rule below can be proved in Node against live data before a
 * pixel is drawn. The page maps ledgers to rows; this file turns those rows into one line per customer
 * with a block per book, and decides what each cell of a block says.
 *
 * ── Customer since: there is NO creation date in Tally's export ──
 *
 *  Checked in both databases on 17-09-2026. The ledger masters in ConnectWave carry no creation or
 *  alteration date — the connector never asks Tally for one. ⚠ APPLICABLEFROM, nested inside
 *  LEDMAILINGDETAILS.LIST / LEDGSTREGDETAILS.LIST, LOOKS like one and is not: every value is a 1 April
 *  (two are 1 July 2017, GST launch), and ledgers with very low MASTERIDs carry 2025 dates. It records
 *  when the address or GST details were last set. Do not try it again.
 *
 *  What does exist is Orange One's mst_parties.created_at: when the masters sync first SAW a ledger.
 *  The sync bulk-loaded every existing ledger up to 14-08-2026 17:45:24 IST, so for those it is only the
 *  load date and means nothing. For the 42 customers first seen since, it was compared against each
 *  one's first voucher: 29 were first seen within 3 days of (or before) it, 7 had a voucher 1-3 weeks
 *  earlier, and 4 were OLD customers with vouchers 2-5 months earlier. Taking the EARLIER of the two
 *  dates corrects all 11. Everyone older reads blank — never a fabricated date.
 *
 * ── Last transaction ──
 *
 *  The newest of the last Tally voucher (rpt_ledger_voucher_dates, which sees credit notes, journals
 *  and settled bills), the last receipt and the newest open bill. Post-dated vouchers are left out
 *  until their day — 24 ledgers carried post-dated bank receipts on 17-09-2026.
 */

/** The last row the masters sync bulk-loaded was created 14-08-2026 17:45:24 IST; the next arrived 17-08. */
export const MASTERS_BULK_LOAD_END = "2026-08-14T12:15:25Z";

export const BEFORE_LOAD_TIP = "Customer before 14 Aug 2026; creation date not available from Tally";

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

/** "2026-08-12" -> "Aug-26" — what the Last transaction filter offers. */
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

/* ── Customer since ─────────────────────────────────────────────────────────────────────────── */

export interface VoucherDates {
  /** ISO dates. `last` is never after the day the table was rebuilt. */
  first: string;
  last: string;
  lastType: string;
}

export interface SinceFacts {
  /** Tally GUID -> mst_parties.created_at, for ledgers first seen AFTER the bulk load. null = failed to load. */
  firstSeen: ReadonlyMap<string, string> | null;
  /** Tally GUID -> first/last voucher. null = failed to load. */
  vouchers: ReadonlyMap<string, VoucherDates> | null;
}

export type SinceReason = "new" | "before-load" | "unavailable";

export interface Since {
  iso: string;
  reason: SinceReason;
  tip: string;
}

export function customerSince(ledgerId: string, facts: SinceFacts): Since {
  // Either half missing means no honest answer. First-seen on its own is exactly the trap: wrong for
  // 11 of the 42 new customers.
  if (!facts.firstSeen || !facts.vouchers) {
    return { iso: "", reason: "unavailable", tip: "Could not be loaded — reload the page to try again." };
  }
  const seenTs = facts.firstSeen.get(ledgerId);
  // The loader only asks for rows after the bulk load; the second test keeps this function honest if
  // it is ever handed the whole table.
  if (!seenTs || !(new Date(seenTs).getTime() > new Date(MASTERS_BULK_LOAD_END).getTime())) {
    return { iso: "", reason: "before-load", tip: BEFORE_LOAD_TIP };
  }
  const seen = istDateOf(seenTs);
  const first = facts.vouchers.get(ledgerId)?.first ?? "";
  const iso = first && first < seen ? first : seen;
  const tip =
    `First seen by Orange One ${isoToDisplay(seen)} · ` +
    (first ? `first voucher ${isoToDisplay(first)}` : "no voucher yet") +
    ". Customer since is the earlier of the two.";
  return { iso, reason: "new", tip };
}

/* ── Last transaction ───────────────────────────────────────────────────────────────────────── */

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

/** Hover text for a Last transaction cell. */
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
  sinceIso: string;
  sinceReason: SinceReason;
  sinceTip: string;
  lastTxnIso: string;
  lastTxnKind: TxnKind | "";
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

export type CellField = "days" | "limit" | "since" | "outstanding";
export const CELL_FIELDS: CellField[] = ["days", "limit", "since", "outstanding"];
export const FIELD_LABEL: Record<CellField, string> = {
  days: "Days",
  limit: "Limit",
  since: "Customer since",
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

export function sinceText(l: PivotLedger | undefined): string {
  return !l ? "NA" : isoToDisplay(l.sinceIso);
}

const NA_MONEY = -1e15;

export function customerColumns<L extends PivotLedger>(shownBooks: string[]): CustomerColumn<L>[] {
  const cols: CustomerColumn<L>[] = [
    { key: "customer", label: "Customer", value: (c) => c.name },
    { key: "books", label: "Books", value: (c) => String(c.bookNames.length), sortValue: (c) => c.bookNames.length },
    {
      key: "lastTxn", label: "Last transaction",
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
        key: cellKey(book, "since"), label: FIELD_LABEL.since, book, field: "since",
        value: (c) => sinceText(cell(c)),
        sortValue: (c) => {
          const l = cell(c);
          return !l ? -1 : activityOrd(l.sinceIso);
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
