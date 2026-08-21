import { supabase } from "./supabase";

/**
 * CENTRAL MASTERS — the read model.
 *
 * One master list per concept, shared by every module and fed from Tally. This
 * file is the read half; masterWrites.ts is the write half. Same split, and the
 * same shape, as liveDirectory.ts / directoryWrites.ts.
 *
 * ⚠ THESE TABLES ARE NOT SMALL, AND THAT CHANGES THE LOADING RULE.
 *   The directory is 57 profiles and loads in one go. The masters are ~7,800
 *   parties and ~14,200 items — every ledger and stock item in Tally. Loading
 *   all of it on every admin page view would be several megabytes for a screen
 *   that shows 25 rows.
 *
 *   So each master type is fetched SEPARATELY and LAZILY, one React Query key
 *   each, and the Masters page only asks for the tab you are looking at. The
 *   small types (companies, units, groups, locations) are cheap; parties and
 *   items are the ones this matters for.
 *
 * ⚠ EVERY READ PAGES. PostgREST caps a response at 1000 rows and does it
 *   SILENTLY — a plain .select() on mst_items returns exactly 1000 rows and no
 *   error, which looks like a working screen with most of the catalogue missing.
 *   Same reason dispatchFetch.ts pages.
 *
 * `modules` is the allow-list that keeps a module's pickers usable: a row synced
 * from Tally arrives belonging to no module and appears in nobody's dropdown
 * until an admin ticks it here. Module screens read
 * `.contains("modules", [appId])`; this admin screen reads everything.
 *
 * The mst_* tables are not in the generated Database types, so table calls route
 * through an untyped alias — the standing FMS convention (see dispatchFetch.ts).
 */
const db = supabase as any;

const PAGE = 1000;

export type MasterSource = "portal" | "tally";

/** Every central master row shares this shape — it is also MasterCrud's contract. */
export interface MasterRowBase {
  id: string;
  name: string;
  active: boolean;
  sortOrder: number;
  modules: string[];
  source: MasterSource;
  tallyGuid: string | null;
  tallySyncedAt: string | null;
}

export interface MasterCompany extends MasterRowBase {
  /**
   * THE SHORT NAME EVERY FMS SHOWS ("O-tec"). Portal-owned.
   *
   * `name` is Tally's real company name, financial year and all
   * ("ORANGE O TEC PRIVATE LIMITED (01-04-25TO31-03-27)") and the sync rewrites
   * it — including each April when the new FY book opens. The alias is the
   * stable label, so that rollover changes nothing a user sees. Render `alias`,
   * never `name`, outside the Masters screen.
   */
  alias: string | null;
  location: string | null;
  tallyName: string | null;
  gstin: string | null;
  address: string | null;
  gatePassPrefix: string | null;
}

/** What a company is called anywhere outside the Masters screen. */
export const companyDisplayName = (c: Pick<MasterCompany, "alias" | "name" | "location">): string => {
  const label = c.alias?.trim() || c.name;
  return c.location ? `${label} — ${c.location}` : label;
};

export interface MasterParty extends MasterRowBase {
  code: string | null;
  isCustomer: boolean;
  isVendor: boolean;
  gstin: string | null;
  subGroup: string | null;
  groupChain: string[];
  creditLimit: number | null;
  creditPeriod: string | null;
  companyId: string | null;
  location: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
}

export interface MasterItem extends MasterRowBase {
  code: string | null;
  /**
   * Which of our companies this item belongs to.
   *
   * Items are managed per company — Colorix, Enterprise and O-tec carry
   * different catalogues — so the same stock item under three companies is three
   * rows, exactly as it is three ledgers for a party. Derived from the Tally
   * tenant, so it is Tally's and the sync refreshes it.
   */
  companyId: string | null;
  groupId: string | null;
  unitId: string | null;
  hsnCode: string | null;
  /**
   * What the item IS — OURS, not Tally's.
   *
   * Typed by hand in the Inventory Mapping sheet and loaded by
   * `supabase/itemsheet/load-item-sheet.mjs`; before that it was a regex guess
   * off the item name, and 2,536 of those guesses turned out wrong. NULL means
   * the sheet does not name this item AND nothing gave a signal, which is NOT
   * the same as "other".
   */
  itemType: ItemType | null;
  /**
   * A middle layer between the type and Tally's stock group — MACHINERY PARTS,
   * PAPER ROLL, REACTIVE INK, K24. 96 values.
   *
   * ⚠ NOT the stock group, however much it reads like one: only 858 of 13k
   *   rows agree with their own group, and just 40 of the 96 names are group
   *   names at all. Do not "simplify" this by reading `groupId` instead.
   */
  category: string | null;
  /** The ink product family — ANTELOS, KY REACTIVE INK, RI G6 PRO. Inks only. */
  inkType: string | null;
}

/**
 * The item's type, in the words of the Inventory Mapping sheet.
 *
 * ⚠ THE FIRST FIVE SPELLINGS ARE A CONTRACT, NOT A STYLE CHOICE. `ink`,
 *   `spare_parts`, `head`, `machine` and `other` are exactly the strings
 *   receivables-hub uses for `SaleType`, so an item and the revenue it earned
 *   can be lined up without a translation table. Renaming one silently breaks
 *   a join nobody has written yet.
 */
export type ItemType =
  | "ink" | "spare_parts" | "head" | "machine" | "other"
  | "paper" | "raw_material" | "packing_material" | "cartage"
  | "software" | "provision_ink" | "other_ink" | "service_expense";

/**
 * The thirteen, in the order the business names them, each carrying the
 * receivables bucket it collapses into.
 *
 * ⚠ `saleType` LIVES HERE AND NOWHERE ELSE. It is the whole reason the
 *   vocabulary could widen past five: a sales order can state PAPER while the
 *   ledger still reports it as `other`. Copying this map into SQL or into a
 *   module would be two answers to one question.
 *
 * ⚠ AND THE LABELS ARE LOAD-BEARING. The Masters Excel round trip matches a
 *   dropdown BY LABEL (shared/lib/masterCrudIo.ts), so renaming "Heads" to
 *   "Head" rejects every sheet exported before the rename. Add freely; do not
 *   rename.
 */
export const ITEM_TYPES: { value: ItemType; label: string; saleType: SaleTypeKey }[] = [
  { value: "ink", label: "Ink", saleType: "ink" },
  { value: "spare_parts", label: "Spare Parts", saleType: "spare_parts" },
  { value: "head", label: "Heads", saleType: "head" },
  { value: "machine", label: "Machine", saleType: "machine" },
  { value: "paper", label: "Paper", saleType: "other" },
  { value: "raw_material", label: "Raw Material", saleType: "other" },
  { value: "packing_material", label: "Packing Material", saleType: "other" },
  { value: "provision_ink", label: "Provision Ink", saleType: "ink" },
  { value: "other_ink", label: "Other Ink", saleType: "ink" },
  { value: "cartage", label: "Cartage", saleType: "other" },
  { value: "software", label: "Software", saleType: "other" },
  { value: "service_expense", label: "Service Expense", saleType: "other" },
  { value: "other", label: "Others", saleType: "other" },
];

/** The five buckets receivables splits revenue by (`SaleType` there). */
export type SaleTypeKey = "ink" | "spare_parts" | "head" | "machine" | "other";

export const itemTypeLabel = (t: ItemType | null | undefined): string =>
  ITEM_TYPES.find((x) => x.value === t)?.label ?? "";

/**
 * The item type as receivables would name it. NULL in, null out — an unclassified
 * item belongs to no bucket, and answering "other" would invent one.
 */
export const itemSaleType = (t: ItemType | null | undefined): SaleTypeKey | null =>
  ITEM_TYPES.find((x) => x.value === t)?.saleType ?? null;

export interface MasterLookup extends MasterRowBase {
  /** mst_item_groups / mst_units carry no module scoping — they are global. */
  _lookup: true;
  /**
   * Set for ITEM GROUPS, null for UNITS — and that asymmetry is deliberate.
   *
   * A stock group is an organising choice a company makes, and 103 group names
   * are used by more than one company, so groups are per-company. A unit is a
   * measure: KGS is KGS everywhere, all 13 of them, and splitting units per
   * company would make five copies of each for no gain.
   */
  companyId: string | null;
}

/**
 * One of OUR sites — the place a consignment leaves from.
 *
 * ⚠ `companyIds`, PLURAL, and it is NOT the table's `company_id` column. A site
 *   is a shed with a gate and several of our companies dispatch from it, so
 *   which ones is its own list (mst_company_locations). The column survives on
 *   the table, nullable and unused, because nothing here is ever dropped — see
 *   migration 20260919120000. New rows leave it null; read `companyIds`.
 */
export interface MasterLocation extends MasterRowBase {
  companyIds: string[];
  /**
   * Splits this site's gate pass series off from the main one: 'N' on Noida
   * turns OTEC-2608-001 into OTEC-N-2608-001. Null means the main series, not
   * "unset" — Surat is deliberately null.
   *
   * ⚠ THE SUFFIX IS ON THE SITE, NOT THE (company, site) PAIR, because the gate
   *   register is a book kept at a place. Both firms dispatching from Noida
   *   share the site and each still gets its own series through its prefix.
   *   Composed server-side in `fms_dispatch_gate_pass_no` (20260928120000);
   *   nothing in the app builds a gate pass number itself.
   */
  gatePassSuffix: string | null;
}

/** Which of our companies dispatch from a site, and which may bill / sell. */
export interface MasterCompanyLink extends MasterRowBase {
  companyId: string;
  /** The site, party or item this link hangs off. */
  targetId: string;
  targetName: string;
}

/**
 * One customer-item line: this party may order this item, because they bought it.
 *
 * A NAMELESS master — the pair IS the record — so `name` is synthesised for the
 * shared CRUD contract and for search. Built by the sync from the sales register,
 * which is why it carries when it was last sold and how many voucher lines back it.
 */
export interface MasterPartyItem extends MasterRowBase {
  partyId: string;
  partyName: string;
  itemId: string;
  itemName: string;
  itemGroupId: string | null;
  companyId: string | null;
  lastSoldOn: string | null;
  saleCount: number;
  /**
   * Carried through from the item — NOT stored on the mapping.
   *
   * The pair does not have a type of its own: an item is ink or a spare part
   * whoever buys it. Reading it off `mst_items` means correcting an item's type
   * once fixes every customer line that points at it, where a copy here would
   * need 5,972 rows rewritten and would drift the moment one was missed.
   */
  itemType: ItemType | null;
  /**
   * WHO MADE THIS PAIR BY HAND — empty when a machine derived it.
   *
   * ⚠ IT IS `created_by`, NOT `source`, AND THAT IS NOT INTERCHANGEABLE.
   *   masters-sync upserts this table on (party_id, item_id) and writes
   *   `source: 'sales_register'` unconditionally, so the first time the customer
   *   actually BUYS the item they were mapped to, a 'portal' mark is overwritten
   *   and the row drops out of any filter built on it. Four rows on the live
   *   table already show it: created_by set, source reading 'sales_register'.
   *
   *   `created_by` is not in that upsert's column list, and the sync runs on the
   *   service key where auth.uid() is null. So the reading is exact:
   *   **blank = a machine derived it, a name = a person mapped it.**
   *
   *   `source` is no use for this on its own anyway — 1,823 of its 1,869
   *   'portal' rows are bulk migration rows nobody chose.
   */
  mappedById: string | null;
  mappedOn: string | null;
}

export async function fetchMasterPartyItems(): Promise<MasterPartyItem[]> {
  // ⚠ The embedded selects page with the parent, which is why this goes through
  //   fetchAllRows. A plain nested select silently stops at the API row limit.
  const rows = await fetchAllRows<Record<string, any>>(
    "mst_party_items",
    "id,active,sort_order,source,last_sold_on,sale_count,created_by,created_at," +
      "party:mst_parties(id,name,company_id),item:mst_items(id,name,group_id,item_type)",
  );
  return rows
    .map((r) => {
      const partyName = r.party?.name ?? "";
      const itemName = r.item?.name ?? "";
      return {
        id: r.id,
        name: `${partyName} — ${itemName}`,
        active: r.active ?? true,
        sortOrder: r.sort_order ?? 0,
        modules: [],
        source: (r.source === "sales_register" ? "tally" : "portal") as MasterSource,
        tallyGuid: null,
        tallySyncedAt: null,
        partyId: r.party?.id ?? "",
        partyName,
        itemId: r.item?.id ?? "",
        itemName,
        itemGroupId: r.item?.group_id ?? null,
        itemType: (r.item?.item_type ?? null) as ItemType | null,
        companyId: r.party?.company_id ?? null,
        lastSoldOn: r.last_sold_on ?? null,
        saleCount: r.sale_count ?? 0,
        mappedById: r.created_by ?? null,
        mappedOn: r.created_at ?? null,
      };
    })
    .sort((a, b) => a.partyName.localeCompare(b.partyName) || a.itemName.localeCompare(b.itemName));
}

export interface MasterSyncRun {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "success" | "error";
  trigger: "schedule" | "manual";
  sourceWatermark: string | null;
  counts: Record<string, number>;
  error: string | null;
}

/**
 * Reads every row of a table, a page at a time.
 *
 * Ordered by id, not by name: a stable, indexed key is what makes range paging
 * correct. Ordering by name over 14,000 rows would both sort in the database on
 * every page and risk rows shifting between pages if two share a name.
 */
async function fetchAllRows<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from(table)
      .select(columns)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

const base = (r: Record<string, any>): MasterRowBase => ({
  id: r.id,
  name: r.name ?? "",
  active: r.active ?? true,
  sortOrder: r.sort_order ?? 0,
  modules: r.modules ?? [],
  source: (r.source ?? "portal") as MasterSource,
  tallyGuid: r.tally_guid ?? null,
  tallySyncedAt: r.tally_synced_at ?? null,
});

const byName = <T extends { name: string }>(rows: T[]): T[] =>
  [...rows].sort((a, b) => a.name.localeCompare(b.name));

export async function fetchMasterCompanies(): Promise<MasterCompany[]> {
  const rows = await fetchAllRows<Record<string, any>>(
    "mst_companies",
    "id,name,alias,location,tally_name,tally_guid,tally_synced_at,source,gstin,address,gate_pass_prefix,modules,active,sort_order",
  );
  return byName(rows.map((r) => ({
    ...base(r),
    alias: r.alias ?? null,
    location: r.location ?? null,
    tallyName: r.tally_name ?? null,
    gstin: r.gstin ?? null,
    address: r.address ?? null,
    gatePassPrefix: r.gate_pass_prefix ?? null,
  })));
}

export async function fetchMasterParties(): Promise<MasterParty[]> {
  const rows = await fetchAllRows<Record<string, any>>(
    "mst_parties",
    "id,name,code,tally_guid,tally_synced_at,source,is_customer,is_vendor,gstin,sub_group,group_chain," +
      "credit_limit,credit_period,company_id,location,contact_name,phone,email,address,modules,active,sort_order",
  );
  return byName(rows.map((r) => ({
    ...base(r),
    code: r.code ?? null,
    isCustomer: r.is_customer ?? false,
    isVendor: r.is_vendor ?? false,
    gstin: r.gstin ?? null,
    subGroup: r.sub_group ?? null,
    groupChain: r.group_chain ?? [],
    creditLimit: r.credit_limit ?? null,
    creditPeriod: r.credit_period ?? null,
    companyId: r.company_id ?? null,
    location: r.location ?? null,
    contactName: r.contact_name ?? null,
    phone: r.phone ?? null,
    email: r.email ?? null,
    address: r.address ?? null,
  })));
}

export async function fetchMasterItems(): Promise<MasterItem[]> {
  const rows = await fetchAllRows<Record<string, any>>(
    "mst_items",
    "id,name,code,tally_guid,tally_synced_at,source,company_id,group_id,unit_id,hsn_code,item_type,category,ink_type,modules,active,sort_order",
  );
  return byName(rows.map((r) => ({
    ...base(r),
    code: r.code ?? null,
    companyId: r.company_id ?? null,
    groupId: r.group_id ?? null,
    unitId: r.unit_id ?? null,
    hsnCode: r.hsn_code ?? null,
    itemType: (r.item_type ?? null) as ItemType | null,
    category: r.category ?? null,
    inkType: r.ink_type ?? null,
  })));
}

/**
 * mst_item_groups and mst_units share one shape and one loader.
 *
 * ⚠ The column list differs by table: mst_units has no company_id, and asking
 *   PostgREST for a column that does not exist is an error, not a null.
 */
export async function fetchMasterLookup(table: "mst_item_groups" | "mst_units"): Promise<MasterLookup[]> {
  const cols = "id,name,source,tally_synced_at,active,sort_order"
    + (table === "mst_item_groups" ? ",company_id" : "");
  const rows = await fetchAllRows<Record<string, any>>(table, cols);
  return byName(rows.map((r) => ({
    ...base(r),
    modules: [],
    tallyGuid: null,
    companyId: r.company_id ?? null,
    _lookup: true as const,
  })));
}

export async function fetchMasterLocations(): Promise<MasterLocation[]> {
  const [rows, links] = await Promise.all([
    fetchAllRows<Record<string, any>>("mst_locations", "id,name,modules,active,sort_order,gate_pass_suffix"),
    fetchAllRows<Record<string, any>>("mst_company_locations", "location_id,company_id,active"),
  ]);
  const byLocation = new Map<string, string[]>();
  for (const l of links) {
    if (l.active === false) continue;
    const arr = byLocation.get(l.location_id);
    if (arr) arr.push(l.company_id);
    else byLocation.set(l.location_id, [l.company_id]);
  }
  return byName(rows.map((r) => ({
    ...base(r),
    source: "portal" as const,
    tallyGuid: null,
    tallySyncedAt: null,
    companyIds: byLocation.get(r.id) ?? [],
    gatePassSuffix: r.gate_pass_suffix ?? null,
  })));
}

/**
 * The company links, as flat rows the shared CRUD can list, sort and filter.
 *
 * ⚠ THESE ARE NOT READABLE OFF TALLY, which is the whole reason they exist.
 *   Tally files a stock item under one company BOOK, and the Phase 1 reconcile
 *   put 209 of Dispatch's 234 items in the O-tec book against 21 in Enterprise —
 *   yet both firms sell the same physical goods. Measured before building this:
 *   filtering a picker on mst_items.company_id would offer 21 items on an
 *   Enterprise order instead of ~230 and invalidate 589 of its 619 existing
 *   order lines. `company_id` says where Tally FILES a row, not who sells it.
 *
 *   So these are ours, seeded from order history, and no sync deletes from them.
 */
async function fetchCompanyLinks(
  table: "mst_party_companies" | "mst_item_companies",
  fk: "party_id" | "item_id",
  target: "party:mst_parties(id,name)" | "item:mst_items(id,name)",
  key: "party" | "item",
): Promise<MasterCompanyLink[]> {
  const rows = await fetchAllRows<Record<string, any>>(
    table,
    `id,company_id,${fk},active,sort_order,source,${target}`,
  );
  return rows
    .map((r) => ({
      id: r.id,
      name: r[key]?.name ?? "",
      active: r.active ?? true,
      sortOrder: r.sort_order ?? 0,
      modules: [] as string[],
      source: (r.source === "portal" ? "portal" : "tally") as MasterSource,
      tallyGuid: null,
      tallySyncedAt: null,
      companyId: r.company_id,
      targetId: r[key]?.id ?? "",
      targetName: r[key]?.name ?? "",
    }))
    .sort((a, b) => a.targetName.localeCompare(b.targetName));
}

export const fetchMasterPartyCompanies = () =>
  fetchCompanyLinks("mst_party_companies", "party_id", "party:mst_parties(id,name)", "party");

export const fetchMasterItemCompanies = () =>
  fetchCompanyLinks("mst_item_companies", "item_id", "item:mst_items(id,name)", "item");

/**
 * The newest sync runs, for the "last synced" line on the Masters page.
 *
 * Deliberately not filtered to successes: a run that ERRORED is exactly what an
 * admin needs to see, and hiding it would make a broken sync look like a quiet one.
 */
export async function fetchMasterSyncRuns(limit = 5): Promise<MasterSyncRun[]> {
  const { data, error } = await db
    .from("mst_sync_runs")
    .select("id,started_at,finished_at,status,trigger,source_watermark,counts,error")
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`mst_sync_runs: ${error.message}`);
  return ((data ?? []) as Record<string, any>[]).map((r) => ({
    id: r.id,
    startedAt: r.started_at,
    finishedAt: r.finished_at ?? null,
    status: r.status,
    trigger: r.trigger,
    sourceWatermark: r.source_watermark ?? null,
    counts: r.counts ?? {},
    error: r.error ?? null,
  }));
}
