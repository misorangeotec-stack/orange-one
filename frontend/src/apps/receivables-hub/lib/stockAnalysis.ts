/**
 * stockAnalysis.ts — the data layer for Reports → Inventory → Stock Analysis.
 *
 * WHERE THE NUMBERS COME FROM
 * A single ConnectWave RPC, `rpt_stock_analysis`, returns all ten panels already aggregated as one
 * jsonb payload (the browser reads ConnectWave as `anon`, ~3 s statement timeout). See
 * "Orange One Supabase Connect"/db/rpt/rpt_stock_analysis.sql. Measured **95 ms on the largest book**
 * (8,234 items / 73k vouchers), so unlike the C-Level dashboard this needs no cache layer.
 *
 * THIS IS THE FIRST INVENTORY-SIDE REPORT
 * Nothing existing could feed it. `rpt_sales_item` / `rpt_purchase_item` / `rpt_day_book_item` each
 * cover ONE family of voucher natures, and none of them sees stock journals, delivery challans,
 * credit notes or rejections — so none can answer "when did this item last move". Two small
 * precomputed tables fill that: `rpt_stock_analysis_item` (closing position + movement dates) and
 * `rpt_stock_analysis_move` (daily inward/outward quantity).
 *
 * "LIVE AT LAST SYNC" IS A DELIBERATE PRODUCT DECISION
 * Closing stock is Tally's OWN cached CLOSINGBALANCE / CLOSINGVALUE as at the last ConnectWave sync —
 * Tally-true by construction. The screen does not offer an arbitrary as-on date. It CAN be derived
 * (the inventory-line walk ties on 2,112 of Noida's 2,113 items — 99.95 %, residual one unit, which
 * overturns the C-Level "stock at a past date is not derivable" note for quantity), but v1 ships the
 * live figure and labels it.
 *
 * RECONCILIATION (Orange O Tec Noida, FY 2026-27). Their stamp is 24-Jul-2026 3:52 PM; our mirror's
 * stock closing is 27-Jul — three days fresher, so face-value comparisons overstate the gap:
 *   Stock Value       ₹2.7403 Cr live; walked to their date ₹2.8275 Cr vs their ₹2.86 Cr = −1.1 %
 *   Product groups    40 non-zero of 87 — exactly their "1 - 10 of 40"; 9 of their 10 printed rows
 *                     tie to the paisa (FABPRO PARTS is the tenth, and it moved in those three days)
 *   Top 10 Products   ranked BY QUANTITY, not value — all ten items reproduce, in their order
 *   Inward / Outward  Apr 20,115/21,899 · May 19,072/33,792 · Jun 32,857/29,473 · Jul 18,235/15,993
 *   Category          one bar, "Undefined" — all 2,113 items are CATEGORY 'Not Applicable'
 * Full write-up: Misc/Talligence-Inputs/stock-analysis-reconciliation.md
 *
 * TWO DELIBERATE DIVERGENCES, both footnoted on the page — see BAD_STOCK_BASIS below and the
 * `expiry_supported` flag.
 *
 * Reuses the Master Reports money / FY / tenant helpers outright rather than re-deriving them.
 */
import { getConnectwaveSupabase } from "./connectwaveSupabase";
import {
  fmtSales, tickSales, salesPeriod, salesFyOptions, tenantForFy, salesCat,
  SALES_CURRENT, SALES_PRIOR, SALES_ACCENT,
} from "./salesReport";

export {
  fmtSales as fmtStock,
  tickSales as tickStock,
  salesPeriod as stockPeriod,
  salesFyOptions as stockFyOptions,
  tenantForFy,
  salesCat as stockCat,
  SALES_CURRENT as STOCK_CURRENT,
  SALES_PRIOR as STOCK_PRIOR,
  SALES_ACCENT as STOCK_ACCENT,
};

/** Talligence's own defaults for the two editable inputs on the screen. */
export const DEFAULT_BAD_DAYS = 90;
export const DEFAULT_EXPIRE_DAYS = 30;

/**
 * Printed on the Bad Stock card so the number is never mistaken for Talligence's.
 *
 * Theirs is ₹3.21 Cr, which EXCEEDS its own ₹2.86 Cr Stock Value — because they value bad stock at
 * INWARD rate while the Stock Value KPI uses Tally's closing rate (proved on REACTIVE INK H SERIES
 * RED: ₹2.64 L ÷ 695 = ₹379.86, exactly that item's purchase rate on all four FY26-27 inwards,
 * against ₹347 closing on their own product panel). No candidate universe reaches ₹3.21 Cr — all of
 * Noida's positive stock is ₹2.82 Cr — and their own output is self-inconsistent: RED shows 695 in
 * the bad table and 1590 in the product table ON THE SAME PAGE, and is flagged unmoved for 104 days
 * while it sold on 24-Jul, their own snapshot date. Ours is at closing value so Bad ≤ Stock always
 * holds and both KPIs on this screen share one basis.
 */
export const BAD_STOCK_BASIS =
  "Stock with no outward movement in the window, valued at Tally's closing value.";

/* ------------------------------------------------------------------ types */

export interface StockKpi {
  stock_value: number;
  bad_value: number;
  bad_items: number;
  expired_value: number;
  expired_items: number;
  item_count: number;
  in_stock_items: number;
}

export interface StockCategoryRow { category: string; amt: number }
export interface StockGroupRow { grp: string; amt: number }
/** `m` is the calendar month number (4 = April), not an FY index. */
export interface StockMovePoint { m: number; inward: number; outward: number }
export interface StockProductRow { item: string; qty: number; base_unit: string | null; value: number }
export interface StockBadRow {
  item: string; qty: number; base_unit: string | null; amount: number;
  days: number;
  /** True when the item has no movement AT ALL this FY, so `days` is a floor, not an exact age. */
  never_moved: boolean;
}

export interface StockMeta {
  tenant: string; as_on: string; fy_from: string;
  bad_days: number; expire_days: number;
  /** Always false today — the connector never fetches an expiry field. See EXPIRY_NOTE. */
  expiry_supported: boolean;
  group_count: number;
  built_at: string | null;
  /** Latest voucher date in the book — what "live at last sync" actually resolves to. */
  stock_as_at: string | null;
  move_days: number;
}

export interface StockAnalysisData {
  kpi: StockKpi;
  categories: StockCategoryRow[];
  groups: StockGroupRow[];
  movement: StockMovePoint[];
  /** Top 10 by quantity, including zero-VALUE items — the "Show Zero Value Items = On" state. */
  products: StockProductRow[];
  /** The same top 10 with zero-value items excluded. */
  products_valued: StockProductRow[];
  bad: StockBadRow[];
  expired: StockBadRow[];
  expiring: StockBadRow[];
  meta: StockMeta;
}

/**
 * Why the three expiry panels are empty on every company, printed on the page rather than left to
 * look like a bug: 0 of 17,333 stock items across all 7 tenants carry any expiry key, and the
 * transaction batch allocations carry eleven keys of which none is expiry. The cause is upstream —
 * the Go connector's FETCH lists never request EXPIRYPERIOD / MFDON.
 */
export const EXPIRY_NOTE =
  "Tally is not tracking batch expiry on these books — the Tally connector does not fetch an expiry " +
  "or manufacturing date for any company, so there is nothing to age. This panel will fill in on its " +
  "own once that is added upstream.";

/* ------------------------------------------------------------------ reads */

export async function loadStockAnalysis(
  companyGuid: string,
  fy: string,
  badDays: number = DEFAULT_BAD_DAYS,
  expireDays: number = DEFAULT_EXPIRE_DAYS,
): Promise<StockAnalysisData> {
  const cw = getConnectwaveSupabase();
  const tenant = await tenantForFy(companyGuid, fy);
  const p = salesPeriod(fy);

  const { data, error } = await cw.rpc("rpt_stock_analysis", {
    p_tenant: tenant,
    p_fy_from: p.from,
    p_as_on: p.asOn,
    p_fy_to: p.to,
    p_bad_days: badDays,
    p_expire_days: expireDays,
  });
  if (error) throw new Error(error.message);
  return data as StockAnalysisData;
}

/* --------------------------------------------------------------- refresh */

export interface RefreshResult {
  status: "ok" | "cooldown" | "busy" | "error";
  seconds?: number; items?: number; days?: number;
  retry_after_seconds?: number; last_run?: string; message?: string;
}

/**
 * Rebuild this company's stock snapshot — the same work the 22:45 IST cron does nightly.
 *
 * Note what this can and cannot fix: it re-reads the mirror, so it picks up anything ConnectWave has
 * synced since. It does NOT pull from Tally — if the closing looks stale, the sync is what is behind,
 * not this table.
 */
export async function refreshStockAnalysisCompany(
  companyGuid: string, fy: string,
): Promise<RefreshResult> {
  const cw = getConnectwaveSupabase();
  const tenant = await tenantForFy(companyGuid, fy);
  const { data, error } = await cw.rpc("rpt_stock_analysis_refresh_company", { p_tenant: tenant });
  if (error) throw new Error(error.message);
  return data as RefreshResult;
}

export interface RefreshLogRow {
  ran_at: string; tenant_id: string | null; items: number | null; days: number | null;
  seconds: number | null; error: string | null; source: string | null;
}

export async function loadStockAnalysisLastRefresh(
  companyGuid: string, fy: string,
): Promise<RefreshLogRow | null> {
  const cw = getConnectwaveSupabase();
  const tenant = await tenantForFy(companyGuid, fy);
  const { data, error } = await cw
    .from("rpt_stock_analysis_refresh_log")
    .select("ran_at,tenant_id,items,days,seconds,error,source")
    .eq("tenant_id", tenant)
    .order("ran_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] as RefreshLogRow | undefined) ?? null;
}

/* ------------------------------------------------------------- derivations */

/** dd-mm-yyyy from Tally's YYYYMMDD — the house date format. */
export function dmy(ymd: string | null | undefined): string {
  if (!ymd || ymd.length < 8) return "";
  return `${ymd.slice(6, 8)}-${ymd.slice(4, 6)}-${ymd.slice(0, 4)}`;
}

/** Quantities are unit-less totals across mixed base units — see the SQL header. */
export const qtyFmt = (n: number | null | undefined) =>
  Math.round(Number(n) || 0).toLocaleString("en-IN");

/**
 * Bad stock as a share of total stock. Always ≤ 100 % by construction, which is the whole point of
 * choosing the closing-value basis over Talligence's inward-rate one.
 */
export function badShare(kpi?: StockKpi | null): number | null {
  const total = Number(kpi?.stock_value) || 0;
  if (!kpi || total <= 0) return null;
  return ((Number(kpi.bad_value) || 0) / total) * 100;
}
