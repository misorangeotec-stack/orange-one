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
 *   Colour       the colour word in the item description, via Batch Costing's colourOf()
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
import { colourOf } from "./batchCostingRules";
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
}

const db = supabase as any;
const PAGE = 1000;

async function pageAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(table).select(columns).order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
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
export async function loadItemLookup(): Promise<ItemLookup> {
  const [items, groups, companies] = await Promise.all([
    pageAll<{ name: string; company_id: string | null; group_id: string | null; item_type: ItemType | null; category: string | null; ink_type: string | null }>(
      "mst_items", "id,name,company_id,group_id,item_type,category,ink_type"),
    pageAll<{ id: string; name: string }>("mst_item_groups", "id,name"),
    pageAll<{ id: string; tally_guid: string | null }>("mst_companies", "id,tally_guid"),
  ]);
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const companyGuid = new Map(companies.map((c) => [c.id, c.tally_guid ?? ""]));

  const groupOf = (id: string | null) => (id && groupName.get(id)) || null;
  const canonInk = makeCanon("inkType", items.map((i) => i.ink_type));
  const canonCategory = makeCanon("category", items.map((i) => i.category));
  const canonGroup = makeCanon("group", items.map((i) => groupOf(i.group_id)));

  const exact = new Map<string, MasterItemInfo[]>();
  const folded = new Map<string, MasterItemInfo[]>();
  const push = (m: Map<string, MasterItemInfo[]>, k: string, v: MasterItemInfo) => {
    const list = m.get(k);
    if (list) list.push(v); else m.set(k, [v]);
  };
  for (const i of items) {
    const info: MasterItemInfo = {
      companyGuid: (i.company_id && companyGuid.get(i.company_id)) || "",
      itemType: i.item_type,
      inkType: canonInk(i.ink_type),
      category: canonCategory(i.category),
      group: canonGroup(groupOf(i.group_id)),
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
    colour: colourOf(r.particulars),
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
