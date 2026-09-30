/**
 * GODOWN-WISE STOCK, from ConnectWave alone.
 *
 * Otec's books are read whole. Enterprises Surat is not: its ink sits in Finished Goods Sachin
 * and Hojiwala, and the rest of its godowns — Production, Lab, Warehouse, job work — are not
 * stock the planner can sell, so counting them overstates the company every time.
 *
 * ─── WHERE THE FIGURE COMES FROM ─────────────────────────────────────────────────────────
 *
 * Every stock voucher line in Tally carries a godown and the mirror keeps it, so the year's
 * movement is walked per item per godown:
 *
 *     godown stock = the godown's share of the opening + (inward − outward) at that godown
 *
 * Checked against Tally on Enterprises Surat's 126 in-stock finished goods, that walk lands on
 * Tally's own closing EXACTLY for 103 of them, before anything is adjusted. One item traced line
 * by line: KY Reactive Ink Grey, opening 4,870 + net movement 5,186 = 10,056, which is Tally's
 * closing to the kilo, with Production netting to precisely zero as it should.
 *
 * ─── THE ONE THING THAT IS STILL ESTIMATED ───────────────────────────────────────────────
 *
 * ConnectWave carries the opening balance per ITEM but not per GODOWN, and 57 of those 126 items
 * open with stock. So where the opening physically sat on 1-Apr has to be reasoned out:
 *
 *   1. Any godown whose running balance goes NEGATIVE during the year must have held opening —
 *      you cannot issue what was never there. That deficit is a hard floor and is placed first.
 *   2. Whatever opening is left over is spread the way the lot balances sit, which is the only
 *      physical evidence of where stock rests.
 *   3. The result is scaled so the item's godowns add up to Tally's closing EXACTLY. Every item
 *      ties Tally; only the split between its godowns carries the estimate.
 *
 * Measured against Tally's Godown Summary for Finished Goods-Sachin (30,935 KGS) this reads
 * 32,890, about 6% high. It is not exact and cannot be until ConnectWave carries a godown-wise
 * opening balance — with that one field this becomes arithmetic rather than inference.
 *
 * ─── TWO TRAPS, BOTH FOUND THE HARD WAY ──────────────────────────────────────────────────
 *
 * PURCHASE ORDERS ARE NOT STOCK. The mirror flags order lines as affecting stock, and they carry
 * no godown because no goods moved. Counting them put 19,314 KGS of finished goods into a godown
 * called "(none)" and threw every share out. A real stock line always names a godown, so lines
 * without one are dropped.
 *
 * EVERY PAGED READ MUST BE ORDERED. `range()` without `order()` is not a window over a stable
 * list: Postgres may return rows in any order and need not pick the same one twice, so paging an
 * unordered read silently repeats some rows and drops others. It was doing exactly that here —
 * the same 49,082 lines read back as 19,650 distinct rows with 18,941 apparent duplicates, which
 * is what made every earlier godown figure wrong. Read in order, 49,077 of the 49,082 are
 * distinct.
 */
import { useEffect, useState } from "react";
import { getConnectwaveSupabase } from "@hub/lib/connectwaveSupabase";
import { pushDocument } from "./sheetStore";

/** What a godown, or one group inside it, is holding: stock and how many items. */
export interface GodownCell {
  qty: number;
  /** How many items make up that quantity. */
  items: number;
}

/** What the split needs to know about an item to turn movements into stock. */
export interface ItemFacts {
  group: string;
  closing: number;
  opening: number;
  /** Base unit, so a PCS lot is never counted into a KGS item. */
  unit: string;
}

export interface GodownSplit {
  /** item name → godown → STOCK held there. Adds up to the item's Tally closing. */
  byItem: Map<string, Map<string, number>>;
  /** Every godown name seen, for the picker. */
  godowns: string[];
  /** godown → stock and item count. */
  totals: Map<string, GodownCell>;
  /** godown → stock group → stock and item count. What opens under a godown. */
  groupsByGodown: Map<string, Map<string, GodownCell>>;
  /** Items the walk could not place at all; their company figure is used unchanged. */
  unsplit: number;
}

/**
 * A choice is a list of these strings:
 *
 *   "HOJIWALA"                     the whole godown
 *   "HOJIWALA||FINISHED GOODS"     only that stock group within it
 *
 * An item belongs to exactly one stock group, so a group-level tick simply decides which items
 * that godown contributes — no second dimension to carry, and a plain list still describes it.
 */
export const GROUP_SEP = "||";
export const godownGroupKey = (godown: string, group: string) => `${godown}${GROUP_SEP}${group}`;

/**
 * A stock group taken across the WHOLE book, with no godown in it — "||PRINTING INK".
 *
 * This is how three of the four books are narrowed. Their stock effectively sits in one place,
 * so the useful question is which stock groups count, and the answer comes straight from Tally's
 * Stock Summary with nothing inferred. A book picked this way never needs a voucher walk.
 */
export const wholeGroupKey = (group: string) => `${GROUP_SEP}${group}`;
export const isWholeGroupKey = (entry: string) => entry.startsWith(GROUP_SEP);

const PAGE = 1000;
const up = (v: string | null | undefined) => (v ?? "").trim().toUpperCase();

interface MoveRow {
  stock_item: string;
  godown_name: string | null;
  movement: string | null;
  qty: number | null;
  affects_stock: boolean | null;
}

interface LotRow {
  stock_item: string;
  last_godown: string | null;
  balance: number | null;
  uom: string | null;
}

/** How current this book's mirror is. */
export interface GodownFreshness {
  /** When ConnectWave last rebuilt these movement rows. */
  builtAt: string | null;
  /** The newest voucher date it holds, as Tally writes it: yyyymmdd. */
  lastVoucher: string | null;
}

/**
 * The age of the data behind a book.
 *
 * Nothing here is read live from Tally — ConnectWave copies Tally on a schedule and this reads
 * that copy, so the honest question is always "as of when?". Two cheap one-row reads answer it:
 * the newest build stamp, and the newest voucher date that build contains.
 */
export async function loadGodownFreshness(companyGuid: string): Promise<GodownFreshness> {
  const cw = getConnectwaveSupabase();
  const tenant = `acct_orange::${companyGuid}`;
  const one = (column: string) =>
    cw
      .from("rpt_batch_line")
      .select(column)
      .eq("company_guid", companyGuid)
      .eq("tenant_id", tenant)
      .order(column, { ascending: false })
      .limit(1)
      .maybeSingle();
  const [built, vch] = await Promise.all([one("built_at"), one("vch_date")]);
  return {
    builtAt: (built.data as { built_at?: string } | null)?.built_at ?? null,
    lastVoucher: (vch.data as { vch_date?: string } | null)?.vch_date ?? null,
  };
}

/** Tally's yyyymmdd as a date a person reads. */
export const fmtTallyDate = (d: string | null | undefined): string => {
  if (!d || d.length !== 8) return "—";
  const dt = new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T00:00:00`);
  return Number.isNaN(dt.getTime())
    ? "—"
    : dt.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};

export async function loadGodownSplit(
  companyGuid: string,
  /** item name → its group, Tally opening and closing, and base unit. */
  facts: Map<string, ItemFacts> = new Map(),
): Promise<GodownSplit> {
  const cw = getConnectwaveSupabase();
  const tenant = `acct_orange::${companyGuid}`;

  // ── the year's movements, in date order so a running balance means something
  const moves: MoveRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await cw
      .from("rpt_batch_line")
      .select("stock_item,godown_name,movement,qty,affects_stock")
      .eq("company_guid", companyGuid)
      .eq("tenant_id", tenant)
      .order("vch_date", { ascending: true })
      .order("voucher_guid", { ascending: true })
      .order("line_no", { ascending: true })
      .range(offset, offset + PAGE - 1)
      .returns<MoveRow[]>();
    if (error) throw new Error(error.message);
    const page = data ?? [];
    moves.push(...page);
    if (page.length < PAGE) break;
  }

  /** item → godown → net movement, and the lowest that running balance ever reached. */
  const net = new Map<string, Map<string, number>>();
  const low = new Map<string, Map<string, number>>();
  const godowns = new Set<string>();
  for (const r of moves) {
    if (r.affects_stock === false) continue;
    const godown = up(r.godown_name);
    if (!godown) continue; // an order, not a movement — no goods, no godown
    let qty = Number(r.qty) || 0;
    if (r.movement === "out") qty = -qty;

    const n = net.get(r.stock_item) ?? new Map<string, number>();
    const running = (n.get(godown) ?? 0) + qty;
    n.set(godown, running);
    net.set(r.stock_item, n);

    const l = low.get(r.stock_item) ?? new Map<string, number>();
    if (running < (l.get(godown) ?? 0)) l.set(godown, running);
    low.set(r.stock_item, l);

    godowns.add(godown);
  }

  // ── where stock physically rests, for spreading whatever opening the deficits do not explain
  const lots: LotRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await cw
      .from("rpt_lot_balance")
      .select("stock_item,last_godown,balance,uom")
      .eq("company_guid", companyGuid)
      .order("stock_item", { ascending: true })
      .order("batch_name", { ascending: true })
      .order("last_godown", { ascending: true })
      .range(offset, offset + PAGE - 1)
      .returns<LotRow[]>();
    if (error) throw new Error(error.message);
    const page = data ?? [];
    lots.push(...page);
    if (page.length < PAGE) break;
  }

  const lotShape = new Map<string, Map<string, number>>();
  for (const r of lots) {
    const qty = Number(r.balance) || 0;
    if (qty <= 0) continue; // a negative lot is a book error, not a holding
    const unit = facts.get(r.stock_item)?.unit;
    if (unit && up(r.uom) !== unit) continue;
    const godown = up(r.last_godown);
    if (!godown) continue;
    const m = lotShape.get(r.stock_item) ?? new Map<string, number>();
    m.set(godown, (m.get(godown) ?? 0) + qty);
    lotShape.set(r.stock_item, m);
    godowns.add(godown);
  }

  // ── item by item: place the opening, add the movements, tie to Tally
  const byItem = new Map<string, Map<string, number>>();
  let unsplit = 0;
  for (const [item, f] of facts) {
    const closing = f.closing;
    if (!closing) continue;

    const bal = new Map<string, number>(net.get(item) ?? []);
    const opening = f.opening;
    if (opening) {
      // 1. every godown that ran negative must have held at least that much opening
      const need = new Map<string, number>();
      for (const [g, v] of low.get(item) ?? []) if (v < -0.0001) need.set(g, -v);
      const short = [...need.values()].reduce((a, b) => a + b, 0);

      const place = new Map<string, number>();
      const give = (g: string, q: number) => place.set(g, (place.get(g) ?? 0) + q);

      if (short >= opening && short > 0) {
        // not even enough opening to cover the deficits — share it out across them
        for (const [g, v] of need) give(g, (opening * v) / short);
      } else {
        for (const [g, v] of need) give(g, v);
        // 2. the remainder goes where the lots say the stock rests
        const rest = opening - short;
        const shape = lotShape.get(item) ?? new Map<string, number>();
        const total = [...shape.values()].reduce((a, b) => a + b, 0);
        if (total > 0) {
          for (const [g, v] of shape) give(g, (rest * v) / total);
        } else if (need.size) {
          let big = "";
          for (const [g, v] of need) if (!big || v > (need.get(big) ?? 0)) big = g;
          give(big, rest);
        }
        // else: no evidence at all — the remainder is dropped, and the scaling below spreads
        // it over whatever the movements did show.
      }
      for (const [g, q] of place) bal.set(g, (bal.get(g) ?? 0) + q);
    }

    // 3. keep what is positive and scale it to Tally's closing, so the item ties exactly
    const pos = new Map<string, number>();
    let sum = 0;
    for (const [g, v] of bal) {
      if (v > 0.0001) {
        pos.set(g, v);
        sum += v;
      }
    }
    if (sum <= 0) {
      unsplit += 1; // nothing to go on; godownShare passes the company figure through
      continue;
    }
    const scaled = new Map<string, number>();
    for (const [g, v] of pos) scaled.set(g, (v * closing) / sum);
    byItem.set(item, scaled);
  }

  // ── roll up for the picker
  const totals = new Map<string, GodownCell>();
  const groupsByGodown = new Map<string, Map<string, GodownCell>>();
  const add = (cells: Map<string, GodownCell>, key: string, qty: number) => {
    const cur = cells.get(key) ?? { qty: 0, items: 0 };
    cur.qty += qty;
    cur.items += 1;
    cells.set(key, cur);
  };
  for (const [item, m] of byItem) {
    const group = facts.get(item)?.group || "(NO GROUP)";
    for (const [godown, qty] of m) {
      add(totals, godown, qty);
      const cells = groupsByGodown.get(godown) ?? new Map<string, GodownCell>();
      add(cells, group, qty);
      groupsByGodown.set(godown, cells);
    }
  }

  return { byItem, godowns: [...godowns].sort(), totals, groupsByGodown, unsplit };
}

/**
 * The share of an item's stock that sits in the chosen godowns.
 *
 * Returns 1 when nothing is known about the item, so its company figure passes through whole
 * rather than being silently zeroed.
 */
export function godownShare(
  split: GodownSplit | undefined,
  item: string,
  chosen: string[],
  /** The item's own stock group, for the group-level ticks. */
  itemGroup = "",
): number {
  if (!chosen.length) return 1;

  // Group-only picks: the whole book filtered by stock group. Nothing is estimated here — the
  // item is either in a ticked group or it is not, so the answer is 1 or 0. It must NOT fall
  // through to the "no evidence, pass the whole figure" rule below, which would quietly let an
  // unticked group back in.
  const groupPicks = chosen.filter(isWholeGroupKey);
  if (groupPicks.length) {
    return itemGroup && groupPicks.includes(wholeGroupKey(itemGroup)) ? 1 : 0;
  }

  if (!split) return 1;
  const m = split.byItem.get(item);
  if (!m || !m.size) return 1;
  const groupKey = itemGroup ? godownGroupKey("", itemGroup) : "";
  let total = 0;
  let picked = 0;
  for (const [g, qty] of m) {
    total += qty;
    // The whole godown, or this item's group within it.
    if (chosen.includes(g) || (groupKey && chosen.includes(g + groupKey))) picked += qty;
  }
  if (total <= 0) return 1;
  return picked / total;
}

/** One line of Tally's Stock Summary: a top-level stock group. */
export interface GroupLine {
  group: string;
  /** Closing quantity, only meaningful when every item in the group shares a unit. */
  qty: number;
  /** That shared unit, or "" when the group mixes units — as Tally leaves it blank. */
  unit: string;
  value: number;
  items: number;
}

/**
 * The book's stock by top-level group, which is what Tally's Stock Summary screen shows.
 *
 * Straight out of `rpt_stock_summary_item`, so the values ARE Tally's: checked against the
 * Stock Summary for Otec Noida, Printing Ink 75,48,719.39, Paper Roll 49,140.00 and Software
 * 30,000.00 all tie to the paisa.
 *
 * `primary_group` is the TOP-level group, which is what that screen means. `stock_group` holds
 * the leaf and would match almost nothing.
 */
export async function loadGroupSummary(companyGuid: string): Promise<GroupLine[]> {
  const cw = getConnectwaveSupabase();
  const rows: {
    primary_group: string | null; base_unit: string | null;
    closing_qty: number | null; closing_value: number | null;
  }[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await cw
      .from("rpt_stock_summary_item")
      .select("primary_group,base_unit,closing_qty,closing_value")
      .eq("company_guid", companyGuid)
      .eq("tenant_id", `acct_orange::${companyGuid}`)
      .order("item", { ascending: true })
      .range(offset, offset + PAGE - 1)
      .returns<typeof rows>();
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  const acc = new Map<string, { qty: number; value: number; items: number; units: Set<string> }>();
  for (const r of rows) {
    const group = up(r.primary_group) || "(UNGROUPED)";
    const cur = acc.get(group) ?? { qty: 0, value: 0, items: 0, units: new Set<string>() };
    const qty = Number(r.closing_qty) || 0;
    cur.qty += qty;
    cur.value += Number(r.closing_value) || 0;
    cur.items += 1;
    if (qty) cur.units.add(up(r.base_unit));
    acc.set(group, cur);
  }

  return [...acc.entries()]
    .map(([group, v]) => ({
      group,
      qty: v.qty,
      unit: v.units.size === 1 ? [...v.units][0] : "",
      value: v.value,
      items: v.items,
    }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || a.group.localeCompare(b.group));
}

/** True when the walk placed the item, so a filtered figure means something. */
export const hasGodownEvidence = (split: GodownSplit | undefined, item: string): boolean =>
  Boolean(split?.byItem.get(item)?.size);

/* ------------------------------------------------------------------ the planner's choice */

const KEY = "ink-mis:godowns:v1";
/** Raised when the choice is SAVED, so a screen already open follows it without a reload. */
const CHANGED = "ink-mis:godowns-changed";

/** Chosen godowns per company key. An empty or missing list means the whole company. */
export type GodownChoice = Record<string, string[]>;

/**
 * Drop picks that no longer mean anything for a book.
 *
 * A book that was being narrowed by godown before it moved to stock groups still has its old
 * godown picks sitting in this browser. They are dead weight — `godownShare` ignores them the
 * moment a group pick exists — but they were still being LISTED, so the dashboard banner read
 * "Otec Surat: (NO GODOWN) > PRINTING INK, GODOWN 42A,42B,43A,43B > PRINTING INK, ..." and looked
 * as though nothing had been updated.
 *
 * The rule needs no knowledge of which book is which: if a book has any whole-book group pick,
 * that is how it is being narrowed now, and its godown picks are history. A book with only godown
 * picks is left exactly as it is.
 */
const cleanChoice = (v: GodownChoice): GodownChoice => {
  const out: GodownChoice = {};
  for (const [book, list] of Object.entries(v)) {
    if (!Array.isArray(list)) continue;
    const groups = list.filter(isWholeGroupKey);
    const kept = [...new Set(groups.length ? groups : list)].filter(Boolean);
    if (kept.length) out[book] = kept;
  }
  return out;
};

export const loadGodownChoice = (): GodownChoice => {
  try {
    const raw = window.localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as GodownChoice) : {};
    if (!v || typeof v !== "object") return {};
    const clean = cleanChoice(v);
    // Write the tidied version back so this happens once, not on every read. Deliberately NOT
    // through saveGodownChoice: that raises CHANGED, which is what called this in the first
    // place, and the two would chase each other.
    if (JSON.stringify(clean) !== JSON.stringify(v)) {
      try {
        window.localStorage.setItem(KEY, JSON.stringify(clean));
      } catch {
        /* private mode: the tidy-up just happens again next time */
      }
    }
    return clean;
  } catch {
    return {};
  }
};

export const saveGodownChoice = (c: GodownChoice) => {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* private mode: the choice still applies for this visit */
  }
  // Shared like the rest of the sheet, so every machine narrows the books the same way.
  pushDocument(KEY, c);
  window.dispatchEvent(new Event(CHANGED));
};

/**
 * The choice as one comparable string, so "changed since it was saved?" does not depend on the
 * order things were ticked in. An empty list means the whole book, so it is left out of the
 * signature entirely — untick everything and you are back where you started.
 */
export const godownChoiceSig = (c: GodownChoice): string =>
  Object.keys(c)
    .filter((k) => (c[k] ?? []).length)
    .sort()
    .map((k) => `${k}=${[...(c[k] ?? [])].sort().join(",")}`)
    .join(";");

/**
 * The SAVED choice, for the screens that only read it.
 *
 * Reading it once at mount was enough while each screen was its own route, but it left the link
 * between screens resting on a remount nobody promised. It now follows the save itself: CHANGED
 * for this tab, `storage` for another tab of the same browser. A fresh object with the same
 * contents hashes to the same react-query key, so this cannot set off a refetch by itself.
 */
export function useGodownChoice(): GodownChoice {
  const [choice, setChoice] = useState<GodownChoice>(() => loadGodownChoice());
  useEffect(() => {
    const sync = () => setChoice(loadGodownChoice());
    window.addEventListener(CHANGED, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGED, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return choice;
}
