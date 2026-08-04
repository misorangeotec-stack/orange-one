/**
 * Stock Summary — Tally Reports → Inventory Books.
 *
 * Tally's own "Stock Group Summary" print: one flat row per stock item, four column blocks
 * (Opening Balance | Inwards | Outwards | Closing Balance), each carrying Quantity, Rate and Value,
 * with the stock-group path exploded across Primary Group + Sub Group 1..4.
 *
 * SOURCE — the precomputed ConnectWave `rpt_stock_summary_item` / `rpt_stock_summary_move` snapshot
 * (rebuilt nightly at 23:15 IST + on demand per company), read through the
 * `rpt_stock_summary_window(tenant, from, to)` RPC. Source-agnostic: available regardless of the
 * Live-Tally toggle, exactly like the Sales Register and Stock Analysis.
 *
 * The RPC `returns table`, so PostgREST pages it like a table — loadStockSummary blocks at 1,000
 * rows, which matters on the largest book (8,247 items).
 *
 * ─── TALLY'S OWN FIGURES ONLY ────────────────────────────────────────────────────────────────
 *
 * NOTHING ON THIS SCREEN IS A NUMBER WE INVENTED.
 *   Opening Qty / Rate / Value and Closing Qty / Rate / Value come STRAIGHT from Tally's
 *   StockItem master (OPENINGBALANCE/RATE/VALUE, CLOSINGBALANCE/RATE/VALUE). There is no
 *   value ÷ quantity fallback: if Tally carries no rate node the cell is BLANK, because a
 *   computed rate would be ours, not Tally's.
 *   Inwards / Outwards Qty and Value are sums of Tally's own voucher lines (ACTUALQTY, AMOUNT).
 *   Their Rate is value ÷ quantity over those lines — the one division on the screen, and the
 *   same one Tally performs when its own summary rolls several vouchers into one line.
 *
 * WHICH MEANS THE PERIOD PICKER SCOPES INWARDS AND OUTWARDS, NOT OPENING AND CLOSING.
 *   Tally only holds a cached opening and closing at the FINANCIAL YEAR's boundaries. Reporting
 *   them at an arbitrary date would mean deriving them, so we don't: opening and closing always
 *   show Tally's own year figures, and `period_scope` tells the page to say so when the chosen
 *   window is narrower ('window' vs 'full-year').
 *
 * AND OPENING + INWARDS − OUTWARDS DOES NOT TIE TO CLOSING ON VALUE.
 *   On quantity it does — measured per book at 100 % on four of the seven, 99.5 % on Noida,
 *   92.4 % on the largest. On value it never will: outwards are summed at SALE price while Tally
 *   values closing stock by each item's own valuation method at the moment of issue. Tally's own
 *   screen behaves identically. The four Value columns are four independent figures, not an
 *   arithmetic chain. VALUE_NOTE below is the text the page prints; do not quietly drop it.
 *
 * COMPANY / LOCATION come from ext_company_map (companyMap.ts), never from a Tally book name —
 * Tally mints a new book name every April.
 */
import { getConnectwaveSupabase } from "./connectwaveSupabase";
import { fetchCompanyMap, makeCompanyResolver } from "./companyMap";
import { fyBounds, tenantForFy } from "./salesReport";

/** One printed line of the report. */
export interface StockSummaryRow {
  /** The book this row came from. Part of the row identity — several companies can be loaded at
   *  once and the same item name exists in more than one of them. */
  company_guid: string;
  item: string;
  item_name: string | null;
  item_code: string | null;
  base_unit: string | null;
  stock_group: string | null;
  primary_group: string | null;
  sub_group_1: string | null;
  sub_group_2: string | null;
  sub_group_3: string | null;
  sub_group_4: string | null;
  group_path: string | null;
  group_depth: number | null;
  stock_category: string | null;
  opening_qty: number;
  opening_rate: number | null;
  opening_value: number;
  inward_qty: number;
  inward_rate: number | null;
  inward_value: number;
  outward_qty: number;
  outward_rate: number | null;
  outward_value: number;
  closing_qty: number;
  closing_rate: number | null;
  closing_value: number;
  /** 'full-year' when the chosen period IS the financial year; 'window' when it is narrower. */
  period_scope: "full-year" | "window";
  fy_from: string;
  fy_to: string;
  period_from: string;
  period_to: string;
  built_at: string;
  /** Resolved client-side from ext_company_map — column A of the finance workbook. */
  company_display: string;
}

/** The numeric measures, in the order the four blocks print them. */
export type BlockKey = "opening" | "inward" | "outward" | "closing";
export type MeasureKey = "qty" | "rate" | "value";

const RAW_COLS =
  "item,item_name,item_code,base_unit,stock_group," +
  "primary_group,sub_group_1,sub_group_2,sub_group_3,sub_group_4," +
  "group_path,group_depth,stock_category," +
  "opening_qty,opening_rate,opening_value,inward_qty,inward_rate,inward_value," +
  "outward_qty,outward_rate,outward_value,closing_qty,closing_rate,closing_value," +
  "period_scope,fy_from,fy_to,period_from,period_to,built_at";

type RawRow = Omit<StockSummaryRow, "company_display" | "company_guid">;

/* ------------------------------------------------------------------ dates */

export const ymdToIso = (s: string) => (s ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : "");
export const isoToYmd = (s: string) => s.replace(/-/g, "");

const TALLY_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "20260401" → "1-Apr-26" — Tally's own title-band date, NOT dmy()'s "01-04-2026". */
export function tallyDate(ymd: string): string {
  if (!/^\d{8}$/.test(ymd)) return "";
  return `${Number(ymd.slice(6, 8))}-${TALLY_MON[Number(ymd.slice(4, 6)) - 1]}-${ymd.slice(2, 4)}`;
}

/** "20260401","20270331" → "1-Apr-26 to 31-Mar-27", exactly the band on the Tally screen. */
export const periodBand = (from: string, to: string) => `${tallyDate(from)} to ${tallyDate(to)}`;

/** The FY's own bounds, i.e. the default period. Re-exported so the page has one import. */
export { fyBounds };

/* ------------------------------------------------------------------ formatting */

const nf3 = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const nf2 = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * "1.000 PCS". BLANK at zero, never a dash and never "0.00" — Tally leaves the whole Inwards /
 * Outwards block empty when nothing moved (visible on every row of the source screenshot), and a
 * placeholder across 12 columns x 25 rows is pure noise.
 */
export const fmtQtyUnit = (q: number | null | undefined, unit: string | null | undefined): string =>
  !q ? "" : `${nf3.format(q)}${unit ? ` ${unit}` : ""}`;

export const fmtRate2 = (n: number | null | undefined): string => (!n ? "" : nf2.format(n));
export const fmtValue2 = (n: number | null | undefined): string => (!n ? "" : nf2.format(n));
/** Totals row: a real zero is meaningful there, so it prints. */
export const fmtTotal2 = (n: number): string => nf2.format(n);

/** The honesty line the page prints under the table. See the file header. */
export const VALUE_NOTE =
  "Every figure is Tally's own: Opening and Closing come straight from the stock item master, " +
  "Inwards and Outwards are summed from the vouchers. A blank Rate means Tally holds no rate for " +
  "that item — nothing is computed here. Opening + Inwards − Outwards ties to Closing on quantity " +
  "but not on value, because outwards are carried at sale price while Tally values closing stock " +
  "by its own valuation method. That is Tally's behaviour, not a defect here.";

/* ------------------------------------------------------------------ reads */

/** Every row of one book, block-paged. The RPC `returns table`, so PostgREST ranges it. */
async function loadOneBook(tenant: string, from?: string, to?: string): Promise<RawRow[]> {
  const cw = getConnectwaveSupabase();
  const PAGE = 1000; // anon-safe block size, same as loadSalesRegister
  const out: RawRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await cw
      .rpc("rpt_stock_summary_window", {
        p_tenant: tenant,
        p_from: from ?? null,
        p_to: to ?? null,
      })
      .select(RAW_COLS)
      .order("item", { ascending: true })
      .range(offset, offset + PAGE - 1)
      .returns<RawRow[]>();
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * One or more companies, one FY, one [from,to] window. from/to are YYYYMMDD; pass the FY bounds
 * (or omit) for the whole year, the only mode where the value columns are Tally-true.
 *
 * Books are fetched CONCURRENTLY and concatenated — each resolves its own winning tenant for the FY
 * through rpt_sales_book, so an FY-split company reads the right book without the caller knowing.
 * The same item name exists in several books, which is why company_guid is part of the row.
 */
export async function loadStockSummary(
  companyGuids: string[],
  fy: string,
  from?: string,
  to?: string,
): Promise<StockSummaryRow[]> {
  if (!companyGuids.length || !fy) return [];
  const resolve = makeCompanyResolver(await fetchCompanyMap());

  const perBook = await Promise.all(
    companyGuids.map(async (guid) => {
      const tenant = await tenantForFy(guid, fy);
      const id = resolve(tenant, "");
      const label = id.location ? `${id.company} — ${id.location}` : id.company || guid;
      const rows = await loadOneBook(tenant, from, to);
      return rows.map((r) => ({ ...r, company_guid: guid, company_display: label }));
    }),
  );
  return perBook.flat();
}

/* ------------------------------------------------------------------ refresh */

export interface StockSummaryRefreshResult {
  status: "ok" | "cooldown" | "busy" | "error";
  items?: number;
  moves?: number;
  tied?: number;
  seconds?: number;
  retry_after_seconds?: number;
  message?: string;
}

/**
 * Rebuilds every selected book. Runs them in SEQUENCE, not Promise.all: the RPC takes a per-tenant
 * advisory lock and returns `busy` rather than queueing, so parallel calls on one company would
 * report a spurious failure. The worst status across the books is what the caller reports.
 */
export async function refreshStockSummaryCompanies(
  companyGuids: string[],
  fy: string,
): Promise<StockSummaryRefreshResult> {
  const cw = getConnectwaveSupabase();
  let items = 0;
  let moves = 0;
  let seconds = 0;
  let worst: StockSummaryRefreshResult | null = null;
  for (const guid of companyGuids) {
    const tenant = await tenantForFy(guid, fy);
    const { data, error } = await cw.rpc("rpt_stock_summary_refresh_company", { p_tenant: tenant });
    if (error) throw new Error(error.message);
    const res = data as StockSummaryRefreshResult;
    if (res.status !== "ok") { worst = worst ?? res; continue; }
    items += res.items ?? 0;
    moves += res.moves ?? 0;
    seconds += res.seconds ?? 0;
  }
  return worst ?? { status: "ok", items, moves, seconds: Math.round(seconds * 10) / 10 };
}

export interface StockSummaryRefreshLog {
  ran_at: string;
  items: number | null;
  moves: number | null;
  items_tied: number | null;
  seconds: number | null;
}

/** The most recent successful build across the selected books — the "Last refreshed" stamp. */
export async function loadLastStockSummaryRefresh(
  companyGuids: string[],
  fy: string,
): Promise<StockSummaryRefreshLog | null> {
  if (!companyGuids.length || !fy) return null;
  const tenants = await Promise.all(companyGuids.map((g) => tenantForFy(g, fy)));
  const cw = getConnectwaveSupabase();
  const { data, error } = await cw
    .from("rpt_stock_summary_refresh_log")
    .select("ran_at,items,moves,items_tied,seconds")
    .in("tenant_id", tenants)
    .is("error", null)
    .order("ran_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as StockSummaryRefreshLog | null) ?? null;
}

/* ------------------------------------------------------------------ group path */

/** The separator the cascading sub-group filter joins path segments with. */
export const PATH_SEP = " › ";

/** 'MACHINERY PARTS › FEDAR SPARE PARTS' — built from the five columns, not group_path. */
export function pathOf(r: StockSummaryRow): string {
  return [r.primary_group, r.sub_group_1, r.sub_group_2, r.sub_group_3, r.sub_group_4]
    .filter(Boolean)
    .join(PATH_SEP);
}
