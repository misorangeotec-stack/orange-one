/**
 * Batch Costing — the classification rules, and nothing else.
 *
 * Kept import-free on purpose: every rule the business gave us lives in this one file, so it can
 * be read top to bottom, changed in one place, and exercised from a plain Node script against the
 * real item list without booting the app.
 *
 * ─── WHAT EACH PRODUCTION LINE GETS ─────────────────────────────────────────────────────────────
 *
 *   Type           Output (positive qty in Tally) | Consumption (negative qty).
 *   Category       Output whose name carries "SCRAP" → Scrap; every other Output → Finished Good;
 *                  every Consumption line → RM Consumption (scrap re-used as an input included).
 *   Colour         The colour word in the voucher's FINISHED GOOD name, filled down the whole entry.
 *   Item Group     FG name has SUBLIMATION → Sublimation, REACTIVE → Reactive, else Others.
 *   Item Category  Per the rule table below, cut from the same FG name.
 *
 * Colour / Item Group / Item Category are VOUCHER-level: one entry is one batch, so the consumption
 * and scrap rows of that batch carry the finished good's values. That is what lets a filter on
 * "Reactive · CYAN" return whole batches instead of orphaned output rows.
 *
 * The names are matched on whole words, never substrings: "NHD" contains "HD", and "KY REACTIVE
 * INK NHD BLACK" is not an EP Sublimation HD ink.
 */

export type LineType = "Output" | "Consumption";
export type LineCategory = "Finished Good" | "Scrap" | "RM Consumption";
export type ItemGroup = "Sublimation" | "Reactive" | "Others";

/** Colour words, in the order they are tried. GRAY is normalised to GREY. */
export const COLOURS = [
  "BLACK", "CYAN", "MAGENTA", "YELLOW", "GREY", "GRAY", "PINK", "RED", "ORANGE", "GREEN", "BLUE",
  "VIOLET", "PURPLE", "BROWN", "WHITE",
] as const;

interface CategoryRule {
  /** Tested against the upper-cased FG name. */
  test: RegExp;
  category: string;
}

/**
 * Item Category, per Item Group. FIRST MATCH WINS, so the specific rule sits above the general one
 * ("SUPER HD" before "HD", "KY REACTIVE INK PRO" before "KY REACTIVE").
 *
 * The three Sublimation rules marked ★ are the business's own; the rest extend the same naming to
 * the ranges the business summarised as "so on", and are what the page shows until confirmed.
 * A name that no rule catches falls back to the item's Tally stock group, flagged as such.
 */
export const CATEGORY_RULES: Record<ItemGroup, CategoryRule[]> = {
  Sublimation: [
    { test: /\bSUPER\s+HD\b/, category: "EP SUBLIMATION SUPER HD" }, // ★
    { test: /\bHD\b/, category: "EP SUBLIMATION HD" },               // ★
    { test: /\bEPN\b/, category: "EP SUBLIMATION NORMAL" },          // ★
    { test: /\bS3200\b/, category: "EP SUBLIMATION S3200" },
    { test: /\bK\s+SERIES\b/, category: "EP SUBLIMATION K SERIES" },
    { test: /-G\b/, category: "EP SUBLIMATION -G" },
    { test: /^KY\s+SUBLIMATION\b/, category: "KY SUBLIMATION" },
  ],
  Reactive: [
    { test: /\bX-\s*SERIES\b/, category: "KY REACTIVE X-SERIES" },
    { test: /\bRI\s+G6\b/, category: "RI G6 PRO" },
    { test: /\bNHD\b/, category: "KY REACTIVE NHD" },
    { test: /^KY\s+REACTIVE\s+INK\s+PRO\b/, category: "KY REACTIVE PRO" },
    { test: /\bCONCENTRATE\b/, category: "REACTIVE CONCENTRATE" },
    { test: /^KY\s+REACTIVE\b/, category: "KY REACTIVE" },
    { test: /^KNA\b/, category: "KNA REACTIVE" },
    // FY 2025-26 only — the KN REACTIVE INK … HD range is not produced in FY 2026-27.
    { test: /^KN\s+REACTIVE\b/, category: "KN REACTIVE HD" },
    { test: /\bE-SERIES\b/, category: "REACTIVE E-SERIES" },
    { test: /\bECO\b/, category: "REACTIVE ECO" },
    { test: /\bH[\s-]SERIES\b/, category: "REACTIVE H-SERIES" },
  ],
  // Cleaners, chemicals and the odd raw-material top-up — no naming scheme, so Tally's own
  // stock group (CHEMICALS, Raw Materials, …) is the category.
  Others: [],
};

const up = (s: string | null | undefined) => (s ?? "").toUpperCase();

export function lineType(movement: string): LineType {
  return movement === "in" ? "Output" : "Consumption";
}

/** A scrap item, on either side of the voucher — produced as Output, or re-used as Consumption. */
export const isScrapItem = (item: string): boolean => /SCRAP/.test(up(item));

export function lineCategory(type: LineType, item: string): LineCategory {
  if (type === "Consumption") return "RM Consumption";
  return isScrapItem(item) ? "Scrap" : "Finished Good";
}

/** The colour word in a name — the one that appears FIRST, so "BLACK ULTRA" is BLACK. "" if none. */
export function colourOf(item: string): string {
  const name = up(item);
  let best = "";
  let at = Infinity;
  for (const c of COLOURS) {
    const m = new RegExp(`\\b${c}\\b`).exec(name);
    if (m && m.index < at) { at = m.index; best = c; }
  }
  return best === "GRAY" ? "GREY" : best;
}

export function itemGroupOf(item: string): ItemGroup {
  const name = up(item);
  if (/\bSUBLIMATION\b/.test(name)) return "Sublimation";
  if (/\bREACTIVE\b/.test(name)) return "Reactive";
  return "Others";
}

export interface CategoryResult {
  category: string;
  /** True when no rule matched and the Tally stock group stood in. */
  fromTallyGroup: boolean;
}

export function itemCategoryOf(item: string, group: ItemGroup, tallyGroup: string | null): CategoryResult {
  const name = up(item);
  for (const r of CATEGORY_RULES[group]) {
    if (r.test.test(name)) return { category: r.category, fromTallyGroup: false };
  }
  return { category: up(tallyGroup), fromTallyGroup: true };
}
