/**
 * customerProfile.ts — the data layer for Reports → Insights → Customer Profile.
 *
 * A rebuild of the Talligence "Insights → Customer Profile" screen
 * (Misc/Talligence-Inputs/Insights - Customer Profile.pdf). Every panel comes from ONE
 * ConnectWave RPC, `rpt_customer_profile`, over the precomputed rpt_customer_profile_year
 * snapshot (see "Orange One Supabase Connect"/db/rpt/rpt_customer_profile.sql). Measured
 * anon PostgREST 200 in 0.41–0.57 s on the largest book, so there is no cache layer.
 *
 * WHAT RECONCILES (Orange O Tec Noida FY2026-27, cut at Talligence's 24-Jul-2026 stamp —
 * full detail in Misc/Talligence-Inputs/customer-profile-reconciliation.md)
 *   roster 89 · New 9 · Existing 80 · Old 0 · Small 84   → all EXACT
 *   Non Active total sales ₹1.1078 Cr                     → their ₹1.11 Cr
 *   both Journey panels, including their exact row order  → EXACT
 *   8 of the 9 Top-20 rows tie to the rupee; 7 of 9 receivables tie exactly
 *
 * THREE DEFINITIONS THAT ARE NOT WHAT THEY LOOK LIKE
 *   1. `New` is a RESIDUAL, not "first ever purchase". Existing = CY sales > 0 AND present in
 *      PY; New = the CY roster minus Existing. That is why three customers with genuine
 *      prior-year invoices sit in New — their current-year net is negative.
 *   2. The size bands DROP net-negative customers rather than netting them (84 = 80 + 4), which
 *      is why five rows print a blank Segment. The lifecycle cards DO net.
 *   3. Average Sales divides by PURE-SALES vouchers only — returns are in the money but not the
 *      count. A customer whose only voucher is a credit note shows ₹0 average and no last
 *      invoice while still carrying its negative sales.
 *
 * ⚠ Bands are applied HERE IN THE BROWSER, from the shares the RPC ships, so "Edit Segments"
 * re-buckets instantly with no rebuild and no refetch.
 *
 * ⚠ We deliberately do NOT reproduce Talligence's Existing "Pending Receivable ₹23.77 Cr":
 * it is 4.6× Noida's entire debtor book (₹5.1650 Cr pending / ₹5.9577 Cr of open bills) and
 * their own table's receivables agree with ours to the rupee. Ours ships Tally-true, footnoted
 * on the page. Same call as Stock Analysis's Bad Stock.
 *
 * The money / FY helpers and `tenantForFy` (the generic rpt_sales_book resolver) are shared
 * with the Sales Report and re-exported so the page has a single import source.
 */
import { supabase } from "@/core/platform/supabase";
import { getConnectwaveSupabase } from "./connectwaveSupabase";
import {
  fmtSales, tickSales, pctChange, fyBounds, priorFy, salesPeriod, salesFyOptions,
  salesCat, tenantForFy, SALES_CURRENT, SALES_PRIOR, SALES_ACCENT,
} from "./salesReport";

export {
  fmtSales, tickSales, pctChange, fyBounds, priorFy, salesFyOptions, salesCat, tenantForFy,
  SALES_CURRENT, SALES_PRIOR, SALES_ACCENT,
};
export const fmtCust = fmtSales;
export const tickCust = tickSales;
export const custPeriod = salesPeriod;
export const custFyOptions = salesFyOptions;
export const CUST_CURRENT = SALES_CURRENT;
export const CUST_PRIOR = SALES_PRIOR;

/** Default inactivity window for the "Non Active Customers for [Days]" control. */
export const DEFAULT_INACTIVE_DAYS = 90;

/** Talligence's own bands: Small 0–30 %, Medium 31–50 %, Large 51 %+ of total sales. */
export const DEFAULT_SEGMENT_CONFIG: SegmentConfig = { small_max_pct: 30, medium_max_pct: 50 };

/**
 * Shown on the page under the Existing Customers card. Ours is the Tally-true figure; theirs
 * exceeds the whole book. Keeping the evidence next to the number, not just in a comment.
 */
export const RECEIVABLE_BASIS =
  "Pending Receivable is each customer's open receivable from the Tally books. Talligence prints " +
  "₹23.77 Cr for Existing Customers, which is 4.6× this company's entire debtor book (₹5.17 Cr " +
  "pending across 77 ledgers); their own customer table agrees with these figures to the rupee, so " +
  "we ship the Tally-true number.";

/* ------------------------------------------------------------------ types */

export type Lifecycle = "new" | "existing" | "nonactive";
export type Segment = "Small" | "Medium" | "Large";

export interface CustomerProfileKpi {
  roster: number;
  new_count: number; new_sales: number; new_recv: number;
  existing_count: number; existing_sales: number; existing_recv: number;
  nonactive_count: number; nonactive_sales: number; nonactive_recv: number;
  old_count: number; old_recv: number;
  cy_positive_total: number;
  py_positive_total: number;
}

export interface CustomerRow {
  cust_key: string;
  name: string;
  guid: string | null;
  salesperson: string | null;
  lifecycle: Lifecycle;
  cy_sales: number;
  py_sales: number;
  invoices: number;
  last_invoice: string | null;
  avg_sales: number;
  cy_share: number;
  py_share: number;
  receivable: number;
  overdue: number;
  days_since: number | null;
}

export interface InactiveRow {
  name: string;
  guid: string | null;
  salesperson: string | null;
  lifecycle: Lifecycle;
  cy_sales: number;
  py_sales: number;
  last_invoice: string | null;
  days_since: number | null;
  receivable: number;
  overdue: number;
}

export interface CustomerProfileMeta {
  tenant: string;
  company_guid: string;
  fy: string;
  prior_fy: string;
  as_on: string | null;
  /** The date the current-year aggregate is actually AS AT (the rebuild clamps the FY to today). */
  as_at: string | null;
  inactive_days: number;
  book_from: string | null;
  book_fys: number;
  /** "Old" can only ever be non-zero on a book with three or more years in it. */
  old_supported: boolean;
  py_present: boolean;
  built_at: string | null;
  recv_built_at: string | null;
  guid_missing: number;
}

export interface CustomerProfileData {
  kpi: CustomerProfileKpi;
  customers: CustomerRow[];
  inactive: InactiveRow[];
  meta: CustomerProfileMeta;
}

export interface SegmentConfig {
  small_max_pct: number;
  medium_max_pct: number;
}

/* ------------------------------------------------------------------ reads */

export async function loadCustomerProfile(
  companyGuid: string,
  fy: string,
  inactiveDays: number = DEFAULT_INACTIVE_DAYS,
): Promise<CustomerProfileData> {
  const cw = getConnectwaveSupabase();
  const tenant = await tenantForFy(companyGuid, fy);
  const p = custPeriod(fy);

  const { data, error } = await cw.rpc("rpt_customer_profile", {
    p_tenant: tenant,
    p_fy: fy,
    p_as_on: p.asOn,
    p_inactive_days: inactiveDays,
  });
  if (error) throw new Error(error.message);
  return data as CustomerProfileData;
}

/* ------------------------------------------------------- segment bands */

/**
 * Which band a share falls in. Returns null for a customer with no positive sales — Talligence
 * leaves their Segment cell blank rather than calling them Small, and those are exactly the rows
 * excluded from the band counts (84 = 80 existing + 4 new, not 89).
 */
export function segmentOf(share: number, cfg: SegmentConfig): Segment | null {
  if (!(share > 0)) return null;
  if (share <= cfg.small_max_pct) return "Small";
  if (share <= cfg.medium_max_pct) return "Medium";
  return "Large";
}

/** The "Small to Old" transition Talligence prints. A customer with no current year is "Old". */
export function journeyLabel(from: Segment | null, to: Segment | null): string {
  return `${from ?? "New"} to ${to ?? "Old"}`;
}

const RANK: Record<Segment, number> = { Small: 1, Medium: 2, Large: 3 };

export interface JourneyRow { name: string; guid: string | null; segment: string; weight: number }

/**
 * Customers whose band moved between the prior year and this one.
 *
 * Restricted to customers who traded in the PRIOR year — a brand-new arrival has no band to move
 * from, which is why Talligence's Positive panel reads "No Data Found" on a book where everyone
 * is Small in both years. Unchanged pairs are excluded. Ranked by the size of the year they are
 * leaving, which reproduces their five Negative rows in their exact order.
 */
export function journeys(rows: CustomerRow[], cfg: SegmentConfig): {
  positive: JourneyRow[];
  negative: JourneyRow[];
} {
  const positive: JourneyRow[] = [];
  const negative: JourneyRow[] = [];

  for (const r of rows) {
    if (!(r.py_sales > 0)) continue;            // no prior-year band to move from
    const from = segmentOf(r.py_share, cfg);
    const gone = r.lifecycle === "nonactive";
    const to = gone ? null : segmentOf(r.cy_share, cfg);

    // ⚠ A customer who DID buy this year but whose year nets to zero or below has no band —
    // segmentOf() returns null for them exactly as it does for someone who never came back.
    // Treating that null as "moved to Old" put APOLLO DIGITEX and FLORATEX at the top of the
    // Negative panel and pushed the two customers who really did leave off the bottom of it.
    // Only an ABSENT customer has gone; an unbanded present one simply has no journey.
    if (!gone && to === null) continue;
    if (from === to) continue;                  // unchanged — not a journey

    const row: JourneyRow = {
      name: r.name,
      guid: r.guid,
      segment: journeyLabel(from, to),
      weight: r.py_sales,
    };
    // "to" null means they stopped buying: always a downward move.
    if (to === null || (from !== null && RANK[to] < RANK[from])) negative.push(row);
    else positive.push(row);
  }

  const bySize = (a: JourneyRow, b: JourneyRow) => b.weight - a.weight;
  return { positive: positive.sort(bySize), negative: negative.sort(bySize) };
}

/* --------------------------------------------------------------- refresh */

export interface RefreshResult {
  status: "ok" | "cooldown" | "busy" | "error";
  seconds?: number; fys?: number; customers?: number;
  retry_after_seconds?: number; last_run?: string; message?: string;
}

/**
 * Rebuild this company's customer snapshot — the same work the 23:00 IST cron does nightly.
 * Rebuilds EVERY financial year of the company, not just the one on screen: the lifecycle
 * buckets are a year-over-year comparison, so a stale prior year would mislabel everybody.
 * Rate-limited to one run per company per two minutes.
 */
export async function refreshCustomerProfileCompany(companyGuid: string, fy: string): Promise<RefreshResult> {
  const cw = getConnectwaveSupabase();
  const tenant = await tenantForFy(companyGuid, fy);
  const { data, error } = await cw.rpc("rpt_customer_profile_refresh_company", { p_tenant: tenant });
  if (error) throw new Error(error.message);
  return data as RefreshResult;
}

export interface RefreshLogRow {
  ran_at: string; tenant_id: string | null; company_guid: string | null;
  fys: number | null; customers: number | null; seconds: number | null;
  error: string | null; source: string | null;
}

/** Last refresh for a company — drives the "Last refreshed" stamp and the progress-bar ETA. */
export async function loadCustomerProfileLastRefresh(companyGuid: string): Promise<RefreshLogRow | null> {
  const cw = getConnectwaveSupabase();
  const { data, error } = await cw
    .from("rpt_customer_profile_refresh_log")
    .select("ran_at,tenant_id,company_guid,fys,customers,seconds,error,source")
    .eq("company_guid", companyGuid)
    .order("ran_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] as RefreshLogRow | undefined) ?? null;
}

/* -------------------------------------------------- segment config (r/w) */

/** Per-company bands. A company with no row has never been edited — fall back to Talligence's. */
export async function loadSegmentConfig(companyGuid: string): Promise<SegmentConfig> {
  const cw = getConnectwaveSupabase();
  const { data, error } = await cw
    .from("ext_customer_segment_config")
    .select("small_max_pct,medium_max_pct")
    .eq("company_guid", companyGuid)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return DEFAULT_SEGMENT_CONFIG;
  return {
    small_max_pct: Number(data.small_max_pct),
    medium_max_pct: Number(data.medium_max_pct),
  };
}

/**
 * Save the bands. ConnectWave is read-only from the browser, so this goes through the identity
 * project's `muster-write` Edge Function, which re-verifies the caller is an Orange One admin and
 * writes with ITS service key — the same door the Masters screens use.
 */
export async function saveSegmentConfig(companyGuid: string, cfg: SegmentConfig): Promise<void> {
  const { data, error } = await supabase.functions.invoke("muster-write", {
    body: {
      action: "update_segment_config",
      company_guid: companyGuid,
      small_max_pct: cfg.small_max_pct,
      medium_max_pct: cfg.medium_max_pct,
    },
  });
  if (error) {
    let detail = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const parsed = await ctx.json();
        if (parsed?.error) detail = String(parsed.error);
      } catch {
        /* body wasn't JSON — keep the generic message */
      }
    }
    throw new Error(detail);
  }
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
}

/* ----------------------------------------------------------- derivations */

/** dd-mm-yyyy from Tally's YYYYMMDD — the house date format. */
export function dmy(ymd: string | null | undefined): string {
  if (!ymd || ymd.length < 8) return "";
  return `${ymd.slice(6, 8)}-${ymd.slice(4, 6)}-${ymd.slice(0, 4)}`;
}

/** Band roll-up for the three size cards: count and total per band. */
export function bandTotals(rows: CustomerRow[], cfg: SegmentConfig): Record<Segment, { count: number; total: number }> {
  const out: Record<Segment, { count: number; total: number }> = {
    Small: { count: 0, total: 0 },
    Medium: { count: 0, total: 0 },
    Large: { count: 0, total: 0 },
  };
  for (const r of rows) {
    if (r.lifecycle === "nonactive") continue;   // bands are current-year only
    const seg = segmentOf(r.cy_share, cfg);
    if (!seg) continue;                          // net-negative customers are dropped, not netted
    out[seg].count += 1;
    out[seg].total += r.cy_sales;
  }
  return out;
}
