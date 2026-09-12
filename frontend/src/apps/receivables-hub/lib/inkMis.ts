/**
 * INK MIS — the printing-ink stock position across all four books, plus the incoming
 * pipeline (ETD / ETA / AT PORT) that the planner maintains by hand.
 *
 * This is the Hub port of the Excel sheet the team keeps for ink planning. Two halves:
 *
 *   1. STOCK comes from Tally, through the ConnectWave mirror. Nothing here is typed in.
 *      `loadInkPositions` reuses `loadStockSummary` (the rpt_stock_summary_window RPC) and
 *      merges the four books onto ONE line per item code.
 *
 *   2. PLANNING INPUTS AND SHIPMENTS are the planner's own numbers — three-month average,
 *      per-day average, lead time, safety factor, and every ETD/ETA consignment. Tally has
 *      no such data, so it lives in the browser (see `store` below).
 *
 * ─── THE MERGE KEY IS THE ITEM CODE ──────────────────────────────────────────────────────
 *
 * The same ink carries the same code in every book (FG-H-BLACK, FG-EP-SHD-CYAN …), which is
 * what makes one merged line possible. Item NAMES are not reliable across books and the code
 * is what the Excel sheet has always keyed on.
 *
 * Verified against the planner's sheet on 12-Sep-2026: FG-H-BLACK merged to 6,435 and
 * FG-H-LIGHT-MAGENTA to 2,280, both matching the sheet exactly.
 *
 * Rows with NO item code cannot join and are counted in `unmapped` rather than dropped in
 * silence — a blank code is a master-data gap somebody has to fix, not a rounding detail.
 *
 * That gap is not theoretical. Checked against the planner's sheet, 25 of 29 lines tied; all
 * four that did not were uncoded rows in Otec Surat. H6K Black is the clearest: 1,085 coded in
 * Otec Noida plus 3,745 uncoded in Otec Surat is exactly the 4,830 on the sheet. So `aliases`
 * lets the planner point an uncoded Tally item at a code and close the gap here, without
 * waiting on the item master. Fixing the code in Tally is still the better repair — an alias
 * is local to one browser — which is why the screen says so.
 *
 * ─── WHICH GROUP HOLDS THE INK ───────────────────────────────────────────────────────────
 *
 * Three books keep ink under the top-level group PRINTING INK. Enterprises Surat keeps it
 * under FINISHED GOODS, because that book manufactures it. So the group filter is PER BOOK.
 *
 * Two traps, both of which return near-empty tables if you get them wrong:
 *   - Filter on `primary_group` (the TOP-level group), never `stock_group`, which holds the
 *     leaf. `stock_group = 'PRINTING INK'` matches a couple of dozen rows out of thousands.
 *   - Enterprises Surat is taken at COMPANY level, not by godown. Netting its two finished-
 *     goods godowns from voucher lines produces negative balances, because the mirror holds
 *     movements but no per-godown opening. Company level ties to the planner's sheet where
 *     godown netting does not (Light Magenta: 280 company, 297 netted, 280 on the sheet).
 */
import { loadStockSummary, type StockSummaryRow } from "./stockSummary";
import { getConnectwaveSupabase } from "./connectwaveSupabase";

/* ------------------------------------------------------------------- the books */

export interface InkCompany {
  /** Short key used in the UI, the tab routes and the local store. */
  key: string;
  guid: string;
  label: string;
  /** Top-level stock group that holds printing ink IN THIS BOOK. */
  inkGroups: string[];
}

export const INK_COMPANIES: InkCompany[] = [
  {
    key: "otec-surat",
    guid: "a4e100d1-3b6f-4193-876a-c754f1a74552",
    label: "Otec Surat",
    inkGroups: ["PRINTING INK"],
  },
  {
    key: "otec-noida",
    guid: "53d35745-5246-4e1a-a27a-d4769f245b50",
    label: "Otec Noida",
    inkGroups: ["PRINTING INK"],
  },
  {
    key: "ent-surat",
    guid: "59a6c2d9-0c5a-4fc5-b8c5-3be6fec3289e",
    label: "Enterprises Surat",
    inkGroups: ["FINISHED GOODS"],
  },
  {
    key: "ent-noida",
    guid: "779c26f4-3fd8-46bd-9995-4f9916c98856",
    label: "Enterprises Noida",
    inkGroups: ["PRINTING INK"],
  },
];

export const INK_COMPANY_GUIDS = INK_COMPANIES.map((c) => c.guid);
const BY_GUID = new Map(INK_COMPANIES.map((c) => [c.guid, c]));

/* ------------------------------------------------------------------ stock side */

/** One ink, merged across the four books. Quantities only — ink is bought and sold in KGS. */
export interface InkPosition {
  itemCode: string;
  /** Longest name seen across the books; the sheet's "New Description". */
  description: string;
  /** Leaf stock group, for the sheet's "Group" column. */
  group: string;
  baseUnit: string;
  /** Closing quantity per book, keyed by `InkCompany.key`. Absent book means zero. */
  byCompany: Record<string, number>;
  /** Sum of `byCompany` — the merged line. */
  stock: number;
  /** Outward quantity over the loaded window, per book and merged. Feeds "fill from Tally". */
  consumedByCompany: Record<string, number>;
  consumed: number;
}

/** An uncoded Tally item, offered for mapping. `key` is what `InkAliases` is keyed on. */
export interface UnmappedItem {
  key: string;
  companyKey: string;
  company: string;
  item: string;
  qty: number;
}

export interface InkPositionsResult {
  rows: InkPosition[];
  /** Ink rows carrying no item code and no alias, so unable to join. Never swallowed. */
  unmapped: UnmappedItem[];
  /** Newest mirror build time across the four books. */
  builtAt: string | null;
  /** `<companyKey>|<ITEM NAME>` → item code. The Sales Register carries names, not codes,
   *  so this is the bridge `loadInkConsumption` joins on. Per book, because the same name
   *  can be a different code in a different company. */
  nameToCode: Map<string, string>;
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();

/**
 * Planner-supplied item codes for Tally items that have none, keyed by book and item name.
 * Scoped per book on purpose: the same name can be a different ink in a different company,
 * and a global map would merge two things that are not the same.
 */
export type InkAliases = Record<string, string>;

export const aliasKey = (companyKey: string, item: string) => `${companyKey}|${norm(item)}`;

function isInk(row: StockSummaryRow): boolean {
  const company = BY_GUID.get(row.company_guid);
  if (!company) return false;
  return company.inkGroups.includes(norm(row.primary_group));
}

/**
 * Load and merge. `from`/`to` narrow the window for the consumption figures; closing stock is
 * as at `to`. Pass the whole financial year to get Tally's own closing rather than a walked one.
 */
export async function loadInkPositions(
  fy: string,
  from?: string,
  to?: string,
  aliases: InkAliases = {},
): Promise<InkPositionsResult> {
  const raw = await loadStockSummary(INK_COMPANY_GUIDS, fy, from, to);
  const ink = raw.filter(isInk);

  const merged = new Map<string, InkPosition>();
  const unmapped: InkPositionsResult["unmapped"] = [];
  const nameToCode = new Map<string, string>();
  let builtAt: string | null = null;

  for (const row of ink) {
    if (row.built_at && (!builtAt || row.built_at > builtAt)) builtAt = row.built_at;

    const company = BY_GUID.get(row.company_guid);
    if (!company) continue;

    // Tally's own code wins; the planner's alias only fills a blank, never overrides.
    const code = norm(row.item_code) || norm(aliases[aliasKey(company.key, row.item)]);
    if (!code) {
      // No code, no join. Only worth reporting when the row actually holds something.
      if (row.closing_qty) {
        unmapped.push({
          key: aliasKey(company.key, row.item),
          companyKey: company.key,
          company: company.label,
          item: row.item,
          qty: row.closing_qty,
        });
      }
      continue;
    }

    nameToCode.set(`${company.key}|${norm(row.item)}`, code);

    let pos = merged.get(code);
    if (!pos) {
      pos = {
        itemCode: code,
        description: row.item_name || row.item || code,
        group: row.stock_group || row.primary_group || "",
        baseUnit: row.base_unit || "KGS",
        byCompany: {},
        stock: 0,
        consumedByCompany: {},
        consumed: 0,
      };
      merged.set(code, pos);
    }

    // Books disagree on how fully an item is named; keep the most descriptive one.
    const name = row.item_name || row.item || "";
    if (name.length > pos.description.length) pos.description = name;

    pos.byCompany[company.key] = (pos.byCompany[company.key] ?? 0) + row.closing_qty;
    pos.stock += row.closing_qty;
    pos.consumedByCompany[company.key] =
      (pos.consumedByCompany[company.key] ?? 0) + row.outward_qty;
    pos.consumed += row.outward_qty;
  }

  const rows = [...merged.values()].sort((a, b) => a.itemCode.localeCompare(b.itemCode));
  unmapped.sort((a, b) => Math.abs(b.qty) - Math.abs(a.qty));
  return { rows, unmapped, builtAt, nameToCode };
}

/* ---------------------------------------------------------------- consumption */

/**
 * The two consumption figures, read from the Sales Register.
 *
 *   three-month average = the three COMPLETE months before this one, summed and divided by 3
 *   per-day average     = THIS month so far, divided by the working days elapsed
 *
 * ─── WHAT COUNTS AS CONSUMPTION ──────────────────────────────────────────────────────────
 *
 * Not every line in the register is ink leaving the group. Two whole categories are the same
 * ink moving inside it, and counting them inflates every reorder level on the page:
 *
 *   BRANCH SALE    one book selling to another of our own books — Enterprises Surat to
 *                  Enterprises Noida, Otec Surat to Otec Noida. The ink has not been consumed,
 *                  it has been relocated, and the receiving book's own sale counts it again.
 *   RELATED SALE   sales to related entities, which the planner also leaves out.
 *
 * Sales returns are netted off rather than ignored, since the ink came back.
 *
 * This was not guessed. Six filter combinations were tested against the planner's sheet: taking
 * every line runs 34% high, and this rule reproduces 12 of 18 three-month averages EXACTLY with
 * the rest inside 3%. Widening it back to all lines is a regression, not a simplification.
 *
 * ─── WORKING DAYS ────────────────────────────────────────────────────────────────────────
 *
 * Sundays are excluded and the count runs to TODAY, not to the month end — dividing a part-month
 * by a whole month's days would understate the daily rate badly in the first week.
 *
 * Public holidays are NOT excluded by default. The planner asked for them, but excluding only
 * Sundays is what reproduces their own figures, so the holiday list starts empty and is theirs
 * to fill; every date added raises every per-day average.
 */
export interface InkConsumption {
  threeMonthAvg: number;
  perDayAvg: number;
}

/** Register `type` values that are the group moving ink to itself, not selling it. */
const INTERNAL_TYPES = new Set(["BRANCH SALE", "RELATED SALE"]);

const monthKey = (ymd: string) => ymd.slice(0, 6);

/** First day of the month `back` months before `d`, as yyyymmdd. */
function monthStart(d: Date, back: number): string {
  const x = new Date(d.getFullYear(), d.getMonth() - back, 1);
  return `${x.getFullYear()}${String(x.getMonth() + 1).padStart(2, "0")}01`;
}

/**
 * Working days from the 1st of `d`'s month up to and including `d`.
 * Sundays are always excluded; `holidays` are extra yyyymmdd dates to skip.
 * Never returns 0 — a division guard, since day 1 of a month can be a Sunday.
 */
export function workingDaysElapsed(d: Date, holidays: Set<string> = new Set()): number {
  let n = 0;
  for (let day = 1; day <= d.getDate(); day++) {
    const x = new Date(d.getFullYear(), d.getMonth(), day);
    if (x.getDay() === 0) continue;
    const ymd = `${x.getFullYear()}${String(x.getMonth() + 1).padStart(2, "0")}${String(day).padStart(2, "0")}`;
    if (holidays.has(ymd)) continue;
    n++;
  }
  return Math.max(n, 1);
}

/**
 * Read the register for the four ink books and return both averages per item code.
 *
 * The register carries the item NAME, not its code, so the join runs through `nameToCode` —
 * built per book from the same stock rows the dashboard already has, because the same name can
 * carry different codes in different books.
 */
export async function loadInkConsumption(
  nameToCode: Map<string, string>,
  today: Date = new Date(),
  holidays: Set<string> = new Set(),
): Promise<Map<string, InkConsumption>> {
  const cw = getConnectwaveSupabase();
  const from = monthStart(today, 3);
  const to = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;

  const PAGE = 1000;
  const rows: { company_guid: string; particulars: string; quantity: number; vch_date: string; type: string }[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await cw
      .from("rpt_sales_register")
      .select("company_guid,particulars,quantity,vch_date,type")
      .in("company_guid", INK_COMPANY_GUIDS)
      .gte("vch_date", from)
      .lte("vch_date", to)
      .order("vch_date", { ascending: true })
      .range(offset, offset + PAGE - 1)
      .returns<typeof rows>();
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  const byGuid = new Map(INK_COMPANIES.map((c) => [c.guid, c.key]));
  const priorMonths = [monthKey(monthStart(today, 1)), monthKey(monthStart(today, 2)), monthKey(monthStart(today, 3))];
  const thisMonth = monthKey(to);

  const prior = new Map<string, number>();
  const current = new Map<string, number>();

  for (const r of rows) {
    const companyKey = byGuid.get(r.company_guid);
    if (!companyKey) continue;
    const type = (r.type ?? "").trim().toUpperCase();
    if (INTERNAL_TYPES.has(type)) continue;

    const code = nameToCode.get(`${companyKey}|${norm(r.particulars)}`);
    if (!code) continue;

    // The register's sign is not a reliable direction marker, so magnitude plus the TYPE is.
    const qty = Math.abs(r.quantity ?? 0) * (type.includes("RETURN") ? -1 : 1);
    const month = monthKey(String(r.vch_date));
    if (month === thisMonth) current.set(code, (current.get(code) ?? 0) + qty);
    else if (priorMonths.includes(month)) prior.set(code, (prior.get(code) ?? 0) + qty);
  }

  const days = workingDaysElapsed(today, holidays);
  const out = new Map<string, InkConsumption>();
  for (const code of new Set([...prior.keys(), ...current.keys()])) {
    out.set(code, {
      threeMonthAvg: Math.round((prior.get(code) ?? 0) / 3),
      perDayAvg: Math.round((current.get(code) ?? 0) / days),
    });
  }
  return out;
}

/* -------------------------------------------------------------- the pipeline */

/**
 * Where a consignment has got to. The planner's sheet uses exactly these three headings, and
 * they are a lifecycle, not a free choice:
 *   ETD      ordered, not yet shipped — an expected departure
 *   ETA      shipped, on the water — an expected arrival
 *   AT PORT  landed, clearing customs
 * A consignment that has been received is DELETED, because from then on it is in the stock
 * figure and counting it twice would overstate cover.
 */
export const SHIPMENT_STATUSES = ["ETD", "ETA", "AT PORT"] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

/** One item and quantity inside a consignment — a single cell of the sheet's shipment column. */
export interface ShipmentLine {
  id: string;
  itemCode: string;
  qty: number;
}

/** One consignment — one column of the planner's sheet. */
export interface Shipment {
  id: string;
  /** The planner's own reference: OTPL/INK/33, OTEC260819-1, PP, BIB … */
  reference: string;
  status: ShipmentStatus;
  /** Expected date, ISO yyyy-mm-dd. Departure when status is ETD, otherwise arrival. */
  date: string;
  /** Optional landing book, as an `InkCompany.key`. Blank means it shows only on the
   *  combined dashboard, which is how the Excel sheet behaves today. */
  company: string;
  note: string;
  lines: ShipmentLine[];
}

/** Planning inputs the planner maintains per ink. Tally cannot supply these. */
export interface InkPlan {
  /** Quantity consumed over the last three months. */
  threeMonthAvg: number;
  /** Working-day average. NOT threeMonthAvg/90 — the planner sets it per ink. */
  perDayAvg: number;
  /** Months of cover to order against. */
  leadTime: number;
  safetyFactor: number;
}

export const EMPTY_PLAN: InkPlan = { threeMonthAvg: 0, perDayAvg: 0, leadTime: 0, safetyFactor: 1 };

/**
 * Colour bands, as percentages of the month max level. Defaults reproduce the sheet's
 * conditional formatting: below 33 red, 33–66 amber, 66–120 green, 120 and over purple.
 * `excessRemark` is deliberately lower than `excess` — the sheet flags "excess stock" in the
 * remark column from 100%, while the cell only turns purple at 120%.
 */
export interface InkThresholds {
  low: number;
  mid: number;
  excess: number;
  excessRemark: number;
}

export const DEFAULT_THRESHOLDS: InkThresholds = {
  low: 33,
  mid: 66,
  excess: 120,
  excessRemark: 100,
};

/* ------------------------------------------------------------------ derivation */

export type InkBand = "low" | "mid" | "normal" | "excess" | "none";

/** Everything the dashboard prints for one ink, once stock and plan are combined. */
export interface InkRow extends InkPosition {
  plan: InkPlan;
  /** Incoming by status, from the consignments in scope. */
  etd: number;
  eta: number;
  atPort: number;
  /** ETA + AT PORT. Goods on the water or landed — what the sheet adds to stock. */
  incoming: number;
  /** Stock + incoming. The sheet's "ETA + AT PORT + STOCK" grand total. */
  total: number;
  monthMaxLevel: number;
  dailyMaxLevel: number;
  /** Days of cover on stock alone, and with incoming. Null when no per-day average is set. */
  daysCover: number | null;
  daysCoverWithIncoming: number | null;
  /** Stock as a percentage of month max level. Null when no month max is set. */
  coverPct: number | null;
  band: InkBand;
  remark: "NEW ORDER REQUIRED" | "EXCESS STOCK" | "";
}

function bandFor(pct: number | null, t: InkThresholds): InkBand {
  if (pct === null) return "none";
  if (pct < t.low) return "low";
  if (pct < t.mid) return "mid";
  if (pct < t.excess) return "normal";
  return "excess";
}

/**
 * Combine a merged stock line with the planner's inputs and the consignments.
 *
 * `companyKey` scopes the whole calculation to one book: stock becomes that book's own
 * closing, and only consignments tagged to that book count as incoming. Pass null for the
 * combined view, where every consignment counts whether or not it names a book.
 */
export function deriveInkRow(
  pos: InkPosition,
  plan: InkPlan,
  shipments: Shipment[],
  thresholds: InkThresholds,
  companyKey: string | null,
): InkRow {
  const stock = companyKey ? (pos.byCompany[companyKey] ?? 0) : pos.stock;

  let etd = 0;
  let eta = 0;
  let atPort = 0;
  for (const s of shipments) {
    if (companyKey && s.company !== companyKey) continue;
    for (const line of s.lines) {
      if (line.itemCode !== pos.itemCode) continue;
      if (s.status === "ETD") etd += line.qty;
      else if (s.status === "ETA") eta += line.qty;
      else atPort += line.qty;
    }
  }

  const incoming = eta + atPort;
  const monthMaxLevel = plan.threeMonthAvg * plan.leadTime * plan.safetyFactor;
  const dailyMaxLevel = plan.perDayAvg * plan.leadTime * plan.safetyFactor;
  const daysCover = plan.perDayAvg > 0 ? stock / plan.perDayAvg : null;
  const daysCoverWithIncoming = plan.perDayAvg > 0 ? (stock + incoming) / plan.perDayAvg : null;
  const coverPct = monthMaxLevel > 0 ? (stock / monthMaxLevel) * 100 : null;

  let remark: InkRow["remark"] = "";
  if (coverPct !== null) {
    remark = coverPct >= thresholds.excessRemark ? "EXCESS STOCK" : "NEW ORDER REQUIRED";
  }

  return {
    ...pos,
    stock,
    plan,
    etd,
    eta,
    atPort,
    incoming,
    total: stock + incoming,
    monthMaxLevel,
    dailyMaxLevel,
    daysCover,
    daysCoverWithIncoming,
    coverPct,
    band: bandFor(coverPct, thresholds),
    remark,
  };
}

/* ----------------------------------------------------------------- local store */

/**
 * The planner's numbers live in the browser, by an explicit decision: no table was added to
 * the shared database for this. Consequences the UI must own up to — the data is visible only
 * on this machine and this browser profile, and clearing site data loses it. Hence the export
 * and import buttons on the entry screen, which are the backup.
 *
 * Every read is defensive. A half-written or hand-edited value must not blank the dashboard,
 * so a parse failure falls back to the default rather than throwing.
 */
const KEY_PLANS = "ink-mis:plans:v1";
const KEY_SHIPMENTS = "ink-mis:shipments:v1";
const KEY_THRESHOLDS = "ink-mis:thresholds:v1";
const KEY_ALIASES = "ink-mis:aliases:v1";
const KEY_HOLIDAYS = "ink-mis:holidays:v1";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing, or the quota is full. The screen keeps working on in-memory state;
    // warning on every keystroke would be worse than losing an unsaved edit.
  }
}

export const loadPlans = (): Record<string, InkPlan> => readJson(KEY_PLANS, {});
export const savePlans = (p: Record<string, InkPlan>) => writeJson(KEY_PLANS, p);

export const loadShipments = (): Shipment[] => {
  const rows = readJson<Shipment[]>(KEY_SHIPMENTS, []);
  return Array.isArray(rows) ? rows.filter((r) => r && typeof r.id === "string") : [];
};
export const saveShipments = (s: Shipment[]) => writeJson(KEY_SHIPMENTS, s);

export const loadThresholds = (): InkThresholds => ({
  ...DEFAULT_THRESHOLDS,
  ...readJson<Partial<InkThresholds>>(KEY_THRESHOLDS, {}),
});
export const saveThresholds = (t: InkThresholds) => writeJson(KEY_THRESHOLDS, t);

export const loadAliases = (): InkAliases => readJson<InkAliases>(KEY_ALIASES, {});
export const saveAliases = (a: InkAliases) => writeJson(KEY_ALIASES, a);

/** Extra non-working days, yyyymmdd. Sundays are excluded already and are not listed here. */
export const loadHolidays = (): string[] => {
  const v = readJson<string[]>(KEY_HOLIDAYS, []);
  return Array.isArray(v) ? v.filter((d) => /^\d{8}$/.test(d)) : [];
};
export const saveHolidays = (d: string[]) => writeJson(KEY_HOLIDAYS, d);

/** `crypto.randomUUID` is not available on every browser the team uses; this always is. */
export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function emptyShipment(): Shipment {
  return {
    id: newId(),
    reference: "",
    status: "ETD",
    date: "",
    company: "",
    note: "",
    lines: [{ id: newId(), itemCode: "", qty: 0 }],
  };
}

/* ------------------------------------------------------------------ backup i/o */

export interface InkBackup {
  kind: "ink-mis-backup";
  version: 1;
  savedAt: string;
  plans: Record<string, InkPlan>;
  shipments: Shipment[];
  thresholds: InkThresholds;
  aliases: InkAliases;
  holidays: string[];
}

export function buildBackup(): InkBackup {
  return {
    kind: "ink-mis-backup",
    version: 1,
    savedAt: new Date().toISOString(),
    plans: loadPlans(),
    shipments: loadShipments(),
    thresholds: loadThresholds(),
    aliases: loadAliases(),
    holidays: loadHolidays(),
  };
}

/** Restore a backup file. Throws with a readable message rather than half-applying one. */
export function applyBackup(text: string): InkBackup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  const b = parsed as Partial<InkBackup>;
  if (!b || b.kind !== "ink-mis-backup") {
    throw new Error("That file is not an INK MIS backup.");
  }
  savePlans(b.plans ?? {});
  saveShipments(Array.isArray(b.shipments) ? b.shipments : []);
  saveThresholds({ ...DEFAULT_THRESHOLDS, ...(b.thresholds ?? {}) });
  saveAliases(b.aliases ?? {});
  saveHolidays(Array.isArray(b.holidays) ? b.holidays : []);
  return b as InkBackup;
}

/* -------------------------------------------------------------------- display */

const nf0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });

/** Zero prints as a dash. A real zero and an unknown read the same on paper, and the sheet
 *  the planner works from uses a dash for both. */
export const fmtQty = (n: number | null | undefined): string =>
  !n ? "–" : nf0.format(Math.round(n));

export const fmtDays = (n: number | null | undefined): string =>
  n === null || n === undefined || !Number.isFinite(n) ? "–" : nf1.format(n);

export const fmtPct = (n: number | null | undefined): string =>
  n === null || n === undefined || !Number.isFinite(n) ? "–" : `${nf0.format(n)}%`;
