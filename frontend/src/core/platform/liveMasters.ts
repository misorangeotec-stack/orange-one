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
   * Ink / Spare Parts / Heads / Machine / Others — OURS, not Tally's.
   *
   * Same five keys the Outstanding Dashboard splits revenue by (`SaleType`), so
   * "what we sell" and "what we are owed for" can be lined up later without a
   * translation table. Seeded by `mst_guess_item_type()` from the item name and
   * its Tally group; NULL means nothing in either name gave a signal, which is
   * NOT the same as "other".
   */
  itemType: ItemType | null;
}

export type ItemType = "ink" | "spare_parts" | "head" | "machine" | "other";

/** The five buckets, in the order the business names them. */
export const ITEM_TYPES: { value: ItemType; label: string }[] = [
  { value: "ink", label: "Ink" },
  { value: "spare_parts", label: "Spare Parts" },
  { value: "head", label: "Heads" },
  { value: "machine", label: "Machine" },
  { value: "other", label: "Others" },
];

export const itemTypeLabel = (t: ItemType | null | undefined): string =>
  ITEM_TYPES.find((x) => x.value === t)?.label ?? "";

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

export interface MasterLocation extends MasterRowBase {
  companyId: string;
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
}

export async function fetchMasterPartyItems(): Promise<MasterPartyItem[]> {
  // ⚠ The embedded selects page with the parent, which is why this goes through
  //   fetchAllRows. A plain nested select silently stops at the API row limit.
  const rows = await fetchAllRows<Record<string, any>>(
    "mst_party_items",
    "id,active,sort_order,source,last_sold_on,sale_count," +
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
    "id,name,code,tally_guid,tally_synced_at,source,company_id,group_id,unit_id,hsn_code,item_type,modules,active,sort_order",
  );
  return byName(rows.map((r) => ({
    ...base(r),
    code: r.code ?? null,
    companyId: r.company_id ?? null,
    groupId: r.group_id ?? null,
    unitId: r.unit_id ?? null,
    hsnCode: r.hsn_code ?? null,
    itemType: (r.item_type ?? null) as ItemType | null,
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
  const rows = await fetchAllRows<Record<string, any>>(
    "mst_locations",
    "id,name,company_id,modules,active,sort_order",
  );
  return byName(rows.map((r) => ({
    ...base(r),
    source: "portal" as const,
    tallyGuid: null,
    tallySyncedAt: null,
    companyId: r.company_id,
  })));
}

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
