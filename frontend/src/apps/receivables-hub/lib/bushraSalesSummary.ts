/**
 * The Sales dashboard, as a set of TABLES rather than a screen.
 *
 * The dashboard draws rings, cards and charts; a PDF and a mail body need the same figures as rows
 * and columns. This turns the filtered register lines into that shape — once — so the screen, the
 * PDF and the scheduled mail all count the same way (the maths itself is in lib/bushraSalesFigures).
 *
 * Pure: no React, no browser, no jsPDF. The runner that builds the scheduled mail imports this.
 */
import type { BushraRegisterRow } from "./bushraSalesRegister";
import type { QtyUnit } from "./bushraSalesDashboards";
import {
  DIMS, MAIN_PRODUCTS, OTHER_PRODUCT, QUARTER_MONTHS, SALES_TYPE_UNIT, compareBy, fmtInt,
  makeQtyFmt, monthName, monthsOfFy, orNotSet, pairBy, quarterOf, salesKpis, yearBefore,
  type Cmp, type DimKey, type Pair, type QtyFmt, type SalesKpis,
} from "./bushraSalesFigures";

type Row = BushraRegisterRow;

export interface SummaryInput {
  rows: Row[];
  /** Rows of this FY and last, before the year filter — what the comparisons read. */
  compareRows: Row[];
  /** FOC lines for the same window, which never enter `rows`. */
  focRows: Row[];
  thisFy: string;
  lastFy: string;
  /** Last day with sales this year, YYYYMMDD — the year-to-date cut-off. */
  ytdTo: string;
  /** The month both halves of a comparison line up on, YYYYMM. */
  compareMonth: string;
  /** Which dimension the product table breaks down by, and what opens inside it. */
  dims: { bucket: DimKey; child: DimKey };
  /** This dashboard's quantity unit, for figures that mix products. */
  qtyUnit: QtyUnit;
  title: string;
  /** "FY 2026-27 · 1-Apr-2026 → 18-Sep-2026" */
  periodLabel: string;
  /** What the reader had filtered when this was built ("Company: O-tec"), or [] for everything. */
  filters: string[];
}

/**
 * One line of the performance table: the MONTH and the YEAR TO DATE for the same name, each already
 * carrying last year beside this year. Both windows live on one row on purpose — the first draft
 * kept two lists and looked the month up by name, which silently printed ₹0 against every category
 * (the month list only held products).
 */
export interface CmpRow { name: string; month: Cmp; ytd: Cmp; children: CmpRow[] }
export interface PeriodCol { key: string; label: string; months: string[] }
export interface PeriodCell { cur: number; pre: number }

export interface SalesSummary {
  title: string;
  periodLabel: string;
  filters: string[];
  generatedAt: string;
  kpis: SalesKpis;
  foc: { qty: number; value: number; vouchers: number; lines: number };
  company: Pair[];
  location: Pair[];
  /** This month and the year to date, each against last year, per product (or per category). */
  monthLabel: string;
  ytdLabel: string;
  performance: CmpRow[];
  /** The quarter × product pivot: quarters, then each quarter's months. */
  periods: PeriodCol[];
  rowNames: string[];
  /** rowName → periodKey → figures, for revenue and for quantity. */
  pivot: { value: Record<string, Record<string, PeriodCell>>; qty: Record<string, Record<string, PeriodCell>> };
  totals: { value: Record<string, PeriodCell>; qty: Record<string, PeriodCell> };
  /** How to write a quantity: the dashboard's own, and one per row name. */
  fmtQ: QtyFmt;
  /** The dashboard's quantity adds products of different units — a bare number, and said so. */
  mixedUnits: boolean;
  fmtRowQ: (name: string) => QtyFmt;
  lines: number;
}

const blankCmp = (name: string): Cmp => ({ name, curQty: 0, curVal: 0, preQty: 0, preVal: 0 });

/** Build every figure the PDF and the mail need, in one pass over the rows. */
export function buildSalesSummary(input: SummaryInput): SalesSummary {
  const { rows, compareRows, focRows, thisFy, lastFy, ytdTo, compareMonth, dims, qtyUnit } = input;
  const byProduct = dims.bucket === "salesType";

  const fmtQ = makeQtyFmt(qtyUnit, rows);
  const unitCache = new Map<string, QtyFmt>();
  const fmtRowQ = (name: string): QtyFmt => {
    if (!byProduct) return fmtQ;
    let f = unitCache.get(name);
    if (!f) {
      f = makeQtyFmt(SALES_TYPE_UNIT[name] ?? "auto", compareRows.filter((r) => DIMS.salesType(r) === name));
      unitCache.set(name, f);
    }
    return f;
  };

  /* ---- this month and the year to date, each against last year ---- */
  // The month still running stops at the same day as the year to date, on both sides.
  const monthCut = ytdTo.slice(0, 6) === compareMonth;
  const curMonth = { from: `${compareMonth}01`, to: monthCut ? ytdTo : `${compareMonth}31` };
  const preMonth = { from: yearBefore(curMonth.from), to: yearBefore(curMonth.to) };
  const curYtd = { from: `${thisFy.slice(0, 4)}0401`, to: ytdTo };
  const preYtd = { from: yearBefore(curYtd.from), to: yearBefore(curYtd.to) };

  /** Both windows for one dimension, merged name by name, children included. */
  const perfRows = (): CmpRow[] => {
    const get = DIMS[dims.bucket];
    const monthBy = new Map(compareBy(compareRows, get, curMonth, preMonth).map((c) => [c.name, c]));
    return compareBy(compareRows, get, curYtd, preYtd).map((ytd): CmpRow => {
      const mine = compareRows.filter((r) => get(r) === ytd.name);
      // "Other" opens by TYPE — packing material, raw material, software — each in its own unit.
      const isOther = byProduct && ytd.name === OTHER_PRODUCT;
      const childGet = isOther ? (r: Row) => orNotSet(r.sales_type) : DIMS[dims.child];
      const childMonth = new Map(compareBy(mine, childGet, curMonth, preMonth).map((c) => [c.name, c]));
      const children = compareBy(mine, childGet, curYtd, preYtd).map((cy): CmpRow => ({
        name: cy.name,
        ytd: cy,
        month: childMonth.get(cy.name) ?? blankCmp(cy.name),
        children: [],
      }));
      return { name: ytd.name, ytd, month: monthBy.get(ytd.name) ?? blankCmp(ytd.name), children };
    });
  };
  const order = (n: string) => {
    const i = (MAIN_PRODUCTS as readonly string[]).indexOf(n);
    return i === -1 ? MAIN_PRODUCTS.length : i;
  };
  const sortRows = (list: CmpRow[]) =>
    byProduct ? [...list].sort((a, b) => order(a.name) - order(b.name)) : list;

  /* ---- the quarter × product pivot, quarters then their months ---- */
  const months = monthsOfFy(thisFy, ytdTo);
  const periods: PeriodCol[] = [];
  for (const q of [1, 2, 3, 4]) {
    const qm = months.filter((m) => quarterOf(m) === q);
    if (!qm.length) continue;
    periods.push({ key: `Q${q}`, label: `Q${q} · ${QUARTER_MONTHS[q - 1]}`, months: qm.map(monthName) });
    for (const m of qm) periods.push({ key: m, label: monthName(m), months: [monthName(m)] });
  }
  periods.push({ key: "all", label: `FY ${thisFy}`, months: months.map(monthName) });

  const pivot = { value: {} as Record<string, Record<string, PeriodCell>>, qty: {} as Record<string, Record<string, PeriodCell>> };
  const totals = { value: {} as Record<string, PeriodCell>, qty: {} as Record<string, PeriodCell> };
  const cell = (bag: Record<string, PeriodCell>, key: string) => (bag[key] ??= { cur: 0, pre: 0 });
  const seen = new Set<string>();
  const lastYearTo = yearBefore(ytdTo);
  for (const r of compareRows) {
    const ym = r.vch_date.slice(0, 6);
    const isCur = months.includes(ym);
    const mapped = isCur ? ym : `${Number(ym.slice(0, 4)) + 1}${ym.slice(4)}`;
    if (!isCur && !months.includes(mapped)) continue;
    // Last year only to the same day, so the running month, its quarter and the year are like for like.
    if (!isCur && r.vch_date > lastYearTo) continue;
    const name = DIMS[dims.bucket](r);
    seen.add(name);
    for (const [measure, v] of [["value", r.revenue], ["qty", r.quantity]] as const) {
      const rowBag = (pivot[measure][name] ??= {});
      for (const key of [`Q${quarterOf(mapped)}`, mapped, "all"]) {
        const c = cell(rowBag, key);
        const t = cell(totals[measure], key);
        if (isCur) { c.cur += v; t.cur += v; } else { c.pre += v; t.pre += v; }
      }
    }
  }
  const rowNames = byProduct
    ? [...MAIN_PRODUCTS, OTHER_PRODUCT].filter((p) => seen.has(p))
    : [...seen].sort((a, b) => Math.abs(pivot.value[b]?.all?.cur ?? 0) - Math.abs(pivot.value[a]?.all?.cur ?? 0));

  /* ---- free issues, counted beside the sales rather than inside them ---- */
  const focVouchers = new Set(focRows.map((r) => `${r.tenant_id}|${r.voucher_no}`));

  return {
    title: input.title,
    periodLabel: input.periodLabel,
    filters: input.filters,
    // IST, stated: the scheduled mail builds this on a UTC runner, which would print 5.5 hours early.
    generatedAt: `${new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })} IST`,
    kpis: salesKpis(rows),
    foc: {
      qty: focRows.reduce((s, r) => s + r.quantity, 0),
      value: focRows.reduce((s, r) => s + r.revenue, 0),
      vouchers: focVouchers.size,
      lines: focRows.length,
    },
    company: pairBy(rows, DIMS.company),
    location: pairBy(rows, DIMS.location),
    monthLabel: `${monthName(compareMonth)} vs ${monthName(yearBefore(`${compareMonth}01`).slice(0, 6))}${monthCut ? ` · 1–${Number(ytdTo.slice(6))}` : ""}`,
    ytdLabel: `FY ${thisFy} to date vs FY ${lastFy}`,
    performance: sortRows(perfRows()),
    periods,
    rowNames,
    pivot,
    totals,
    fmtQ,
    mixedUnits: qtyUnit === "none",
    fmtRowQ,
    lines: rows.length,
  };
}

/** A figure's change against last year, already written. "—" when there is nothing to compare. */
export const changeText = (cur: number, pre: number): string => {
  if (pre === 0) return cur ? "new" : "—";
  const g = ((cur - pre) / Math.abs(pre)) * 100;
  return `${g >= 0 ? "+" : ""}${g.toFixed(1)}%`;
};

export const blankRow = blankCmp;
export const fmtCount = fmtInt;
