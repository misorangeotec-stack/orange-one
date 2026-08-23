import { supabase } from "@/core/platform/supabase";
const db = supabase as any;

/**
 * The CENTRAL masters OCPI reads — customers, companies, locations.
 *
 * ⚠ A SEPARATE QUERY KEY FROM THE MODULE'S OWN DATA, ON PURPOSE. These tables
 *   are large (7,863 parties), shared with every other module, and change only
 *   when the 15-minute Tally sync runs. Folding them into the module snapshot
 *   would re-download them every time somebody saved a draft. Same split
 *   order-to-dispatch makes with DISPATCH_MASTERS_QK.
 *
 * ⚠ OCPI KEEPS NO CUSTOMER TABLE OF ITS OWN, and must not grow one.
 *   fms_dispatch_customers is the cautionary tale: a customer saved into it was
 *   invisible everywhere, and that module now renders an explainer page where
 *   its master screen used to be.
 *
 * ⚠ WHAT TALLY ACTUALLY GIVES YOU — checked against the live database, because
 *   the column list is misleading. Of 7,863 parties: `address`, `email` and
 *   `phone` are empty on EVERY row, and `gstin` is set on 1,218. So picking a
 *   customer fills in a NAME, and a GSTIN about a quarter of the time. The rest
 *   is typed once and then remembered — see fms_ocpi_last_contact_for.
 */

const PAGE = 1000;

export interface OcpiParty {
  id: string;
  name: string;
  /** Empty on ~76% of rows. When present it seeds the GSTIN field and its lookup. */
  gstin: string | null;
  /** Present on 1,878 of 1,888 customers — this is what resolves the selling entity. */
  companyId: string | null;
  /**
   * Empty on every row today. Read anyway: the columns exist, the Tally sync may
   * one day fill them, and a form that ignores a filled column is worse than one
   * that finds it blank.
   */
  address: string | null;
  email: string | null;
  phone: string | null;
  contactName: string | null;
}

export interface NamedRow {
  id: string;
  name: string;
}

export interface OcpiMasters {
  parties: OcpiParty[];
  companies: NamedRow[];
  locations: NamedRow[];
}

export const OCPI_MASTERS_QK = ["ocpiMasters"] as const;

async function page(table: string, cols: string, build?: (q: any) => any): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = db.from(table).select(cols).order("name", { ascending: true }).range(from, from + PAGE - 1);
    if (build) q = build(q);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export async function fetchOcpiMasters(): Promise<OcpiMasters> {
  const [parties, companies, locations] = await Promise.all([
    page(
      "mst_parties",
      "id,name,gstin,company_id,address,email,phone,contact_name",
      // Customers only. A vendor has no business appearing in a sales quotation.
      (q) => q.eq("is_customer", true).eq("active", true),
    ),
    page("mst_companies", "id,name", (q) => q.eq("active", true)),
    page("mst_locations", "id,name", (q) => q.eq("active", true)),
  ]);

  return {
    parties: parties.map((r) => ({
      id: r.id,
      name: r.name,
      gstin: r.gstin ?? null,
      companyId: r.company_id ?? null,
      address: r.address ?? null,
      email: r.email ?? null,
      phone: r.phone ?? null,
      contactName: r.contact_name ?? null,
    })),
    companies: companies.map((r) => ({ id: r.id, name: r.name })),
    locations: locations.map((r) => ({ id: r.id, name: r.name })),
  };
}

/**
 * The contact details last recorded against this customer on a submitted deal.
 *
 * Tally holds none of these, so this is how a repeat customer stops being
 * retyped. Returns null when the party has never been quoted before, or when the
 * only prior deals are drafts (which the RPC excludes as unreliable).
 */
export interface LastContact {
  customerAddress: string | null;
  customerAttn: string | null;
  customerEmail: string | null;
  customerMobile: string | null;
  gstNo: string | null;
}

export async function fetchLastContactFor(customerId: string): Promise<LastContact | null> {
  const { data, error } = await db.rpc("fms_ocpi_last_contact_for", { p_customer: customerId });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    customerAddress: row.customer_address ?? null,
    customerAttn: row.customer_attn ?? null,
    customerEmail: row.customer_email ?? null,
    customerMobile: row.customer_mobile ?? null,
    gstNo: row.gst_no ?? null,
  };
}
