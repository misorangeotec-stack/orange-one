import { getConnectwave, hasConnectwave } from "@/core/platform/connectwave";
import type { CategorySource } from "./categories";
import { NOT_CATEGORISED, SURAT_GUID } from "./constants";

export { SURAT_GUID };

/**
 * INK STABILISATION — every ink lot Enterprises Surat manufactured, and its three retests.
 *
 * QC retests each manufactured lot three times: 3, 6 and 9 months after production. This
 * reads the lots straight off ConnectWave (read-only) and works the dates out in the
 * browser. `tools/build_ink_stabilisation_schedule.py` applies the SAME rules to write the
 * Excel version — change one, change the other.
 *
 * ⚠ PRODUCTION DATE IS THE VOUCHER DATE, NOT THE LOT NAME. Lot `#1585-26061113` reads as
 *   June 2026, but its STOCK JOURNAL-PRODUCTION voucher is dated 10-Jul-2026. ConnectWave's
 *   own `batch_date` parses these YYMM+serial names as YYMMDD, so it is wrong here too.
 *
 * ⚠ EXPIRY IS MOSTLY NOT IN TALLY. Measured 26-09-2026: 185 of 1,259 lots carry one, and
 *   never on the production line itself — it turns up on later sales / transfer lines of
 *   the same batch, as text ('21-Aug-27'). A blank is shown blank, never estimated.
 *
 * ⚠ BOTH BOOKS. Surat's books were split: FY 2025-26 lives on the `~20240401` tenant and
 *   FY 2026-27 on the base one. Filtering on `company_guid` (not `tenant_id`) reads both,
 *   and they never overlap on a voucher, so nothing is double-counted.
 */

const PRODUCTION = "STOCK JOURNAL-PRODUCTION";
export const TEST_MONTHS = [3, 6, 9] as const;
const PAGE = 1000;

/** Enterprises Surat manufactures ink, so its finished ink sits under FINISHED GOODS. */
const INK_PREFIXES = ["FINISHED GOODS > FINISHED INK KGS", "PRINTING INK"];
const NOT_INK = ["FINISHED GOODS > FINISHED INK KGS > CHEMICALS"];
const UNGROUPED = "(Ungrouped)";
/** A few inks have no stock group in Tally; keep those by name (this leaves out CLEANER). */
const INK_WORDS = ["INK", "SUBLIMATION", "REACTIVE"];

export interface InkLot {
  item: string;
  family: string;
  /** The tab it sits under: its Ink type from Bushra Central Master (see categories.ts). */
  category: string;
  /** The broader Category there (REACTIVE INK, SUBLIMATION INK…), when set. */
  categoryGroup: string | null;
  categorySource: CategorySource;
  /** False when Central Masters has no Enterprises Surat item of this name at all. */
  inMaster: boolean;
  lot: string;
  /** yyyy-mm-dd */
  prod: string;
  mfd: string | null;
  expiry: string | null;
  qty: number;
  uom: string | null;
  /** Test 1, 2, 3 due dates — yyyy-mm-dd. */
  tests: [string, string, string];
  vouchers: string[];
  /**
   * Closing stock page only (07-10-2026). Unset on production lots, which are all Enterprises
   * Surat's. `prod` there is the lot's production OR purchase date, and `qty` is stock today.
   */
  companyGuid?: string;
  company?: string;
  godown?: string;
  /** The voucher type that dated the lot: 'STOCK JOURNAL-PRODUCTION', 'GST PURCHASE-INK'… */
  dateFrom?: string | null;
}

interface ProdRow { vch_date: string; voucher_no: string | null; stock_item: string; batch_name: string | null; qty: number | null; uom: string | null }
interface DatedRow { vch_date: string; stock_item: string; batch_name: string | null; batch_mfd: string | null; batch_expiry_raw: string | null }
interface GroupRow { tenant_id: string; item: string; group_path: string | null }

async function readAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await build(off, off + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return out;
  }
}

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** '20260926' → '2026-09-26' */
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

/** Calendar months later; the 31st rolls back to the month's last day. */
export function addMonths(isoDate: string, n: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const idx = m - 1 + n;
  const ny = y + Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  const last = new Date(ny, nm, 0).getDate();
  return iso(ny, nm, Math.min(d, last));
}

function isInk(item: string, path: string | undefined): boolean {
  if (!path || path === UNGROUPED) return INK_WORDS.some((w) => item.toUpperCase().includes(w));
  return INK_PREFIXES.some((p) => path.startsWith(p)) && !NOT_INK.some((p) => path.startsWith(p));
}

const familyOf = (path: string | undefined) =>
  !path || path === UNGROUPED ? "(No stock group in Tally)" : path.split(" > ").pop()!.trim();

export async function fetchInkLots(): Promise<InkLot[]> {
  if (!hasConnectwave()) {
    throw new Error("The live Tally mirror is not configured for this site, so production lots cannot be read.");
  }
  const cw = getConnectwave();

  const [prod, dated, groups] = await Promise.all([
    readAll<ProdRow>((a, b) => cw.from("rpt_batch_line")
      .select("vch_date,voucher_no,stock_item,batch_name,qty,uom")
      .eq("company_guid", SURAT_GUID).eq("voucher_type", PRODUCTION).eq("movement", "in").eq("affects_stock", true)
      // A TOTAL order — offset paging drops or repeats rows that tie.
      .order("tenant_id").order("voucher_guid").order("line_no").order("batch_no")
      .range(a, b)),
    readAll<DatedRow>((a, b) => cw.from("rpt_batch_line")
      .select("vch_date,stock_item,batch_name,batch_mfd,batch_expiry_raw")
      .eq("company_guid", SURAT_GUID).or("batch_expiry_raw.not.is.null,batch_mfd.not.is.null")
      .order("tenant_id").order("voucher_guid").order("line_no").order("batch_no")
      .range(a, b)),
    readAll<GroupRow>((a, b) => cw.from("rpt_stock_summary_item")
      .select("tenant_id,item,group_path")
      .eq("company_guid", SURAT_GUID)
      .order("tenant_id").order("item").order("fy")
      .range(a, b)),
  ]);

  // The live (un-suffixed) tenant's group wins over an older year's snapshot.
  const path = new Map<string, string>();
  for (const g of [...groups].sort((x, y) => Number(!x.tenant_id.includes("~")) - Number(!y.tenant_id.includes("~")))) {
    if (g.group_path) path.set(g.item, g.group_path);
  }

  const key = (item: string, lot: string) => `${item}\u0000${lot}`;

  // Latest-dated line wins if a batch's dates were edited over time.
  const bdates = new Map<string, { mfd: string | null; exp: string | null }>();
  for (const r of [...dated].sort((x, y) => x.vch_date.localeCompare(y.vch_date))) {
    const k = key(r.stock_item, (r.batch_name ?? "").trim());
    const prev = bdates.get(k) ?? { mfd: null, exp: null };
    bdates.set(k, { mfd: tallyDate(r.batch_mfd) ?? prev.mfd, exp: tallyDate(r.batch_expiry_raw) ?? prev.exp });
  }

  const lots = new Map<string, InkLot>();
  for (const r of prod) {
    const grp = path.get(r.stock_item);
    if (!isInk(r.stock_item, grp)) continue;
    const lot = (r.batch_name ?? "").trim();
    const k = key(r.stock_item, lot);
    const d = fromYmd(r.vch_date);
    let L = lots.get(k);
    if (!L) {
      L = { item: r.stock_item, family: familyOf(grp), category: NOT_CATEGORISED, categoryGroup: null, categorySource: "missing", inMaster: false, lot, prod: d, mfd: null, expiry: null,
            qty: 0, uom: r.uom, tests: ["", "", ""], vouchers: [] };
      lots.set(k, L);
    }
    if (d < L.prod) L.prod = d;
    L.qty += Number(r.qty) || 0;
    if (r.voucher_no && !L.vouchers.includes(r.voucher_no)) L.vouchers.push(r.voucher_no);
  }

  for (const [k, L] of lots) {
    const bd = bdates.get(k);
    L.mfd = bd?.mfd ?? null;
    L.expiry = bd?.exp ?? null;
    L.tests = TEST_MONTHS.map((m) => addMonths(L.prod, m)) as InkLot["tests"];
  }
  return [...lots.values()];
}

/** The next test on or after `today`, or null once all three dates have passed. */
export function nextTest(L: InkLot, today: string): { no: 1 | 2 | 3; date: string } | null {
  const i = L.tests.findIndex((t) => t >= today);
  return i < 0 ? null : { no: (i + 1) as 1 | 2 | 3, date: L.tests[i] };
}

/** Whole days between two yyyy-mm-dd dates (local, DST-safe via UTC). */
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

/** '2026-09' → 'Sep 2026' */
export const fmtMonth = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
