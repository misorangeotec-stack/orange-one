/**
 * Data layer for the C-Level Dashboard.
 *
 * Reads the ConnectWave / Tally-mirror project (the SAME db the Balance Sheet / P&L reports use)
 * via getConnectwaveSupabase(). Point-in-time numbers (GP/NP, ratios, balances) are derived from
 * loadFinancialStatements() (v_fs_line, exact). Trend + stock + duties come from the dashboard's own
 * mirror objects: clevel_pl_monthly, mv_clevel_ledger, v_clevel_gst_summary, v_clevel_stock_*.
 *
 * See supabase/clevel-mirror/ for the DB object definitions.
 */
import { getConnectwaveSupabase } from "./connectwaveSupabase";
import {
  buildPnl,
  buildBalanceSheet,
  type FsNode,
  type FsCompany,
} from "./financialStatements";

const tenantOf = (companyGuid: string) => `acct_orange::${companyGuid}`;

// ── Shared shapes ────────────────────────────────────────────────────────────
export interface MonthPoint {
  month: string; // "Apr", "May", …
  current: number | null;
  prior: number | null;
}
export interface NamedAmount {
  name: string;
  amount: number;
}

const MONTH_ORDER = ["04", "05", "06", "07", "08", "09", "10", "11", "12", "01", "02", "03"];
const MONTH_LABEL: Record<string, string> = {
  "01": "Jan", "02": "Feb", "03": "Mar", "04": "Apr", "05": "May", "06": "Jun",
  "07": "Jul", "08": "Aug", "09": "Sep", "10": "Oct", "11": "Nov", "12": "Dec",
};

// ── Trends (monthly sales / purchase / income / expense, two FYs) ─────────────
export interface ClevelTrends {
  currentFy: string | null;
  priorFy: string | null;
  sales: MonthPoint[];
  purchase: MonthPoint[];
  income: MonthPoint[];
  expense: MonthPoint[];
  grossProfit: MonthPoint[]; // Sales + Direct Incomes − Purchase − Direct Expenses (accounting GP, ex-stock)
  profit: MonthPoint[]; // income − expense (monthly net proxy)
  /** Current-FY-to-date totals + prior-FY same-period totals, for KPI deltas. */
  ytd: {
    sales: { current: number; prior: number | null };
    purchase: { current: number; prior: number | null };
    income: { current: number; prior: number | null };
    expense: { current: number; prior: number | null };
    grossProfit: { current: number; prior: number | null };
    profit: { current: number; prior: number | null };
  };
}

interface PlRow {
  fy: string;
  ym: string;
  sales: number | null;
  purchase: number | null;
  income: number | null;
  expense: number | null;
  // Granular P&L split (added for the accounting GP formula). Null on rows written before the split
  // existed → treated as 0, which degrades GP gracefully back to the old Sales − Purchase proxy.
  direct_incomes: number | null;
  indirect_incomes: number | null;
  direct_expenses: number | null;
  indirect_expenses: number | null;
}

export async function loadClevelTrends(companyGuid: string): Promise<ClevelTrends> {
  const cw = getConnectwaveSupabase();
  const { data, error } = await cw
    .from("clevel_pl_monthly")
    .select("fy,ym,sales,purchase,income,expense,direct_incomes,indirect_incomes,direct_expenses,indirect_expenses")
    .eq("company_guid", companyGuid)
    .order("ym", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as PlRow[];

  const fys = Array.from(new Set(rows.map((r) => r.fy))).sort().reverse();
  const currentFy = fys[0] ?? null;
  const priorFy = fys[1] ?? null;

  const num = (v: number | null | undefined) => (v == null ? 0 : Number(v));
  const monthsUpTo = new Set(rows.filter((r) => r.fy === currentFy).map((r) => r.ym.slice(4, 6)));

  const series = (key: keyof Omit<PlRow, "fy" | "ym">): MonthPoint[] =>
    MONTH_ORDER.map((mm) => {
      const cur = rows.find((r) => r.fy === currentFy && r.ym.slice(4, 6) === mm);
      const pri = priorFy ? rows.find((r) => r.fy === priorFy && r.ym.slice(4, 6) === mm) : undefined;
      return {
        month: MONTH_LABEL[mm],
        current: cur ? num(cur[key]) : monthsUpTo.has(mm) ? 0 : null,
        prior: priorFy ? (pri ? num(pri[key]) : 0) : null,
      };
    });

  // Derived monthly series: a − b per month, aligned across both FYs.
  const derived = (a: keyof Omit<PlRow, "fy" | "ym">, b: keyof Omit<PlRow, "fy" | "ym">): MonthPoint[] =>
    MONTH_ORDER.map((mm) => {
      const cur = rows.find((r) => r.fy === currentFy && r.ym.slice(4, 6) === mm);
      const pri = priorFy ? rows.find((r) => r.fy === priorFy && r.ym.slice(4, 6) === mm) : undefined;
      return {
        month: MONTH_LABEL[mm],
        current: cur ? num(cur[a]) - num(cur[b]) : monthsUpTo.has(mm) ? 0 : null,
        prior: priorFy ? (pri ? num(pri[a]) - num(pri[b]) : 0) : null,
      };
    });

  // Gross profit = Sales + Direct Incomes − Purchase − Direct Expenses: the accounting GP MINUS the
  // stock-movement term (opening/closing stock), which the mirror does not retain for a prior mid-year
  // period. When the granular columns are null (rows written before the split), num()→0 collapses this
  // to the old Sales − Purchase proxy, so unmigrated companies are unchanged.
  const gpOf = (r: PlRow | undefined) =>
    r ? num(r.sales) + num(r.direct_incomes) - num(r.purchase) - num(r.direct_expenses) : 0;
  const gpSeries: MonthPoint[] = MONTH_ORDER.map((mm) => {
    const cur = rows.find((r) => r.fy === currentFy && r.ym.slice(4, 6) === mm);
    const pri = priorFy ? rows.find((r) => r.fy === priorFy && r.ym.slice(4, 6) === mm) : undefined;
    return {
      month: MONTH_LABEL[mm],
      current: cur ? gpOf(cur) : monthsUpTo.has(mm) ? 0 : null,
      prior: priorFy ? (pri ? gpOf(pri) : 0) : null,
    };
  });

  const grossProfit = gpSeries; // accounting GP (ex-stock)
  const profit = derived("income", "expense"); // net proxy

  // YTD: current-FY total vs prior-FY over the SAME months (so the % is like-for-like).
  const sumField = (fy: string | null, key: keyof Omit<PlRow, "fy" | "ym">, months?: Set<string>) =>
    fy == null
      ? null
      : rows
          .filter((r) => r.fy === fy && (!months || months.has(r.ym.slice(4, 6))))
          .reduce((s, r) => s + num(r[key]), 0);

  const ytdOf = (key: keyof Omit<PlRow, "fy" | "ym">) => ({
    current: sumField(currentFy, key) ?? 0,
    prior: sumField(priorFy, key, monthsUpTo),
  });

  // Derived YTD (current-FY total vs prior-FY same-period), for the margin cards' value + %Δ.
  const ytdDerived = (a: keyof Omit<PlRow, "fy" | "ym">, b: keyof Omit<PlRow, "fy" | "ym">) => ({
    current: (sumField(currentFy, a) ?? 0) - (sumField(currentFy, b) ?? 0),
    prior:
      priorFy == null
        ? null
        : (sumField(priorFy, a, monthsUpTo) ?? 0) - (sumField(priorFy, b, monthsUpTo) ?? 0),
  });

  // YTD gross profit via the same accounting-GP formula as gpSeries (ex-stock).
  const gpSum = (fy: string | null, months?: Set<string>) =>
    fy == null
      ? null
      : rows
          .filter((r) => r.fy === fy && (!months || months.has(r.ym.slice(4, 6))))
          .reduce((s, r) => s + gpOf(r), 0);

  return {
    currentFy,
    priorFy,
    sales: series("sales"),
    purchase: series("purchase"),
    income: series("income"),
    expense: series("expense"),
    grossProfit,
    profit,
    ytd: {
      sales: ytdOf("sales"),
      purchase: ytdOf("purchase"),
      income: ytdOf("income"),
      expense: ytdOf("expense"),
      grossProfit: { current: gpSum(currentFy) ?? 0, prior: gpSum(priorFy, monthsUpTo) },
      profit: ytdDerived("income", "expense"),
    },
  };
}

// ── Ledger rollup (balances + top parties + duties) ──────────────────────────
export interface ClevelLedgerRollup {
  bank: number;
  cash: number;
  loans: number;
  receivables: number;
  payables: number;
  bankAccounts: NamedAmount[];
  topCustomers: NamedAmount[];
  topSuppliers: NamedAmount[];
}

interface LedgerRow {
  ledger: string;
  sub_group: string | null;
  grouping: string | null;
  group_chain: string[] | null;
  closing: number | null; // Dr-positive
}

export async function loadClevelLedgerRollup(companyGuid: string): Promise<ClevelLedgerRollup> {
  const cw = getConnectwaveSupabase();
  const tenant = tenantOf(companyGuid);
  const PAGE = 1000;
  const rows: LedgerRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await cw
      .from("mv_clevel_ledger")
      .select("ledger,sub_group,grouping,group_chain,closing")
      .eq("tenant_id", tenant)
      .order("guid", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as LedgerRow[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  const num = (v: number | null | undefined) => (v == null ? 0 : Number(v));
  // Match by the ANCESTOR chain, not the immediate sub-group: debtors/creditors/banks routinely nest
  // under geographic or custom sub-groups (e.g. Surat → Gujarat → OTHER DEBTORS → Sundry Debtors), so an
  // exact sub_group test misses ~90% of them. group_chain @> [group] is the same walk v_ledger_detail uses.
  const inChain = (r: LedgerRow, g: string) => Array.isArray(r.group_chain) && r.group_chain.includes(g);

  const bankRows = rows.filter((r) => inChain(r, "Bank Accounts"));
  const debtorRows = rows.filter((r) => inChain(r, "Sundry Debtors"));
  const creditorRows = rows.filter((r) => inChain(r, "Sundry Creditors"));

  const bank = bankRows.reduce((s, r) => s + num(r.closing), 0);
  const cash = rows.filter((r) => inChain(r, "Cash-in-Hand")).reduce((s, r) => s + num(r.closing), 0);
  const loans = rows
    .filter((r) => inChain(r, "Loans (Liability)"))
    .reduce((s, r) => s - num(r.closing), 0); // Cr → positive liability
  const receivables = debtorRows.reduce((s, r) => s + Math.max(num(r.closing), 0), 0);
  const payables = creditorRows.reduce((s, r) => s + Math.max(-num(r.closing), 0), 0);

  const topCustomers = debtorRows
    .map((r) => ({ name: r.ledger, amount: num(r.closing) }))
    .filter((x) => x.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);
  const topSuppliers = creditorRows
    .map((r) => ({ name: r.ledger, amount: -num(r.closing) }))
    .filter((x) => x.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);
  const bankAccounts = bankRows
    .map((r) => ({ name: r.ledger, amount: num(r.closing) }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  return { bank, cash, loans, receivables, payables, bankAccounts, topCustomers, topSuppliers };
}

// ── Duties & Taxes ───────────────────────────────────────────────────────────
export interface GstRow {
  taxName: string;
  receivable: number;
  payable: number;
}
export async function loadClevelGst(companyGuid: string): Promise<GstRow[]> {
  const cw = getConnectwaveSupabase();
  const { data, error } = await cw
    .from("v_clevel_gst_summary")
    .select("tax_name,receivable,payable")
    .eq("company_guid", companyGuid)
    .order("payable", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: { tax_name: string; receivable: number | null; payable: number | null }) => ({
    taxName: r.tax_name,
    receivable: Number(r.receivable) || 0,
    payable: Number(r.payable) || 0,
  }));
}

// ── Stock ────────────────────────────────────────────────────────────────────
export interface StockGroupRow {
  group: string;
  qty: number;
  value: number;
}
export interface StockItemRow {
  item: string;
  group: string;
  baseUnit: string;
  qty: number;
  value: number;
  movement: number;
}
export interface ClevelStock {
  groups: StockGroupRow[];
  totalValue: number;
  fast: StockItemRow[];
  slow: StockItemRow[];
  nonMoving: StockItemRow[];
}

export async function loadClevelStock(companyGuid: string): Promise<ClevelStock> {
  const cw = getConnectwaveSupabase();
  const [grpRes, itemRes] = await Promise.all([
    cw
      .from("v_clevel_stock_group_summary")
      .select("stock_group,closing_qty,closing_value")
      .eq("company_guid", companyGuid)
      .order("closing_value", { ascending: false }),
    cw
      .from("v_clevel_stock_item")
      .select("item,stock_group,base_unit,closing_qty,closing_value,movement_qty")
      .eq("company_guid", companyGuid)
      .limit(4000),
  ]);
  if (grpRes.error) throw new Error(grpRes.error.message);
  if (itemRes.error) throw new Error(itemRes.error.message);

  const groups: StockGroupRow[] = (grpRes.data ?? [])
    .map((r: { stock_group: string; closing_qty: number | null; closing_value: number | null }) => ({
      group: r.stock_group,
      qty: Number(r.closing_qty) || 0,
      value: Number(r.closing_value) || 0,
    }))
    .filter((g) => Math.abs(g.value) > 0.5 || Math.abs(g.qty) > 0.001);
  const totalValue = groups.reduce((s, g) => s + g.value, 0);

  const items: StockItemRow[] = (itemRes.data ?? []).map(
    (r: {
      item: string;
      stock_group: string;
      base_unit: string | null;
      closing_qty: number | null;
      closing_value: number | null;
      movement_qty: number | null;
    }) => ({
      item: r.item,
      group: r.stock_group,
      baseUnit: r.base_unit || "",
      qty: Number(r.closing_qty) || 0,
      value: Number(r.closing_value) || 0,
      movement: Number(r.movement_qty) || 0,
    }),
  );

  const fast = items
    .filter((i) => i.movement > 0.001)
    .sort((a, b) => b.movement - a.movement)
    .slice(0, 10);
  const slow = items
    .filter((i) => i.movement > 0.001)
    .sort((a, b) => a.movement - b.movement)
    .slice(0, 10);
  const nonMoving = items
    .filter((i) => Math.abs(i.movement) < 0.001 && (Math.abs(i.qty) > 0.001 || Math.abs(i.value) > 0.5))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 10);

  return { groups, totalValue, fast, slow, nonMoving };
}

// ── Point-in-time headline + ratios (exact, from financial statements) ───────
export interface ClevelHeadline {
  sales: number;
  grossProfit: number;
  nettProfit: number;
  grossMarginPct: number;
  nettMarginPct: number;
  closingStock: number;
}
export interface ClevelRatios {
  currentRatio: number | null;
  quickRatio: number | null;
  debtToEquity: number | null;
  returnOnEquityPct: number | null;
  opexRatio: number | null;
  currentAssets: number;
  currentLiabilities: number;
  equity: number;
  loans: number;
}

/** Sum a top-level group's Dr-positive tally from the statement roots. */
function rootTally(roots: FsNode[], name: string): number {
  return roots.filter((n) => n.name === name).reduce((s, n) => s + n.tally, 0);
}

export function selectHeadline(roots: FsNode[], company: FsCompany): ClevelHeadline {
  const pnl = buildPnl(roots, company);
  const sales = -rootTally(roots, "Sales Accounts");
  const grossMarginPct = sales ? (pnl.grossProfit / sales) * 100 : 0;
  const nettMarginPct = sales ? (pnl.nettProfit / sales) * 100 : 0;
  return {
    sales,
    grossProfit: pnl.grossProfit,
    nettProfit: pnl.nettProfit,
    grossMarginPct,
    nettMarginPct,
    closingStock: company.closingStock,
  };
}

export function selectRatios(roots: FsNode[], company: FsCompany): ClevelRatios {
  const bs = buildBalanceSheet(roots, company);
  const findLiab = (n: string) => bs.liabilities.rows.find((r) => r.name === n)?.tally ?? 0;
  const findAsset = (n: string) => bs.assets.rows.find((r) => r.name === n)?.tally ?? 0;

  const currentAssets = findAsset("Current Assets"); // restated to closing stock, positive
  const currentLiabilities = findLiab("Current Liabilities");
  const loans = findLiab("Loans (Liability)");
  const capital = findLiab("Capital Account");
  // P&L A/c can sit on either side depending on profit/loss; take it from whichever holds it.
  const plac = findLiab("Profit & Loss A/c") || -findAsset("Profit & Loss A/c");
  const equity = capital + plac;

  const pnl = buildPnl(roots, company);
  const sales = -rootTally(roots, "Sales Accounts");
  const indirectExp = rootTally(roots, "Indirect Expenses");

  const safe = (num: number, den: number) => (Math.abs(den) < 0.5 ? null : num / den);

  // Current/Quick ratios use the MAGNITUDE of current liabilities. Tally's group can net to a small
  // debit (advances/receivables parked under Current Liabilities exceed payables) — here NOIDA's is
  // +11.9 L Dr — which the balance-sheet sign convention renders negative and would flip the ratio's
  // sign (showed −72.75 vs Talligence's +72.80). abs() is a no-op for a normal Cr liability balance.
  return {
    currentRatio: safe(currentAssets, Math.abs(currentLiabilities)),
    quickRatio: safe(currentAssets - company.closingStock, Math.abs(currentLiabilities)),
    debtToEquity: safe(loans, equity),
    returnOnEquityPct: equity ? (pnl.nettProfit / equity) * 100 : null,
    opexRatio: safe(indirectExp, sales),
    currentAssets,
    currentLiabilities,
    equity,
    loans,
  };
}

/** Indirect-expense breakdown for the expense pie (top groups + Other). */
export function selectExpenseBreakdown(roots: FsNode[]): NamedAmount[] {
  const ind = roots.find((n) => n.name === "Indirect Expenses");
  if (!ind) return [];
  const children = ind.children
    .map((c) => ({ name: c.name, amount: c.tally }))
    .filter((c) => c.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const top = children.slice(0, 6);
  const rest = children.slice(6).reduce((s, c) => s + c.amount, 0);
  if (rest > 0) top.push({ name: "Other", amount: rest });
  return top;
}
