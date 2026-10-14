import { getConnectwave, hasConnectwave } from "@/core/platform/connectwave";

/**
 * THE MASTER LIST — Otec Surat's items that hold closing stock, every primary group.
 *
 * The Master opens on PRINTING INK (DEFAULT_PRIMARY); the admin can widen it with the Primary
 * group filter (asked 14-10-2026).
 *
 * Read-only from ConnectWave; neither Tally nor `mst_*` is ever written.
 *
 * ⚠ BASE TENANT ONLY. `acct_orange::<guid>` by name — a `~<YYYYMMDD>` tenant is an earlier
 *   year's closing (see bushra-central-master/lib/closingStock.ts).
 *
 * ⚠ `primary_group`, NOT `stock_group`. stock_group is the LEAF group (KNA REACTIVE INK …);
 *   primary_group is the Stock Group Summary's top level.
 *
 * ⚠ PROVISION INK IS LEFT OUT (asked 14-10-2026). The PROVISION INK-PAYABLE / -RECEIVABLE
 *   groups are book entries for ink owed to or by a party, not stock on the shelf — and they
 *   are every one of the negative balances in the group. Dead, Diff, Trial and Liquidate stock
 *   stay: those are physically in the store.
 *
 * ⚠ ONLY ITEMS WITH STOCK (closing > 0, asked 14-10-2026).
 */

export const OTEC_SURAT_GUID = "a4e100d1-3b6f-4193-876a-c754f1a74552";
export const OTEC_SURAT_NAME = "Otec Surat";
export const DEFAULT_PRIMARY = "PRINTING INK";

export interface StockItem {
  item: string;
  /** Top level of the Stock Group Summary — PRINTING INK, MACHINERY PARTS … */
  primaryGroup: string;
  /** The level under it — LANYU INK, HOMER INK, TRIAL INKS … (= the stock group when only two deep). */
  subGroup: string;
  /** The leaf stock group the item is filed under. */
  group: string;
  unit: string;
  closingQty: number;
  closingRate: number | null;
  closingValue: number;
  /** When ConnectWave last rebuilt this row — "Tally as at". */
  builtAt: string | null;
}

interface RawRow {
  item: string;
  primary_group: string | null;
  sub_group_1: string | null;
  stock_group: string | null;
  group_path: string | null;
  base_unit: string | null;
  closing_qty: number | null;
  closing_rate: number | null;
  closing_value: number | null;
  built_at: string | null;
}

const PAGE = 1000;

export const isProvision = (groupPath: string | null | undefined) => /PROVISION/i.test(groupPath ?? "");

export async function fetchSuratStock(): Promise<StockItem[]> {
  if (!hasConnectwave()) {
    throw new Error("The live Tally mirror is not configured for this site, so closing stock cannot be read.");
  }
  const cw = getConnectwave();
  const out: StockItem[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await cw
      .from("rpt_stock_summary_item")
      .select("item,primary_group,sub_group_1,stock_group,group_path,base_unit,closing_qty,closing_rate,closing_value,built_at")
      .eq("tenant_id", `acct_orange::${OTEC_SURAT_GUID}`)
      .gt("closing_qty", 0)
      // A TOTAL order — unordered offset paging drops and repeats rows.
      .order("item", { ascending: true })
      .order("fy", { ascending: true })
      .range(offset, offset + PAGE - 1)
      .returns<RawRow[]>();
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const r of rows) {
      if (isProvision(r.group_path) || isProvision(r.stock_group)) continue;
      out.push({
        item: r.item,
        primaryGroup: r.primary_group ?? "(Ungrouped)",
        subGroup: r.sub_group_1 ?? r.stock_group ?? "",
        group: r.stock_group ?? "",
        unit: r.base_unit ?? "",
        closingQty: Number(r.closing_qty) || 0,
        closingRate: r.closing_rate === null ? null : Number(r.closing_rate),
        closingValue: Number(r.closing_value) || 0,
        builtAt: r.built_at,
      });
    }
    if (rows.length < PAGE) break;
  }
  // Ascending fy: a later year (if the book ever carries two) replaces the earlier.
  const byItem = new Map<string, StockItem>();
  for (const s of out) byItem.set(s.item, s);
  return [...byItem.values()];
}

const qtyNf = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });
const inrNf = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export const fmtQty = (n: number | null | undefined) => (n === null || n === undefined ? "—" : qtyNf.format(n));
export const fmtInr = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `₹${inrNf.format(n)}`);

/** "15-10-26" — the user's own way of writing a date. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}-${m}-${y.slice(2)}`;
}

export function fmtStamp(s: string | null | undefined): string {
  if (!s) return "—";
  return new Date(s).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}
