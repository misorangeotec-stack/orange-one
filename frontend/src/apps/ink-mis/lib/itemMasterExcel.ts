/**
 * INK IMS — item master to and from Excel.
 *
 * Numbering hundreds of lines one box at a time is not a real way to work, so the planner
 * exports the item master, fills the Order / Item code / Group / Description columns in Excel,
 * and imports it back.
 *
 * ─── THE ROW IDENTITY IS BOOK + ITEM IN TALLY ────────────────────────────────────────────
 *
 * Those two columns are how an imported row finds its item, so they must not be edited. Every
 * other column is either read-only context (Closing, Tally code) or the planner's to change.
 * A row whose Book + Item in Tally matches nothing is COUNTED AND REPORTED, never guessed at —
 * a renamed item in Tally is a different item, and fuzzy-matching it would put a code on the
 * wrong ink.
 *
 * ─── A VALUE EQUAL TO TALLY'S IS NOT AN OVERRIDE ─────────────────────────────────────────
 *
 * The export writes what the report USES, Tally's value where nothing is overridden. Imported
 * straight back, that must not turn every Tally value into a frozen override that would then
 * hide later corrections made in Tally. So a cell equal to Tally's own value clears the
 * override, and only a genuine difference is stored. A blank cell also clears it.
 *
 * ─── ORDER BELONGS TO THE PRINTED LINE ───────────────────────────────────────────────────
 *
 * Positions are keyed on the dashboard line, and several books' rows can feed one line. If an
 * import gives those rows different numbers, the SMALLEST wins, so the line sits at the earliest
 * place the planner put any of its parts. The count of such clashes is reported.
 */
import * as XLSX from "xlsx-js-style";
import { saveAs } from "file-saver";
import { parseXlsxRows } from "@/shared/lib/importXlsx";
import {
  EMPTY_PLAN, INK_CATEGORIES, INK_COMPANIES, INK_SOURCES, masterKey, sourceLabel,
  type InkMasterRow, type InkOrder, type InkOverride, type InkOverrides, type InkPlan,
} from "./inkMis";

const SHEET = "Item master";

const COLS = [
  "Book", "Item in Tally", "Unit", "Closing", "Tally code",
  "Order", "Lead time", "Item code", "Group", "Description", "Category", "Import/Plant",
] as const;

/** The columns the planner may change. Everything else is identity or context. */
const EDITABLE = new Set([
  "Order", "Lead time", "Item code", "Group", "Description", "Category", "Import/Plant",
]);

const norm = (v: unknown) => String(v ?? "").trim();
const up = (v: unknown) => norm(v).toUpperCase();

/** Mirror of the report's merge key — the code where one exists, else a per-book key. */
const lineKey = (companyKey: string, item: string, code: string) =>
  code ? code : `~${companyKey}|${up(item)}`;

export function exportItemMaster(
  master: InkMasterRow[],
  order: InkOrder,
  plans: Record<string, InkPlan> = {},
): void {
  const header = [...COLS];
  const body = master.map((r) => [
    r.company,
    r.item,
    r.baseUnit,
    r.closingQty,
    r.tallyCode,
    order[r.mergeKey] ?? "",
    plans[r.mergeKey]?.leadTime || "",
    r.effectiveCode,
    r.effectiveGroup,
    r.effectiveDescription,
    r.category,
    sourceLabel(r.source),
  ]);
  const ws = XLSX.utils.aoa_to_sheet([header, ...body]);

  // Identity and context columns are shaded grey; the four the planner fills have orange headers
  // and plain cells, so it is obvious at a glance which columns are theirs.
  header.forEach((name, c) => {
    const ref = XLSX.utils.encode_cell({ r: 0, c });
    ws[ref].s = {
      font: { bold: true, color: { rgb: EDITABLE.has(name) ? "000000" : "555555" } },
      fill: { fgColor: { rgb: EDITABLE.has(name) ? "FFE8CC" : "E5E7EB" } },
    };
    for (let r = 1; r <= body.length; r++) {
      if (EDITABLE.has(name)) continue;
      const cell = XLSX.utils.encode_cell({ r, c });
      if (ws[cell]) ws[cell].s = { fill: { fgColor: { rgb: "F3F4F6" } } };
    }
  });
  ws["!cols"] = [18, 46, 7, 12, 18, 8, 10, 22, 26, 46, 18, 14].map((wch) => ({ wch }));
  ws["!freeze"] = { xSplit: 2, ySplit: 1 };
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: body.length, c: COLS.length - 1 } }) };

  const about = XLSX.utils.aoa_to_sheet([
    ["How to use this file"],
    [""],
    ["Fill the orange columns: Order, Lead time, Item code, Group, Description."],
    ["Do not change Book or Item in Tally — they are how each row finds its item on import."],
    ["Order: any number. Lines are shown smallest first. Leave blank for no position."],
    ["Lead time: months of cover to order against. One value per line, shared by every book."],
    ["Item code, Group, Description: leave blank, or equal to Tally's value, to keep Tally's."],
    ["Category: one of REACTIVE, SUBLIMATION, PIGMENT, DISPERSE, OTHERS. Anything else is ignored."],
    ["Import/Plant: one of Import, Domestic or Plant. Anything else is ignored."],
    ["The same code in two books merges them into one line on the dashboard."],
    ["Save as .xlsx and use Import on the Item master screen."],
  ]);
  about["!cols"] = [{ wch: 90 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, SHEET);
  // Named exactly what parseXlsxRows skips, so it is never read back as data.
  XLSX.utils.book_append_sheet(wb, about, "About this export");
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const stamp = new Date().toISOString().slice(0, 10);
  saveAs(new Blob([out], { type: "application/octet-stream" }), `Ink IMS item master ${stamp}.xlsx`);
}

export interface ItemMasterImportResult {
  overrides: InkOverrides;
  order: InkOrder;
  /** Only present when the file carries a Lead time column. */
  plans?: Record<string, InkPlan>;
  rows: number;
  matched: number;
  unmatched: { book: string; item: string }[];
  orderClashes: number;
  badOrders: number;
  /** Import/Plant cells that were not Import, Domestic or Plant. */
  badSources: number;
  /** Category cells that were none of the five categories. */
  badCategories: number;
}

/**
 * Read an exported (and edited) item master back.
 *
 * Pure with respect to storage: it returns the NEW overrides and order, and the caller decides
 * whether to apply them. Nothing is half-applied if the file turns out to be wrong.
 */
export async function importItemMaster(
  file: File,
  master: InkMasterRow[],
  current: { overrides: InkOverrides; order: InkOrder; plans?: Record<string, InkPlan> },
): Promise<ItemMasterImportResult> {
  const raw = await parseXlsxRows(file);
  if (!raw.length) throw new Error("The file has no rows.");
  const first = raw[0];
  for (const need of ["Book", "Item in Tally"]) {
    if (!(need in first)) {
      throw new Error(`Column "${need}" is missing. Import a file exported from this screen.`);
    }
  }

  const bookKey = new Map(INK_COMPANIES.map((c) => [up(c.label), c.key]));
  const byKey = new Map(master.map((r) => [r.key, r]));

  const overrides: InkOverrides = { ...current.overrides };
  // Positions for lines in this file are rebuilt from the file; lines not in it keep theirs.
  const order: InkOrder = { ...current.order };
  const touchedLines = new Set<string>();
  // Lead time is only touched when the file actually has the column: an older export must not
  // wipe lead times just because it predates them.
  const hasLead = "Lead time" in first;
  const plans: Record<string, InkPlan> = { ...(current.plans ?? {}) };
  const unmatched: ItemMasterImportResult["unmatched"] = [];
  let matched = 0;
  let orderClashes = 0;
  let badOrders = 0;
  let badSources = 0;
  let badCategories = 0;

  for (const row of raw) {
    const book = norm(row["Book"]);
    const item = norm(row["Item in Tally"]);
    if (!book && !item) continue;

    const companyKey = bookKey.get(up(book));
    const key = companyKey ? masterKey(companyKey, item) : "";
    const m = key ? byKey.get(key) : undefined;
    if (!companyKey || !m) {
      unmatched.push({ book, item });
      continue;
    }
    matched++;

    // Overrides: store only a real difference from Tally.
    const next: Partial<InkOverride> = {};
    const code = up(row["Item code"]);
    const group = norm(row["Group"]);
    const desc = norm(row["Description"]);
    if (code && code !== up(m.tallyCode)) next.code = code;
    if (group && group !== norm(m.tallyGroup)) next.group = group;
    if (desc && desc !== norm(m.tallyDescription)) next.description = desc;

    // Planner-only fields: no Tally value to compare against, so whatever is in the cell stands.
    const category = up(row["Category"]);
    if (INK_CATEGORIES.includes(category as (typeof INK_CATEGORIES)[number])) next.category = category;
    else if (category) badCategories++;
    const srcCell = up(row["Import/Plant"]);
    const src = INK_SOURCES.find((o) => o.value.toUpperCase() === srcCell || o.label.toUpperCase() === srcCell);
    if (src) next.source = src.value;
    else if (srcCell) badSources++;
    if (Object.keys(next).length) overrides[key] = next;
    else delete overrides[key];

    // Order: keyed on the line this row will feed AFTER its code is applied.
    const line = lineKey(companyKey, item, code || up(m.tallyCode));
    if (!touchedLines.has(line)) {
      delete order[line];
      touchedLines.add(line);
    }
    if (hasLead) {
      const lead = norm(row["Lead time"]);
      const n = Number(lead);
      const cur = plans[line] ?? EMPTY_PLAN;
      plans[line] = { ...cur, leadTime: lead === "" || !Number.isFinite(n) ? 0 : n };
    }

    const cell = norm(row["Order"]);
    if (!cell) continue;
    const n = Number(cell);
    if (!Number.isFinite(n)) {
      badOrders++;
      continue;
    }
    if (order[line] !== undefined && order[line] !== n) {
      orderClashes++;
      order[line] = Math.min(order[line], n);
    } else {
      order[line] = n;
    }
  }

  return {
    overrides,
    order,
    ...(hasLead ? { plans } : {}),
    rows: raw.length,
    matched,
    unmatched,
    orderClashes,
    badOrders,
    badSources,
    badCategories,
  };
}
