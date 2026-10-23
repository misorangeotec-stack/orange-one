import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/core/platform/supabase";

/**
 * Expense Analysis (CFO) — data layer.
 *
 * The CFO's expense workbook (`PL and BS\Files\EXPENSES REFERESH\Expense Sheet *.xlsx`, built by
 * the refresh-expenses skill straight from Tally) rebuilt as a hub report. The lines are NOT read
 * from ConnectWave here: `tools/expense_cfo_loader.py` rebuilds them from the raw voucher lines,
 * proves them against Tally's own Trial Balance, and writes one load into the hub's database
 * (`expense_cfo_load` / `_line` / `_tie`, migration 20270207120000_expense_cfo.sql).
 *
 * Why the loader and not ConnectWave's `rpt_expense_line`: on 23-Oct-2026 that snapshot dropped
 * every ledger under Colorix's "OTHER EXPENSES" group (₹1,35,003.53 the TB does carry), and it
 * counts Purchase / Sales ORDERS, which never reach the books. See the loader's docstring.
 *
 * Every figure on the screen, in the workbook and in the PDF comes from this module and
 * `expenseCfoRules.ts`. A document that recomputed its own totals would sooner or later disagree
 * with the page it claims to be a copy of.
 */

// The three tables are not in the generated Database types (they are written by a local loader,
// not by the app), so they are read through an untyped handle. Read-only: RLS grants SELECT only.
const db = supabase as unknown as SupabaseClient;

/**
 * OTHER holds the two non-operating groups Tally files under Direct Expenses — inventory
 * valuation and exchange-rate gain/loss. The user asked (23-Oct-2026) that they not count as direct
 * cost: they swing by crores with stock valuation and the rupee, and in Direct they drown the real
 * cost movement. They stay in every total and in the TB tie (which follows Tally's own grouping).
 */
export type ExpType = "DIRECT" | "INDIRECT" | "OTHER";
export const EXP_TYPES: ExpType[] = ["DIRECT", "INDIRECT", "OTHER"];
export const EXP_LABEL: Record<ExpType, string> = { DIRECT: "DIRECT", INDIRECT: "INDIRECT", OTHER: "OTHER (VALUATION & EXCHANGE)" };
const OTHER_GROUP = /^(INVENTORY VALU|EXCHANGE RATE)/i;
export const isOther = (mainGroup: string): boolean => OTHER_GROUP.test(mainGroup.trim());

export interface ExpLine {
  company: string;
  entity: string;
  date: string;          // yyyy-mm-dd
  month: string;         // yyyy-mm
  voucherType: string;
  voucherNo: string;
  gl: string;
  expType: ExpType;
  mainGroup: string;
  subGroup: string;
  subSubGroup: string;
  party: string;
  partySource: string;
  narration: string;
  amount: number;        // spend positive, reversals negative
  isSalesVch: boolean;
  component: string;
}

export interface TieRow {
  company: string;
  expType: ExpType;
  level: "group" | "child";
  name: string;
  tb: number;
  lines: number;
  gap: number;
  asOf: string;
  capturedAt: string;
}

export interface LoadMeta {
  loadId: number;
  finishedAt: string;
  dateTo: string;
  status: "tied" | "not_tied";
  companies: Record<string, { lines: number; tb_as_of: string; tb_captured_at: string; gaps: number; notes: string[] }>;
}

export interface ExpenseCfoData {
  meta: LoadMeta;
  lines: ExpLine[];
  ties: TieRow[];
}

/** ₹0.99 — the loader's tolerance. A gap at or under it is rounding, anything over it is a gap. */
export const TIE_TOLERANCE = 0.99;

/** Company order and legal entity, as on the Excel's Company / Company Name columns. */
export const COMPANIES = ["Otec-Surat", "Otec-Noida", "Ent-Surat", "Ent-Noida", "Colorix"] as const;
export const ENTITY_LABEL: Record<string, string> = {
  Otec: "Orange O Tec Pvt Ltd",
  Ent: "Orange O Tec Enterprises Pvt Ltd",
  Colorix: "Colorix Digital Printing Solutions LLP",
};

const PAGE = 1000;   // PostgREST row cap — every read pages past it

/** The newest finished load. 'loading' and 'failed' loads are never shown. */
export async function loadExpenseCfo(): Promise<ExpenseCfoData> {
  const { data: loads, error } = await db
    .from("expense_cfo_load")
    .select("load_id, finished_at, date_to, status, companies")
    .in("status", ["tied", "not_tied"])
    .order("load_id", { ascending: false })
    .limit(1);
  if (error) throw error;
  if (!loads?.length) throw new Error("No expense load yet. Run tools/expense_cfo_loader.py once.");
  const l = loads[0];
  const meta: LoadMeta = {
    loadId: l.load_id, finishedAt: l.finished_at, dateTo: l.date_to, status: l.status, companies: l.companies,
  };

  const raw: Record<string, unknown>[] = [];
  for (;;) {
    const { data, error: e } = await db
      .from("expense_cfo_line")
      .select("company, entity, vch_date, voucher_type, voucher_no, gl, exp_type, main_group, sub_group, " +
              "sub_sub_group, party, party_source, narration, amount, is_sales_vch, component")
      .eq("load_id", meta.loadId)
      .order("voucher_guid").order("list_key").order("line_no")
      .range(raw.length, raw.length + PAGE - 1);
    if (e) throw e;
    raw.push(...((data ?? []) as unknown as Record<string, unknown>[]));
    if (!data || data.length < PAGE) break;
  }
  const expected = Object.values(meta.companies).reduce((s, c) => s + c.lines, 0);
  if (raw.length !== expected) {
    // Never show a partial picture of a CFO report as if it were whole.
    throw new Error(`Read ${raw.length} expense lines but the load holds ${expected}. Reload the page.`);
  }

  const { data: tieRows, error: te } = await db
    .from("expense_cfo_tie")
    .select("company, exp_type, level, name, tb, lines, gap, as_of, captured_at")
    .eq("load_id", meta.loadId);
  if (te) throw te;

  return {
    meta,
    lines: raw.map((r) => ({
      company: r.company as string,
      entity: r.entity as string,
      date: r.vch_date as string,
      month: (r.vch_date as string).slice(0, 7),
      voucherType: r.voucher_type as string,
      voucherNo: r.voucher_no as string,
      gl: r.gl as string,
      expType: isOther(r.main_group as string) ? "OTHER" : (r.exp_type as ExpType),
      mainGroup: r.main_group as string,
      subGroup: r.sub_group as string,
      subSubGroup: r.sub_sub_group as string,
      party: r.party as string,
      partySource: r.party_source as string,
      narration: r.narration as string,
      amount: Number(r.amount),
      isSalesVch: r.is_sales_vch as boolean,
      component: r.component as string,
    })),
    ties: (tieRows ?? []).map((r) => ({
      company: r.company, expType: r.exp_type, level: r.level, name: r.name,
      tb: Number(r.tb), lines: Number(r.lines), gap: Number(r.gap), asOf: r.as_of, capturedAt: r.captured_at,
    })),
  };
}

// ── Months ───────────────────────────────────────────────────────────────────────────────────

const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** "2026-04" → "APR-26", the Excel's MONTH label. */
export const monthLabel = (m: string): string => `${MON[Number(m.slice(5, 7)) - 1]}-${m.slice(2, 4)}`;

/** Indian FY quarter of a month: Apr–Jun is Q1. */
export const quarterOf = (m: string): number => Math.floor(((Number(m.slice(5, 7)) + 8) % 12) / 3) + 1;

/** Every month of the FY that contains `dateTo`, Apr → the month of `dateTo`. */
export function fyMonths(dateTo: string): string[] {
  const y = Number(dateTo.slice(0, 4));
  const startY = Number(dateTo.slice(5, 7)) >= 4 ? y : y - 1;
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    const mm = ((3 + i) % 12) + 1;
    const yy = startY + (mm < 4 ? 1 : 0);
    const key = `${yy}-${String(mm).padStart(2, "0")}`;
    if (key > dateTo.slice(0, 7)) break;
    out.push(key);
  }
  return out;
}

/** A table column: a month, a quarter total placed after its last month, or the grand total. */
export type Col = { kind: "month"; key: string; label: string }
  | { kind: "quarter"; q: number; months: string[]; label: string }
  | { kind: "total"; label: string };

export function columnsFor(months: string[]): Col[] {
  const cols: Col[] = [];
  months.forEach((m, i) => {
    cols.push({ kind: "month", key: m, label: monthLabel(m) });
    const q = quarterOf(m);
    if (i === months.length - 1 || quarterOf(months[i + 1]) !== q) {
      const qm = months.filter((x) => quarterOf(x) === q);
      if (qm.length) cols.push({ kind: "quarter", q, months: qm, label: `Q${q} Total` });
    }
  });
  cols.push({ kind: "total", label: "Grand Total" });
  return cols;
}

export function colValue(byMonth: ReadonlyMap<string, number>, c: Col, months: string[]): number {
  if (c.kind === "month") return byMonth.get(c.key) ?? 0;
  const keys = c.kind === "quarter" ? c.months : months;
  return keys.reduce((s, k) => s + (byMonth.get(k) ?? 0), 0);
}

// ── Filtering and pivots ─────────────────────────────────────────────────────────────────────

export interface Filters {
  from: string;          // yyyy-mm
  to: string;            // yyyy-mm
  companies: string[];   // every list: empty = all
  expTypes: string[];
  mainGroups: string[];
  gls: string[];
  parties: string[];
  search: string;        // voucher no / narration / party / ledger, case-insensitive
}

export const NO_FILTERS = { companies: [], expTypes: [], mainGroups: [], gls: [], parties: [], search: "" };

/** One filter set for every sheet, the screen and both downloads. */
export function applyFilters(lines: readonly ExpLine[], f: Filters): ExpLine[] {
  const sets = [f.companies, f.expTypes, f.mainGroups, f.gls, f.parties].map((a) => new Set(a));
  const pick: ((l: ExpLine) => string)[] = [(l) => l.company, (l) => l.expType, (l) => l.mainGroup, (l) => l.gl, (l) => l.party];
  const q = f.search.trim().toUpperCase();
  return lines.filter((l) =>
    l.month >= f.from && l.month <= f.to &&
    sets.every((s, i) => !s.size || s.has(pick[i](l))) &&
    (!q || `${l.voucherNo} ${l.narration} ${l.party} ${l.gl}`.toUpperCase().includes(q)));
}

/** The filters in words, for the downloads' headers — a printed figure must say what it covers. */
export function filterLabel(f: Filters): string {
  const parts = [f.companies.length ? f.companies.join(", ") : "All 5 companies"];
  if (f.expTypes.length) parts.push(f.expTypes.join(" + "));
  if (f.mainGroups.length) parts.push(`groups: ${f.mainGroups.join(", ")}`);
  if (f.gls.length) parts.push(`ledgers: ${f.gls.join(", ")}`);
  if (f.parties.length) parts.push(`parties: ${f.parties.join(", ")}`);
  if (f.search.trim()) parts.push(`search "${f.search.trim()}"`);
  return parts.join(" · ");
}

/** True when anything narrower than "all companies, whole period" is applied. */
export const isNarrowed = (f: Filters): boolean =>
  [f.companies, f.expTypes, f.mainGroups, f.gls, f.parties].some((a) => a.length > 0) || !!f.search.trim();

// ── Tree (collapsible rows) and quarter columns ──────────────────────────────────────────────

export interface TreeNode {
  key: string;           // path joined — stable id for open/closed state
  label: string;
  path: string[];
  depth: number;         // 1 = outermost group
  lines: ExpLine[];
  byMonth: Map<string, number>;
  total: number;
  children: TreeNode[];
}

/** Rows grouped by `keys` (outer first), every level sorted largest first. Returns the root. */
export function buildTree(lines: readonly ExpLine[], keys: ((l: ExpLine) => string)[]): TreeNode {
  const make = (path: string[], ls: ExpLine[]): TreeNode => {
    const depth = path.length;
    const children: TreeNode[] = [];
    if (depth < keys.length) {
      const groups = new Map<string, ExpLine[]>();
      for (const l of ls) {
        const k = keys[depth](l) || "(blank)";
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(l);
      }
      for (const [k, g] of groups) children.push(make([...path, k], g));
      children.sort((a, b) => b.total - a.total);
    }
    return {
      key: path.join("\u0001"), label: path[path.length - 1] ?? "Grand Total", path, depth,
      lines: ls, byMonth: byMonthOf(ls), total: sum(ls), children,
    };
  };
  return make([], [...lines]);
}

/**
 * Columns with each quarter CLOSED (its total only) unless it is in `open`, in which case its
 * months come first and its total follows. Grand Total last.
 */
export function quarterColumns(months: string[], open: ReadonlySet<number>): Col[] {
  return columnsFor(months).filter((c) => c.kind !== "month" || open.has(quarterOf(c.key)));
}

export interface PivotRow {
  /** Labels down to this row's depth, e.g. ["INDIRECT", "EMPLOYEE COST"]. */
  path: string[];
  depth: number;
  kind: "detail" | "subtotal" | "grand";
  byMonth: Map<string, number>;
  total: number;
}

/**
 * A pivot shaped like the Excel's: rows grouped by `keys` (outer first), each level sorted
 * largest-first, a subtotal closing every outer group, and a grand total.
 */
export function pivot(lines: readonly ExpLine[], keys: ((l: ExpLine) => string)[]): PivotRow[] {
  interface Node { children: Map<string, Node>; byMonth: Map<string, number>; total: number }
  const mk = (): Node => ({ children: new Map(), byMonth: new Map(), total: 0 });
  const root = mk();
  for (const l of lines) {
    let n = root;
    const add = (node: Node) => {
      node.byMonth.set(l.month, (node.byMonth.get(l.month) ?? 0) + l.amount);
      node.total += l.amount;
    };
    add(n);
    for (const k of keys) {
      const label = k(l) || "(blank)";
      if (!n.children.has(label)) n.children.set(label, mk());
      n = n.children.get(label)!;
      add(n);
    }
  }
  const out: PivotRow[] = [];
  const walk = (n: Node, path: string[]) => {
    const kids = [...n.children.entries()].sort((a, b) => b[1].total - a[1].total);
    for (const [label, child] of kids) {
      const p = [...path, label];
      if (child.children.size) {
        walk(child, p);
        out.push({ path: p, depth: p.length, kind: "subtotal", byMonth: child.byMonth, total: child.total });
      } else {
        out.push({ path: p, depth: p.length, kind: "detail", byMonth: child.byMonth, total: child.total });
      }
    }
  };
  walk(root, []);
  out.push({ path: ["Grand Total"], depth: 0, kind: "grand", byMonth: root.byMonth, total: root.total });
  return out;
}

export const sum = (lines: readonly ExpLine[]): number => lines.reduce((s, l) => s + l.amount, 0);

export function byMonthOf(lines: readonly ExpLine[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lines) m.set(l.month, (m.get(l.month) ?? 0) + l.amount);
  return m;
}

// ── Formatting ───────────────────────────────────────────────────────────────────────────────

const INR = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Table figure: Indian grouping, 2 decimals, "-" for nil — the Excel's `#,##0.00`. */
export const fmtAmt = (v: number): string => (Math.abs(v) < 0.005 ? "-" : INR.format(v));

/** Headline figure in crore / lakh. */
export function fmtCr(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  return `₹${INR.format(v)}`;
}

// ── Download options ─────────────────────────────────────────────────────────────────────────

/**
 * Asked every time the report is downloaded (user, 23-Oct-2026): full-rupee figures did not fit
 * the PDF's columns, and the reader wants to choose quarters or months and grouped or full rows.
 */
export type Unit = "cr" | "lakh" | "rupees";
export interface DownloadOptions {
  unit: Unit;
  columns: "quarters" | "months";   // quarter totals only, or every month with its quarter total
  rows: "grouped" | "detail";        // groups only (Excel: collapsible outline) or down to ledger / party
}
export const DEFAULT_DOWNLOAD: DownloadOptions = { unit: "lakh", columns: "quarters", rows: "grouped" };
export const UNIT_LABEL: Record<Unit, string> = { cr: "₹ in Crore", lakh: "₹ in Lakh", rupees: "₹" };
const UNIT_DIV: Record<Unit, number> = { cr: 1e7, lakh: 1e5, rupees: 1 };

/** A figure in the chosen unit, as a number (for Excel) — rounded to 2 decimals. */
export const inUnit = (v: number, u: Unit): number => Math.round((v / UNIT_DIV[u]) * 100) / 100;
/** A figure in the chosen unit, as text (for the PDF). */
export const fmtUnit = (v: number, u: Unit): string => fmtAmt(inUnit(v, u));

/** dd-mm-yyyy, the house date format. */
export const dmy = (iso: string): string => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
