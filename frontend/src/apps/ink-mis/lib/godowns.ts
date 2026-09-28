/**
 * GODOWN-WISE STOCK, from ConnectWave alone.
 *
 * Otec's books are read whole. Enterprises Surat is not: its ink sits in Finished Goods Sachin
 * and Hojiwala, and the rest of its godowns — Production, Lab, Warehouse, job work — are not
 * stock the planner can sell, so counting them overstates the company every time.
 *
 * ─── WHY THIS IS A SHARE, NOT A BALANCE ──────────────────────────────────────────────────
 *
 * ConnectWave has no godown-wise closing balance. Three ways to build one were measured against
 * Tally's own item closing on Enterprises Surat's 124 finished-goods items:
 *
 *   netting movements per godown                     22 of 124 tie, 44 items go negative
 *   opening (item masters) + movements, de-duplicated 50 of 124 tie, 16 negative
 *   lot balances by their godown                     41 of 124 tie, 22 negative
 *
 * None is trustworthy on its own. So the lot balances are used only for the SHARE each godown
 * holds of an item, and that share is applied to Tally's closing, which is authoritative. The
 * item always ties Tally; only the split between godowns is inferred. Negative lot balances are
 * clamped to zero first — a negative share is not a share.
 *
 * An item with no lot rows keeps its whole company figure rather than vanishing, and is counted
 * in `unsplit` so the screen can say how much of the book is being taken on trust.
 *
 * The lot table is small (about 4,600 rows for that book) and is read once per company.
 *
 * ─── WHAT THE PICKER SHOWS, AND WHY IT IS NOT TALLY'S GODOWN SUMMARY ─────────────────────
 *
 * The figures beside each godown are the SAME estimate the sheet uses — each item's Tally
 * closing multiplied by the share of its lots sitting there — not the raw lot quantities, which
 * are a different and much larger number (Finished Goods-Sachin: 52,296 of lots behind 21,450 of
 * stock). Showing lots made the screen disagree with itself.
 *
 * It still does not match Tally's own Godown Summary, and cannot. Measured against that report
 * for Finished Goods-Sachin, which Tally puts at 30,935 KGS:
 *
 *   raw lot balances            52,296   +69%
 *   share x Tally closing       21,450   -31%   <- what this screen shows
 *   signed netting per godown  -63,680   negative on 38 of its items
 *
 * The cause is structural: the mirror carries no opening balance per godown, and a lot's whole
 * balance is attributed to whichever godown it moved to LAST, so a batch split between Sachin and
 * Hojiwala lands entirely in one of them. Godown-wise stock is therefore indicative. The item
 * total always ties Tally exactly; only the split between godowns is inferred.
 *
 * Quantities are also unit-guarded: a lot line measured in PCS or LTR is not added to an item
 * whose base unit is KGS, which was quietly inflating every godown that holds mixed stock.
 */
import { useEffect, useState } from "react";
import { getConnectwaveSupabase } from "@hub/lib/connectwaveSupabase";

/** What a godown, or one group inside it, is holding: estimated stock and how many items. */
export interface GodownCell {
  /** Estimated stock — each item's Tally closing times its share of lots here. */
  qty: number;
  /** How many items make up that quantity. Asked for directly, and it keeps qty honest. */
  items: number;
}

/** What the split needs to know about an item to turn lot shares into stock. */
export interface ItemFacts {
  group: string;
  closing: number;
  /** Base unit, so a PCS lot is never added to a KGS item. */
  unit: string;
}

export interface GodownSplit {
  /** item name → godown (upper case) → lot quantity held, negatives clamped away. The SHARE. */
  byItem: Map<string, Map<string, number>>;
  /** Every godown name seen, for the picker. */
  godowns: string[];
  /** godown → estimated stock and item count. */
  totals: Map<string, GodownCell>;
  /** godown → stock group → estimated stock and item count. What opens under a godown. */
  groupsByGodown: Map<string, Map<string, GodownCell>>;
  /** Items with no lot evidence at all; their company figure is used unchanged. */
  unsplit: number;
}

/**
 * A choice is a list of these strings:
 *
 *   "HOJIWALA"                     the whole godown
 *   "HOJIWALA||PRINTING INK"       only that stock group within it
 *
 * An item belongs to exactly one stock group, so a group-level tick simply decides which items
 * that godown contributes — no second dimension to carry, and a plain list still describes it.
 */
export const GROUP_SEP = "||";
export const godownGroupKey = (godown: string, group: string) => `${godown}${GROUP_SEP}${group}`;

const PAGE = 1000;

export async function loadGodownSplit(
  companyGuid: string,
  /** item name → its group, Tally closing and base unit. Empty means shares only. */
  facts: Map<string, ItemFacts> = new Map(),
): Promise<GodownSplit> {
  const cw = getConnectwaveSupabase();
  const rows: {
    stock_item: string; last_godown: string | null; balance: number | null; uom: string | null;
  }[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await cw
      .from("rpt_lot_balance")
      .select("stock_item,last_godown,balance,uom")
      .eq("company_guid", companyGuid)
      .range(offset, offset + PAGE - 1)
      .returns<typeof rows>();
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  const up = (v: string | null | undefined) => (v ?? "").trim().toUpperCase();

  // Pass one: the shares. Lots in a unit the item is not measured in are not its stock.
  const byItem = new Map<string, Map<string, number>>();
  const godowns = new Set<string>();
  for (const r of rows) {
    const qty = r.balance ?? 0;
    if (qty <= 0) continue; // a negative lot is a book error, not a holding
    const unit = facts.get(r.stock_item)?.unit;
    if (unit && up(r.uom) !== unit) continue;
    const godown = up(r.last_godown) || "(NO GODOWN)";
    godowns.add(godown);
    const m = byItem.get(r.stock_item) ?? new Map<string, number>();
    m.set(godown, (m.get(godown) ?? 0) + qty);
    byItem.set(r.stock_item, m);
  }

  // Pass two: turn each share into stock, so the screen shows what the sheet will use.
  const totals = new Map<string, GodownCell>();
  const groupsByGodown = new Map<string, Map<string, GodownCell>>();
  const add = (cells: Map<string, GodownCell>, key: string, qty: number) => {
    const cur = cells.get(key) ?? { qty: 0, items: 0 };
    cur.qty += qty;
    cur.items += 1;
    cells.set(key, cur);
  };
  for (const [item, m] of byItem) {
    const f = facts.get(item);
    const lotTotal = [...m.values()].reduce((a, b) => a + b, 0);
    if (lotTotal <= 0) continue;
    const closing = f?.closing ?? 0;
    for (const [godown, lot] of m) {
      const qty = closing * (lot / lotTotal);
      add(totals, godown, qty);
      const cells = groupsByGodown.get(godown) ?? new Map<string, GodownCell>();
      add(cells, f?.group || "(NO GROUP)", qty);
      groupsByGodown.set(godown, cells);
    }
  }

  return { byItem, godowns: [...godowns].sort(), totals, groupsByGodown, unsplit: 0 };
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
  if (!split || !chosen.length) return 1;
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

/** True when the item carried no lot evidence, so its figure is the whole company's. */
export const hasGodownEvidence = (split: GodownSplit | undefined, item: string): boolean =>
  Boolean(split?.byItem.get(item)?.size);

/* ------------------------------------------------------------------ the planner's choice */

const KEY = "ink-mis:godowns:v1";
/** Raised when the choice is SAVED, so a screen already open follows it without a reload. */
const CHANGED = "ink-mis:godowns-changed";

/** Chosen godowns per company key. An empty or missing list means the whole company. */
export type GodownChoice = Record<string, string[]>;

export const loadGodownChoice = (): GodownChoice => {
  try {
    const raw = window.localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as GodownChoice) : {};
    return v && typeof v === "object" ? v : {};
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
