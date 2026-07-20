/**
 * companyMap.ts — the single source of truth for "which finance company/location is this
 * Tally book?" in LIVE (ConnectWave) mode.
 *
 * WHY THIS EXISTS
 * The mirror stores each Tally book's raw name — 'ORANGE O TEC PRIVATE LIMITED (01-04-25TO31-03-27)',
 * 'ORANGE O TEC ENTERPRISES PRIVATE LIMITED-NOIDA -FY 26-27' — and carries NO location at all
 * (collection_customer_snapshot.location is '' for every row). The pipeline source, by contrast,
 * serves the finance-facing pair the whole app expects: 'O-tec' / 'Surat'. This module maps one to
 * the other so Live and pipeline render identically.
 *
 * WHY IT IS KEYED ON THE GUID, NOT THE NAME
 * Every raw name embeds the financial year ('FY 26-27', 'from 1-Apr-25', '(01-04-25TO31-03-27)').
 * Tally mints a NEW book with a NEW name every April, so any name-based rule silently drifts once a
 * year — the exact failure this replaces. The company GUID never changes. It previously lived as two
 * divergent substring heuristics (liveOtherPayments.toPipelineCompany and
 * MusterEditor.locationForCompany, the latter guessing location via `name.includes("NOIDA")`).
 *
 * The map is a MUSTER: read live from ConnectWave (small, admin-editable via Settings → Masters) and
 * applied over the snapshot at load, exactly like ext_ledger_tags / ext_ledger_group. So an edit
 * shows up on the next page load — no waiting for the ~15 min collection_refresh rebuild.
 */
import { getConnectwaveSupabase } from "./connectwaveSupabase";

export interface CompanyMapRow {
  company_guid: string;       // stable Tally company GUID (primary key)
  tally_company: string | null; // last-seen raw book name — reference/display only, never a key
  company: string;            // 'Colorix' | 'Enterprise' | 'O-tec'
  location: string;           // 'Surat' | 'Noida'
  checked: boolean;
  match_status: string | null;
  source: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

/** The finance-facing pair for one Tally book. */
export interface CompanyIdentity {
  company: string;
  location: string;
}

/**
 * tenant_id → the company GUID the map is keyed on.
 * tenant_id looks like 'acct_orange::<guid>' or 'acct_orange::<guid>~20250401' (an FY-split book),
 * so we drop the account prefix AND the books-begin suffix — both splits of one company therefore
 * resolve to the SAME map row.
 */
export function companyGuidOf(tenantId: string | null | undefined): string {
  return (tenantId ?? "").split("::")[1]?.split("~")[0] ?? "";
}

export async function fetchCompanyMap(): Promise<CompanyMapRow[]> {
  const cw = getConnectwaveSupabase();
  // Handful of rows (one per Tally book) — no pagination needed, but order for determinism.
  const { data, error } = await cw
    .from("ext_company_map")
    .select("company_guid,tally_company,company,location,checked,match_status,source,updated_at,updated_by")
    .order("company_guid", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as CompanyMapRow[];
}

/**
 * Build a resolver over the map rows.
 *
 * An UNMAPPED book (a company newly added to Tally, before anyone tags it) falls back to the raw
 * name + empty location — i.e. exactly today's behaviour, never worse — and warns ONCE per company.
 * It must never fail silently: collection_refresh also stubs a row for every new book so it surfaces
 * in the master screen as "New".
 */
export function makeCompanyResolver(
  rows: CompanyMapRow[],
): (tenantId: string | null | undefined, rawCompany: string | null | undefined) => CompanyIdentity {
  const byGuid = new Map(rows.map((r) => [r.company_guid, r]));
  const warned = new Set<string>();
  return (tenantId, rawCompany) => {
    const guid = companyGuidOf(tenantId);
    const hit = byGuid.get(guid);
    if (hit) return { company: hit.company, location: hit.location };
    const raw = rawCompany ?? "";
    if (guid && !warned.has(guid)) {
      warned.add(guid);
      console.warn(
        `[companyMap] Tally company "${raw}" (guid ${guid}) is not in ext_company_map — falling back ` +
        `to its raw name with no location. Tag it in Settings → Masters → Companies & Locations.`,
      );
    }
    return { company: raw, location: "" };
  };
}
