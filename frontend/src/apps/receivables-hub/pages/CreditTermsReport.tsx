import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import * as XLSX from "xlsx-js-style";
import {
  CreditCard, Download, Search, ArrowLeft, ArrowUpDown, ArrowUp, ArrowDown, Lock,
} from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Badge } from "@hub/components/ui/badge";
import { Card, CardContent } from "@hub/components/ui/card";
import { Input } from "@hub/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@hub/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@hub/components/ui/table";
import {
  Pagination, PaginationContent, PaginationItem,
  PaginationLink, PaginationPrevious, PaginationNext, PaginationEllipsis,
} from "@hub/components/ui/pagination";
import { MultiSelectFilter } from "@hub/components/MultiSelectFilter";
import { SalesPersonMultiSelect } from "@hub/components/SalesPersonMultiSelect";
import { CustomerCategoryMultiSelect, matchesCategory } from "@hub/components/CustomerCategoryMultiSelect";
import { SaleTypeMultiSelect, SALE_TYPE_OPTIONS } from "@hub/components/SaleTypeMultiSelect";
import { FilterChips, type FilterChip } from "@hub/components/FilterChips";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useAppData } from "@hub/lib/useAppData";
import { useFY } from "@hub/lib/fyContext";
import { useReceivablesSource } from "@hub/lib/sourceContext";
import { fmtINRMoney } from "@hub/lib/utils";
import type { SaleType } from "@hub/lib/types";
import { HEADER_STYLE, GRAND_TOTAL_STYLE, styleRow } from "@hub/lib/xlsxStyle";

/**
 * Credit Terms Not Set — which customers carry no credit days / credit limit, book by book.
 *
 * ── The three rules this report exists to get right ──
 *
 *  1. A CREDIT LIMIT OF ₹1 IS A FLAG, NOT A LIMIT.
 *     Tally reads 0/blank as "no credit control at all", so Accounts marked a party as blocked by
 *     setting the limit to ₹1 — the smallest figure any sale breaches. 184 ledgers still carry it.
 *     It once drove the Red Mark badge; ext_redmark replaced it and holds 54 ledgers, only 12 of
 *     which overlap. So on Live a ₹1 row is NOT a Red Mark customer and is never labelled one —
 *     `Red Mark` here reads `Customer.blocked` (the master), and ₹1 gets its own muted chip.
 *     For "is a limit set?", ₹1 counts as NOT set.
 *
 *  2. MONEY OWED SUMS POSITIVE BALANCES ONLY.
 *     Netting credit balances in flips a whole company: Colorix reads +₹0.83 Cr owed against a net
 *     of −₹4.03 Cr. A customer sitting on an advance is not negative exposure.
 *
 *  3. THE COMPANY PANEL IGNORES THE STATUS AND COMPANY FILTERS, ON PURPOSE.
 *     The list below defaults to the gaps. Honouring Status would leave the panel's "Complete"
 *     column reading 0 in every book — summarising its own filter instead of the data; honouring
 *     Company would collapse the panel to the one row you just clicked, with no way back.
 *
 *  4. CREDIT DAYS LIVE IN TWO PLACES IN TALLY, AND ONLY ONE OF THEM IS THE LEDGER.
 *     A bill carries its own BILLCREDITPERIOD — "45 Days" or an explicit "5-May-26" — typed at
 *     invoice entry. 154 ledgers here hold NO master credit period while every open bill carries a
 *     due date; BISHEN DYEING (MACHINE) is 58 machine instalments, ₹6.55 Cr, perfectly controlled.
 *     Reading the ledger alone called all 154 "Days missing", which is an accusation, not a finding.
 *     They get their OWN status, "Set on the bills" — visible, but out of the default gap view.
 *     Resolved from customerDetail[id].invoices (dueDate per open bill), no extra fetch.
 *
 * Source is `allCustomers`: one row per ledger per company (1,854 today), already salesperson-scoped
 * by useAppData, with the limit sign-corrected (Tally holds a debtor's limit as a negative Cr
 * amount) and the free-text credit period ("60 Days", "60", "1 Days") parsed to an integer by the
 * snapshot. Live (Tally) only — the legacy pipeline carries neither field reliably.
 */

/* ── Helpers ───────────────────────────────────────────────── */

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200, "all"] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

function getPageWindow(current: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | "...")[] = [1];
  if (current > 3) pages.push("...");
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p);
  if (current < total - 2) pages.push("...");
  pages.push(total);
  return pages;
}

const MONTH_ABBR: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

/** "2026-08-12" -> "12-Aug-26". Anything unparseable comes back empty, never "Invalid Date". */
function isoToDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return "";
  const name = Object.keys(MONTH_ABBR).find((k) => MONTH_ABBR[k] === Number(m[2]));
  return name ? m[3] + "-" + name + "-" + m[1].slice(2) : "";
}

/** Sortable integer for either form: "2026-08-12" -> 20260812, "Aug-26" -> 20260800. */
function activityOrd(iso: string, monthLabel: string): number {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (d) return Number(d[1] + d[2] + d[3]);
  const m = /^([A-Za-z]{3})-(\d{2})$/.exec(monthLabel);
  if (m && MONTH_ABBR[m[1]]) return Number("20" + m[2]) * 10000 + MONTH_ABBR[m[1]] * 100;
  return 0;
}

/** A limit of 0 is blank; a limit of ₹1 is the legacy Tally block flag. Neither is a limit. */
const hasLimit = (creditLimit: number) => creditLimit > 1;
const hasDays = (creditPeriod: number) => creditPeriod > 0;

/** Filters a caller can ask survives() to ignore. */
type Skippable = "book" | "status" | "salesPerson" | "saleType";

/**
 * Which balances the list keeps.
 *
 *   "all"      every ledger, zero balances included
 *   "nonzero"  carrying a balance either way — the "Has outstanding" button
 *   "owing"    OWES money, positive only — where the panel's money column drills to
 *
 * The last two are genuinely different and conflating them was a real defect: the panel's "Owed
 * with nothing set" sums POSITIVE balances (rule 2), so drilling into ₹82.47 L on a "nonzero"
 * filter produced a list whose own total read −₹3.42 Cr — the credit balances the figure had
 * deliberately excluded, dragged back in. A number you click and the list you land on have to be
 * the same set of customers.
 */
type BalanceMode = "all" | "nonzero" | "owing";

/** Same 50-paise floor fmtINRMoney uses, so nothing that PRINTS as ₹0 survives either filter. */
function passesBalance(outstanding: number, mode: BalanceMode): boolean {
  if (mode === "nonzero") return Math.abs(outstanding) >= 0.5;
  if (mode === "owing") return outstanding >= 0.5;
  return true;
}

type TermStatus = "none" | "days" | "limit" | "billwise" | "complete";

const STATUS_LABEL: Record<TermStatus, string> = {
  none: "Neither set",
  days: "Days missing",
  limit: "Limit missing",
  billwise: "Set on the bills",
  complete: "Complete",
};
const STATUS_ORDER: TermStatus[] = ["none", "days", "limit", "billwise", "complete"];
/**
 * The default view: everything that still needs a decision.
 * "billwise" is deliberately NOT here — a term typed on every bill is a term, not a gap.
 */
const INCOMPLETE: TermStatus[] = ["none", "days", "limit"];

function statusOf(days: number, limit: number, billWise: boolean): TermStatus {
  const d = hasDays(days), l = hasLimit(limit);
  if (d && l) return "complete";
  // Ledger days blank but the bills carry due dates — controlled, just not from the master.
  // Takes precedence over the limit gap: see the caveat on the "Set on the bills" filter.
  if (!d && billWise) return "billwise";
  if (!d && !l) return "none";
  return d ? "limit" : "days";
}

interface Row {
  id: string;
  customer: string;
  company: string;
  location: string;
  /** "O-tec — Surat". The book is the grain: O-tec Surat and O-tec Noida are nothing alike. */
  book: string;
  salesPerson: string;
  category: string;
  creditDays: number;
  creditLimit: number;
  /** creditLimit === 1 — the legacy block flag, shown as a chip and never as a rupee figure. */
  limitIsFlag: boolean;
  status: TermStatus;
  /** The same customer NAME carries this missing term in another book. */
  setElsewhere: boolean;
  /** Open bills (pending > 0) that carry their own due date — the bill-wise credit period. */
  billWiseBills: number;
  /** Sale types this customer actually trades in — open outstanding OR sales this FY. */
  saleTypes: SaleType[];
  /** Last activity we can prove: newest of the last receipt and the newest bill. "" when none. */
  lastActivity: string;
  /** Fallback when no dated record exists but a month shows turnover — "Aug-26". */
  lastActivityMonth: string;
  lastActivityOrd: number;
  redMark: boolean;
  outstanding: number;
  overdue: number;
  maxOverdueDays: number;
}

interface BookSummary {
  book: string;
  customers: number;
  none: number;
  days: number;
  limit: number;
  billwise: number;
  complete: number;
  owed: number;
}

type SortKey =
  | "customer" | "book" | "salesPerson" | "category" | "saleTypes" | "creditDays" | "creditLimit"
  | "status" | "outstanding" | "overdue" | "maxOverdueDays" | "lastActivity";

/** "Ink, Spare Parts" — the label list, which is also what the column sorts and exports on. */
const saleTypeText = (r: { saleTypes: SaleType[] }) =>
  r.saleTypes.map((t) => SALE_TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t).join(", ");

/**
 * Hover text for every column, in plain words.
 *
 * Kept here rather than inline so the panel and the list cannot end up explaining the same idea
 * two different ways. Shown as a native `title`, which works inside ScrollableTable and needs no
 * portal — the column headers are already crowded and a floating tooltip would cover the next one.
 */
const COL_HELP: Record<string, string> = {
  // ── company panel ──
  company: "Which of our Tally books this row is. O-tec Surat and O-tec Noida are separate books, so the same customer is counted once in each.",
  customers: "How many customer ledgers exist in this book. A customer billed by two companies appears once under each. This equals the five status columns added together — every customer is in exactly one of them.",
  none: "No credit days AND no credit limit — not on the ledger, and no due dates on their bills either. No credit control at all: this is the real problem list. Counted here ONLY — a customer whose bills carry due dates is in \"Set on the bills\" instead, not in both.",
  daysMissing: "Has a credit limit, but no credit days — and the bills carry no due dates either. We know how much they may owe, but not by when they must pay.",
  limitMissing: "Has credit days, but no credit limit. We know when they must pay, but not how much they are allowed to owe.",
  billwise: "No credit days on the ledger, but every open bill carries its own due date, typed in when the invoice was entered. These customers ARE controlled — just from the bills instead of the master, so they are NOT counted in \"Neither set\". Not a gap.",
  complete: "Both credit days and credit limit are filled in on the customer ledger.",
  pctSet: "Share of this book's customers who are properly controlled — Complete plus Set on the bills, divided by Customers.",
  owed: "Money currently owed by the \"Neither set\" customers only. Positive balances only: a customer sitting on an advance is not exposure, so credit balances are left out rather than netted off.",
  // ── customer list ──
  customer: "The customer ledger name, exactly as it reads in Tally.",
  salesPerson: "The salesperson tagged against this customer.",
  category: "The customer's finance grade — AA, A, B, C, D, E.",
  saleTypes: "What this customer actually buys — based on what they still owe, or what they bought this year.",
  creditDays: "Credit days set on the customer LEDGER. A dash means nothing is set there (the bills may still carry due dates — see Status).",
  creditLimit: "Credit limit set on the customer ledger. A dash means none. \"₹1 flag\" is an old Tally marker meaning blocked — it is not a real limit of one rupee.",
  status: "Where this customer stands: Neither set / Days missing / Limit missing / Set on the bills / Complete. The number beside \"Set on the bills\" is how many open bills carry their own due date.",
  setElsewhere: "Yes = this customer already has the missing term filled in under a DIFFERENT company. That makes the blank here far more likely to be an oversight than a decision.",
  outstanding: "What this customer owes right now, after other payments are applied.",
  overdue: "How much of that is already past its due date.",
  maxOd: "The oldest unpaid bill, in days past due.",
  lastActivity: "The most recent receipt or bill we hold for this ledger. A dash means no receipt and no bill in the period shown, so the ledger is dormant. A bare month (e.g. Aug-26) means there was turnover that month but no dated document to point at. Covers receipts and bills — not credit notes or journals.",
};

/**
 * One figure in the company panel, clickable when it counts something.
 *
 * A zero is deliberately INERT — no pointer, no click. Clicking it could only ever land on an
 * empty table, and a control whose single outcome is "nothing here" is a dead end, not a filter.
 */
function DrillCell({
  value, display, active, onPick, className = "", title,
}: {
  value: number;
  display?: string;
  active: boolean;
  onPick: () => void;
  className?: string;
  title?: string;
}) {
  const clickable = value > 0;
  return (
    <TableCell
      onClick={clickable ? onPick : undefined}
      title={title ?? (clickable ? "Click to show these in the list below" : "Nothing to show")}
      className={`text-xs text-right font-mono ${className} ${
        clickable ? "cursor-pointer hover:underline underline-offset-2" : "text-muted-foreground/50"
      } ${active ? "bg-primary/20 font-bold" : ""}`}
    >
      {display ?? value}
    </TableCell>
  );
}

/* ── Page ──────────────────────────────────────────────────── */

export default function CreditTermsReport() {
  // customerDetail carries the per-bill lines; it is unfiltered here because this page keeps its
  // own sale-type filter in local state and never touches useAppData's global one.
  const { loading, error, allCustomers, customerDetail } = useAppData();
  const { label: fyLabel } = useFY();
  const source = useReceivablesSource();

  const [search, setSearch] = useState("");
  const [books, setBooks] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<TermStatus[]>(INCOMPLETE);
  const [salesPersons, setSalesPersons] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [saleTypes, setSaleTypes] = useState<string[]>([]);
  const [onlyElsewhere, setOnlyElsewhere] = useState(false);
  const [balanceMode, setBalanceMode] = useState<BalanceMode>("all");
  const [sortKey, setSortKey] = useState<SortKey>("outstanding");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(25);

  const allRows = useMemo<Row[]>(() => {
    // Pass 1: which terms does each customer NAME hold anywhere? Exact-name match, deliberately —
    // "VAIBHAV ENTERPRISES MACHINE" is a separate ledger and a separate decision, so it must not
    // vouch for "VAIBHAV ENTERPRISES".
    const daysSomewhere = new Set<string>();
    const limitSomewhere = new Set<string>();
    for (const c of allCustomers) {
      if (hasDays(c.creditPeriod)) daysSomewhere.add(c.name);
      if (hasLimit(c.creditLimit)) limitSomewhere.add(c.name);
    }
    return allCustomers.map((c) => {
      const missingDaysHeldElsewhere = !hasDays(c.creditPeriod) && daysSomewhere.has(c.name);
      const missingLimitHeldElsewhere = !hasLimit(c.creditLimit) && limitSomewhere.has(c.name);
      // Only OPEN bills count. A settled bill's due date says nothing about how the next one
      // will be treated, and every closed bill would otherwise vouch for a dormant ledger.
      // ⚠ THIS COUNT MOVES BY A HANDFUL OF ROWS WHEN ConnectWave IS SLOW, and that is not a bug here.
      //   liveNonBillRefs STRIPS bill rows out of customerDetail (liveNonBillRefs.ts:212) — advances
      //   raised on cash vouchers that are not real bills. When v_non_bill_ref times out it fails
      //   soft and removes nothing (RC-7), so those rows survive and read as bill-wise cover: O-tec
      //   Surat showed 604 "Neither set" on a clean load and 598 on a degraded one. The clean load
      //   is the correct one. Nothing to fix in this file; fixing RC-7 fixes this too.
      const openBills = (customerDetail[c.id]?.invoices ?? []).filter((inv) => inv.pending > 0);
      const billWiseBills = openBills.filter((inv) => !!inv.dueDate).length;
      // What this customer actually trades in. Outstanding OR sales, so a customer who bought
      // spares and cleared the balance is still a spare-parts customer to whoever filters for one.
      const saleTypes = (SALE_TYPE_OPTIONS.map((o) => o.value) as SaleType[])
        .filter((t) => (c.outstandingByType?.[t] ?? 0) > 0 || (c.salesByType?.[t] ?? 0) > 0);
      // Last activity: the newest of the last receipt and the newest bill we hold. Both are ISO,
      // so a string compare IS a date compare.
      // ⚠ This is not the full voucher register — we hold receipts and bills, not credit notes or
      //   journals — so it is the last activity we can PROVE, not provably the last activity.
      //   The column is named "Last activity" for exactly that reason; do not rename it to
      //   "Last transaction" without first sourcing the voucher-level date from ConnectWave.
      const bills = customerDetail[c.id]?.invoices ?? [];
      const lastBill = bills.reduce((m, inv) => (inv.date && inv.date > m ? inv.date : m), "");
      const lastActivity = [c.lastReceiptDate ?? "", lastBill].filter(Boolean).sort().pop() ?? "";
      // No dated record, but a month carrying turnover still says the ledger is not dead.
      const lastActivityMonth = lastActivity ? "" :
        (customerDetail[c.id]?.trend ?? []).reduce(
          (m, t) => ((t.sales > 0 || t.receipts > 0) ? t.month : m), "");
      return {
        id: c.id,
        customer: c.name,
        company: c.company,
        location: c.location,
        book: c.location ? `${c.company} — ${c.location}` : c.company,
        salesPerson: c.salesPerson || "—",
        category: c.category || "",
        creditDays: c.creditPeriod,
        creditLimit: c.creditLimit,
        limitIsFlag: c.creditLimit === 1,
        status: statusOf(c.creditPeriod, c.creditLimit, billWiseBills > 0),
        setElsewhere: missingDaysHeldElsewhere || missingLimitHeldElsewhere,
        billWiseBills,
        saleTypes,
        lastActivity,
        lastActivityMonth,
        lastActivityOrd: activityOrd(lastActivity, lastActivityMonth),
        redMark: c.blocked,
        outstanding: c.outstanding,
        overdue: c.overdue,
        maxOverdueDays: c.maxOverdueDays,
      };
    });
  }, [allCustomers, customerDetail]);

  /**
   * One predicate for every filter, with the caller naming the ones to SKIP.
   *
   * That is what makes the dropdowns cascade: a column's options are read from the rows that
   * survive every filter EXCEPT its own, so narrowing Company shrinks the Salesperson list, and a
   * column never removes its own selected value from its own list.
   *
   * ⚠ VARIADIC, and it has to be. The company panel skips Status AND Company together; calling it
   *   twice and requiring both to pass applies every filter instead of skipping either — which read
   *   as "Complete: 0" in every company, the panel summarising its own filter.
   */
  /**
   * ⚠ ALL SIX TICKED MEANS "NO SALE-TYPE FILTER", exactly as none ticked does.
   *
   *   SaleTypeMultiSelect prints "All Sale Types" for BOTH states, so they have to behave the same
   *   or the control is lying about what it is doing. They did not: a full selection was applied as
   *   a real filter, and every customer with no sale-type activity at all — a dormant ledger, no
   *   open bills and no sales this FY — matched nothing and vanished, so the totals moved the
   *   moment you ticked the last box. Same rule TopExposureReport uses.
   */
  const saleTypeFilterOn = saleTypes.length > 0 && saleTypes.length < SALE_TYPE_OPTIONS.length;

  const survives = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (r: Row, ...skip: Skippable[]) =>
      (skip.includes("book") || books.length === 0 || books.includes(r.book)) &&
      (skip.includes("status") || statuses.length === 0 || statuses.includes(r.status)) &&
      (skip.includes("salesPerson") || salesPersons.length === 0 || salesPersons.includes(r.salesPerson)) &&
      // A customer matches a sale type if they trade in ANY of the selected ones.
      (skip.includes("saleType") || !saleTypeFilterOn || r.saleTypes.some((t) => saleTypes.includes(t))) &&
      matchesCategory(r, categories) &&
      (!onlyElsewhere || r.setElsewhere) &&
      passesBalance(r.outstanding, balanceMode) &&
      (!q || r.customer.toLowerCase().includes(q) || r.salesPerson.toLowerCase().includes(q));
  }, [search, books, statuses, salesPersons, categories, saleTypes, saleTypeFilterOn, onlyElsewhere, balanceMode]);

  const bookOptions = useMemo(
    () => [...new Set(allRows.filter((r) => survives(r, "book")).map((r) => r.book))].sort()
      .map((v) => ({ value: v, label: v })),
    [allRows, survives],
  );
  const statusOptions = useMemo(() => {
    const live = new Set(allRows.filter((r) => survives(r, "status")).map((r) => r.status));
    return STATUS_ORDER.filter((s) => live.has(s)).map((s) => ({ value: s, label: STATUS_LABEL[s] }));
  }, [allRows, survives]);
  const salesPersonOptions = useMemo(
    () => [...new Set(allRows.filter((r) => survives(r, "salesPerson")).map((r) => r.salesPerson))].sort(),
    [allRows, survives],
  );

  const filteredRows = useMemo(() => {
    const rows = allRows.filter((r) => survives(r));
    const dir = sortDir === "asc" ? 1 : -1;
    return rows.sort((a, b) => {
      let av: string | number, bv: string | number;
      switch (sortKey) {
        case "creditDays":     av = a.creditDays; bv = b.creditDays; break;
        // "Not set" sorts below every real limit rather than alongside ₹0 and ₹1.
        case "creditLimit":    av = hasLimit(a.creditLimit) ? a.creditLimit : -1;
                               bv = hasLimit(b.creditLimit) ? b.creditLimit : -1; break;
        case "outstanding":    av = a.outstanding; bv = b.outstanding; break;
        case "overdue":        av = a.overdue; bv = b.overdue; break;
        case "maxOverdueDays": av = a.maxOverdueDays; bv = b.maxOverdueDays; break;
        case "lastActivity":   av = a.lastActivityOrd; bv = b.lastActivityOrd; break;
        // Sorts by how incomplete the row is, not alphabetically by its label.
        case "status":         av = STATUS_ORDER.indexOf(a.status); bv = STATUS_ORDER.indexOf(b.status); break;
        case "book":           av = a.book; bv = b.book; break;
        case "salesPerson":    av = a.salesPerson; bv = b.salesPerson; break;
        case "category":       av = a.category; bv = b.category; break;
        case "saleTypes":      av = saleTypeText(a); bv = saleTypeText(b); break;
        default:               av = a.customer; bv = b.customer;
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return a.customer < b.customer ? -1 : a.customer > b.customer ? 1 : 0;
    });
  }, [allRows, survives, sortKey, sortDir]);

  /**
   * Company-wise panel. Reads the rows surviving every filter EXCEPT Status and Company — see rule
   * 3 in the header: honouring Status would zero its own "Complete" column, and honouring Company
   * would collapse the panel to the single row you just clicked.
   */
  const bookSummaries = useMemo<BookSummary[]>(() => {
    const m = new Map<string, BookSummary>();
    for (const r of allRows) {
      if (!survives(r, "status", "book")) continue;
      const s = m.get(r.book) ?? { book: r.book, customers: 0, none: 0, days: 0, limit: 0, billwise: 0, complete: 0, owed: 0 };
      s.customers++;
      s[r.status]++;
      // Positive balances only — rule 2.
      if (r.status === "none" && r.outstanding > 0) s.owed += r.outstanding;
      m.set(r.book, s);
    }
    return [...m.values()].sort((a, b) => b.customers - a.customers);
  }, [allRows, survives]);

  const bookTotal = useMemo(
    () => bookSummaries.reduce(
      (t, s) => ({
        book: "Total", customers: t.customers + s.customers, none: t.none + s.none,
        days: t.days + s.days, limit: t.limit + s.limit, billwise: t.billwise + s.billwise,
        complete: t.complete + s.complete, owed: t.owed + s.owed,
      }),
      { book: "Total", customers: 0, none: 0, days: 0, limit: 0, billwise: 0, complete: 0, owed: 0 } as BookSummary,
    ),
    [bookSummaries],
  );

  /** Counts bill-wise as set — those customers are controlled, just not from the master. */
  const pctSet = (s: BookSummary) =>
    s.customers === 0 ? "—" : `${Math.round(((s.complete + s.billwise) / s.customers) * 1000) / 10}%`;

  const listOutstanding = filteredRows.reduce((s, r) => s + r.outstanding, 0);
  const listOverdue = filteredRows.reduce((s, r) => s + r.overdue, 0);

  /* Pagination */
  const effectivePageSize = pageSize === "all" ? Math.max(1, filteredRows.length) : pageSize;
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / effectivePageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedRows = pageSize === "all"
    ? filteredRows
    : filteredRows.slice((safePage - 1) * effectivePageSize, safePage * effectivePageSize);
  const rangeStart = filteredRows.length === 0 ? 0 : (safePage - 1) * effectivePageSize + 1;
  const rangeEnd = Math.min(safePage * effectivePageSize, filteredRows.length);

  const resetPage = () => setCurrentPage(1);
  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "customer" || k === "book" || k === "salesPerson" || k === "category" || k === "saleTypes" ? "asc" : "desc");
    }
    resetPage();
  };
  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey !== k ? <ArrowUpDown className="h-3 w-3 inline opacity-40" />
    : sortDir === "asc" ? <ArrowUp className="h-3 w-3 inline" />
    : <ArrowDown className="h-3 w-3 inline" />;

  /**
   * Every figure in the company panel is a link into the list below it.
   *
   * Clicking a cell SETS the filters to exactly what that number counts — the book it sits in and
   * the status of its column — so what you read and what you then see are the same set. Clicking
   * the same cell again clears back to the default view, so a drill-down is always reversible
   * without hunting for the chip. `book: null` is the Total row: same status, every book.
   *
   * Deliberately a set, not a toggle-into-a-multi-select: adding "Days missing" to an existing
   * "Neither set" selection reads as a widening, and nobody clicking a single number means that.
   * The dropdowns are still there for anyone who does.
   */
  const drillActive = (book: string | null, sts: TermStatus[], mode: BalanceMode) =>
    (book === null ? books.length === 0 : books.length === 1 && books[0] === book) &&
    statuses.length === sts.length && sts.every((x) => statuses.includes(x)) &&
    balanceMode === mode;

  const drill = (book: string | null, sts: TermStatus[], mode: BalanceMode = "all") => {
    const already = drillActive(book, sts, mode);
    setBooks(already || book === null ? [] : [book]);
    setStatuses(already ? INCOMPLETE : sts);
    setBalanceMode(already ? "all" : mode);
    resetPage();
  };

  const clearAll = () => {
    setSearch(""); setBooks([]); setStatuses([]); setSalesPersons([]); setCategories([]);
    setSaleTypes([]); setOnlyElsewhere(false); setBalanceMode("all"); resetPage();
  };

  const chips: FilterChip[] = [
    search && { label: `Search: ${search}`, onRemove: () => { setSearch(""); resetPage(); } },
    books.length > 0 && {
      label: books.length <= 2 ? `Company: ${books.join(", ")}` : `Company: ${books.length} selected`,
      onRemove: () => { setBooks([]); resetPage(); },
    },
    statuses.length > 0 && {
      label: statuses.length === INCOMPLETE.length && INCOMPLETE.every((s) => statuses.includes(s))
        ? "Not set up yet"
        : `Status: ${statuses.map((s) => STATUS_LABEL[s]).join(", ")}`,
      onRemove: () => { setStatuses([]); resetPage(); },
    },
    salesPersons.length > 0 && {
      label: salesPersons.length <= 2 ? `Salesperson: ${salesPersons.join(", ")}` : `Salesperson: ${salesPersons.length} selected`,
      onRemove: () => { setSalesPersons([]); resetPage(); },
    },
    categories.length > 0 && {
      label: `Category: ${categories.join(", ")}`,
      onRemove: () => { setCategories([]); resetPage(); },
    },
    saleTypeFilterOn && {
      label: `Sale type: ${saleTypes.map((t) => SALE_TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t).join(", ")}`,
      onRemove: () => { setSaleTypes([]); resetPage(); },
    },
    onlyElsewhere && { label: "Set in another company", onRemove: () => { setOnlyElsewhere(false); resetPage(); } },
    balanceMode !== "all" && {
      label: balanceMode === "owing" ? "Owes money" : "Has outstanding",
      onRemove: () => { setBalanceMode("all"); resetPage(); },
    },
  ].filter(Boolean) as FilterChip[];

  const exportXlsx = () => {
    const wb = XLSX.utils.book_new();

    const sumHeader = ["Company", "Customers", "Neither set", "Days missing", "Limit missing",
      "Set on the bills", "Complete", "% set", "Owed with nothing set"];
    const sumAoa: (string | number)[][] = [
      [`Credit Terms Not Set — company summary — ${fyLabel}`],
      [],
      sumHeader,
      ...bookSummaries.map((s) => [s.book, s.customers, s.none, s.days, s.limit, s.billwise, s.complete, pctSet(s), Math.round(s.owed)]),
      ["Total", bookTotal.customers, bookTotal.none, bookTotal.days, bookTotal.limit, bookTotal.billwise,
        bookTotal.complete, pctSet(bookTotal), Math.round(bookTotal.owed)],
    ];
    const ws1 = XLSX.utils.aoa_to_sheet(sumAoa);
    ws1["!cols"] = [{ wch: 24 }, { wch: 11 }, { wch: 12 }, { wch: 13 }, { wch: 14 }, { wch: 16 }, { wch: 10 }, { wch: 8 }, { wch: 22 }];
    styleRow(ws1, 0, sumHeader.length, HEADER_STYLE);
    styleRow(ws1, 2, sumHeader.length, HEADER_STYLE);
    styleRow(ws1, sumAoa.length - 1, sumHeader.length, GRAND_TOTAL_STYLE);
    XLSX.utils.book_append_sheet(wb, ws1, "Company Summary");

    const detHeader = ["Customer", "Company", "Location", "Sales Person", "Category", "Sale Types",
      "Credit Days", "Credit Limit", "Status", "Bill-wise Due Dates", "Set Elsewhere", "Red Mark",
      "Outstanding", "Overdue", "Max OD Days", "Last Activity"];
    const detAoa: (string | number)[][] = [
      [`Credit Terms Not Set — ${fyLabel}`],
      [],
      detHeader,
      ...filteredRows.map((r) => [
        r.customer, r.company, r.location, r.salesPerson, r.category, saleTypeText(r),
        hasDays(r.creditDays) ? r.creditDays : "",
        // ₹1 exports as the words, never as the number 1 — a 1 in a rupee column reads as data.
        hasLimit(r.creditLimit) ? Math.round(r.creditLimit) : r.limitIsFlag ? "₹1 flag (Tally)" : "",
        STATUS_LABEL[r.status], r.billWiseBills || "", r.setElsewhere ? "Yes" : "", r.redMark ? "Red Mark" : "",
        Math.round(r.outstanding), Math.round(r.overdue), r.maxOverdueDays,
        isoToDisplay(r.lastActivity) || r.lastActivityMonth || "",
      ]),
      ["", "", "", "", "", "", "", "", `Total (${filteredRows.length} rows)`, "", "", "",
        Math.round(listOutstanding), Math.round(listOverdue), "", ""],
    ];
    const ws2 = XLSX.utils.aoa_to_sheet(detAoa);
    ws2["!cols"] = [{ wch: 36 }, { wch: 14 }, { wch: 11 }, { wch: 16 }, { wch: 9 }, { wch: 22 },
      { wch: 11 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 13 }, { wch: 10 }, { wch: 14 },
      { wch: 14 }, { wch: 12 }, { wch: 14 }];
    styleRow(ws2, 0, detHeader.length, HEADER_STYLE);
    styleRow(ws2, 2, detHeader.length, HEADER_STYLE);
    styleRow(ws2, detAoa.length - 1, detHeader.length, GRAND_TOTAL_STYLE);
    XLSX.utils.book_append_sheet(wb, ws2, "Customers");

    XLSX.writeFile(wb, `credit-terms-not-set-${fyLabel.replace(/\s+/g, "")}.xlsx`);
  };

  /* ── Not applicable on the default pipeline ──────────────── */
  if (source === "default") {
    return (
      <div className="p-6 max-w-[900px] mx-auto space-y-4">
        <Link to="/outstanding-dashboard/reports" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Reports
        </Link>
        <Card className="rounded-card border-border bg-surface">
          <CardContent className="p-10 flex flex-col items-center text-center gap-3">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
              <Lock className="h-6 w-6 text-muted-foreground" />
            </div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-primary" /> Credit Terms Not Set
            </h1>
            <p className="text-sm text-muted-foreground max-w-md">
              This report reads the credit limit and credit period held on each Tally ledger, so it is
              only available on the <strong>Live (Tally)</strong> view. Switch on{" "}
              <strong>Live (Tally)</strong> in the top bar to use it.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading credit terms…</div>;
  if (error) return <div className="p-6 text-sm text-destructive">Failed to load: {error}</div>;

  const notSetUp = bookTotal.none + bookTotal.days + bookTotal.limit;

  return (
    <div className="p-6 space-y-5 max-w-[1440px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <CreditCard className="h-6 w-6 text-primary" /> Credit Terms Not Set
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Which customers have no credit limit and no credit days in Tally, company by company. One
            row per ledger per book, so a customer billed by two companies appears once for each. ({fyLabel})
          </p>
        </div>
        <Button onClick={exportXlsx} disabled={filteredRows.length === 0} className="rounded-button gap-2">
          <Download className="h-4 w-4" /> Export Excel
        </Button>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: "Customer records", value: String(bookTotal.customers), sub: "one per ledger per company" },
          { label: "Not set up yet", value: String(notSetUp), sub: "missing days, limit or both" },
          { label: "Set on the bills", value: String(bookTotal.billwise), sub: "ledger blank, bills carry due dates" },
          { label: "Neither set", value: String(bookTotal.none), sub: "no credit term at all" },
          { label: "Owed with nothing set", value: fmtINRMoney(bookTotal.owed), sub: "outstanding, credit balances excluded" },
        ].map((s) => (
          <Card key={s.label} className="rounded-card border-border bg-surface">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{s.label}</div>
              <div className="text-lg font-bold text-foreground mt-1">{s.value}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{s.sub}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Panel 1 · company-wise ─────────────────────────── */}
      <Card className="rounded-card border-border bg-surface">
        <CardContent className="p-0">
          <div className="px-4 pt-4 pb-2">
            <h2 className="text-sm font-semibold text-foreground">By company</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              <strong>Click any figure</strong> to show exactly those customers in the list below;
              click it again to come back. Click a company name for all of its customers. <strong>Every customer is counted in exactly
              one of the five columns</strong> — Neither set, Days missing, Limit missing, Set on the
              bills, Complete — and the five add up to Customers. Nothing is double-counted.
              <strong> Set on the bills</strong> = no credit days on the ledger, but every open bill
              carries its own due date; those are controlled, so they are counted there and NOT in
              &ldquo;Neither set&rdquo;. These counts ignore the Status filter, so &ldquo;Complete&rdquo;
              keeps its meaning while the list below shows only the gaps.
            </p>
          </div>
          <ScrollableTable>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-xs cursor-help" title={COL_HELP.company}>Company</TableHead>
                  <TableHead className="text-xs text-right cursor-help" title={COL_HELP.customers}>Customers</TableHead>
                  <TableHead className="text-xs text-right cursor-help" title={COL_HELP.none}>Neither set</TableHead>
                  <TableHead className="text-xs text-right cursor-help" title={COL_HELP.daysMissing}>Days missing</TableHead>
                  <TableHead className="text-xs text-right cursor-help" title={COL_HELP.limitMissing}>Limit missing</TableHead>
                  <TableHead className="text-xs text-right cursor-help" title={COL_HELP.billwise}>Set on the bills</TableHead>
                  <TableHead className="text-xs text-right cursor-help" title={COL_HELP.complete}>Complete</TableHead>
                  <TableHead className="text-xs text-right cursor-help" title={COL_HELP.pctSet}>% set</TableHead>
                  <TableHead className="text-xs text-right cursor-help" title={COL_HELP.owed}>Owed with nothing set</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bookSummaries.map((s) => (
                  <TableRow key={s.book} className="hover:bg-muted/20">
                    <TableCell
                      onClick={() => drill(s.book, STATUS_ORDER, "all")}
                      title="Click to show every customer in this company, whatever their status"
                      className={`text-xs font-medium cursor-pointer hover:underline underline-offset-2 ${
                        drillActive(s.book, STATUS_ORDER, "all") ? "bg-primary/20 font-bold" : ""}`}
                    >{s.book}</TableCell>
                    <DrillCell
                      value={s.customers} active={drillActive(s.book, STATUS_ORDER, "all")}
                      onPick={() => drill(s.book, STATUS_ORDER, "all")}
                      /* If this ever stops adding up, the statuses have stopped being exclusive. */
                      title={`${s.none} + ${s.days} + ${s.limit} + ${s.billwise} + ${s.complete} = ${s.customers} — click to show them all`}
                    />
                    <DrillCell value={s.none} className="font-semibold text-destructive"
                      active={drillActive(s.book, ["none"], "all")} onPick={() => drill(s.book, ["none"])} />
                    <DrillCell value={s.days}
                      active={drillActive(s.book, ["days"], "all")} onPick={() => drill(s.book, ["days"])} />
                    <DrillCell value={s.limit}
                      active={drillActive(s.book, ["limit"], "all")} onPick={() => drill(s.book, ["limit"])} />
                    <DrillCell value={s.billwise} className="text-muted-foreground"
                      active={drillActive(s.book, ["billwise"], "all")} onPick={() => drill(s.book, ["billwise"])} />
                    <DrillCell value={s.complete} className="text-muted-foreground"
                      active={drillActive(s.book, ["complete"], "all")} onPick={() => drill(s.book, ["complete"])} />
                    {/* "% set" is Complete + Set on the bills, so clicking it shows exactly that pair. */}
                    <DrillCell value={s.complete + s.billwise} display={pctSet(s)} className="text-muted-foreground"
                      active={drillActive(s.book, ["complete", "billwise"], "all")}
                      onPick={() => drill(s.book, ["complete", "billwise"])}
                      title="Complete plus Set on the bills — click to show them" />
                    {/* The money is "Neither set" customers who actually owe something, so the
                        drill turns Has outstanding ON. Otherwise the list would include the
                        zero-balance ones that contribute nothing to this figure. */}
                    <DrillCell value={Math.round(s.owed)} display={fmtINRMoney(s.owed)} className="font-semibold"
                      active={drillActive(s.book, ["none"], "owing")} onPick={() => drill(s.book, ["none"], "owing")}
                      title="Customers with no credit term who owe money — click to show them" />
                  </TableRow>
                ))}
                {/* Same drills across every book — `null` clears the company filter instead of setting one. */}
                <TableRow className="bg-muted/50 font-semibold border-t border-border">
                  <TableCell
                    onClick={() => drill(null, STATUS_ORDER, "all")}
                    title="Click to show every customer, every company"
                    className={`text-xs font-bold cursor-pointer hover:underline underline-offset-2 ${
                      drillActive(null, STATUS_ORDER, "all") ? "bg-primary/20" : ""}`}
                  >Total</TableCell>
                  <DrillCell value={bookTotal.customers} className="font-bold"
                    active={drillActive(null, STATUS_ORDER, "all")} onPick={() => drill(null, STATUS_ORDER, "all")}
                    title={`${bookTotal.none} + ${bookTotal.days} + ${bookTotal.limit} + ${bookTotal.billwise} + ${bookTotal.complete} = ${bookTotal.customers} — click to show them all`} />
                  <DrillCell value={bookTotal.none} className="font-bold text-destructive"
                    active={drillActive(null, ["none"], "all")} onPick={() => drill(null, ["none"])} />
                  <DrillCell value={bookTotal.days} className="font-bold"
                    active={drillActive(null, ["days"], "all")} onPick={() => drill(null, ["days"])} />
                  <DrillCell value={bookTotal.limit} className="font-bold"
                    active={drillActive(null, ["limit"], "all")} onPick={() => drill(null, ["limit"])} />
                  <DrillCell value={bookTotal.billwise} className="font-bold"
                    active={drillActive(null, ["billwise"], "all")} onPick={() => drill(null, ["billwise"])} />
                  <DrillCell value={bookTotal.complete} className="font-bold"
                    active={drillActive(null, ["complete"], "all")} onPick={() => drill(null, ["complete"])} />
                  <DrillCell value={bookTotal.complete + bookTotal.billwise} display={pctSet(bookTotal)} className="font-bold"
                    active={drillActive(null, ["complete", "billwise"], "all")}
                    onPick={() => drill(null, ["complete", "billwise"])}
                    title="Complete plus Set on the bills — click to show them" />
                  <DrillCell value={Math.round(bookTotal.owed)} display={fmtINRMoney(bookTotal.owed)} className="font-bold"
                    active={drillActive(null, ["none"], "owing")} onPick={() => drill(null, ["none"], "owing")}
                    title="Customers with no credit term who owe money — click to show them" />
                </TableRow>
              </TableBody>
            </Table>
          </ScrollableTable>
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search customer / salesperson"
            value={search}
            onChange={(e) => { setSearch(e.target.value); resetPage(); }}
            className="pl-8 w-64 h-9 rounded-input text-sm"
          />
        </div>
        <MultiSelectFilter
          options={bookOptions} value={books} onChange={(v) => { setBooks(v); resetPage(); }}
          allLabel="All Companies" unit="Companies" searchable
          triggerClassName="w-52 h-9 text-sm rounded-input"
        />
        <MultiSelectFilter
          options={statusOptions} value={statuses}
          onChange={(v) => { setStatuses(v as TermStatus[]); resetPage(); }}
          allLabel="All Statuses" unit="Statuses" searchable
          triggerClassName="w-44 h-9 text-sm rounded-input"
        />
        <SalesPersonMultiSelect
          options={salesPersonOptions} value={salesPersons}
          onChange={(v) => { setSalesPersons(v); resetPage(); }}
        />
        <CustomerCategoryMultiSelect
          value={categories} onChange={(v) => { setCategories(v); resetPage(); }}
          triggerClassName="w-44 h-9 text-sm rounded-input"
        />
        {/* An author-declared vocabulary, not a reading of the data, so it does not cascade. */}
        <SaleTypeMultiSelect
          value={saleTypes} onChange={(v) => { setSaleTypes(v); resetPage(); }}
          triggerClassName="w-44 h-9 text-sm rounded-input"
        />
        <Button
          variant={balanceMode === "nonzero" ? "default" : "outline"}
          onClick={() => { setBalanceMode((m) => (m === "nonzero" ? "all" : "nonzero")); resetPage(); }}
          className="h-9 rounded-button text-xs"
          title="Show only ledgers carrying a balance right now, positive or negative. 1,131 of 1,854 sit at exactly zero and are usually not worth chasing."
        >
          Has outstanding
        </Button>
        <Button
          variant={onlyElsewhere ? "default" : "outline"}
          onClick={() => { setOnlyElsewhere((v) => !v); resetPage(); }}
          className="h-9 rounded-button text-xs"
          title="Rows missing a term the same customer already has in another company — an oversight rather than a decision"
        >
          Set in another company
        </Button>
      </div>

      <FilterChips chips={chips} onClearAll={clearAll} />

      {/* ── Panel 2 · customer-wise ────────────────────────── */}
      <Card className="rounded-card border-border bg-surface">
        <CardContent className="p-0">
          <ScrollableTable>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-xs cursor-pointer" title={COL_HELP.customer} onClick={() => toggleSort("customer")}>Customer <SortIcon k="customer" /></TableHead>
                  <TableHead className="text-xs cursor-pointer" title={COL_HELP.company} onClick={() => toggleSort("book")}>Company <SortIcon k="book" /></TableHead>
                  <TableHead className="text-xs cursor-pointer" title={COL_HELP.salesPerson} onClick={() => toggleSort("salesPerson")}>Sales Person <SortIcon k="salesPerson" /></TableHead>
                  <TableHead className="text-xs cursor-pointer" title={COL_HELP.category} onClick={() => toggleSort("category")}>Category <SortIcon k="category" /></TableHead>
                  <TableHead className="text-xs cursor-pointer" title={COL_HELP.saleTypes} onClick={() => toggleSort("saleTypes")}>Sale Types <SortIcon k="saleTypes" /></TableHead>
                  <TableHead className="text-xs text-right cursor-pointer" title={COL_HELP.creditDays} onClick={() => toggleSort("creditDays")}>Credit Days <SortIcon k="creditDays" /></TableHead>
                  <TableHead className="text-xs text-right cursor-pointer" title={COL_HELP.creditLimit} onClick={() => toggleSort("creditLimit")}>Credit Limit <SortIcon k="creditLimit" /></TableHead>
                  <TableHead className="text-xs cursor-pointer" title={COL_HELP.status} onClick={() => toggleSort("status")}>Status <SortIcon k="status" /></TableHead>
                  <TableHead className="text-xs cursor-help" title={COL_HELP.setElsewhere}>Set Elsewhere</TableHead>
                  <TableHead className="text-xs text-right cursor-pointer" title={COL_HELP.outstanding} onClick={() => toggleSort("outstanding")}>Outstanding <SortIcon k="outstanding" /></TableHead>
                  <TableHead className="text-xs text-right cursor-pointer" title={COL_HELP.overdue} onClick={() => toggleSort("overdue")}>Overdue <SortIcon k="overdue" /></TableHead>
                  <TableHead className="text-xs text-right cursor-pointer" title={COL_HELP.maxOd} onClick={() => toggleSort("maxOverdueDays")}>Max OD <SortIcon k="maxOverdueDays" /></TableHead>
                  <TableHead className="text-xs text-right cursor-pointer" title={COL_HELP.lastActivity} onClick={() => toggleSort("lastActivity")}>Last Activity <SortIcon k="lastActivity" /></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* An empty RESULT is not an empty TABLE — the header, the sorts and the filters
                    stay standing, or the only control that could undo the filter goes with them. */}
                {filteredRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={13} className="py-10 text-center text-sm text-muted-foreground">
                      <div className="flex flex-col items-center gap-2">
                        No customers match the current filters.
                        <Button variant="outline" size="sm" onClick={clearAll} className="rounded-button text-xs">
                          Clear filters
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {paginatedRows.map((r, i) => (
                      <TableRow key={`${r.id}-${i}`} className="hover:bg-muted/20">
                        <TableCell className="text-xs font-medium">
                          {r.customer}
                          {r.redMark && (
                            <Badge variant="outline" className="ml-1.5 text-[10px] px-1.5 py-0 rounded-button bg-destructive/15 text-destructive border-destructive/30">
                              Red Mark
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.book}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.salesPerson}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.category || "—"}</TableCell>
                        <TableCell className="text-[11px] text-muted-foreground max-w-[150px] truncate" title={saleTypeText(r)}>
                          {saleTypeText(r) || "—"}
                        </TableCell>
                        <TableCell className={`text-xs text-right font-mono ${hasDays(r.creditDays) ? "" : "text-muted-foreground/60"}`}>
                          {hasDays(r.creditDays) ? `${r.creditDays}d` : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-right font-mono">
                          {hasLimit(r.creditLimit) ? (
                            fmtINRMoney(r.creditLimit)
                          ) : r.limitIsFlag ? (
                            /* NEVER "₹1" and never "Red Mark": a stale Tally block flag, nothing more. */
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0 rounded-button text-muted-foreground border-border"
                              title="A limit of ₹1 is an old Tally marker for 'blocked', not a credit limit. Treated here as not set."
                            >
                              ₹1 flag
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground/60">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          <span className={
                            r.status === "none" ? "text-destructive font-semibold"
                            : r.status === "complete" || r.status === "billwise" ? "text-muted-foreground"
                            : "text-primary"
                          }>
                            {STATUS_LABEL[r.status]}
                          </span>
                          {r.status === "billwise" && (
                            <span className="ml-1 text-[10px] text-muted-foreground" title="Open bills carrying their own due date">
                              ({r.billWiseBills})
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {r.setElsewhere
                            ? <Badge variant="outline" className="text-[10px] px-1.5 py-0 rounded-button bg-primary/10 text-primary border-primary/30">Yes</Badge>
                            : <span className="text-muted-foreground/60">—</span>}
                        </TableCell>
                        <TableCell className="text-xs text-right font-mono font-semibold">{fmtINRMoney(r.outstanding)}</TableCell>
                        <TableCell className={`text-xs text-right font-mono ${r.overdue > 0 ? "text-destructive font-semibold" : "text-muted-foreground"}`}>{fmtINRMoney(r.overdue)}</TableCell>
                        <TableCell className="text-xs text-right font-mono text-muted-foreground">{r.maxOverdueDays > 0 ? r.maxOverdueDays : "—"}</TableCell>
                        <TableCell
                          className="text-xs text-right font-mono text-muted-foreground"
                          title={r.lastActivity ? "Newest receipt or bill on this ledger" : r.lastActivityMonth ? "Turnover in this month, but no dated document" : "No receipt and no bill in the period shown"}
                        >
                          {isoToDisplay(r.lastActivity) || r.lastActivityMonth || "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/50 font-semibold border-t border-border">
                      <TableCell className="text-xs font-bold" colSpan={9}>
                        Total ({filteredRows.length} record{filteredRows.length === 1 ? "" : "s"})
                      </TableCell>
                      <TableCell className="text-xs text-right font-mono font-bold">{fmtINRMoney(listOutstanding)}</TableCell>
                      <TableCell className="text-xs text-right font-mono font-bold text-destructive">{fmtINRMoney(listOverdue)}</TableCell>
                      <TableCell />
                      <TableCell />
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
          </ScrollableTable>
        </CardContent>
      </Card>

      {/* Pagination */}
      {filteredRows.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground whitespace-nowrap">Rows per page</span>
            <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(v === "all" ? "all" : Number(v) as PageSize); resetPage(); }}>
              <SelectTrigger className="w-[90px] h-8 rounded-input border-border text-sm"><SelectValue /></SelectTrigger>
              <SelectContent className="rounded-input">
                {PAGE_SIZE_OPTIONS.map((opt) => (
                  <SelectItem key={String(opt)} value={String(opt)}>{opt === "all" ? "All" : opt}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground whitespace-nowrap">{rangeStart}–{rangeEnd} of {filteredRows.length}</span>
          </div>
          {totalPages > 1 && (
            <Pagination className="mx-0 w-auto justify-end">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    aria-disabled={safePage === 1}
                    className={safePage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                  />
                </PaginationItem>
                {getPageWindow(safePage, totalPages).map((p, i) =>
                  p === "..." ? (
                    <PaginationItem key={`e-${i}`}><PaginationEllipsis /></PaginationItem>
                  ) : (
                    <PaginationItem key={p}>
                      <PaginationLink isActive={p === safePage} onClick={() => setCurrentPage(p)} className="cursor-pointer">{p}</PaginationLink>
                    </PaginationItem>
                  )
                )}
                <PaginationItem>
                  <PaginationNext
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    aria-disabled={safePage === totalPages}
                    className={safePage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </div>
      )}
    </div>
  );
}
