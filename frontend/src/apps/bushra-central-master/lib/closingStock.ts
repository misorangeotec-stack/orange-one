import { getConnectwave, hasConnectwave } from "@/core/platform/connectwave";

/**
 * CLOSING STOCK — which of Central Masters' items Tally is actually holding.
 *
 * Bushra Central Master lists ONLY items with a closing balance, so this is what
 * decides the list. Everything here is read-only and comes from the ConnectWave
 * mirror; neither Tally nor `mst_items` is ever written.
 *
 * ⚠ THE FIGURE IS TALLY'S OWN. `rpt_stock_summary_item.closing_qty` is Tally's cached
 *   CLOSINGBALANCE off the stock item master, as at the last ConnectWave sync —
 *   nothing is derived here. It is the same column the Reports → Stock Summary screen
 *   prints, so the two screens can never disagree.
 *
 * ⚠ BASE TENANTS ONLY. A company whose books were split mid-year carries extra
 *   `acct_orange::<guid>~<YYYYMMDD>` tenants holding an EARLIER year's closing. Asking
 *   for `acct_orange::<guid>` by name is what keeps a previous year's balance from
 *   being read as today's — on 23-09-2026 the two split books held 1,269 such rows
 *   between them. Never widen this to "every tenant whose guid matches".
 *
 * ⚠ THE JOIN IS (COMPANY, ITEM NAME), NOT NAME ALONE. Items are filed per company —
 *   the same ink is a separate row in each book — so a name on its own would show
 *   Surat's stock against Noida's item. Both sides carry Tally's own name verbatim
 *   (`mst_items.name` is written from `v_master_stock_item.item` by masters-sync), so
 *   the match is exact: measured 23-09-2026, all 5,511 items holding stock across the
 *   five books tied to a central item, with none left over.
 */

/** One item's closing balance, as Tally holds it. */
export interface ClosingStock {
  qty: number;
  /** Tally's base unit for the item — KGS, PCS, MTR. */
  unit: string | null;
}

/** Keyed by `stockKey`, i.e. by company AND item name. */
export type ClosingStockMap = Map<string, ClosingStock>;

/**
 * The key both sides agree on.
 *
 * \u0000 separates them because item names legitimately contain spaces, commas and
 * hyphens, and any of those would let two different pairs collide on one key.
 */
export const stockKey = (companyGuid: string, itemName: string) => `${companyGuid}\u0000${itemName}`;

/** anon-safe block size — the same one the hub's stock reads use. */
const PAGE = 1000;

interface RawRow {
  tenant_id: string;
  fy: string;
  item: string;
  base_unit: string | null;
  closing_qty: number | null;
}

/**
 * Every item holding stock in the given companies' current books.
 *
 * `closing_qty <> 0` is applied IN THE DATABASE, not here: it is the whole point of the
 * call and it cuts the read from ~14,600 rows to ~5,500. Negative balances are kept —
 * a book that has issued more than it received is holding a position that someone needs
 * to see, and silently dropping it would make an item vanish with no explanation.
 *
 * Throws rather than returning an empty map when ConnectWave cannot be read. An empty
 * map and a failed read look identical to a caller, and here they are opposites: one
 * means "nothing is in stock", the other means "we do not know what is in stock".
 */
export async function fetchClosingStock(companyGuids: string[]): Promise<ClosingStockMap> {
  const out: ClosingStockMap = new Map();
  const guids = [...new Set(companyGuids.filter(Boolean))];
  if (guids.length === 0) return out;
  if (!hasConnectwave()) {
    throw new Error(
      "The live Tally mirror is not configured for this site, so closing stock cannot be read.",
    );
  }

  const cw = getConnectwave();
  const tenants = guids.map((g) => `acct_orange::${g}`);

  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await cw
      .from("rpt_stock_summary_item")
      .select("tenant_id,fy,item,base_unit,closing_qty")
      .in("tenant_id", tenants)
      .neq("closing_qty", 0)
      // A TOTAL order. PostgREST pages by offset, so any two rows left tied can swap
      // between pages — which drops one of them and repeats the other.
      .order("tenant_id", { ascending: true })
      .order("item", { ascending: true })
      .order("fy", { ascending: true })
      .range(offset, offset + PAGE - 1)
      .returns<RawRow[]>();
    if (error) throw new Error(error.message);

    const rows = data ?? [];
    for (const r of rows) {
      // Safe to split rather than strip a `~` tail: only base tenants were asked for.
      const guid = r.tenant_id.split("::")[1] ?? "";
      // Ascending `fy` means the LAST row for an item wins, i.e. the newest year the
      // book carries. Only one year exists today; this costs nothing and survives the
      // day a second one appears.
      out.set(stockKey(guid, r.item), { qty: Number(r.closing_qty) || 0, unit: r.base_unit });
    }
    if (rows.length < PAGE) return out;
  }
}

/** "1,234.5" — Tally quantities carry three decimals, and trailing zeros are noise. */
const qtyNf = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });

export const fmtClosingQty = (qty: number | null): string => (qty === null ? "—" : qtyNf.format(qty));
