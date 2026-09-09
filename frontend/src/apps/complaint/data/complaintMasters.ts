import { supabase } from "@/core/platform/supabase";
import {
  companyDisplayName,
  fetchMasterCompanies,
  fetchMasterLookup,
  fetchMasterParties,
} from "@/core/platform/liveMasters";
const db = supabase as any;

/**
 * The CENTRAL masters the Complaint FMS reads — parties, companies, units, and the
 * items one party actually deals in.
 *
 * ⚠ A SEPARATE QUERY KEY FROM THE MODULE'S OWN DATA, ON PURPOSE. These tables are
 *   large (7,842 parties, 14,267 items), shared with every module, and change only
 *   when the 15-minute Tally sync runs. Folding them into the module snapshot would
 *   re-download them every time somebody recorded a step. Same split
 *   order-to-dispatch and OCPI both make.
 *
 * ⚠ THE COMPLAINT MODULE KEEPS NO PARTY OR ITEM TABLE OF ITS OWN, and must not
 *   grow one. `fms_dispatch_customers` is the cautionary tale: a customer saved
 *   into it was invisible everywhere, and that module now renders an explainer
 *   page where its master screen used to be. This is OD-2's answered half —
 *   "remove them… they come from Tally only".
 *
 * ⚠ DO NOT FILTER ON `modules`. The array reads like the right gate and is not:
 *   Order to Dispatch dropped it deliberately ("THE `modules` TICK NO LONGER
 *   SCOPES THIS APP, and dropping it was the point of the change rather than an
 *   oversight" — dispatchFetch.ts). A ledger Tally already knew about could not be
 *   used until somebody remembered to tick it, and only 540 of 14,264 active items
 *   carry any tick at all. THE COMPANY IS THE FILTER for parties, and the party's
 *   own catalogue is the filter for items.
 *
 * The three whole-table reads go through `core/platform/liveMasters`, which
 * already pages correctly (ordered by `id` — a stable, indexed, unique key, which
 * is what makes range paging safe) and maps the rows. Do not re-roll a pager here.
 */

export interface ComplaintParty {
  id: string;
  name: string;
  /** Which of OUR companies bills this party. NULL means every company — see partiesForCompany. */
  companyId: string | null;
  isCustomer: boolean;
  isVendor: boolean;
}

export interface ComplaintItem {
  id: string;
  name: string;
  /**
   * "Category of Ink" — `mst_items.category`, 96 values, hand-maintained from the
   * Inventory Mapping sheet and filled on 13,220 items.
   *
   * ⚠ NOT the Tally stock group, however much it reads like one: only 858 of 13k
   *   rows agree with their own group, and just 40 of the 96 names are group names
   *   at all. Do not "simplify" this by reading `group_id`.
   */
  category: string | null;
  inkType: string | null;
  companyId: string | null;
}

export interface NamedRow {
  id: string;
  name: string;
}

export interface ComplaintMasters {
  parties: ComplaintParty[];
  companies: NamedRow[];
  units: NamedRow[];
}

export const COMPLAINT_MASTERS_QK = ["complaintMasters"] as const;

export async function fetchComplaintMasters(): Promise<ComplaintMasters> {
  const [parties, companies, units] = await Promise.all([
    fetchMasterParties(),
    fetchMasterCompanies(),
    fetchMasterLookup("mst_units"),
  ]);

  return {
    // BOTH sides in one list. A party may be customer AND vendor — we buy from and
    // sell to some firms — so the arms are narrowed in the UI by
    // `partyFlagOf(complaintType)`, never partitioned here into two lists that
    // would double-count those rows.
    parties: parties
      .filter((p) => p.active && (p.isCustomer || p.isVendor))
      .map((p) => ({
        id: p.id,
        name: p.name,
        companyId: p.companyId,
        isCustomer: p.isCustomer,
        isVendor: p.isVendor,
      })),
    // `companyDisplayName` and not `name`: the name carries the financial year and
    // is re-minted every April, so rendering it raw would date the picker. The
    // alias (plus location, where two books share one) is what the FMS show.
    companies: companies
      .filter((c) => c.active)
      .map((c) => ({ id: c.id, name: companyDisplayName(c) })),
    units: units.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name })),
  };
}

/**
 * The items one party actually deals in, from `mst_party_items`.
 *
 * Fetched PER PARTY under its own key rather than loading all 14,267 items up
 * front — the catalogue is what makes the picker usable, and it is a handful of
 * rows per party. A party with no catalogue rows returns empty; the escape hatch
 * is {@link searchItems}, because an item nobody has been invoiced for yet can
 * still be the one that failed.
 */
export const partyItemsQueryKey = (partyId: string | null) =>
  ["complaintPartyItems", partyId] as const;

export async function fetchPartyItems(partyId: string): Promise<ComplaintItem[]> {
  const { data, error } = await db
    .from("mst_party_items")
    .select("item_id, item:mst_items!inner(id,name,category,ink_type,company_id,active)")
    .eq("party_id", partyId)
    .eq("active", true);
  if (error) throw new Error(`mst_party_items: ${error.message}`);

  const seen = new Set<string>();
  const out: ComplaintItem[] = [];
  for (const row of (data ?? []) as any[]) {
    const it = row.item;
    // The same item can arrive twice where a party holds catalogue rows in more
    // than one book. Dedupe rather than offering it twice.
    if (!it || !it.active || seen.has(it.id)) continue;
    seen.add(it.id);
    out.push({
      id: it.id,
      name: it.name,
      category: it.category ?? null,
      inkType: it.ink_type ?? null,
      companyId: it.company_id ?? null,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Server-side item search — the escape hatch when the failing item is not in the
 * party's catalogue. Capped and debounced by the caller, because `mst_items` is
 * 14,267 rows.
 */
export async function searchItems(term: string, limit = 50): Promise<ComplaintItem[]> {
  const q = term.trim();
  if (q.length < 2) return [];
  const { data, error } = await db
    .from("mst_items")
    .select("id,name,category,ink_type,company_id")
    .eq("active", true)
    .ilike("name", `%${q}%`)
    .order("name", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`mst_items: ${error.message}`);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    name: r.name,
    category: r.category ?? null,
    inkType: r.ink_type ?? null,
    companyId: r.company_id ?? null,
  }));
}

/**
 * The parties one company may raise a complaint against.
 *
 * ⚠ NO COMPANY MEANS EVERY COMPANY, not none. A party nobody has billed yet sits
 *   in no Tally book, and hiding those would make a freshly approved customer
 *   unusable at the exact moment somebody needs to complain about them. (The same
 *   rule, for the same reason, as `customersForCompany` in the Dispatch store.)
 *
 * `includeId` keeps the party already saved on a row selectable even if it has
 * since been deactivated or moved book — an edit screen must never silently drop
 * the value it is editing.
 */
export function partiesForCompany(
  parties: ComplaintParty[],
  companyId: string | null,
  flag: "is_customer" | "is_vendor",
  includeId?: string | null,
): ComplaintParty[] {
  const wanted = (p: ComplaintParty) => (flag === "is_customer" ? p.isCustomer : p.isVendor);
  return parties.filter(
    (p) =>
      p.id === includeId ||
      (wanted(p) && (!companyId || p.companyId === companyId || p.companyId === null)),
  );
}
