import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * INK EXPIRY — every ink lot in stock, in every company, and whether Tally has its expiry date.
 *
 * The accountant's to-do list: in-stock lots with no expiry get sent to them to enter in Tally.
 * Read-only from ConnectWave. `tools/build_ink_expiry_status.py` writes the same thing to Excel,
 * using `fetch_stock_ageing_lotwise.py` for the stock — this file ports that tool's rules, so
 * change one, change the other.
 *
 * ⚠ STOCK PER LOT IS NOT `rpt_lot_balance`. That table disagrees with the ageing tool on ~1 lot in
 *   9 (measured 28-09-2026), so lots are netted here from `rpt_batch_line`:
 *     - drop lines that don't move stock (affects_stock false, order / proforma vouchers)
 *     - count a Delivery Challan and its invoice once (shared tracking_number)
 *     - net per (company, item, lot); tie each item to Tally's closing qty
 *       (`rpt_stock_analysis_item`, live tenant only), trimming the OLDEST lots first
 *     - whatever Tally holds beyond the lots is "stock without a lot" — it cannot carry an expiry
 *
 * ⚠ ~100k ink lines. Deep offset paging on that brushes PostgREST's ~8 s statement timeout, so
 *   the read is split per company × financial year, a few requests at a time; a year holding more
 *   than SPLIT_ROWS lines is split again by month (Otec Surat FY 2025-26 = 55 pages one after
 *   another, 47 s — the "stuck at 98 %" on the page, 21-10-2026).
 *
 * ⚠ ONLY THE CURRENT FY CHANGES. ConnectWave's hourly after-sync job rebuilds rpt_batch_line for
 *   the current financial year only; closed years were last built in Sep-2026 and stay put.
 *   `rpt_batch_coverage` stamps every tenant × FY with its row count and built_at, so with a
 *   `LineCache` a company × year is read again only when that stamp moves, and a year with no
 *   lines at all is not requested. Before this every refresh re-read every year since 2019.
 *
 * ⚠ EXPIRY sits on whichever voucher the lot's expiry was typed on — sale, transfer, purchase —
 *   as text ('21-Aug-27'). If vouchers disagree, the latest-dated one wins.
 */

const PAGE = 1000;
const PARALLEL = 8;
const ORDERISH = /(PURCHASE\s+OREDR|PURCHASE\s+ORDER|SALES\s+ORDER|PROFORMA)/i;
/** Words that mark a stock group as ink even when "INK" isn't in its name. */
const INK_WORDS = ["INK", "SUBLIMATION", "REACTIVE", "PIGMENT", "DISPERSE"];
const NON_LOT = new Set(["", "any", "not applicable", "primary batch", "none"]);
/** First FY any book reaches back to (Colorix, from 1-Apr-2020), with a year's margin. */
const FIRST_FY = 2019;
/** A company × year with more lines than this (all stock, per rpt_batch_coverage) is read month by month. */
const SPLIT_ROWS = 4000;

/** One row of `rpt_batch_coverage`: a tenant's lines in one financial year ('2025-26'). */
export interface CoverageRow { tenant_id: string; fy: string; batch_rows: number; built_at: string | null }

/** Ink voucher lines kept between visits, one entry per company × FY, valid while `sig` matches. */
export interface LineCache {
  get(window: string, sig: string): Promise<unknown[] | null>;
  put(window: string, sig: string, rows: unknown[]): Promise<void>;
}

/**
 * What changes when ConnectWave rebuilds anything this page reads — the per-year line stamps plus
 * the newest built_at of both stock tables. Three small reads (~¼ s each). Same stamp as last time
 * = nothing new from Tally, so the saved figures can be shown as they are.
 */
export async function fetchSyncStamp(cw: SupabaseClient): Promise<{ coverage: CoverageRow[]; stamp: string }> {
  const newest = (table: string) => cw.from(table).select("built_at")
    .order("built_at", { ascending: false, nullsFirst: false }).limit(1);
  const [cov, ana, sum] = await Promise.all([
    cw.from("rpt_batch_coverage").select("tenant_id,fy,batch_rows,built_at"),
    newest("rpt_stock_analysis_item"),
    newest("rpt_stock_summary_item"),
  ]);
  const err = cov.error ?? ana.error ?? sum.error;
  if (err) throw new Error(err.message);
  const coverage = (cov.data ?? []) as CoverageRow[];
  const stamp = [
    ...coverage.map((c) => `${c.tenant_id}|${c.fy}|${c.batch_rows}|${c.built_at}`).sort(),
    `analysis|${ana.data?.[0]?.built_at}`,
    `summary|${sum.data?.[0]?.built_at}`,
  ].join("\n");
  return { coverage, stamp };
}

export const COMPANY_SHORT: Record<string, string> = {
  "59a6c2d9-0c5a-4fc5-b8c5-3be6fec3289e": "Enterprises Surat",
  "a4e100d1-3b6f-4193-876a-c754f1a74552": "Otec Surat",
  "779c26f4-3fd8-46bd-9995-4f9916c98856": "Enterprises Noida",
  "53d35745-5246-4e1a-a27a-d4769f245b50": "Otec Noida",
  "393ee4bd-4fdc-4aed-ae88-e2ff1394927a": "Colorix",
};

export type ExpiryState = "missing" | "invalid" | "expired" | "updated";

export const STATE_LABEL: Record<ExpiryState, string> = {
  missing: "Not updated",
  invalid: "Not a valid date",
  expired: "Updated — expired",
  updated: "Updated",
};

export interface StockLot {
  company: string;
  item: string;
  /** Leaf stock group in Tally, e.g. 'EP SUBLIMATION INK HD'. Shown as "Group" on screen. */
  category: string;
  /** Ink type — Tally's stock CATEGORY (REACTIVE INK, SUBLIMATION INK…), shown as "Category". */
  inkCategory: string;
  /** False when Tally has no stock category for the item and it was placed by its name. */
  inkCategoryFromTally: boolean;
  mainGroup: string;
  path: string;
  lot: string;
  qty: number;
  uom: string;
  /** qty × the item's Tally closing rate (closing value ÷ closing qty); the older-FY book's rate when
   *  the live book has no closing row; 0 when neither has one. */
  value: number;
  godown: string;
  /**
   * PURCHASE / PRODUCTION DATE — yyyy-mm-dd. The lot's first real receipt: the original purchase or
   * production, in another company when this book only received it by job work / material in.
   * Internal moves are NOT receipts: a voucher that takes the same lot out AND back in (stock
   * journal, stock transfer, Hojiwala → Job) is skipped. Found on lot 26040800261 (01-10-2026):
   * purchased 04-Jun-26, but a 28-Sep stock journal had been shown as its date.
   */
  inward: string | null;
  /** The voucher type of that receipt, e.g. 'GST PURCHASE-INK', 'STOCK JOURNAL-PRODUCTION'. */
  inwardType: string | null;
  /** Set when the date above is another company's — the lot came here later (job work, material in). */
  inwardCompany: string | null;
  /** When THIS company first received the lot, if that differs from the purchase / production date. */
  receivedHere: string | null;
  receivedHereType: string | null;
  /** The latest sales return of this lot from a customer — yyyy-mm-dd — or null. */
  returnDate: string | null;
  mfd: string | null;
  expiry: string | null;
  /** The expiry exactly as typed in Tally, for the rows that aren't a date ('1 Days'). */
  expiryRaw: string | null;
  /** Days from today to expiry; negative once expired. */
  days: number | null;
  state: ExpiryState;
}

export interface NoLotStock {
  company: string;
  item: string;
  category: string;
  inkCategory: string;
  inkCategoryFromTally: boolean;
  qty: number;
  uom: string;
  value: number;
}

export interface ExpiryStatus {
  lots: StockLot[];
  noLot: NoLotStock[];
  builtAt: string | null;
  /** Stock left out because it sits in the Lab or LOOSE INK godown (see HELD_GODOWNS). */
  heldOut?: { qty: number; value: number; lots: number };
}

/**
 * Godowns whose stock is NOT counted — the user, 01-10-2026: "I don't want to consider Lab stock,
 * Loose Ink stock". Only Enterprises Surat has them. Ink reaches them on STOCK TRANSFER-LAB
 * vouchers, which ConnectWave stores as a matched pair for the same lot — OUT of Production, IN to
 * Lab — so the lot's company-level balance is unchanged and, without this, lab ink stays counted.
 *
 * Per lot: held = Σ in − Σ out on lines whose godown is one of these, clipped to [0, lot qty].
 * Measured 01-10-2026: Lab holds ~14,661 KGS over 853 lots with only 3 lots slightly negative (−3 KGS),
 * so the figure is sound. LOOSE INK goes negative on many lots (loose ink is drawn into production
 * without a matching receipt in that godown) — a negative is treated as nothing held, never added.
 * The big godowns (Production, Hojiwala) are NOT done this way: their opening stock is not in the
 * synced lines, so netting them gives nonsense (Production +5.37 lakh KGS).
 */
export const HELD_GODOWNS = /^(LAB|LOOSE INK)$/i;

export interface Line {
  /** 'acct_orange::<guid>' is the live book; '…~<yyyymmdd>' an older-FY archive of the same company. */
  tenant_id: string;
  company_guid: string;
  vch_date: string;
  voucher_type: string | null;
  movement: string | null;
  affects_stock: boolean | null;
  stock_item: string;
  batch_name: string | null;
  is_real_lot: boolean | null;
  godown_name: string | null;
  qty: number | null;
  uom: string | null;
  tracking_number: string | null;
  voucher_guid: string;
  line_no: number;
  batch_no: number;
}
interface ItemRow { tenant_id: string; company_guid: string; item: string; stock_group: string | null; primary_group: string | null; group_path: string | null; base_unit: string | null; stock_category: string | null }

/** The ink types Tally's stock categories use; anything else is not an ink type. */
const INK_TYPES = ["SUBLIMATION INK", "REACTIVE INK", "PIGMENT INK", "DISPERSE INK", "OTHERS INK"];

/**
 * Ink type for an item. Tally's stock CATEGORY where it is one of the ink types; otherwise — about
 * half the ink items say 'Not Applicable' (measured 30-09-2026) — placed by the words in the item
 * name and group, and flagged as such so the page can say so.
 */
export function inkCategoryOf(tallyCategory: string | null, item: string, path: string | null): { name: string; fromTally: boolean } {
  const c = (tallyCategory ?? "").trim().toUpperCase();
  if (INK_TYPES.includes(c)) return { name: c, fromTally: true };
  const text = `${item} ${path ?? ""}`.toUpperCase();
  const name = /SUBLIMATION/.test(text) ? "SUBLIMATION INK"
    : /REACTIVE/.test(text) ? "REACTIVE INK"
    : /PIGMENT/.test(text) ? "PIGMENT INK"
    : /DISPERSE/.test(text) ? "DISPERSE INK"
    : "OTHERS INK";
  return { name, fromTally: false };
}
interface AnchorRow { tenant_id: string; company_guid: string; item: string; base_unit: string | null; closing_qty: number | null; closing_value: number | null }
interface DatedRow { company_guid: string; vch_date: string; voucher_no: string | null; stock_item: string; batch_name: string | null; batch_mfd: string | null; batch_expiry_raw: string | null; built_at: string | null }

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

async function readAll<T>(build: (from: number, to: number) => Page<T>): Promise<T[]> {
  const out: T[] = [];
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await build(off, off + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return out;
  }
}

/** Run `jobs` with at most `n` in flight, reporting each completion. */
async function pool<T>(jobs: (() => Promise<T>)[], n: number, onDone: () => void): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => {
    while (next < jobs.length) {
      const i = next++;
      out[i] = await jobs[i]();
      onDone();
    }
  }));
  return out;
}

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const fromYmd = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
const MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Tally batch dates arrive as text: '21-Aug-27', sometimes '21-Aug-2027' or already ISO. */
export function tallyDate(s: string | null): string | null {
  if (!s) return null;
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})$/.exec(t);
  if (!m) return null;
  const mon = MON.indexOf(m[2].toLowerCase());
  if (mon < 0) return null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return iso(y, mon + 1, Number(m[1]));
}

export function daysBetween(from: string, to: string): number {
  const [a, b] = [from, to].map((s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); });
  return Math.round((b - a) / 86_400_000);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** '2026-09-26' → '26-Sep-2026' */
export function fmtDate(s: string | null): string {
  if (!s) return "—";
  const [y, m, d] = s.split("-");
  return `${d}-${MONTHS[Number(m) - 1]}-${y}`;
}

/** Same rule as build_ink_expiry_list.is_ink: the group path says INK and isn't the CHEMICALS group. */
const isInk = (path: string | null) => !!path && /INK/i.test(path) && !/CHEMICALS/i.test(path);

/**
 * Stock that sits in an ink group but is NOT saleable ink with a shelf life — left out entirely, as
 * the user asked (01-10-2026). Measured that day, in KGS:
 *   PROVISION INK-RECEIVABLE / -PAYABLE   ~47,500  (Otec Surat 33,300 · Colorix 14,200) — accounting provisions
 *   DEAD STOCK, LANYU INK DEAD STOCK       ~1,740   (Otec Surat)
 *   DIFF STOCK INK, DIFF INK STOCK         ~2,555
 *   MANUFACTURING STOCK > LOOSE INK        ~1,900   (Enterprises Surat) — loose ink before packing
 * Matched on the Tally group path (any book that files the item there) and on PROVISION item names.
 * `build_ink_expiry_list.is_excluded` applies the same rule to the Excel.
 */
export const EXCLUDED_GROUPS = /PROVISION|DEAD STOCK|DIFF (INK )?STOCK|LOOSE INK/i;
const isExcluded = (path: string | null, item: string) => EXCLUDED_GROUPS.test(path ?? "") || /^PROVISION/i.test(item.trim());

const K = (...parts: string[]) => parts.join("\u0000");
/** Short fingerprint of a long string (FNV-1a), for cache signatures. */
const hash = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return `f${(h >>> 0).toString(36)}:${s.length}`;
};

export async function fetchExpiryStatus(
  cw: SupabaseClient,
  today: string,
  onProgress: (done: number, total: number) => void = () => {},
  /** cache — keep each company × year's lines between visits; coverage — already read by fetchSyncStamp. */
  opts: { cache?: LineCache; coverage?: CoverageRow[] } = {},
): Promise<ExpiryStatus> {
  const asOf = today.replace(/-/g, "");

  // 1. Which items are ink, and their groups. The live (un-suffixed) tenant wins — but an item is
  //    ink if ANY book says so: EPN SUBLIMATION MAGENTA is '(Ungrouped)' in FY 2026-27 and only
  //    the FY 2024-26 book still files it under EP SUBLIMATION INK NORMAL.
  //    The coverage stamps are read alongside; if they can't be, every year is read as before.
  const [items, coverage] = await Promise.all([
    readAll<ItemRow>((a, b) => cw.from("rpt_stock_summary_item")
      .select("tenant_id,company_guid,item,stock_group,primary_group,group_path,base_unit,stock_category")
      .ilike("group_path", "%INK%")
      .order("tenant_id").order("item").order("fy")
      .range(a, b)),
    opts.coverage ?? fetchSyncStamp(cw).then((s) => s.coverage, () => null),
  ]);
  const ink = new Map<string, ItemRow>();
  for (const r of [...items].sort((x, y) => Number(!x.tenant_id.includes("~")) - Number(!y.tenant_id.includes("~")))) {
    if (isInk(r.group_path)) ink.set(K(r.company_guid, r.item), r);
  }
  // Provision / dead / diff / loose stock: out, if any book files the item under such a group.
  for (const r of items) if (isExcluded(r.group_path, r.item)) ink.delete(K(r.company_guid, r.item));
  const guids = [...new Set([...ink.values()].map((r) => r.company_guid))].sort();
  const leaves = [...new Set([...ink.values()].map((r) => r.stock_group).filter(Boolean) as string[])].sort();

  // 2. The jobs: Tally's closing qty per item, the expiry lines, and the ink lines per company × FY.
  const thisFy = Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < 4 ? 1 : 0);
  // Today's ink groups, plus blank groups and any group named like ink: lines keep the group
  // name they were booked under, so an item whose group was renamed ('KN REACTIVE INK HD (RP)'
  // → '… HD RP'; Noida's 'EP SUBLIMATION SUPER HD' → '…SUPERHD') would otherwise lose those
  // lines. Non-ink items are dropped below.
  const groupFilter = [
    `stock_group.in.(${leaves.map((l) => `"${l.replace(/"/g, '\\"')}"`).join(",")})`,
    "stock_group.is.null",
    ...INK_WORDS.map((w) => `stock_group.ilike.*${w}*`),
  ].join(",");

  // Each company × year's ConnectWave stamp (every tenant of the company — live and archive books).
  // The group filter is part of the signature: a new ink group means the saved lines missed some.
  const stamps = new Map<string, { sig: string[]; rows: number }>();
  for (const c of coverage ?? []) {
    const k = K(c.tenant_id.split("::")[1]?.split("~")[0] ?? "", c.fy.slice(0, 4));
    const s = stamps.get(k) ?? { sig: [], rows: 0 };
    s.sig.push(`${c.tenant_id}|${c.batch_rows}|${c.built_at}`);
    s.rows += Number(c.batch_rows) || 0;
    stamps.set(k, s);
  }
  const filterSig = hash(groupFilter);
  // Bump when Line's columns change, so saved lines of the old shape are read again.
  const LINE_SHAPE = "line:v2";
  const windows = guids.flatMap((g) =>
    Array.from({ length: thisFy - FIRST_FY + 1 }, (_, i) => FIRST_FY + i).flatMap((fy) => {
      const s = stamps.get(K(g, String(fy)));
      // Coverage read and no row for this company × year → it has no lines at all; skip it.
      if (coverage && !s) return [];
      return [{ g, fy, key: `${g}|${fy}`, sig: s ? [...s.sig.sort(), filterSig, LINE_SHAPE].join("\n") : "", rows: s?.rows ?? 0 }];
    }));
  const cached = await Promise.all(windows.map((w) =>
    opts.cache && w.sig ? opts.cache.get(w.key, w.sig).catch(() => null) : Promise.resolve(null)));

  const readLines = (g: string, from: string, to: string) => () => readAll<Line>((a, b) => cw.from("rpt_batch_line")
    .select("tenant_id,company_guid,vch_date,voucher_type,movement,affects_stock,stock_item,batch_name,is_real_lot,godown_name,qty,uom,tracking_number,voucher_guid,line_no,batch_no")
    .eq("company_guid", g)
    .or(groupFilter)
    .gte("vch_date", from).lte("vch_date", to)
    // A TOTAL order — offset paging drops or repeats rows that tie.
    .order("tenant_id").order("voucher_guid").order("line_no").order("batch_no")
    .range(a, b));
  // The years still to read, a big one split into its 12 months so they run side by side.
  const parts: { w: number; job: () => Promise<Line[]> }[] = [];
  windows.forEach(({ g, fy, rows }, w) => {
    if (cached[w]) return;
    if (rows <= SPLIT_ROWS) { parts.push({ w, job: readLines(g, `${fy}0401`, `${fy + 1}0331`) }); return; }
    for (let m = 0; m < 12; m++) {
      const y = m < 9 ? fy : fy + 1;
      const mm = String(((m + 3) % 12) + 1).padStart(2, "0");
      parts.push({ w, job: readLines(g, `${y}${mm}01`, `${y}${mm}31`) });
    }
  });

  const anchorJobs = guids.map((g) => () => readAll<AnchorRow>((a, b) => cw.from("rpt_stock_analysis_item")
    .select("tenant_id,company_guid,item,base_unit,closing_qty,closing_value")
    .eq("company_guid", g)
    .order("tenant_id").order("item")
    .range(a, b)));
  // One per company, so they run side by side too.
  const datedJobs = guids.map((g) => () => readAll<DatedRow>((a, b) => cw.from("rpt_batch_line")
    .select("company_guid,vch_date,voucher_no,stock_item,batch_name,batch_mfd,batch_expiry_raw,built_at")
    .eq("company_guid", g)
    .not("batch_expiry_raw", "is", null)
    .order("tenant_id").order("voucher_guid").order("line_no").order("batch_no")
    .range(a, b)));

  let done = 0;
  const total = parts.length + anchorJobs.length + datedJobs.length;
  const tick = () => onProgress(++done, total);
  onProgress(0, total);

  // Expiry lines and closing qty first, then the line parts.
  const results = await pool<unknown[]>([...datedJobs, ...anchorJobs, ...parts.map((p) => p.job)], PARALLEL, tick);
  const n = guids.length;
  const dated = (results.slice(0, n) as DatedRow[][]).flat();
  const anchors = (results.slice(n, 2 * n) as AnchorRow[][]).flat();
  const fresh = results.slice(2 * n) as Line[][];
  const perWindow: Line[][] = windows.map((_, w) => (cached[w] as Line[] | null) ?? []);
  parts.forEach((p, i) => { for (const x of fresh[i]) perWindow[p.w].push(x); });
  if (opts.cache) {
    await Promise.all(windows.map((win, w) =>
      !cached[w] && win.sig ? opts.cache!.put(win.key, win.sig, perWindow[w]).catch(() => {}) : null));
  }
  const lines = perWindow.flat();

  // 3. Tally's closing qty per ink item — live tenant only (older-FY snapshots share the guid).
  const closing = new Map<string, AnchorRow>();
  // An item missing from the live book (EPN SUBLIMATION MAGENTA) still needs a rate for its value:
  // fall back to the older-FY book's closing rate. Used for VALUE only — never to tie quantities.
  const oldRate = new Map<string, number>();
  for (const a of anchors) {
    const k = K(a.company_guid, a.item);
    if (!ink.has(k)) continue;
    if (!a.tenant_id.includes("~")) closing.set(k, a);
    else if (Number(a.closing_qty) > 0) oldRate.set(k, (Number(a.closing_value) || 0) / Number(a.closing_qty));
  }

  // 4. Stock-moving lines, tracked pairs counted once (the earlier line is kept).
  //    First, one row per physical line across books: Enterprises Noida's archive (~20250401)
  //    repeats FY 2026-27 vouchers that the live book also holds — same voucher_guid / line_no /
  //    batch_no — and both copies were being counted (1,109 lines, 21-10-2026). The live copy wins,
  //    as in rpt_lot_balance.
  const byLine = new Map<string, Line>();
  for (const x of lines) {
    const k = K(x.voucher_guid, String(x.line_no), String(x.batch_no));
    const c = byLine.get(k);
    if (!c || (c.tenant_id.includes("~") && !x.tenant_id.includes("~"))) byLine.set(k, x);
  }
  const moving = [...byLine.values()]
    .filter((x) => ink.has(K(x.company_guid, x.stock_item)) && x.vch_date <= asOf && x.affects_stock &&
      !ORDERISH.test(x.voucher_type ?? "") && (x.movement === "in" || x.movement === "out"))
    .sort((a, b) => a.company_guid.localeCompare(b.company_guid) || a.vch_date.localeCompare(b.vch_date) ||
      a.voucher_guid.localeCompare(b.voucher_guid) || a.line_no - b.line_no || a.batch_no - b.batch_no);
  const seen = new Set<string>();
  const kept = moving.filter((x) => {
    if (!x.tracking_number) return true;
    const k = K(x.company_guid, x.tracking_number, x.stock_item, x.batch_name ?? "", x.movement!, (Math.round((Number(x.qty) || 0) * 1000) / 1000).toString());
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // 5a. Internal moves: a voucher that takes the same lot both OUT and IN (stock journal, transfer)
  //     moves stock between godowns — it is not a receipt, so it never sets a purchase date.
  const dir = new Map<string, number>();
  for (const x of kept) {
    const k = K(x.voucher_guid, x.stock_item, x.batch_name ?? "");
    dir.set(k, (dir.get(k) ?? 0) | (x.movement === "in" ? 1 : 2));
  }
  const isInternal = (x: Line) => dir.get(K(x.voucher_guid, x.stock_item, x.batch_name ?? "")) === 3;
  const RETURN = /RETURN|CREDIT NOTE/i;
  // A real purchase or production — the lot's ORIGIN, wherever it later travels.
  const ORIGIN = /PURCHASE|PRODUCTION|RECEIPT NOTE|OPENING/i;

  // 5. Net per lot, remembering each lot's inward slices and last godown.
  interface Acc {
    guid: string; item: string; lot: string; bal: number; held: number; ins: { d: string; q: number }[]; godown: string; uom: string;
    /** First receipt that is not an internal move or a return. */
    first: { d: string; t: string } | null;
    lastReturn: string | null;
  }
  /**
   * Earliest purchase / production of a lot in ANY company. Two indexes:
   *   - by ITEM + LOT — the normal match;
   *   - by LOT alone (lot numbers of 6+ characters) — used ONLY when this company's own first receipt
   *     is not itself a purchase or production (job work, material in), because the receiving book
   *     sometimes names the item differently. Matching on the lot alone in every case could hand a
   *     lot another item's earlier date. (Audit, 02-10-2026.)
   */
  type Origin = { d: string; t: string; guid: string };
  const originByItem = new Map<string, Origin>();
  const originByLot = new Map<string, Origin>();
  const keep = (m: Map<string, Origin>, k: string, o: Origin) => { const c = m.get(k); if (!c || o.d < c.d) m.set(k, o); };
  const acc = new Map<string, Acc>();
  const lotAcc = (guid: string, item: string, lot: string) => {
    const k = K(guid, item, lot);
    let a = acc.get(k);
    if (!a) acc.set(k, (a = { guid, item, lot, bal: 0, held: 0, ins: [], godown: "", uom: "", first: null, lastReturn: null }));
    return a;
  };
  for (const x of kept) {
    const lot = x.batch_name ?? "";
    if (!x.is_real_lot || NON_LOT.has(lot.trim().toLowerCase())) continue;
    const a = lotAcc(x.company_guid, x.stock_item, lot);
    const q = Number(x.qty) || 0;
    a.bal += x.movement === "in" ? q : -q;
    if (x.godown_name && HELD_GODOWNS.test(x.godown_name.trim())) a.held += x.movement === "in" ? q : -q;
    if (x.movement === "in") {
      a.ins.push({ d: x.vch_date, q });
      const t = x.voucher_type ?? "";
      if (RETURN.test(t)) {
        if (!a.lastReturn || x.vch_date > a.lastReturn) a.lastReturn = x.vch_date;
      } else if (!isInternal(x)) {
        if (!a.first || x.vch_date < a.first.d) a.first = { d: x.vch_date, t };
        if (ORIGIN.test(t)) {
          const o = { d: x.vch_date, t, guid: x.company_guid };
          keep(originByItem, K(x.stock_item, lot.trim()), o);
          if (lot.trim().length >= 6) keep(originByLot, lot.trim(), o);
        }
      }
    }
    if (x.godown_name) a.godown = x.godown_name;
    if (x.uom) a.uom = x.uom;
  }

  // 6. Expiry per lot: the latest-dated voucher that carries one.
  const exp = new Map<string, { raw: string; mfd: string | null }>();
  let builtAt: string | null = null;
  for (const r of [...dated].sort((a, b) => a.vch_date.localeCompare(b.vch_date) || (a.voucher_no ?? "").localeCompare(b.voucher_no ?? ""))) {
    const k = K(r.company_guid, r.stock_item, (r.batch_name ?? "").trim());
    const prev = exp.get(k);
    exp.set(k, { raw: r.batch_expiry_raw!, mfd: tallyDate(r.batch_mfd) ?? prev?.mfd ?? null });
    if (r.built_at && (!builtAt || r.built_at > builtAt)) builtAt = r.built_at;
  }

  // 7. Tie each item to Tally's closing qty: keep the NEWEST lots, trim the oldest.
  const byItem = new Map<string, Acc[]>();
  for (const a of acc.values()) {
    if (a.bal <= 0.001) continue;
    const k = K(a.guid, a.item);
    byItem.set(k, [...(byItem.get(k) ?? []), a]);
  }
  const lots: StockLot[] = [];
  const noLot: NoLotStock[] = [];
  const heldOut = { qty: 0, value: 0, lots: 0 };
  for (const k of new Set([...closing.keys(), ...byItem.keys()])) {
    const meta = ink.get(k)!;
    const anchor = closing.get(k);
    const company = COMPANY_SHORT[meta.company_guid] ?? meta.company_guid.slice(0, 8);
    const unit = anchor?.base_unit ?? meta.base_unit ?? "";
    const cat = inkCategoryOf(meta.stock_category, meta.item, meta.group_path);
    let have = (byItem.get(k) ?? []).map((a) => ({ a, q: a.bal }));
    const tally = anchor ? Number(anchor.closing_qty) || 0 : null;
    // Tally's own average closing rate, so lot values add back up to the item's closing value.
    const rate = anchor && tally ? (Number(anchor.closing_value) || 0) / tally : oldRate.get(k) ?? 0;
    const sum = () => have.reduce((s, h) => s + h.q, 0);
    if (tally !== null && sum() > tally + 0.01) {
      const newest = (a: Acc) => a.ins.reduce((m, i) => (i.d > m ? i.d : m), "00000000");
      let budget = Math.max(tally, 0);
      const keep: typeof have = [];
      // Largest lot first, THEN newest first (a stable sort) — the ageing tool's exact order, so
      // lots with the same inward date are trimmed the same way the Excel trims them.
      const bySize = [...have].sort((x, y) => y.q - x.q);
      for (const h of bySize.sort((x, y) => newest(y.a).localeCompare(newest(x.a)))) {
        if (budget <= 0.001) break;
        const q = Math.min(h.q, budget);
        keep.push({ a: h.a, q });
        budget -= q;
      }
      have = keep;
    }
    for (const { a, q: tied } of have) {
      // Take out what sits in the Lab / LOOSE INK godown; a lot with nothing left drops out.
      const held = Math.min(Math.max(a.held, 0), tied);
      if (held > 0.001) { heldOut.qty += held; heldOut.value += held * rate; heldOut.lots += 1; }
      const q = tied - held;
      if (q <= 0.001) continue;
      // Purchase / production date: the lot's origin (any company) if it is no later than this
      // company's own first receipt; else that receipt; else, for a lot whose only "in" lines are
      // internal moves (stock carried in from before the sync), the earliest of those.
      const own = a.first;
      const org = originByItem.get(K(a.item, a.lot.trim()))
        ?? (!own || !ORIGIN.test(own.t) ? originByLot.get(a.lot.trim()) : undefined);
      const useOrigin = !!org && (!own || org.d <= own.d);
      const src = useOrigin ? org! : own;
      const earliestIn = a.ins.reduce<string | null>((m, i) => (m === null || i.d < m ? i.d : m), null);
      const inward = src ? fromYmd(src.d) : earliestIn ? fromYmd(earliestIn) : null;
      const inwardCompany = useOrigin && org!.guid !== a.guid ? COMPANY_SHORT[org!.guid] ?? null : null;
      const receivedHere = own && src && own.d !== src.d ? fromYmd(own.d) : null;
      const e = exp.get(K(a.guid, a.item, a.lot.trim()));
      const expiry = e ? tallyDate(e.raw) : null;
      const days = expiry ? daysBetween(today, expiry) : null;
      lots.push({
        company, item: a.item, category: meta.stock_group ?? "", inkCategory: cat.name, inkCategoryFromTally: cat.fromTally,
        mainGroup: meta.primary_group ?? "",
        path: meta.group_path ?? "", lot: a.lot, qty: Math.round(q * 1000) / 1000, uom: a.uom || unit, value: q * rate,
        godown: a.godown, inward, inwardType: src?.t ?? null, inwardCompany,
        receivedHere, receivedHereType: receivedHere ? own!.t : null,
        returnDate: a.lastReturn ? fromYmd(a.lastReturn) : null, mfd: e?.mfd ?? null, expiry, expiryRaw: e?.raw ?? null, days,
        state: !e ? "missing" : !expiry ? "invalid" : days! < 0 ? "expired" : "updated",
      });
    }
    if (tally !== null) {
      const gap = Math.round((tally - sum()) * 1000) / 1000;
      if (gap > 0.001) noLot.push({ company, item: meta.item, category: meta.stock_group ?? "", inkCategory: cat.name, inkCategoryFromTally: cat.fromTally, qty: gap, uom: unit, value: gap * rate });
    }
  }

  const order = (a: { company: string; category: string; item: string }, b: typeof a) =>
    a.company.localeCompare(b.company) || a.category.localeCompare(b.category) || a.item.localeCompare(b.item);
  lots.sort((a, b) => order(a, b) || (a.inward ?? "").localeCompare(b.inward ?? "") || a.lot.localeCompare(b.lot));
  noLot.sort(order);
  return { lots, noLot, builtAt, heldOut };
}
