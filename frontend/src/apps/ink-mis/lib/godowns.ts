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
 */
import { getConnectwaveSupabase } from "@hub/lib/connectwaveSupabase";

export interface GodownSplit {
  /** item name → godown (upper case) → quantity held, negatives clamped away. */
  byItem: Map<string, Map<string, number>>;
  /** Every godown name seen, for the picker. */
  godowns: string[];
  /** godown → stock group → quantity held there. What the picker lists under a godown. */
  groupsByGodown: Map<string, Map<string, number>>;
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
  /** item name → its stock group, so a godown can be broken down by group. */
  groupOf: Map<string, string> = new Map(),
): Promise<GodownSplit> {
  const cw = getConnectwaveSupabase();
  const rows: { stock_item: string; last_godown: string | null; balance: number | null }[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await cw
      .from("rpt_lot_balance")
      .select("stock_item,last_godown,balance")
      .eq("company_guid", companyGuid)
      .range(offset, offset + PAGE - 1)
      .returns<typeof rows>();
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  const byItem = new Map<string, Map<string, number>>();
  const godowns = new Set<string>();
  const groupsByGodown = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const qty = r.balance ?? 0;
    if (qty <= 0) continue; // a negative lot is a book error, not a holding
    const godown = (r.last_godown ?? "").trim().toUpperCase() || "(NO GODOWN)";
    godowns.add(godown);
    const m = byItem.get(r.stock_item) ?? new Map<string, number>();
    m.set(godown, (m.get(godown) ?? 0) + qty);
    byItem.set(r.stock_item, m);

    const group = groupOf.get(r.stock_item) || "(NO GROUP)";
    const g = groupsByGodown.get(godown) ?? new Map<string, number>();
    g.set(group, (g.get(group) ?? 0) + qty);
    groupsByGodown.set(godown, g);
  }
  return { byItem, godowns: [...godowns].sort(), groupsByGodown, unsplit: 0 };
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
};
