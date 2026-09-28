/**
 * Batch Costing — Reports → Bushra-Report.
 *
 * Every STOCK JOURNAL-PRODUCTION voucher, one row per inventory line, laid out the way Tally's
 * Voucher Register prints it, plus five columns Tally does not have: Type, Category, Colour,
 * Item Group and Item Category. The rules behind those five live in ./batchCostingRules.ts.
 *
 * SOURCE — ConnectWave `rpt_batch_line` (project ieeefdnyhzgrroifiqbb), read straight through
 * PostgREST, for the one company that books production (PRODUCTION_COMPANY_GUID below). It is the only table in the mirror that carries stock journals at all: the day-book,
 * sales and purchase item tables each see one family of voucher natures and none of them sees a
 * stock journal. Verified line for line against Tally's register for 1-Apr-26 (four vouchers).
 *
 * ─── ONE ROW PER TALLY LINE, NOT PER BATCH ──────────────────────────────────────────────────────
 *
 * `rpt_batch_line` is grained voucher × inventory line × BATCH ALLOCATION. A consumption line drawn
 * from three lots arrives as three rows (LOOSE INK KY REACTIVE CYAN on #1142: 2 + 38 + 36 KGS),
 * while Tally prints one line of 76 KGS. We sum quantity and amount back up per
 * (voucher_guid, line_no) and keep the lot names alongside — they are the batch trail costing
 * will need. ~4 % of lines are split this way.
 *
 * ─── SIGNS ───────────────────────────────────────────────────────────────────────────────────────
 *
 * Tally prints consumption as (-) quantity. So do we: Output is positive, Consumption negative, and
 * Amount carries the same sign as its quantity. In the mirror an inward line's AMOUNT is negative
 * and an outward one positive (a debit/credit convention), which is the opposite — normalised here.
 *
 * Rate is Tally's own where it sent one. Scrap is booked at no value (rate null, amount 0), and
 * stays blank rather than being given a rate nobody stated.
 */
import { getConnectwaveSupabase } from "./connectwaveSupabase";
import { fetchCompanyMap, makeCompanyResolver } from "./companyMap";
import { fyBounds, tenantForFy } from "./salesReport";
import {
  colourOf, itemCategoryOf, itemGroupOf, lineCategory, lineType,
  type ItemGroup, type LineCategory, type LineType,
} from "./batchCostingRules";

export const VOUCHER_TYPE = "STOCK JOURNAL-PRODUCTION";

/**
 * PRODUCTION IS BOOKED IN ONE COMPANY ONLY — Enterprise, Surat ("ORANGE O TEC ENTERPRISES PVT
 * LTD"). So the screens carry no company picker; they read this book and nothing else.
 *
 * The book is SPLIT BY YEAR in Tally, and the mirror keeps each part as its own tenant:
 *   FY 2026-27             acct_orange::<guid>             (the live book)
 *   FY 2024-25 + 2025-26   acct_orange::<guid>~20240401    (the book before the split)
 * tenantForFy() resolves the right one per FY through rpt_sales_book, so picking FY 2025-26 reads
 * the older book with no special case here.
 */
export const PRODUCTION_COMPANY_GUID = "59a6c2d9-0c5a-4fc5-b8c5-3be6fec3289e";
export const PRODUCTION_COMPANY_LABEL = "Enterprise — Surat";

/**
 * The FYs worth offering: production in this book starts 2-Jun-2025, so FY 2024-25 (and earlier)
 * would only ever be an empty screen.
 */
export const FIRST_PRODUCTION_FY = "2025-26";

/** One printed line of the report. */
export interface BatchCostingRow {
  company_guid: string;
  company_display: string;
  voucher_guid: string;
  line_no: number;
  /** YYYYMMDD */
  vch_date: string;
  voucher_no: string;
  voucher_type: string;
  /** The item, with spelling variants merged (see canonicalItemNames) — what every screen groups on. */
  item: string;
  /** The name exactly as the voucher booked it in Tally, when that differs from `item`. */
  item_booked: string | null;
  /** Tally's stock group for the item — the fallback category, and handy on its own. */
  stock_group: string | null;
  /** Signed: + Output, − Consumption. */
  qty: number;
  uom: string | null;
  rate: number | null;
  /** Signed like qty. */
  amount: number;
  /** Every lot this line drew from / produced, in Tally's order. */
  batches: string[];
  type: LineType;
  category: LineCategory;
  /** Voucher-level (filled down from the finished good). "" when the FG name has no colour word. */
  colour: string;
  /** Voucher-level. null only when the voucher produced no finished good at all. */
  item_group: ItemGroup | null;
  /** Voucher-level. */
  item_category: string;
  /** The Tally stock group stood in because no rule matched the FG name. */
  category_from_tally: boolean;
  /** The finished good the voucher-level columns were read from. */
  fg_item: string;
}

interface RawLine {
  tenant_id: string;
  vch_date: string;
  voucher_guid: string;
  voucher_no: string | null;
  voucher_type: string;
  line_no: number;
  batch_no: number;
  stock_item: string;
  stock_group: string | null;
  movement: string;
  batch_name: string | null;
  qty: number | null;
  uom: string | null;
  rate: number | null;
  amount: number | null;
}

const RAW_COLS =
  "tenant_id,vch_date,voucher_guid,voucher_no,voucher_type,line_no,batch_no,stock_item,stock_group," +
  "movement,batch_name,qty,uom,rate,amount";

/** Tally's placeholder allocations — not a lot anybody can trace. */
const NON_LOT = new Set(["", "any", "not applicable", "primary batch", "none"]);

/* ------------------------------------------------------------------ reads */

/**
 * Every production line of one book in [from, to], block-paged. The order is a total order
 * (voucher_guid, line_no, batch_no is unique), which offset paging needs to be stable.
 */
async function loadOneBook(tenant: string, from: string, to: string): Promise<RawLine[]> {
  const cw = getConnectwaveSupabase();
  const PAGE = 1000; // PostgREST's cap on this project
  const out: RawLine[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await cw
      .from("rpt_batch_line")
      .select(RAW_COLS)
      .eq("tenant_id", tenant)
      // ilike, not eq: Tally lets the type be retyped in any case, and the Python tool this
      // replaces had to accept both "Stock Journal-Production" and the upper-case form.
      .ilike("voucher_type", VOUCHER_TYPE)
      .gte("vch_date", from)
      .lte("vch_date", to)
      .order("vch_date", { ascending: true })
      .order("voucher_guid", { ascending: true })
      .order("line_no", { ascending: true })
      .order("batch_no", { ascending: true })
      .range(offset, offset + PAGE - 1)
      .returns<RawLine[]>();
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/* ------------------------------------------------------------------ shaping */

const num = (v: number | null | undefined) => Number(v) || 0;
const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;

/**
 * THE SAME ITEM, SPELT DIFFERENTLY. Tally items get renamed over time ("REACTIVE INK H-SERIES
 * YELLOW" → "REACTIVE INK H SERIES YELLOW", "COMBINATION LIQUID-3" → "COMBINATION LIQUID 3", stray
 * double spaces), and a voucher keeps the name it was booked under — so one item turns up under
 * two or three spellings, even inside a single year (FY 2026-27 has "H SERIES YELLOW" next to
 * "H-SERIES GREY"). Left alone, each spelling is its own row in every filter, chart and ranking.
 *
 * Names are the same item when they match after ignoring case, hyphens/underscores and extra
 * spaces. Different WORDS are never merged: "EPN SUBLIMATION INK YELLOW" and "EPN SUBLIMATION
 * YELLOW" are two separate Tally items in two stock groups, and stay two.
 *
 * The name shown is the item's CURRENT name in Tally's item list for the company's live book
 * (v_master_stock_item), so every FY shows the same name for the same item — the renames went
 * both ways (the live list now says "H-SERIES"), which is why no fixed spelling rule would do.
 * All 526 production item names of FY 2025-26 + 2026-27 resolve in that list. A name that does
 * not falls back to the tidiest spelling present. The booked name is kept in `item_booked`.
 */
export const itemKey = (s: string) => s.toUpperCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();

function canonicalItemNames(lines: BatchCostingRow[], current?: Map<string, string>): void {
  const variants = new Map<string, Map<string, string>>(); // key → spelling → latest vch_date
  for (const l of lines) {
    const k = itemKey(l.item);
    const m = variants.get(k) ?? new Map<string, string>();
    if ((m.get(l.item) ?? "") < l.vch_date) m.set(l.item, l.vch_date);
    variants.set(k, m);
  }
  const untidy = (s: string) => (s.match(/[-_]/g)?.length ?? 0) + (s.match(/\s{2,}/g)?.length ?? 0);
  const chosen = new Map<string, string>();
  for (const [k, m] of variants) {
    const best = current?.get(k) ?? [...m].sort((a, b) => untidy(a[0]) - untidy(b[0]) || b[1].localeCompare(a[1]))[0][0];
    chosen.set(k, best);
  }
  for (const l of lines) {
    const c = chosen.get(itemKey(l.item))!;
    if (c !== l.item) {
      l.item_booked = l.item;
      l.item = c;
    }
  }
}

/**
 * Batch allocations → Tally lines → classified rows, voucher by voucher. Pure: takes the raw
 * mirror rows of ONE book and returns the report rows in Tally's order (date, voucher, line).
 */
export function shapeBook(
  raw: RawLine[],
  company_guid: string,
  company_display: string,
  /** itemKey → current Tally name (see canonicalItemNames). Optional: without it, the tidiest spelling wins. */
  currentNames?: Map<string, string>,
): BatchCostingRow[] {
  // 1. Collapse batch allocations into one line per (voucher, line_no).
  const lines = new Map<string, BatchCostingRow>();
  const splits = new Set<string>();
  for (const r of raw) {
    const key = `${r.voucher_guid}|${r.line_no}`;
    const cur = lines.get(key);
    const lot = (r.batch_name ?? "").trim();
    const isLot = lot && !NON_LOT.has(lot.toLowerCase());
    if (cur) {
      splits.add(key);
      cur.qty += num(r.qty);
      cur.amount += num(r.amount);
      if (isLot && !cur.batches.includes(lot)) cur.batches.push(lot);
      continue;
    }
    const type = lineType(r.movement);
    lines.set(key, {
      company_guid,
      company_display,
      voucher_guid: r.voucher_guid,
      line_no: r.line_no,
      vch_date: r.vch_date,
      voucher_no: r.voucher_no ?? "",
      voucher_type: r.voucher_type,
      item: r.stock_item,
      item_booked: null,
      stock_group: r.stock_group,
      qty: num(r.qty),
      uom: r.uom,
      rate: r.rate,
      amount: num(r.amount),
      batches: isLot ? [lot] : [],
      type,
      category: lineCategory(type, r.stock_item),
      colour: "",
      item_group: null,
      item_category: "",
      category_from_tally: false,
      fg_item: "",
    });
  }

  // 2. Signs + rate. The mirror's qty is unsigned and its amount is debit/credit-signed.
  for (const [key, l] of lines) {
    const sign = l.type === "Output" ? 1 : -1;
    const absQty = Math.abs(l.qty);
    const absAmt = Math.abs(l.amount);
    l.qty = round(sign * absQty, 4);
    l.amount = round(sign * absAmt, 2);
    // An unsplit line keeps Tally's own rate. A split one carries a rate per allocation, so the
    // summed line's rate is amount ÷ qty — the division Tally itself does when it prints the line.
    if (splits.has(key) && l.rate != null && absQty) l.rate = round(absAmt / absQty, 2);
  }

  // 2b. One name per item, whatever spelling the voucher used.
  canonicalItemNames([...lines.values()], currentNames);

  // 3. Voucher-level columns, filled down from the voucher's first finished good.
  const byVoucher = new Map<string, BatchCostingRow[]>();
  for (const l of lines.values()) {
    const arr = byVoucher.get(l.voucher_guid);
    if (arr) arr.push(l);
    else byVoucher.set(l.voucher_guid, [l]);
  }
  const out: BatchCostingRow[] = [];
  for (const vRows of byVoucher.values()) {
    vRows.sort((a, b) => a.line_no - b.line_no);
    const fg = vRows.find((l) => l.category === "Finished Good");
    if (fg) {
      const group = itemGroupOf(fg.item);
      const cat = itemCategoryOf(fg.item, group, fg.stock_group);
      const colour = colourOf(fg.item);
      for (const l of vRows) {
        l.fg_item = fg.item;
        l.colour = colour;
        l.item_group = group;
        l.item_category = cat.category;
        l.category_from_tally = cat.fromTallyGroup;
      }
    }
    out.push(...vRows);
  }
  out.sort((a, b) =>
    a.vch_date.localeCompare(b.vch_date) ||
    a.voucher_no.localeCompare(b.voucher_no, "en", { numeric: true }) ||
    a.voucher_guid.localeCompare(b.voucher_guid) ||
    a.line_no - b.line_no);
  return out;
}

/** The production FYs to offer, newest first, from the house FY list. */
export const productionFyOptions = (all: string[]): string[] => all.filter((f) => f >= FIRST_PRODUCTION_FY);

/**
 * Enterprise — Surat, one FY, one [from, to] window (YYYYMMDD). The FY picks the book — the live
 * one or the pre-split one — through tenantForFy.
 *
 * FY 2025-26 NOTE: ConnectWave's builder skips stock journals when it builds an older (split)
 * book, so the pre-split book's 647 production vouchers were missing from rpt_batch_line. They
 * were added on 2026-09-10 by Tally Operating System/tools/fill_missing_production_lines.py,
 * built from ConnectWave's own raw store (tally_object) column-for-column as its builder would.
 * Re-run that tool (`check`, then `apply`) if a future split or a manual rebuild of an older
 * book ever drops production vouchers again; it only ever adds vouchers that have no rows.
 */
export async function loadBatchCosting(fy: string, from: string, to: string): Promise<BatchCostingRow[]> {
  if (!fy) return [];
  const [tenant, map, names] = await Promise.all([
    tenantForFy(PRODUCTION_COMPANY_GUID, fy), fetchCompanyMap(), loadCurrentItemNames(),
  ]);
  const id = makeCompanyResolver(map)(tenant, "");
  const label = id.location ? `${id.company} — ${id.location}` : id.company || PRODUCTION_COMPANY_LABEL;
  return shapeBook(await loadOneBook(tenant, from, to), PRODUCTION_COMPANY_GUID, label, names);
}

/** itemKey → current name, from the live book's item list. Loaded once per session (~1,500 items). */
let currentNamesPromise: Promise<Map<string, string>> | null = null;
function loadCurrentItemNames(): Promise<Map<string, string>> {
  currentNamesPromise ??= (async () => {
    const cw = getConnectwaveSupabase();
    const out = new Map<string, string>();
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await cw
        .from("v_master_stock_item")
        .select("item")
        .eq("tenant_id", `acct_orange::${PRODUCTION_COMPANY_GUID}`)
        .order("item", { ascending: true })
        .range(offset, offset + 999)
        .returns<{ item: string }[]>();
      if (error) throw new Error(error.message);
      for (const r of data ?? []) out.set(itemKey(r.item), r.item);
      if ((data ?? []).length < 1000) break;
    }
    return out;
  })().catch((e) => { currentNamesPromise = null; throw e; });
  return currentNamesPromise;
}

/**
 * Every production FY in one go — the dashboard spans years, so its Year filter can say "All
 * Years". Books load concurrently; each resolves its own tenant, so the pre-split book comes in
 * beside the live one.
 */
export async function loadBatchCostingYears(fys: string[]): Promise<BatchCostingRow[]> {
  const perFy = await Promise.all(fys.map((fy) => {
    const b = fyBounds(fy);
    return loadBatchCosting(fy, b.from, b.to);
  }));
  return perFy.flat();
}

/** The latest production voucher for the FY's book — shown on the page. */
export async function loadLatestProductionDate(fy: string): Promise<string | null> {
  if (!fy) return null;
  const tenant = await tenantForFy(PRODUCTION_COMPANY_GUID, fy);
  const cw = getConnectwaveSupabase();
  const { data, error } = await cw
    .from("rpt_batch_line")
    .select("vch_date")
    .eq("tenant_id", tenant)
    .ilike("voucher_type", VOUCHER_TYPE)
    .order("vch_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { vch_date: string } | null)?.vch_date ?? null;
}

/* ------------------------------------------------------------------ formatting */

const nf2 = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "1,139.00 KGS" / "(-)270.90 LTR" — Tally's register print, at the 2 decimals the business reads. */
export function fmtRegisterQty(q: number, unit: string | null | undefined): string {
  const body = `${nf2.format(Math.abs(q))}${unit ? ` ${unit}` : ""}`;
  return q < 0 ? `(-)${body}` : body;
}
export const fmtMoney = (n: number | null | undefined): string => (n == null ? "" : nf2.format(n));

/**
 * Tonnes, the unit the factory talks in: "529.12 T" for 5,29,121.33 kilograms (1 T = 1,000 KGS).
 * Only ever applied to a KGS quantity — litres and pieces stay as they are. Every screen states
 * weight this way; the cards print the exact kilograms underneath, so the rounding loses nothing.
 */
export const fmtTonnes = (kgs: number): string => `${nf2.format(kgs / 1000)} T`;

/** Tonnes at three decimals — for a single batch, where 316 KGS is 0.316 T. */
export const fmtTonnes3 = (kgs: number): string =>
  `${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(kgs / 1000)} T`;
