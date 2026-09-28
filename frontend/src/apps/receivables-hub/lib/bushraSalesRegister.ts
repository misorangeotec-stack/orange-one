/**
 * Bushra Sales Register — Reports → Bushra-Report.
 *
 * The Tally Sales Register (lib/salesRegister.ts) read the same way, from the same
 * `rpt_sales_register` snapshot, plus five columns Tally does not have — the groundwork for the
 * Sales Dashboard:
 *
 *   Sales-Type   first of: the tag in PARTICULARS → Central Masters item Type → the voucher's
 *                sale_type_rule (see resolveSalesType below)
 *   Ink Type     Central Masters → Items → Ink type    (mst_items.ink_type) — ONLY on an Ink line
 *   Group        Central Masters → Items → Group       (mst_items.group_id → mst_item_groups.name)
 *   Category     Central Masters → Items → Category    (mst_items.category)
 *   Colour       Bushra Central Master's own Colour for the item if one is set there, else the
 *                colour word in the item description, via Batch Costing's colourOf()
 *
 * ─── HOW A REGISTER LINE FINDS ITS ITEM ─────────────────────────────────────────────────────────
 *
 * PARTICULARS is the Tally stock item name, and Tally files the same item separately in every
 * company book, so mst_items holds one row per (company, name). Type, Category and Ink type belong
 * to the PRODUCT and are the same on every copy (mst_apply_item_sheet loads them by name); Group is
 * the company's own stock group. So we look for the item in the line's own company first
 * (tenant_id → company GUID → mst_companies.tally_guid) and fall back to any company's copy.
 *
 * Names are matched with runs of whitespace collapsed — the same key mst_apply_item_sheet uses —
 * then case-insensitively as a last resort. Nothing fuzzier: an unmatched line shows blank, which
 * is honest, rather than borrowing another product's type.
 *
 * Central Masters lives in the identity project and is readable by any signed-in user; the
 * register itself stays on ConnectWave.
 */
import { SCOPE_ALL, type PartyScope } from "@hub/lib/scopeParties";
import { supabase } from "@/core/platform/supabase";
import { itemTypeLabel, type ItemType } from "@/core/platform/liveMasters";
import { loadSalesRegister, type RegisterRow } from "./salesRegister";
import { companyGuidOf, fetchCompanyMap, makeCompanyResolver } from "./companyMap";
import { SALES_REGISTER_COLOURS, colourOf } from "./batchCostingRules";
import { loadSaleTypeRuleset, type SaleType, type SaleTypeResolver } from "@/apps/daily-report/lib/saleType";

export type SalesTypeSource = "Particulars" | "Central Masters" | "Voucher Type" | "";

export interface BushraRegisterRow extends RegisterRow {
  /** 'Ink', 'Spare Parts', 'Machine', … — "" when no source could type the line. */
  sales_type: string;
  /** Which rule gave `sales_type` — shown on hover, so a wrong type can be traced. */
  sales_type_source: SalesTypeSource;
  /** 'KY REACTIVE INK', 'ANTELOS', … — only when sales_type is Ink. */
  ink_type: string;
  item_group: string;
  item_category: string;
  /** 'BLACK', 'CYAN', … — "" when the item description names no colour. */
  colour: string;
  /** The item's unit in Central Masters ('KGS', 'PCS', 'NOS', 'MTR'…) — "" when unknown. */
  unit: string;
  /** False when no Central Masters item carries this name. */
  in_masters: boolean;
}

/* --------------------------------------------------------- central masters */

interface MasterItemInfo {
  companyGuid: string;
  itemType: ItemType | null;
  inkType: string | null;
  category: string | null;
  group: string | null;
  unit: string | null;
  /** Set ONLY by a Bushra Central Master override; otherwise the colour is read off the description. */
  colour: string | null;
}

/**
 * BUSHRA CENTRAL MASTER — the corrections laid over Central Masters.
 *
 * `bushra_central_master_overrides` (migration 20261212120000) holds one shared row per
 * item somebody has corrected on the Bushra Central Master screen, its `fields` object
 * carrying ONLY what differs from `mst_items`. This report reads central first and lays
 * those on top, so a Category filled in there stops being "(Not set)" here — on every
 * dashboard, in the report, in the Excel export and in the scheduled mail, for everyone.
 *
 * The app's own reader is apps/bushra-central-master/lib/overridesDb.ts. This is a
 * second, much smaller reader rather than an import of that one, on purpose: this side
 * only ever READS, it needs four of the eight keys, and receivables-hub must not take a
 * dependency on another app's store to draw a dashboard.
 *
 * ⚠ ABSENT AND NULL ARE DIFFERENT. A key that is not in the row means "this field
 *   still follows Central Masters"; a key present and null means "cleared on purpose".
 *   `?? central` would collapse the two and quietly undo every deliberate blanking, so
 *   the test is `in`, never a nullish fallback.
 *
 * Only the fields this report reads are taken. `description` is not one of them — the
 * register's Particulars is Tally's own item name, which is what the line was billed
 * as, and no master may rewrite that.
 */
interface ItemOverride {
  itemType?: ItemType | null;
  category?: string | null;
  inkType?: string | null;
  groupName?: string | null;
  color?: string | null;
}

/** Central's value unless the override names that field — including naming it as blank. */
const laidOver = <T,>(o: ItemOverride | undefined, key: keyof ItemOverride, central: T): T =>
  (o && key in o ? (o[key] as unknown as T) : central);

/** PostgREST for "there is no such table": the old relation error, and the schema-cache miss. */
const NO_SUCH_TABLE = (e: { code?: string; message?: string }) =>
  e.code === "42P01" || e.code === "PGRST205" || /does not exist|schema cache/i.test(e.message ?? "");

const db = supabase as any;
const PAGE = 1000;

/**
 * Every row of a Central Masters table, read in PARALLEL pages.
 *
 * `mst_items` alone is ~14k rows = 15 pages, and walking them one after another cost ~7 s before a
 * single sales row could be asked for — the dashboard's register query is gated on this lookup
 * (`enabled: !!lookup`), so every one of those round trips is dead time on first paint. Ask for the
 * count with the first page, then fetch the rest together.
 *
 * `order("id")` is the PRIMARY KEY on all four tables, so OFFSET paging is stable — see the note on
 * fetchAllPages in lib/salesRegister.ts for why a non-unique sort here would be a bug.
 */
const MASTERS_CONCURRENCY = 6;

async function pageAll<T>(table: string, columns: string): Promise<T[]> {
  const q = () => db.from(table).select(columns, { count: "exact" }).order("id", { ascending: true });
  const first = await q().range(0, PAGE - 1);
  if (first.error) throw new Error(`${table}: ${first.error.message}`);
  const head = (first.data ?? []) as T[];
  const total: number | null = typeof first.count === "number" ? first.count : null;
  if (head.length < PAGE) return head;

  // No count header (an older PostgREST, or a view that cannot count): fall back to the sequential
  // walk, which is slower but always correct.
  if (total === null) {
    const out = [...head];
    for (let from = PAGE; ; from += PAGE) {
      const { data, error } = await q().range(from, from + PAGE - 1);
      if (error) throw new Error(`${table}: ${error.message}`);
      const rows = (data ?? []) as T[];
      out.push(...rows);
      if (rows.length < PAGE) return out;
    }
  }

  const offsets: number[] = [];
  for (let from = PAGE; from < total; from += PAGE) offsets.push(from);
  const pages = new Array<T[]>(offsets.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(MASTERS_CONCURRENCY, offsets.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= offsets.length) return;
        const { data, error } = await q().range(offsets[i], offsets[i] + PAGE - 1);
        if (error) throw new Error(`${table}: ${error.message}`);
        pages[i] = (data ?? []) as T[];
      }
    }),
  );
  return head.concat(...pages);
}

const wsKey = (s: string) => s.replace(/\s+/g, " ").trim();

/* ------------------------------------------------------ merging near-duplicates */

/**
 * The item sheet was typed by hand, so one product family is often spelled two ways — 'S3200' and
 * 'SUBLIMATION S3200', 'X- SERIES', '300DPI - KJ4B', 'Raw Materials'. The report shows ONE name for
 * each, in two passes:
 *
 *  1. SAME LETTERS → SAME VALUE. Case, spaces and punctuation are ignored ('X- SERIES' = 'X-SERIES');
 *     the spelling carried by the most items is the one shown.
 *  2. SAME THING, DIFFERENT WORDS → the named merges below, which no rule could safely guess.
 *
 * Central Masters itself is not changed — this is how the report reads it.
 */
const MERGES: Record<"inkType" | "category" | "group", Record<string, string>> = {
  inkType: {
    "S3200": "SUBLIMATION S3200",
    "AMTHYST EVO": "AMETHYST EVO",
    "SUBLIMATION FLOTEC": "FLOTEC SUBLIMATION",
    "SUBLIMATION UNCOATED": "EP SUBLIMATION UNCOATED",
    "X- SERIES": "X-SERIES",
  },
  category: {
    "MACHINERY & MACHINERY PARTS": "MACHINERY PARTS",
    "PACKING MATERIAL STOCK": "PACKING MATERIAL",
    "RAW MATERIALS": "RAW MATERIAL",
    "300DPI - KJ4B": "300 DPI - KJ4B",
    // Cells cut short in the sheet.
    "600 DPI - KJ4B (U": "600 DPI - KJ4B",
    "KYOCERA 300 DPI - HANGLORY (DAMAGE": "KYOCERA 300 DPI - HANGLORY (DAMAGE)",
  },
  group: {
    "RAW MATERIALS": "RAW MATERIAL",
  },
};

/** Case, whitespace and punctuation stripped — two spellings with the same key are the same value. */
const letterKey = (s: string) => s.toUpperCase().replace(/[^A-Z0-9&]+/g, "");

type Canon = (v: string | null) => string | null;

/** Build pass 1 + pass 2 for one field from every spelling found, weighted by how many items use it. */
function makeCanon(field: keyof typeof MERGES, values: (string | null)[]): Canon {
  const merges = new Map(Object.entries(MERGES[field]).map(([from, to]) => [letterKey(from), to]));
  // Everything is shown in capitals, the way the sheet mostly writes it.
  const tidy = (raw: string) => merges.get(letterKey(raw)) ?? wsKey(raw).toUpperCase();
  // Count spellings per key, AFTER the named merges, so a merged value joins its target's tally.
  const counts = new Map<string, Map<string, number>>();
  for (const raw of values) {
    if (!raw?.trim()) continue;
    const v = tidy(raw);
    const k = letterKey(v);
    const byKey = counts.get(k) ?? new Map<string, number>();
    byKey.set(v, (byKey.get(v) ?? 0) + 1);
    counts.set(k, byKey);
  }
  const best = new Map<string, string>();
  for (const [k, spellings] of counts) {
    // The spelling most items use.
    const [top] = [...spellings].sort((a, b) => b[1] - a[1]);
    best.set(k, top[0]);
  }
  return (raw) => {
    if (!raw?.trim()) return null;
    const v = tidy(raw);
    return best.get(letterKey(v)) ?? v;
  };
}

export interface ItemLookup {
  exact: Map<string, MasterItemInfo[]>;
  folded: Map<string, MasterItemInfo[]>;
}

/** Every Central Masters item, keyed by name. ~14k rows over 15 pages; cached by the page. */
const OVERRIDES_TABLE = "bushra_central_master_overrides";

/**
 * The overrides, or none — and NEVER an error that takes the report down with it.
 *
 * Code reaches an environment before a migration does, and it has here: 20261212120000
 * is written but not yet applied to live. Every figure on these dashboards was correct
 * before the Bushra Central Master existed and is still correct without it — the
 * overrides sharpen the classification, they are not load-bearing. So a missing table
 * means "no corrections yet", exactly as an empty one does.
 *
 * Only that one failure is swallowed. A permission refusal or a network fault still
 * throws, because those mean the corrections EXIST and are not reaching the figures —
 * and a dashboard quietly dropping somebody's work is the failure worth being loud about.
 */
async function loadItemOverrides(): Promise<Map<string, ItemOverride>> {
  const out = new Map<string, ItemOverride>();
  // Paged like every other master read here: a bulk Excel import can correct thousands
  // of items at once, and PostgREST would hand back only the first 1,000 of them.
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(OVERRIDES_TABLE)
      .select("item_id,fields").order("item_id", { ascending: true }).range(from, from + PAGE - 1);
    if (error) {
      if (from === 0 && NO_SUCH_TABLE(error)) return out;
      throw new Error(`${OVERRIDES_TABLE}: ${error.message}`);
    }
    const rows = (data ?? []) as { item_id: string; fields: ItemOverride | null }[];
    for (const r of rows) out.set(r.item_id, r.fields ?? {});
    if (rows.length < PAGE) return out;
  }
}

export async function loadItemLookup(): Promise<ItemLookup> {
  const [items, groups, companies, units, overrideOf] = await Promise.all([
    pageAll<{ id: string; name: string; company_id: string | null; group_id: string | null; unit_id: string | null; item_type: ItemType | null; category: string | null; ink_type: string | null }>(
      "mst_items", "id,name,company_id,group_id,unit_id,item_type,category,ink_type"),
    pageAll<{ id: string; name: string }>("mst_item_groups", "id,name"),
    pageAll<{ id: string; tally_guid: string | null }>("mst_companies", "id,tally_guid"),
    pageAll<{ id: string; name: string }>("mst_units", "id,name"),
    loadItemOverrides(),
  ]);
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const unitName = new Map(units.map((u) => [u.id, u.name]));
  const companyGuid = new Map(companies.map((c) => [c.id, c.tally_guid ?? ""]));

  const groupOf = (id: string | null) => (id && groupName.get(id)) || null;

  /**
   * Central laid under Bushra's corrections, resolved ONCE per item and before
   * anything else reads it — so the near-duplicate merge below votes on the values
   * the report will actually show. Canonicalising central first and the override
   * afterwards would let a corrected "S3200" escape the merge that folds it into
   * "SUBLIMATION S3200".
   */
  const settled = items.map((i) => {
    const o = overrideOf.get(i.id);
    return {
      name: i.name,
      companyGuid: (i.company_id && companyGuid.get(i.company_id)) || "",
      itemType: laidOver<ItemType | null>(o, "itemType", i.item_type),
      inkType: laidOver<string | null>(o, "inkType", i.ink_type),
      category: laidOver<string | null>(o, "category", i.category),
      group: laidOver<string | null>(o, "groupName", groupOf(i.group_id)),
      unit: (i.unit_id && unitName.get(i.unit_id)) || null,
      colour: laidOver<string | null>(o, "color", null),
    };
  });

  const canonInk = makeCanon("inkType", settled.map((i) => i.inkType));
  const canonCategory = makeCanon("category", settled.map((i) => i.category));
  const canonGroup = makeCanon("group", settled.map((i) => i.group));

  const exact = new Map<string, MasterItemInfo[]>();
  const folded = new Map<string, MasterItemInfo[]>();
  const push = (m: Map<string, MasterItemInfo[]>, k: string, v: MasterItemInfo) => {
    const list = m.get(k);
    if (list) list.push(v); else m.set(k, [v]);
  };
  for (const i of settled) {
    const info: MasterItemInfo = {
      companyGuid: i.companyGuid,
      itemType: i.itemType,
      inkType: canonInk(i.inkType),
      category: canonCategory(i.category),
      group: canonGroup(i.group),
      unit: i.unit,
      colour: i.colour ? i.colour.trim().toUpperCase() : null,
    };
    const k = wsKey(i.name);
    push(exact, k, info);
    push(folded, k.toUpperCase(), info);
  }
  return { exact, folded };
}

/** The line's own company's copy if there is one, else the first copy that carries the field. */
function pick(copies: MasterItemInfo[], guid: string, field: keyof MasterItemInfo): string | null {
  const own = copies.find((c) => c.companyGuid === guid && c[field]);
  const any = own ?? copies.find((c) => c[field]);
  return (any?.[field] as string | null | undefined) ?? null;
}

/* ------------------------------------------------------------------- type */

/**
 * TYPE, as Bushra reads it. Anything sent out on a DELIVERY voucher is not a sale:
 *
 *   voucher type mentions SALES ON APPROVAL   → SOA (already so — and only still-pending SOA lines
 *                                               reach this report, see loadPendingSoaKeys)
 *   any other voucher type starting DELIVERY  → FOC: SALE → FOC SALE, RELATED SALE → Related FOC,
 *                                               BRANCH SALE → Branch FOC
 *
 * rpt_sales_register_rebuild already does this for "DELIVERY CHALLAN …" vouchers, but "DELIVERY - INK",
 * "DELIVERY - SPARE PARTS" and "DELIVERY - HEAD" arrive typed as SALE / RELATED SALE. Corrected here
 * rather than in the live rebuild, so the Tally report is untouched.
 */
const APPROVAL = /SALES\s+ON\s+APPROVAL/i;
const FOC_OF: Record<string, string> = {
  "SALE": "FOC SALE",
  "RELATED SALE": "Related FOC",
  "BRANCH SALE": "Branch FOC",
};

function bushraType(r: RegisterRow): string {
  if (!/^\s*DELIVERY\b/i.test(r.voucher_type) || APPROVAL.test(r.voucher_type)) return r.type;
  return FOC_OF[r.type.trim().toUpperCase()] ?? r.type;
}

/* ---------------------------------------------------------------- company */

/**
 * COMPANY, as Bushra reads it — the book's owner plus what kind of sale it is, and NO location
 * (Location is already the first column):
 *
 *   TYPE starts with Branch      ORANGE O TEC BRANCH  · ORANGE ENT BRANCH  · COLORIX BRANCH
 *   TYPE contains Related        ORANGE O TEC RELATED · ORANGE ENT RELATED · COLORIX RELATED
 *   anything else (pure sales)   ORANGE O TEC         · ORANGE ENTERPRISE  · COLORIX
 *
 * Built from the book (ext_company_map's company, already resolved on the row as `company` for a
 * non-inter-company line) rather than copied from `company_label`, which is matched off the PARTY
 * name. On FY 2025-26 onward the two agree on every line; a book nobody has mapped yet falls back
 * to `company_label`.
 */
const BOOK_NAME: Record<string, { pure: string; short: string }> = {
  "O-TEC": { pure: "ORANGE O TEC", short: "ORANGE O TEC" },
  ENTERPRISE: { pure: "ORANGE ENTERPRISE", short: "ORANGE ENT" },
  COLORIX: { pure: "COLORIX", short: "COLORIX" },
};

function bushraCompany(r: RegisterRow, bookCompany: string): string {
  const book = BOOK_NAME[bookCompany.trim().toUpperCase()];
  if (!book) return r.company_label;
  if (/^branch\b/i.test(r.type)) return `${book.short} BRANCH`;
  if (/\brelated\b/i.test(r.type)) return `${book.short} RELATED`;
  return book.pure;
}

/* ------------------------------------------------------------- sales-type */

/**
 * 1 — THE TAG IN PARTICULARS. Discount, rate-difference and credit/debit-note lines name the product
 * line they adjust: "DISCOUNT & RATE DIFFERENCE@18% (INK)", "RATE DIFFERENCE (INCOME) 18%-SPARE".
 * When a line says so itself, that answer always wins.
 *
 * Only a TAG counts — a bracketed word, or a trailing "-WORD" — never the word loose inside a name:
 * "X3-053 INK PUMP" is a spare part, not ink, and "INK PUMP" carries no tag.
 */
const PARTICULARS_TAG = /(?:\(\s*(INK|SPARES?|HEADS?|MACHINES?|PAPER)\s*\)|-\s*(INK|SPARES?|HEADS?|MACHINES?|PAPER)\s*$)/i;
const TAG_LABEL: Record<string, string> = {
  INK: "Ink", SPARE: "Spare Parts", HEAD: "Heads", MACHINE: "Machine", PAPER: "Paper",
};

function salesTypeFromParticulars(particulars: string): string {
  const m = PARTICULARS_TAG.exec(particulars);
  const word = (m?.[1] ?? m?.[2] ?? "").toUpperCase().replace(/S$/, "");
  return TAG_LABEL[word] ?? "";
}

/** 3 — the voucher's sale_type_rule bucket, spelled the way Central Masters spells its types. */
const RULE_LABEL: Record<SaleType, string> = {
  ink: "Ink",
  spare_parts: "Spare Parts",
  head: "Heads",
  machine: "Machine",
  paper: "Paper",
  non_product: "Service & Other Income",
  other: "", // the rule table's fall-through — no match, so no answer
};

export function classifyRegisterRow(
  r: RegisterRow,
  lookup: ItemLookup,
  voucherRule: SaleTypeResolver,
  bookCompany: string,
): BushraRegisterRow {
  const k = wsKey(r.particulars);
  const copies = lookup.exact.get(k) ?? lookup.folded.get(k.toUpperCase()) ?? [];
  const guid = companyGuidOf(r.tenant_id);
  const itemType = pick(copies, guid, "itemType") as ItemType | null;

  // Particulars → Central Masters → voucher type. First non-blank answer wins.
  let sales_type = salesTypeFromParticulars(r.particulars);
  let sales_type_source: SalesTypeSource = sales_type ? "Particulars" : "";
  if (!sales_type && itemType) {
    sales_type = itemTypeLabel(itemType);
    sales_type_source = sales_type ? "Central Masters" : "";
  }
  if (!sales_type) {
    sales_type = RULE_LABEL[voucherRule(r.voucher_type, r.voucher_no)];
    sales_type_source = sales_type ? "Voucher Type" : "";
  }

  const type = bushraType(r);
  const company = bushraCompany({ ...r, type }, bookCompany);
  return {
    ...r,
    type,
    company,
    company_display: company,
    sales_type,
    sales_type_source,
    ink_type: itemType === "ink" && sales_type === "Ink" ? pick(copies, guid, "inkType") ?? "" : "",
    item_group: pick(copies, guid, "group") ?? "",
    item_category: pick(copies, guid, "category") ?? "",
    // A colour typed on the Bushra Central Master wins: it is somebody's correction of
    // exactly this reading. Otherwise the shade is taken out of the item's own name,
    // which is where every colour came from before that screen existed.
    colour: pick(copies, guid, "colour") ?? colourOf(r.particulars, SALES_REGISTER_COLOURS),
    unit: pick(copies, guid, "unit") ?? "",
    in_masters: copies.length > 0,
  };
}

export async function loadBushraSalesRegister(
  from: string,
  to: string,
  scope: PartyScope = SCOPE_ALL,
  lookup?: ItemLookup,
): Promise<BushraRegisterRow[]> {
  const [rows, items, ruleset, mapRows] = await Promise.all([
    loadSalesRegister(from, to, scope),
    lookup ? Promise.resolve(lookup) : loadItemLookup(),
    loadSaleTypeRuleset(),
    fetchCompanyMap(),
  ]);
  // The book's owner ('O-tec' | 'Enterprise' | 'Colorix'). Not `row.company`: on a Branch/Related
  // line that already holds the class, not the book.
  const bookOf = makeCompanyResolver(mapRows);
  return rows.map((r) => classifyRegisterRow(r, items, ruleset.resolve, bookOf(r.tenant_id, "").company));
}
