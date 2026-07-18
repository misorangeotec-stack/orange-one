import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  Customer, ConsolidatedCustomer, DashboardData, CustomerDetail, KPIs,
  AgingPoint, RiskSegment, TopRiskyCustomer, AlertItem, SaleType, TrendPoint,
  AgingBuckets, RiskCategory, RiskTrendPoint, AdvanceBreakdown,
  SaleTypeBreakdown, SaleTypeBreakdownRow,
  CustomerGroupMap, GroupedCustomer,
} from "./types";
import { useFY } from "./fyContext";
import { useReceivablesScope } from "./scope";
import { useReceivablesSource } from "./sourceContext";
import { outstandingContribution, sumOutstanding, countByRisk, utilizationPct } from "./receivables";

// ── Helpers ──────────────────────────────────────────────────────────────────

function categorizeRisk(maxOD: number, util: number): RiskCategory {
  if (maxOD > 180 || util > 100) return "critical";
  if (maxOD > 90  || util > 75)  return "high";
  if (maxOD > 30  || util > 50)  return "medium";
  return "low";
}

export function consolidateByName(customers: Customer[]): ConsolidatedCustomer[] {
  const groups = new Map<string, Customer[]>();
  for (const c of customers) {
    if (!groups.has(c.name)) groups.set(c.name, []);
    groups.get(c.name)!.push(c);
  }
  return Array.from(groups.values()).map((entries) => {
    const numSum = (key: keyof Customer) =>
      entries.reduce((s, c) => s + ((c[key] as number) ?? 0), 0);

    const outstanding   = numSum("outstanding");
    const creditLimit   = Math.max(...entries.map((c) => c.creditLimit ?? 0));
    const maxOverdueDays = Math.max(...entries.map((c) => c.maxOverdueDays));
    const utilization   = utilizationPct({ outstanding, creditLimit });
    const risk = categorizeRisk(maxOverdueDays, utilization);

    const proposedCreditLimit3M = numSum("proposedCreditLimit3M");
    const proposedCreditLimitAI = numSum("proposedCreditLimitAI");
    const proposedCreditLimit3MDeltaPct = creditLimit > 0
      ? Math.round((proposedCreditLimit3M - creditLimit) / creditLimit * 1000) / 10
      : null;
    const proposedCreditLimitAIDeltaPct = creditLimit > 0
      ? Math.round((proposedCreditLimitAI - creditLimit) / creditLimit * 1000) / 10
      : null;

    const proposedConstituents = entries.map((c) => ({
      customerId:   c.id,
      customerName: c.name,
      company:      c.company,
      location:     c.location,
      creditLimit:  c.creditLimit,
      proposedAI:   c.proposedCreditLimitAI,
      deltaPct:     c.proposedCreditLimitAIDeltaPct,
      proposed3M:   c.proposedCreditLimit3M,
      delta3MPct:   c.proposedCreditLimit3MDeltaPct,
      reason:       c.proposedCreditLimitReason,
    }));

    const agingBuckets = entries.reduce((acc, c) => {
      for (const k of Object.keys(c.agingBuckets ?? {}) as (keyof AgingBuckets)[])
        acc[k] = (acc[k] ?? 0) + (c.agingBuckets[k] ?? 0);
      return acc;
    }, {} as AgingBuckets);

    const sumByType = (
      field: "salesByType" | "receiptsByType" | "creditNotesByType" | "outstandingByType" | "overdueByType" | "openingBalanceByType"
    ) =>
      entries.reduce((acc, c) => {
        for (const t of Object.keys(c[field] ?? {}))
          acc[t] = (acc[t] ?? 0) + ((c[field] as Record<string, number>)?.[t] ?? 0);
        return acc;
      }, {} as Record<string, number>);

    // A consolidated row is "blocked" if ANY constituent carries the blocked
    // sentinel (credit limit == 1 in at least one company/location).
    const blocked = entries.some((c) => c.blocked === true);

    return {
      ...entries[0],
      blocked,
      sales:                   numSum("sales"),
      receipts:                numSum("receipts"),
      otherPayments:           numSum("otherPayments"),
      otherPaymentsApplied:    numSum("otherPaymentsApplied"),
      otherPaymentsOnAccount:  numSum("otherPaymentsOnAccount"),
      creditNotes:             numSum("creditNotes"),
      debitNotes:              numSum("debitNotes"),
      journalDr:               numSum("journalDr"),
      journalCr:               numSum("journalCr"),
      journalAdjustments:      numSum("journalAdjustments"),
      openingBalanceAdjustment: numSum("openingBalanceAdjustment"),
      checkReturns:            numSum("checkReturns"),
      outstanding,
      overdue:                 numSum("overdue"),
      openingBalance:          numSum("openingBalance"),
      remainingOpeningBalance: numSum("remainingOpeningBalance"),
      obReceiptsApplied:       numSum("obReceiptsApplied"),
      obCreditNotesApplied:    numSum("obCreditNotesApplied"),
      advanceBalance:          numSum("advanceBalance"),
      advanceBreakdown: {
        onAccount:     entries.reduce((s, c) => s + (c.advanceBreakdown?.onAccount     ?? 0), 0),
        agstRefExcess: entries.reduce((s, c) => s + (c.advanceBreakdown?.agstRefExcess ?? 0), 0),
        creditNotes:   entries.reduce((s, c) => s + (c.advanceBreakdown?.creditNotes   ?? 0), 0),
        otherPayment:  entries.reduce((s, c) => s + (c.advanceBreakdown?.otherPayment  ?? 0), 0),
      } as AdvanceBreakdown,
      creditLimit,
      maxOverdueDays,
      creditPeriod:            Math.max(...entries.map((c) => c.creditPeriod)),
      utilization,
      risk,
      agingBuckets,
      proposedCreditLimit3M,
      proposedCreditLimitAI,
      proposedCreditLimit3MDeltaPct,
      proposedCreditLimitAIDeltaPct,
      proposedConstituents,
      salesByType:        sumByType("salesByType")        as Customer["salesByType"],
      receiptsByType:     sumByType("receiptsByType")     as Customer["receiptsByType"],
      creditNotesByType:  sumByType("creditNotesByType")  as Customer["creditNotesByType"],
      outstandingByType:  sumByType("outstandingByType")  as Customer["outstandingByType"],
      overdueByType:      sumByType("overdueByType")      as Customer["overdueByType"],
      openingBalanceByType: sumByType("openingBalanceByType") as Customer["openingBalanceByType"],
      companies:               [...new Set(entries.map((c) => c.company))].sort(),
      locations:               [...new Set(entries.map((c) => c.location))].sort(),
      constituentIds:          entries.map((c) => c.id),
      salesPersons:            [...new Set(entries.map((c) => c.salesPerson).filter(Boolean))].sort(),
      categories:              [...new Set(entries.map((c) => c.category).filter(Boolean))].sort(),
    } as ConsolidatedCustomer;
  });
}

/**
 * Roll consolidated customers up to group rows using the mapping sheet.
 *
 * Aggregation rules (locked by user 2026-04-29):
 *  - Sales / Receipts / Credit Notes / Debit Notes / Journal / Cheque Returns /
 *    Outstanding / Overdue / Opening Balance / Aging buckets → SUM of children
 *  - Credit Limit → MAX of children (NOT sum)
 *  - Credit Period → MAX of children
 *  - Max Overdue Days → MAX of children
 *  - Utilization → sum(outstanding) / max(creditLimit) × 100
 *  - Risk → recomputed from aggregated values
 *  - Company / Location / Sales Person → single value if all children agree, else "Multiple"
 *  - Customers absent from mapping appear as their own single-child group.
 */
/**
 * Resolve a customer's parent group.
 *
 * Resolves by Tally ledger GUID first — the only stable identity. A ConsolidatedCustomer is
 * already merged across companies, so it carries `constituentIds`: we take the first constituent
 * with a muster entry. Falls back to the name-keyed view (which is all the default pipeline
 * source has), then to the customer's own name, which means "ungrouped".
 *
 * Use this rather than indexing `mapping` directly: a name lookup can return another company's
 * group (387 names repeat), and it detaches entirely when the ledger is renamed in Tally.
 */
// Group resolution lives in ./customerGroups (pure, React-free) so non-hook libs can use it.
// Re-exported here because every page already imports from useAppData.
export { groupEntryOf, groupNameOf, allGroupNames, EMPTY_GROUP_MAP } from "./customerGroups";
import { groupNameOf, EMPTY_GROUP_MAP } from "./customerGroups";

export function consolidateByGroup(
  customers: ConsolidatedCustomer[],
  map: CustomerGroupMap,
): GroupedCustomer[] {
  const groups = new Map<string, ConsolidatedCustomer[]>();
  for (const c of customers) {
    const groupName = groupNameOf(c, map);
    if (!groups.has(groupName)) groups.set(groupName, []);
    groups.get(groupName)!.push(c);
  }

  return Array.from(groups.entries()).map(([groupName, children]) => {
    const numSum = (key: keyof ConsolidatedCustomer) =>
      children.reduce((s, c) => s + ((c[key] as number) ?? 0), 0);

    const outstanding   = numSum("outstanding");
    const creditLimit   = Math.max(...children.map((c) => c.creditLimit ?? 0));
    const creditPeriod  = Math.max(...children.map((c) => c.creditPeriod ?? 0));
    const maxOverdueDays = Math.max(...children.map((c) => c.maxOverdueDays ?? 0));
    const utilization   = utilizationPct({ outstanding, creditLimit });
    const risk = categorizeRisk(maxOverdueDays, utilization);

    // Sum proposed limits across children; recompute deltas vs the (max-of-children) creditLimit.
    const proposedCreditLimit3M = numSum("proposedCreditLimit3M");
    const proposedCreditLimitAI = numSum("proposedCreditLimitAI");
    const proposedCreditLimit3MDeltaPct = creditLimit > 0
      ? Math.round((proposedCreditLimit3M - creditLimit) / creditLimit * 1000) / 10
      : null;
    const proposedCreditLimitAIDeltaPct = creditLimit > 0
      ? Math.round((proposedCreditLimitAI - creditLimit) / creditLimit * 1000) / 10
      : null;
    const proposedConstituents = children.flatMap((c) => c.proposedConstituents ?? []);

    const agingBuckets = children.reduce((acc, c) => {
      for (const k of Object.keys(c.agingBuckets ?? {}) as (keyof AgingBuckets)[])
        acc[k] = (acc[k] ?? 0) + (c.agingBuckets[k] ?? 0);
      return acc;
    }, {} as AgingBuckets);

    const sumByType = (
      field: "salesByType" | "receiptsByType" | "creditNotesByType" | "outstandingByType" | "overdueByType" | "openingBalanceByType"
    ) =>
      children.reduce((acc, c) => {
        for (const t of Object.keys(c[field] ?? {}))
          acc[t] = (acc[t] ?? 0) + ((c[field] as Record<string, number>)?.[t] ?? 0);
        return acc;
      }, {} as Record<string, number>);

    const companies = [...new Set(children.flatMap((c) => c.companies ?? [c.company]))].sort();
    const locations = [...new Set(children.flatMap((c) => c.locations ?? [c.location]))].sort();
    const salesPersons = [...new Set(children.flatMap((c) => c.salesPersons ?? (c.salesPerson ? [c.salesPerson] : [])).filter(Boolean))].sort();
    const categories = [...new Set(children.flatMap((c) => c.categories ?? (c.category ? [c.category] : [])).filter(Boolean))].sort();
    const constituentIds = children.flatMap((c) => c.constituentIds ?? [c.id]);
    const childNames = children.map((c) => c.name).sort();

    // For collapsed display: show single value when all children agree, else "Multiple"
    const collapsed = (vals: string[]) => vals.length === 1 ? vals[0] : "Multiple";

    // A group is "blocked" if any child consolidated customer is blocked.
    const blocked = children.some((c) => c.blocked === true);

    return {
      ...children[0],
      blocked,
      id:                       `G:${groupName}`,
      name:                     groupName,
      groupName,
      childNames,
      isGroup:                  children.length > 1,
      company:                  collapsed(companies),
      location:                 collapsed(locations),
      salesPerson:              collapsed(salesPersons.length > 0 ? salesPersons : ["Others"]),
      category:                 categories.length === 0 ? "" : collapsed(categories),
      categories,
      sales:                    numSum("sales"),
      receipts:                 numSum("receipts"),
      otherPayments:            numSum("otherPayments"),
      otherPaymentsApplied:     numSum("otherPaymentsApplied"),
      otherPaymentsOnAccount:   numSum("otherPaymentsOnAccount"),
      creditNotes:              numSum("creditNotes"),
      debitNotes:               numSum("debitNotes"),
      journalDr:                numSum("journalDr"),
      journalCr:                numSum("journalCr"),
      journalAdjustments:       numSum("journalAdjustments"),
      openingBalanceAdjustment: numSum("openingBalanceAdjustment"),
      checkReturns:             numSum("checkReturns"),
      outstanding,
      overdue:                  numSum("overdue"),
      openingBalance:           numSum("openingBalance"),
      remainingOpeningBalance:  numSum("remainingOpeningBalance"),
      obReceiptsApplied:        numSum("obReceiptsApplied"),
      obCreditNotesApplied:     numSum("obCreditNotesApplied"),
      advanceBalance:           numSum("advanceBalance"),
      advanceBreakdown: {
        onAccount:     children.reduce((s, c) => s + (c.advanceBreakdown?.onAccount     ?? 0), 0),
        agstRefExcess: children.reduce((s, c) => s + (c.advanceBreakdown?.agstRefExcess ?? 0), 0),
        creditNotes:   children.reduce((s, c) => s + (c.advanceBreakdown?.creditNotes   ?? 0), 0),
        otherPayment:  children.reduce((s, c) => s + (c.advanceBreakdown?.otherPayment  ?? 0), 0),
      } as AdvanceBreakdown,
      creditLimit,
      creditPeriod,
      maxOverdueDays,
      utilization,
      risk,
      agingBuckets,
      proposedCreditLimit3M,
      proposedCreditLimitAI,
      proposedCreditLimit3MDeltaPct,
      proposedCreditLimitAIDeltaPct,
      proposedConstituents,
      salesByType:        sumByType("salesByType")        as Customer["salesByType"],
      receiptsByType:     sumByType("receiptsByType")     as Customer["receiptsByType"],
      creditNotesByType:  sumByType("creditNotesByType")  as Customer["creditNotesByType"],
      outstandingByType:  sumByType("outstandingByType")  as Customer["outstandingByType"],
      overdueByType:      sumByType("overdueByType")      as Customer["overdueByType"],
      openingBalanceByType: sumByType("openingBalanceByType") as Customer["openingBalanceByType"],
      companies,
      locations,
      constituentIds,
      salesPersons,
    } as GroupedCustomer;
  });
}

export interface UtilizationBucket {
  label: string;
  count: number;
  color: string;
}

export interface CompanyLocationPoint {
  segment: string;
  outstanding: number;
  overdue: number;
}

export interface LowCollectionCustomer {
  id: string;
  name: string;
  company: string;
  location: string;
  /** Trailing-3-month collection = Tally receipts (receipts3M) + manual Other Payments. */
  collected3M: number;
  overdue: number;
  collectionRate: number;
}

interface Filters {
  company?: string;
  location?: string;
  risk?: string;
  saleType?: string;
  customerSegment?: "all" | "active" | "no_activity";
  balanceFilter?: "all" | "has_outstanding" | "zero_outstanding";
  blockedFilter?: "all" | "blocked" | "not_blocked";
  salesPerson?: string; // comma-separated list of selected salespersons, or "all"
  category?: string;    // comma-separated list of selected categories, or "all"
}

interface AppData {
  loading: boolean;
  error: string | null;
  /** Filtered customer list — used by Risk Register, Customer Detail */
  customers: Customer[];
  /** Unfiltered full customer list — used to populate filter dropdowns */
  allCustomers: Customer[];
  /** All customers consolidated by name (one row per unique customer name, full dataset) */
  consolidatedCustomers: ConsolidatedCustomer[];
  /** Consolidated customers rolled up by group mapping (filter-aware, same chain as consolidatedCustomers) */
  groupedCustomers: GroupedCustomer[];
  /** Raw group mapping (Tally name → group name) loaded from customer_groups.json */
  customerGroupMap: CustomerGroupMap;
  /** Raw dashboard JSON (trend is always unfiltered — company-wide) */
  dashboard: DashboardData | null;
  /** KPIs recomputed from filtered customers */
  kpis: KPIs | null;
  /** Trend data (12-month; company-wide when saleType=all, else computed from invoices) */
  trend: TrendPoint[];
  /** Aging chart recomputed from filtered customers */
  aging: AgingPoint[];
  /** Risk segmentation recomputed from filtered customers */
  riskSegmentation: RiskSegment[];
  /** Top risky customers from filtered list */
  topRiskyCustomers: TopRiskyCustomer[];
  /** Alerts filtered by company / location */
  alerts: AlertItem[];
  /** Per-customer invoice + trend detail keyed by customer ID */
  customerDetail: Record<string, CustomerDetail>;
  /** Outstanding split by sale type (always all 4 types, company/location filtered) */
  outstandingByType: Record<SaleType, number>;
  /** Customer count in each credit utilization bucket (company/location filtered) */
  utilizationBuckets: UtilizationBucket[];
  /** Outstanding + overdue by company × location segment */
  companyLocationBreakdown: CompanyLocationPoint[];
  /** Monthly outstanding split by risk level — filter-aware */
  riskTrend: RiskTrendPoint[];
  /** Monthly customer count (with outstanding > 0) split by risk level — filter-aware */
  riskCountTrend: RiskTrendPoint[];
  /** Sale type reconciliation breakdown — always all types, unfiltered by saleType/company/location */
  saleTypeBreakdown: SaleTypeBreakdown;
  /** Count of customers whose 3-month receipts < 30% of their overdue balance */
  lowCollectionCount: number;
  /** Top 10 such customers sorted by overdue descending */
  lowCollectionCustomers: LowCollectionCustomer[];
  /** Distinct salesperson names across the (filtered) consolidated customers */
  salesPersonOptions: string[];
}

interface RawAppData {
  dash: DashboardData;
  cust: Customer[];
  inv: Record<string, CustomerDetail>;
  grp: CustomerGroupMap;
}

async function loadFromJson(fySuffix: string): Promise<RawAppData> {
  const [dashRes, custRes, invRes, grpRes] = await Promise.all([
    fetch(`/data/dashboard${fySuffix}.json`),
    fetch(`/data/customers${fySuffix}.json`),
    fetch(`/data/invoices${fySuffix}.json`),
    // Group mapping is FY-independent; missing file is non-fatal.
    fetch(`/data/customer_groups.json`),
  ]);
  if (!dashRes.ok || !custRes.ok || !invRes.ok) {
    throw new Error("Data files not found. Run 'python scripts/process_data.py' first.");
  }
  const [dash, cust, inv] = await Promise.all([
    dashRes.json() as Promise<DashboardData>,
    custRes.json() as Promise<Customer[]>,
    invRes.json() as Promise<Record<string, CustomerDetail>>,
  ]);
  // The static JSON predates ledger-id keying and carries only { mapping, groups }, so default
  // byLedgerId — groupNameOf() then falls back to the name for this source.
  const grp: CustomerGroupMap = {
    byLedgerId: {}, mapping: {}, groups: {},
    ...(grpRes.ok ? await (grpRes.json() as Promise<Partial<CustomerGroupMap>>) : {}),
  };
  return { dash, cust, inv, grp };
}

async function loadFromSupabase(fySuffix: string): Promise<RawAppData> {
  const {
    fetchDashboardFromSupabase, fetchCustomersFromSupabase,
    fetchInvoicesFromSupabase, fetchCustomerGroupsFromSupabase,
  } = await import("./supabaseFetcher");
  const [dash, cust, inv, grp] = await Promise.all([
    fetchDashboardFromSupabase(fySuffix),
    fetchCustomersFromSupabase(fySuffix),
    fetchInvoicesFromSupabase(fySuffix),
    fetchCustomerGroupsFromSupabase(),
  ]);
  return { dash, cust, inv, grp };
}

async function loadFromConnectwaveSource(fySuffix: string): Promise<RawAppData> {
  const { loadFromConnectwave } = await import("./connectwaveFetcher");
  return loadFromConnectwave(fySuffix);
}


/**
 * Turn any thrown value into a readable message. Supabase/PostgREST rejections are
 * plain objects (`{ message, code, hint, details }`), which `String()` renders as
 * the useless "[object Object]"; surface their real `message` (e.g. "Invalid API
 * key") so config problems are diagnosable instead of opaque.
 */
function toErrorMessage(err: unknown): string | null {
  if (err == null) return null;
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (typeof err === "object") {
    const o = err as Record<string, unknown>;
    if (typeof o.message === "string" && o.message) return o.message;
    if (typeof o.error_description === "string") return o.error_description;
    if (typeof o.error === "string") return o.error;
    try { return JSON.stringify(err); } catch { return "Unknown error"; }
  }
  return String(err);
}

export function useAppData(filters: Filters = {}): AppData {
  const { suffix: fySuffix } = useFY();
  // Per-salesperson scope (UI-level): null = unrestricted (admin); otherwise only
  // these salesperson names are visible — an empty array means "nothing".
  const { restrictToSalespersons } = useReceivablesScope();
  const source = useReceivablesSource();
  const allowedSalespersonSet = useMemo(
    () => (restrictToSalespersons !== null ? new Set(restrictToSalespersons) : null),
    [restrictToSalespersons],
  );

  // React Query caches the fetched payload at the QueryClient level (configured
  // in App.tsx), so navigating between pages no longer triggers a refetch — the
  // second mount returns the cached result instantly.
  const { data: raw, isLoading, error: queryError } = useQuery<RawAppData>({
    // ConnectWave is a distinct backend (live Tally snapshot) → its own cache key. It is now FY-aware
    // (connectwaveFetcher windows the monthly series + sales/receipts to the selected FY, mirroring the
    // pipeline partitions), so the FY suffix is part of the key here too.
    // The "v2" bump retired payloads cached before company/location were resolved from the
    // ext_company_map master (2026-07-17): the IndexedDB cache below hydrates instantly, so without
    // it a returning user would flash the old raw Tally book names ("ORANGE O TEC PRIVATE LIMITED
    // (01-04-25TO31-03-27)") until the background refetch landed.
    // "v3" (2026-07-17) retires payloads cached before Other Payments were netted from the
    // ext_other_payments master — those hold outstanding figures that read HIGH by up to
    // ₹5,76,27,920, and would paint for up to 24h on a returning browser.
    queryKey: source === "connectwave" ? ["appData", "connectwave", "v3", fySuffix] : ["appData", fySuffix],
    queryFn: () => {
      if (source === "connectwave") return loadFromConnectwaveSource(fySuffix);
      const ds = (import.meta.env.VITE_DATA_SOURCE ?? "local").toLowerCase();
      return ds === "supabase" ? loadFromSupabase(fySuffix) : loadFromJson(fySuffix);
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    // Always revalidate on mount. The payload is persisted to IndexedDB for 24h
    // (see queryPersister.ts), so a page reload restores the old snapshot
    // instantly — but with refetchOnMount:false it NEVER refetched, leaving the
    // dashboard (incl. the "Data updated as of" date) showing a stale snapshot
    // for up to 24h even after a fresh Supabase push. "always" keeps the instant
    // hydrate but kicks a background refetch so a reload picks up the live data.
    refetchOnMount: "always",
  });

  // Derive `blocked` on the frontend from the credit-limit sentinel so the rule
  // can be tweaked without regenerating data. Single source of truth: creditLimit === 1.
  // SCOPE CHOKEPOINT: when restricted, drop customers outside the allowed
  // salesperson set here — this cascades to every downstream list/KPI, and to
  // the allowed-id set used to scope customerDetail (blocks /customer/:id guessing).
  const allCustomers = useMemo<Customer[]>(() => {
    const list = raw ? raw.cust.map((c) => ({ ...c, blocked: c.creditLimit === 1 })) : [];
    return allowedSalespersonSet ? list.filter((c) => allowedSalespersonSet.has(c.salesPerson)) : list;
  }, [raw, allowedSalespersonSet]);
  const dashboard = raw?.dash ?? null;
  // Allowed customer ids for the current scope (null = unrestricted).
  const allowedCustomerIds = useMemo(
    () => (allowedSalespersonSet ? new Set(allCustomers.map((c) => c.id)) : null),
    [allowedSalespersonSet, allCustomers],
  );
  // Allowed customer names for the current scope (used to scope alerts).
  const allowedCustomerNames = useMemo(
    () => (allowedSalespersonSet ? new Set(allCustomers.map((c) => c.name)) : null),
    [allowedSalespersonSet, allCustomers],
  );
  // Scope the per-customer invoice/trend detail too, so a restricted user can't
  // open another salesperson's customer by typing the /customer/:id URL.
  const customerDetail = useMemo<Record<string, CustomerDetail>>(() => {
    const inv = raw?.inv ?? ({} as Record<string, CustomerDetail>);
    if (!allowedCustomerIds) return inv;
    const out: Record<string, CustomerDetail> = {};
    for (const [cid, detail] of Object.entries(inv)) if (allowedCustomerIds.has(cid)) out[cid] = detail;
    return out;
  }, [raw, allowedCustomerIds]);
  const customerGroupMap = raw?.grp ?? EMPTY_GROUP_MAP;
  const loading = isLoading;
  const error = toErrorMessage(queryError);

  // ── Filtered customers ──────────────────────────────────────────────────────
  const customers = useMemo(() => {
    let result = allCustomers;
    if (filters.company && filters.company !== "all") {
      const companies = filters.company.split(",").map((c) => c.trim());
      result = result.filter((c) => companies.includes(c.company));
    }
    if (filters.location && filters.location !== "all") {
      const locations = filters.location.split(",").map((l) => l.trim());
      result = result.filter((c) => locations.includes(c.location));
    }
    if (filters.risk && filters.risk !== "all") {
      const risks = filters.risk.split(",").map((r) => r.trim());
      result = result.filter((c) => risks.includes(c.risk));
    }
    return result;
  }, [allCustomers, filters.company, filters.location, filters.risk]);

  // ── Parse saleType filter into a list (empty = all) ─────────────────────────
  const saleTypeList = useMemo<SaleType[]>(() => {
    const st = filters.saleType;
    if (!st || st === "all") return [];
    const list = st.split(",").map((t) => t.trim()).filter(Boolean) as SaleType[];
    // All 4 types selected = no filter (avoids dropping customers with opening-balance-only data)
    if (list.length >= 5) return [];
    return list;
  }, [filters.saleType]);

  // Every sale-type key present in the data (ink, spare_parts, machine, head, other),
  // derived rather than hard-coded so it stays in sync with the pipeline.
  const allSaleTypes = useMemo<SaleType[]>(() => {
    const s = new Set<string>();
    for (const c of customers)
      for (const k of Object.keys(c.salesByType ?? {})) s.add(k);
    return [...s] as SaleType[];
  }, [customers]);

  // ── Project customer values for active sale type filter ─────────────────────
  const projectedCustomers = useMemo(() => {
    if (!saleTypeList.length) return customers;
    return customers
      .filter((c) => {
        const hasInTypeActivity = saleTypeList.some(
          (t) => (c.salesByType?.[t] ?? 0) > 0 || (c.outstandingByType?.[t] ?? 0) > 0
        );
        if (hasInTypeActivity) return true;
        // A customer with no sales mix has ALL of its untyped residual (opening
        // balance, on-account/advance receipts, unlinked credit notes, cheque
        // returns, Tally override delta) assigned to "other" by the projection
        // below (selectedShare = 1 when "other" is selected). Keep such customers
        // whenever "other" is in the selection, otherwise their residual
        // outstanding/overdue shows up in the unfiltered "all" view but vanishes
        // from every specific-type subset, so subsets fail to reconcile to the total.
        const salesTotal = allSaleTypes.reduce((s, t) => s + (c.salesByType?.[t] ?? 0), 0);
        if (salesTotal <= 1e-9 && saleTypeList.includes("other" as SaleType)) return true;
        // Keep no-activity customers (sales/receipts/credit notes/other payments all 0)
        // so the "No Activity" segment filter downstream can still find them. Without
        // this, every no-activity customer is dropped here and the segment
        // shows 0 totals when any sale-type filter is active. An Other Payment is a
        // collection, so it counts as activity (matches the segment filter below).
        return c.sales === 0 && c.receipts === 0 && c.creditNotes === 0 && (c.otherPayments ?? 0) === 0;
      })
      .map((c): Customer => {
        const typeMaxOD = saleTypeList.reduce((best, type) => {
          const odFromType = (customerDetail[c.id]?.invoices ?? [])
            .filter((inv) => inv.voucherType === type && inv.pending > 0)
            .reduce((m, inv) => Math.max(m, inv.overdueDays), 0);
          return Math.max(best, odFromType);
        }, 0);
        // Amounts with no sale type (opening balance, on-account/advance receipts,
        // unlinked credit notes, cheque returns, Tally override delta) are split
        // across the selected types by the customer's sales mix, so the per-type
        // figures reconcile back to the customer total. Customers with no in-period
        // sales have no mix → their residual lands in "other". This makes the
        // opening-balance share an ESTIMATE, not source-true; sales drives the split.
        const salesTotal = allSaleTypes.reduce((s, t) => s + (c.salesByType?.[t] ?? 0), 0);
        const hasSales = salesTotal > 1e-9;
        const selectedShare = hasSales
          ? saleTypeList.reduce((s, t) => s + (c.salesByType?.[t] ?? 0), 0) / salesTotal
          : (saleTypeList.includes("other" as SaleType) ? 1 : 0);

        const project = (
          total: number,
          byType: Partial<Record<SaleType, number>> | undefined,
        ): number => {
          const typedSum = saleTypeList.reduce((s, t) => s + (byType?.[t] ?? 0), 0);
          const residual = total - allSaleTypes.reduce((s, t) => s + (byType?.[t] ?? 0), 0);
          return typedSum + residual * selectedShare;
        };

        // Same residual allocation per aging bucket: the flat agingBuckets include
        // opening balance (180+) which carries no sale type, so distribute that
        // gap by sales mix → buckets reconcile to the flat total under any subset.
        const projectedAgingBuckets = (Object.keys(c.agingBuckets) as (keyof AgingBuckets)[])
          .reduce((acc, k) => {
            acc[k] = project(
              c.agingBuckets[k] ?? 0,
              Object.fromEntries(
                allSaleTypes.map((t) => [t, c.agingBucketsByType?.[t]?.[k] ?? 0]),
              ) as Partial<Record<SaleType, number>>,
            );
            return acc;
          }, {} as AgingBuckets);

        return {
          ...c,
          // Sales, receipts and credit notes are now read straight from their
          // per-type buckets (the pipeline tags each receipt/credit note by the
          // sale type of the bill it settles). Their unallocated remainder
          // (true on-account / unreadable refs) is deliberately NOT smeared into
          // a product — it simply isn't attributed to any selected type.
          sales:          saleTypeList.reduce((s, t) => s + (c.salesByType?.[t] ?? 0), 0),
          receipts:       saleTypeList.reduce((s, t) => s + (c.receiptsByType?.[t] ?? 0), 0),
          creditNotes:    saleTypeList.reduce((s, t) => s + (c.creditNotesByType?.[t] ?? 0), 0),
          // Outstanding & overdue keep the sales-mix projection: their untyped
          // remainder (advances / unallocated) has no bill-level sale type.
          outstanding:    project(c.outstanding,  c.outstandingByType),
          overdue:        project(c.overdue,      c.overdueByType),
          // Opening balance is now source-true per sale type (1wM3 split): its
          // openingBalanceByType sums to openingBalance, so project() carries zero
          // residual and returns the exact selected-type opening (no smear).
          openingBalance: project(c.openingBalance, c.openingBalanceByType),
          maxOverdueDays: typeMaxOD,
          agingBuckets:   projectedAgingBuckets,
        };
      });
  }, [customers, saleTypeList, customerDetail, allSaleTypes]);

  // ── Consolidated customers after company/location/risk/saleType filters ──────
  const projectedConsolidatedCustomers = useMemo(
    () => consolidateByName(projectedCustomers),
    [projectedCustomers],
  );

  // ── Apply customerSegment filter AFTER consolidation to avoid double-counting ─
  // A customer can have activity in one company but not another; segment must be
  // judged on their combined totals, not individual rows.
  const segmentedConsolidatedCustomers = useMemo(() => {
    let result = projectedConsolidatedCustomers;
    if (filters.customerSegment === "active")
      result = result.filter((c) => c.sales > 0 || c.receipts > 0 || c.creditNotes > 0 || (c.otherPayments ?? 0) > 0);
    else if (filters.customerSegment === "no_activity")
      result = result.filter((c) => c.sales === 0 && c.receipts === 0 && c.creditNotes === 0 && (c.otherPayments ?? 0) === 0);
    if (filters.balanceFilter === "has_outstanding")
      result = result.filter((c) => c.outstanding > 0);
    else if (filters.balanceFilter === "zero_outstanding")
      result = result.filter((c) => c.outstanding <= 0);
    if (filters.blockedFilter === "blocked")
      result = result.filter((c) => c.blocked === true);
    else if (filters.blockedFilter === "not_blocked")
      result = result.filter((c) => c.blocked !== true);
    if (filters.salesPerson && filters.salesPerson !== "all") {
      const spSet = new Set(filters.salesPerson.split(",").map((s) => s.trim()).filter(Boolean));
      result = result.filter((c) => c.salesPersons?.some((sp) => spSet.has(sp)) || spSet.has(c.salesPerson));
    }
    if (filters.category && filters.category !== "all") {
      const catSet = new Set(filters.category.split(",").map((s) => s.trim()).filter(Boolean));
      result = result.filter((c) => {
        const toks = c.categories?.length ? c.categories
          : c.category && c.category !== "Multiple" ? [c.category] : ["Uncategorized"];
        return toks.some((t) => catSet.has(t));
      });
    }
    return result;
  }, [projectedConsolidatedCustomers, filters.customerSegment, filters.balanceFilter, filters.blockedFilter, filters.salesPerson, filters.category]);

  // ── customerDetail filtered by saleType — used by the overdue bridge, aging & trend ──
  // Declared here (above its first consumer) rather than further down; only `customerDetail`
  // and `saleTypeList` feed it, and both are defined well above.
  const filteredCustomerDetail = useMemo(() => {
    if (!saleTypeList.length) return customerDetail;
    const typeSet = new Set<string>(saleTypeList);
    const result: Record<string, CustomerDetail> = {};
    for (const [id, detail] of Object.entries(customerDetail)) {
      result[id] = {
        ...detail,
        invoices: detail.invoices.filter((inv) => typeSet.has(inv.voucherType)),
      };
    }
    return result;
  }, [customerDetail, saleTypeList]);

  /**
   * ── The Overdue bridge ───────────────────────────────────────────────────────
   *
   * The Dashboard's Total Overdue (`customers.overdue`, summed) has always disagreed with the
   * bill-based reports (Aging / Overdue-120 / Category) — ₹35.26 cr vs ₹38.00 cr. Neither is
   * wrong. The pipeline reports overdue NET of on-account money the customer has already paid
   * us but that isn't matched to any bill yet. Measured against the live book, this holds for
   * 1,776 of 1,780 ledgers (the 4 misses total ₹0.01 cr — rounding):
   *
   *     customers.overdue  ==  max(0, Σ overdue bills  +  Σ on-account credits)   // per ledger
   *
   * So the difference is not a defect to fix, it is a fact to SHOW. This computes both sides of
   * the bridge here — not in the page — so it is derived from the SAME customer universe as
   * `totalOverdue` (`segmentedConsolidatedCustomers` → `allowedIds`, exactly like the aging memo
   * below) and therefore ties by construction under every filter, instead of agreeing today and
   * drifting the first time someone filters by salesperson.
   *
   * 🔴 The cap is load-bearing. `applied` takes min(overdue, credits) PER LEDGER, because a
   * customer's surplus credit cannot drive their own overdue below zero. Across the book,
   * on-bill credits total ₹16.16 cr but only ₹2.75 cr is actually consumed — sum them globally
   * instead of capping and the bridge over-deducts by ~6× and confidently shows a wrong number.
   */
  const overdueBridge = useMemo(() => {
    const allowedIds = new Set(segmentedConsolidatedCustomers.flatMap((c) => c.constituentIds));

    // ledgerId → { ovd: past-due bills, cred: on-account credits (positive magnitude) }
    const perLedger = new Map<string, { ovd: number; cred: number }>();
    for (const [custId, detail] of Object.entries(filteredCustomerDetail)) {
      if (!allowedIds.has(custId)) continue;
      let e = perLedger.get(custId);
      if (!e) { e = { ovd: 0, cred: 0 }; perLedger.set(custId, e); }
      for (const inv of detail.invoices) {
        if (inv.pending > 0 && inv.overdueDays > 0) e.ovd += inv.pending;
        else if (inv.pending < 0) e.cred += -inv.pending;
      }
    }

    let onBills = 0, applied = 0;
    for (const { ovd, cred } of perLedger.values()) {
      onBills += ovd;
      applied += Math.min(ovd, cred);   // ← the per-ledger cap. See above.
    }
    return { totalOverdueOnBills: onBills, totalOverdueCreditsApplied: applied };
  }, [filteredCustomerDetail, segmentedConsolidatedCustomers]);

  // ── KPIs recomputed from filtered customers ──────────────────────────────────
  const kpis = useMemo<KPIs | null>(() => {
    if (!projectedCustomers.length && !allCustomers.length) return null;
    return {
      ...overdueBridge,
      totalSales:                   segmentedConsolidatedCustomers.reduce((s, c) => s + c.sales, 0),
      totalReceipts:                segmentedConsolidatedCustomers.reduce((s, c) => s + c.receipts, 0),
      totalOtherPayments:           segmentedConsolidatedCustomers.reduce((s, c) => s + (c.otherPayments ?? 0), 0),
      totalCreditNotes:             segmentedConsolidatedCustomers.reduce((s, c) => s + c.creditNotes, 0),
      totalDebitNotes:              segmentedConsolidatedCustomers.reduce((s, c) => s + (c.debitNotes ?? 0), 0),
      totalJournalAdjustments:      segmentedConsolidatedCustomers.reduce((s, c) => s + (c.journalAdjustments ?? 0), 0),
      totalJournalDr:               segmentedConsolidatedCustomers.reduce((s, c) => s + (c.journalDr ?? 0), 0),
      totalJournalCr:               segmentedConsolidatedCustomers.reduce((s, c) => s + (c.journalCr ?? 0), 0),
      totalCheckReturns:            segmentedConsolidatedCustomers.reduce((s, c) => s + (c.checkReturns ?? 0), 0),
      totalOpeningBalance:          segmentedConsolidatedCustomers.reduce((s, c) => s + c.openingBalance, 0),
      totalRemainingOpeningBalance: segmentedConsolidatedCustomers.reduce((s, c) => s + (c.remainingOpeningBalance ?? 0), 0),
      totalAdvanceBalance:          segmentedConsolidatedCustomers.reduce((s, c) => s + (c.advanceBalance ?? 0), 0),
      totalAdvanceBySource: {
        onAccount:     segmentedConsolidatedCustomers.reduce((s, c) => s + (c.advanceBreakdown?.onAccount     ?? 0), 0),
        agstRefExcess: segmentedConsolidatedCustomers.reduce((s, c) => s + (c.advanceBreakdown?.agstRefExcess ?? 0), 0),
        creditNotes:   segmentedConsolidatedCustomers.reduce((s, c) => s + (c.advanceBreakdown?.creditNotes   ?? 0), 0),
        otherPayment:  segmentedConsolidatedCustomers.reduce((s, c) => s + (c.advanceBreakdown?.otherPayment  ?? 0), 0),
      } as AdvanceBreakdown,
      totalOutstanding:             sumOutstanding(segmentedConsolidatedCustomers),
      totalOverdue:                 segmentedConsolidatedCustomers.reduce((s, c) => s + c.overdue, 0),
      totalCustomers:               segmentedConsolidatedCustomers.length,
      criticalCustomers:            segmentedConsolidatedCustomers.filter((c) => c.risk === "critical").length,
      overCreditLimit:              segmentedConsolidatedCustomers.filter((c) => c.utilization > 100).length,
      overdue180Plus:               segmentedConsolidatedCustomers.filter((c) => c.maxOverdueDays > 180).length,
      blockedCustomers:             segmentedConsolidatedCustomers.filter((c) => c.blocked).length,
    };
  }, [projectedCustomers, allCustomers.length, segmentedConsolidatedCustomers, overdueBridge]);

  // ── Consolidated customers with saleType + customerSegment applied ───────────
  // Used by Risk Register. Derived from projectedConsolidatedCustomers so that
  // receipts, openingBalance, and all saleType-projected values are identical to
  // what the Dashboard KPIs use — guaranteeing the two pages always agree.
  const consolidatedCustomers = useMemo<ConsolidatedCustomer[]>(() => {
    let result = projectedConsolidatedCustomers;

    if (filters.customerSegment === "active")
      result = result.filter((c) => c.sales > 0 || c.receipts > 0 || c.creditNotes > 0 || (c.otherPayments ?? 0) > 0);
    else if (filters.customerSegment === "no_activity")
      result = result.filter((c) => c.sales === 0 && c.receipts === 0 && c.creditNotes === 0 && (c.otherPayments ?? 0) === 0);

    if (filters.balanceFilter === "has_outstanding")
      result = result.filter((c) => c.outstanding > 0);
    else if (filters.balanceFilter === "zero_outstanding")
      result = result.filter((c) => c.outstanding <= 0);
    if (filters.blockedFilter === "blocked")
      result = result.filter((c) => c.blocked === true);
    else if (filters.blockedFilter === "not_blocked")
      result = result.filter((c) => c.blocked !== true);
    if (filters.salesPerson && filters.salesPerson !== "all") {
      const spSet = new Set(filters.salesPerson.split(",").map((s) => s.trim()).filter(Boolean));
      result = result.filter((c) => c.salesPersons?.some((sp) => spSet.has(sp)) || spSet.has(c.salesPerson));
    }
    if (filters.category && filters.category !== "all") {
      const catSet = new Set(filters.category.split(",").map((s) => s.trim()).filter(Boolean));
      result = result.filter((c) => {
        const toks = c.categories?.length ? c.categories
          : c.category && c.category !== "Multiple" ? [c.category] : ["Uncategorized"];
        return toks.some((t) => catSet.has(t));
      });
    }

    return result;
  }, [projectedConsolidatedCustomers, filters.customerSegment, filters.balanceFilter, filters.blockedFilter, filters.salesPerson, filters.category]);

  // ── Aging recomputed from filtered customers / invoices ─────────────────────
  const aging = useMemo<AgingPoint[]>(() => {
    const buckets: Record<string, number> = {
      "0-30": 0, "31-60": 0, "61-90": 0, "91-120": 0, "121-180": 0, "180+": 0,
    };

    // Restrict aging to only customers that pass the customerSegment filter
    // (same set used for KPI totalOverdue) so the two numbers always agree.
    const allowedIds = new Set(segmentedConsolidatedCustomers.flatMap((c) => c.constituentIds));

    if (!saleTypeList.length) {
      // Use pre-computed agingBuckets from customer data
      const map: Record<string, string> = {
        "0_30": "0-30", "31_60": "31-60", "61_90": "61-90",
        "91_120": "91-120", "121_180": "121-180", "180_plus": "180+",
      };
      projectedCustomers.forEach((c) => {
        if (!allowedIds.has(c.id)) return;
        Object.entries(map).forEach(([k, label]) => {
          buckets[label] += c.agingBuckets?.[k as keyof typeof c.agingBuckets] ?? 0;
        });
      });
    } else {
      // Compute from invoices already filtered by voucherType
      const custIds = allowedIds;
      Object.entries(filteredCustomerDetail).forEach(([custId, detail]) => {
        if (!custIds.has(custId)) return;
        detail.invoices.forEach((inv) => {
          if (inv.pending <= 0) return;
          if (inv.overdueDays <= 0) return;
          const od = inv.overdueDays;
          let bucket: string;
          if (od <= 30)       bucket = "0-30";
          else if (od <= 60)  bucket = "31-60";
          else if (od <= 90)  bucket = "61-90";
          else if (od <= 120) bucket = "91-120";
          else if (od <= 180) bucket = "121-180";
          else                bucket = "180+";
          buckets[bucket] += inv.pending;
        });
      });
    }

    return Object.entries(buckets).map(([bucket, amount]) => ({
      bucket,
      amount: Math.round(amount / 100_000 * 100) / 100,
    }));
  }, [projectedCustomers, customers, saleTypeList, filteredCustomerDetail, segmentedConsolidatedCustomers]);

  // ── Risk segmentation from filtered customers ────────────────────────────────
  const riskSegmentation = useMemo<RiskSegment[]>(() => {
    const colors: Record<string, string> = {
      low:      "hsl(142, 71%, 45%)",
      medium:   "hsl(45, 93%, 47%)",
      high:     "hsl(28, 80%, 52%)",
      critical: "hsl(0, 84%, 60%)",
    };

    if (!saleTypeList.length) {
      // % of customers by risk category — same in-view set as the KPI tiles, every
      // customer counted (no exposure gate) so band counts sum to Total Customers.
      const total = segmentedConsolidatedCustomers.length;
      const counts: Record<string, number> = countByRisk(segmentedConsolidatedCustomers);
      return ["low", "medium", "high", "critical"].map((r) => ({
        name:  r.charAt(0).toUpperCase() + r.slice(1),
        value: total > 0 ? Math.round((counts[r] ?? 0) / total * 1000) / 10 : 0,
        count: counts[r] ?? 0,
        color: colors[r],
      }));
    } else {
      // % of outstanding amount by risk category (projected to the selected sale type)
      const totalOutstanding = sumOutstanding(segmentedConsolidatedCustomers);
      const byRisk: Record<string, { outstanding: number; count: number }> = {
        low:      { outstanding: 0, count: 0 },
        medium:   { outstanding: 0, count: 0 },
        high:     { outstanding: 0, count: 0 },
        critical: { outstanding: 0, count: 0 },
      };
      segmentedConsolidatedCustomers.forEach((c) => {
        byRisk[c.risk].outstanding += outstandingContribution(c);
        byRisk[c.risk].count       += 1;
      });
      return ["low", "medium", "high", "critical"].map((r) => ({
        name:  r.charAt(0).toUpperCase() + r.slice(1),
        value: totalOutstanding > 0
          ? Math.round(byRisk[r].outstanding / totalOutstanding * 1000) / 10
          : 0,
        count: byRisk[r].count,
        color: colors[r],
      }));
    }
  }, [segmentedConsolidatedCustomers, saleTypeList]);

  // ── Top risky customers from filtered list ───────────────────────────────────
  const topRiskyCustomers = useMemo<TopRiskyCustomer[]>(() => {
    // Same in-view set as the KPIs / register (consolidated by name), so the
    // "top risky" list never shows a customer the register has merged away.
    return [...segmentedConsolidatedCustomers]
      .filter((c) => c.overdue > 0)
      .sort((a, b) => b.overdue - a.overdue)
      .slice(0, 10)
      .map((c) => ({
        id:          c.id,
        name:        c.name,
        company:     c.company,
        location:    c.location,
        outstanding: c.outstanding,
        overdue:     c.overdue,
        maxODDays:   c.maxOverdueDays,
        risk:        c.risk,
      }));
  }, [segmentedConsolidatedCustomers]);

  // ── Low collection rate customers (3M collection < 30% of overdue) ────────────
  // "Collection" = Tally receipts (receipts3M) + manual Other Payments in the same
  // trailing-3-month window. An Other Payment is real money collected, so a customer
  // who paid us that way must not be branded low-collection. The window is a best-effort
  // match to the pipeline's receipts_3m window (last 3 calendar months).
  const otherPayments3MById = useMemo<Map<string, number>>(() => {
    const now = new Date();
    const cutoff = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
    const cutoffIso = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
    const map = new Map<string, number>();
    for (const [id, detail] of Object.entries(customerDetail)) {
      let sum = 0;
      for (const o of detail.otherPaymentTransactions ?? []) {
        if (!o.date || o.date < cutoffIso) continue;
        sum += Math.abs(o.amount);
      }
      if (sum) map.set(id, sum);
    }
    return map;
  }, [customerDetail]);

  const collected3MOf = (c: Customer): number =>
    c.receipts3M + (otherPayments3MById.get(c.id) ?? 0);

  const lowCollectionCustomers = useMemo<LowCollectionCustomer[]>(() => {
    return [...projectedCustomers]
      .filter((c) => c.overdue > 0 && collected3MOf(c) < 0.30 * c.overdue)
      .sort((a, b) => b.overdue - a.overdue)
      .slice(0, 10)
      .map((c) => ({
        id:             c.id,
        name:           c.name,
        company:        c.company,
        location:       c.location,
        collected3M:    collected3MOf(c),
        overdue:        c.overdue,
        collectionRate: Math.round(collected3MOf(c) / c.overdue * 1000) / 10,
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectedCustomers, otherPayments3MById]);

  const lowCollectionCount = useMemo<number>(
    () => projectedCustomers.filter((c) => c.overdue > 0 && collected3MOf(c) < 0.30 * c.overdue).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectedCustomers, otherPayments3MById],
  );

  // ── Alerts filtered by salesperson scope, then company / location ─────────────
  const alerts = useMemo<AlertItem[]>(() => {
    if (!dashboard?.alerts) return [];
    let result = dashboard.alerts;
    // Salesperson scope: only alerts for customers in the allowed set.
    if (allowedCustomerIds || allowedCustomerNames) {
      result = result.filter(
        (a) =>
          (a.customerId != null && allowedCustomerIds?.has(a.customerId)) ||
          (a.customer != null && allowedCustomerNames?.has(a.customer)),
      );
    }
    if (filters.company && filters.company !== "all") {
      const companies = filters.company.split(",").map((c) => c.trim());
      result = result.filter((a) => companies.includes(a.company));
    }
    if (filters.location && filters.location !== "all") {
      const locations = filters.location.split(",").map((l) => l.trim());
      result = result.filter((a) => locations.includes(a.location));
    }
    return result;
  }, [dashboard?.alerts, allowedCustomerIds, allowedCustomerNames, filters.company, filters.location]);

  // ── Trend (monthly sales vs receipts vs outstanding) ─────────────────────────
  // When saleType = "all", returns the pre-computed company-wide trend from dashboard.json.
  // When a specific saleType is selected, aggregates from filtered invoices:
  //   sales       = sum of invoice.amount by invoice month
  //   receipts    = sum of invoice.receiptAdj + otherPaymentAdj by invoice month
  //                 (Tally receipts + manual Other Payments applied to those invoices)
  //   outstanding = running balance (sales - receipts accumulated month-over-month)
  const trend = useMemo<TrendPoint[]>(() => {
    const baseTrend = dashboard?.trend ?? [];

    // The latest (as-of) point must equal the KPI cards exactly — same NET
    // outstanding + total overdue, over the same in-view customer set. Historical
    // months keep the backend's monthly trend (the only source for history).
    // Trend chart unit is lakhs (rupees / 100_000); the display divides by 100 → Cr.
    const asOfMonth = baseTrend.length ? baseTrend[baseTrend.length - 1].month : null;
    const asOfOutstandingL = Math.round(sumOutstanding(segmentedConsolidatedCustomers) / 100_000 * 100) / 100;
    const asOfOverdueL     = Math.round(segmentedConsolidatedCustomers.reduce((s, c) => s + c.overdue, 0) / 100_000 * 100) / 100;

    if (!saleTypeList.length) {
      // Aggregate monthly overdue from per-customer trends (company/location filtered)
      const custIds = new Set(customers.map((c) => c.id));
      const overdueByMonth: Record<string, number> = {};
      baseTrend.forEach((tp) => { overdueByMonth[tp.month] = 0; });
      Object.entries(filteredCustomerDetail).forEach(([custId, detail]) => {
        if (!custIds.has(custId)) return;
        detail.trend.forEach((mt) => {
          if (mt.month in overdueByMonth) {
            overdueByMonth[mt.month] = Math.round((overdueByMonth[mt.month] + mt.overdue) * 100) / 100;
          }
        });
      });
      return baseTrend.map((tp) => tp.month === asOfMonth
        ? { ...tp, outstanding: asOfOutstandingL, overdue: asOfOverdueL }
        : { ...tp, overdue: overdueByMonth[tp.month] ?? 0 });
    }

    // Build a lookup keyed by month label (e.g. "Apr-25")
    const custIds = new Set(customers.map((c) => c.id));
    const monthMap: Record<string, { sales: number; receipts: number }> = {};
    baseTrend.forEach((tp) => { monthMap[tp.month] = { sales: 0, receipts: 0 }; });

    Object.entries(filteredCustomerDetail).forEach(([custId, detail]) => {
      if (!custIds.has(custId)) return;
      detail.invoices.forEach((inv) => {
        const d   = new Date(inv.date);
        const mon = d.toLocaleString("en-US", { month: "short" });
        const yr  = String(d.getFullYear()).slice(2);
        const label = `${mon}-${yr}`;
        if (monthMap[label] !== undefined) {
          monthMap[label].sales    += inv.amount     / 100_000;
          // Collection = Tally receipts applied + manual Other Payments applied to this bill.
          monthMap[label].receipts += (inv.receiptAdj + (inv.otherPaymentAdj ?? 0)) / 100_000;
        }
      });
    });

    // Compute running outstanding balance (starts from 0; rough estimate)
    let runningOS = 0;
    return baseTrend.map((tp) => {
      const s = Math.round((monthMap[tp.month]?.sales    ?? 0) * 100) / 100;
      const r = Math.round((monthMap[tp.month]?.receipts ?? 0) * 100) / 100;
      runningOS = Math.max(0, Math.round((runningOS + s - r) * 100) / 100);
      if (tp.month === asOfMonth)
        return { month: tp.month, sales: s, receipts: r, outstanding: asOfOutstandingL, overdue: asOfOverdueL };
      return { month: tp.month, sales: s, receipts: r, outstanding: runningOS, overdue: 0 };
    });
  }, [dashboard, customers, filteredCustomerDetail, saleTypeList, segmentedConsolidatedCustomers]);

  // ── Outstanding by sale type (all 4 types; company/location filtered) ────────
  const outstandingByType = useMemo<Record<SaleType, number>>(() => {
    // "head" is a legacy SaleType member that no longer appears in current data;
    // keep the original 4-key object (cast preserves runtime behavior).
    const result = { ink: 0, spare_parts: 0, machine: 0, other: 0 } as unknown as Record<SaleType, number>;
    customers.forEach((c) => {
      if (c.outstandingByType) {
        (Object.keys(result) as SaleType[]).forEach((t) => {
          result[t] += c.outstandingByType[t] ?? 0;
        });
      }
    });
    return result;
  }, [customers]);

  // ── Credit utilization distribution (company/location filtered) ───────────
  const utilizationBuckets = useMemo<UtilizationBucket[]>(() => {
    const buckets: UtilizationBucket[] = [
      { label: "<50%",    count: 0, color: "hsl(142,71%,45%)" },
      { label: "50–75%",  count: 0, color: "hsl(45,93%,47%)"  },
      { label: "75–100%", count: 0, color: "hsl(28,80%,52%)"  },
      { label: ">100%",   count: 0, color: "hsl(0,84%,60%)"   },
    ];
    customers.forEach((c) => {
      const u = c.utilization;
      if      (u < 50)  buckets[0].count++;
      else if (u < 75)  buckets[1].count++;
      else if (u < 100) buckets[2].count++;
      else              buckets[3].count++;
    });
    return buckets;
  }, [customers]);

  // ── Company × location breakdown ──────────────────────────────────────────
  const companyLocationBreakdown = useMemo<CompanyLocationPoint[]>(() => {
    const map: Record<string, { outstanding: number; overdue: number }> = {};
    projectedCustomers.forEach((c) => {
      const key = `${c.company} · ${c.location}`;
      if (!map[key]) map[key] = { outstanding: 0, overdue: 0 };
      map[key].outstanding += outstandingContribution(c);
      map[key].overdue     += c.overdue;
    });
    return Object.entries(map)
      .map(([segment, vals]) => ({ segment, ...vals }))
      .sort((a, b) => b.outstanding - a.outstanding);
  }, [projectedCustomers]);

  // ── Risk Trend — outstanding amounts split by risk level per month ────────────
  // No filter: uses per-month historical risk stored in each customer's trend entry.
  // Sale type filter active: falls back to current projected risk (flat line) since
  // per-type historical outstanding cannot be derived from available data.
  const riskTrend = useMemo<RiskTrendPoint[]>(() => {
    const months = (dashboard?.trend ?? []).map((t) => t.month);
    if (!months.length || !Object.keys(customerDetail).length) return [];

    const asOfMonth = months[months.length - 1];

    if (saleTypeList.length) {
      return months.map((month) => {
        const bucket: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
        if (month === asOfMonth) {
          // As-of month: use customers.json data directly → exact KPI match
          for (const c of segmentedConsolidatedCustomers) {
            // NET: credit balances (outstanding < 0) subtract here too — see receivables.ts
            bucket[c.risk] += Math.round(outstandingContribution(c) / 1000) / 100;  // Rupees → Lakhs (2dp)
          }
        } else {
          for (const c of segmentedConsolidatedCustomers) {
            let typeOutstandingL = 0;
            let typeMaxODDays    = 0;
            for (const id of c.constituentIds) {
              const mt = customerDetail[id]?.trend.find((t) => t.month === month);
              if (!mt) continue;
              for (const type of saleTypeList) {
                typeOutstandingL += mt.outstandingByType?.[type] ?? 0;
                typeMaxODDays     = Math.max(typeMaxODDays, mt.maxOverdueDaysByType?.[type] ?? 0);
              }
            }
            if (typeOutstandingL <= 0) continue;
            const utilization = c.creditLimit > 0
              ? Math.round(typeOutstandingL * 100_000 / c.creditLimit * 1000) / 10 : 0;
            const monthRisk = categorizeRisk(typeMaxODDays, utilization);
            bucket[monthRisk] += Math.round(typeOutstandingL * 100) / 100;
          }
        }
        return {
          month,
          critical: Math.round(bucket.critical * 100) / 100,
          high:     Math.round(bucket.high     * 100) / 100,
          medium:   Math.round(bucket.medium   * 100) / 100,
          low:      Math.round(bucket.low      * 100) / 100,
        };
      });
    }

    // No filter — use per-month historical risk from trend data
    const includedIds = new Set<string>(
      segmentedConsolidatedCustomers.flatMap((c) => c.constituentIds)
    );
    return months.map((month) => {
      const bucket: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
      if (month === asOfMonth) {
        // As-of month: use customers.json data directly → exact KPI match
        for (const c of segmentedConsolidatedCustomers) {
          // NET: credit balances (outstanding < 0) subtract here too — see receivables.ts
          bucket[c.risk] += Math.round(outstandingContribution(c) / 1000) / 100;  // Rupees → Lakhs (2dp)
        }
      } else {
        for (const [custId, detail] of Object.entries(customerDetail)) {
          if (!includedIds.has(custId)) continue;
          const mt = detail.trend.find((t) => t.month === month);
          if (!mt) continue;
          bucket[mt.risk ?? "low"] += mt.outstanding;
        }
      }
      return {
        month,
        critical: Math.round(bucket.critical * 100) / 100,
        high:     Math.round(bucket.high     * 100) / 100,
        medium:   Math.round(bucket.medium   * 100) / 100,
        low:      Math.round(bucket.low      * 100) / 100,
      };
    });
  }, [segmentedConsolidatedCustomers, customerDetail, dashboard?.trend, saleTypeList]);

  // ── Risk Count Trend — customer count per risk band per month ─────────────────
  // No filter: for each month, re-derives each consolidated customer's risk from their
  // monthly trend data (maxOverdueDays + utilization), matching the KPI card exactly
  // for the as-of month (Mar-26).
  // Sale type filter active: falls back to current projected risk — flat line.
  const riskCountTrend = useMemo<RiskTrendPoint[]>(() => {
    const months = (dashboard?.trend ?? []).map((t) => t.month);
    if (!months.length || !Object.keys(customerDetail).length) return [];

    const asOfMonth = months[months.length - 1];

    if (saleTypeList.length) {
      return months.map((month) => {
        const bucket: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
        if (month === asOfMonth) {
          // As-of month: use customers.json data directly → exact KPI match
          const b = countByRisk(segmentedConsolidatedCustomers);
          bucket.low = b.low; bucket.medium = b.medium; bucket.high = b.high; bucket.critical = b.critical;
        } else {
          // Historical month — per-type trend data
          for (const c of segmentedConsolidatedCustomers) {
            let typeOutstandingL = 0;
            let typeMaxODDays    = 0;
            for (const id of c.constituentIds) {
              const mt = customerDetail[id]?.trend.find((t) => t.month === month);
              if (!mt) continue;
              for (const type of saleTypeList) {
                typeOutstandingL += mt.outstandingByType?.[type] ?? 0;
                typeMaxODDays     = Math.max(typeMaxODDays, mt.maxOverdueDaysByType?.[type] ?? 0);
              }
            }
            if (typeOutstandingL <= 0) continue;
            const utilization = c.creditLimit > 0
              ? Math.round(typeOutstandingL * 100_000 / c.creditLimit * 1000) / 10
              : 0;
            bucket[categorizeRisk(typeMaxODDays, utilization)]++;
          }
        }
        return { month, critical: bucket.critical, high: bucket.high, medium: bucket.medium, low: bucket.low };
      });
    }

    // No filter — compute consolidated monthly risk per customer from trend data
    return months.map((month) => {
      const bucket: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
      if (month === asOfMonth) {
        // As-of month: use customers.json data directly → exact KPI match
        const b = countByRisk(segmentedConsolidatedCustomers);
        bucket.low = b.low; bucket.medium = b.medium; bucket.high = b.high; bucket.critical = b.critical;
      } else {
        for (const c of segmentedConsolidatedCustomers) {
          let monthOutstandingL = 0;
          let monthMaxODDays    = 0;
          for (const id of c.constituentIds) {
            const mt = customerDetail[id]?.trend.find((t) => t.month === month);
            if (!mt) continue;
            monthOutstandingL += mt.outstanding;
            monthMaxODDays     = Math.max(monthMaxODDays, mt.maxOverdueDays ?? 0);
          }
          if (monthOutstandingL <= 0) continue;
          const utilization = c.creditLimit > 0
            ? Math.round(monthOutstandingL * 100_000 / c.creditLimit * 1000) / 10
            : 0;
          bucket[categorizeRisk(monthMaxODDays, utilization)]++;
        }
      }
      return { month, critical: bucket.critical, high: bucket.high, medium: bucket.medium, low: bucket.low };
    });
  }, [segmentedConsolidatedCustomers, customerDetail, dashboard?.trend, saleTypeList]);

  // ── Sale Type Reconciliation Breakdown ──────────────────────────────────────
  // Always uses allCustomers (unfiltered) so the table always shows full-year totals
  // and the Total row matches the dashboard KPI cards exactly.
  const saleTypeBreakdown = useMemo<SaleTypeBreakdown>(() => {
    const ALL_TYPES: SaleType[] = ["ink", "spare_parts", "machine", "other"];
    const TYPE_LABELS = {
      ink: "Ink", spare_parts: "Spare Parts", machine: "Machine", other: "Other",
    } as unknown as Record<SaleType, string>;
    const sum = (fn: (c: Customer) => number) => allCustomers.reduce((s, c) => s + fn(c), 0);

    // Opening Balance row
    const obRow: SaleTypeBreakdownRow = {
      label:          "Opening Balance",
      type:           "opening_balance",
      openingBalance: sum((c) => c.openingBalance),
      sales:          0,
      receipts:       sum((c) => c.obReceiptsApplied    ?? 0),
      creditNotes:    sum((c) => c.obCreditNotesApplied ?? 0),
      checkReturns:   0,
      advanceBalance: 0,
      outstanding:    sum((c) => c.remainingOpeningBalance),
      overdue:        sum((c) => c.remainingOpeningBalance), // all OB is overdue per business rules
      criticalCount:  0,
      overLimitCount: 0,
      overdue180Count: 0,
    };

    // Per-type rows
    const typeRows: SaleTypeBreakdownRow[] = ALL_TYPES.map((t) => ({
      label:           TYPE_LABELS[t],
      type:            t,
      openingBalance:  0,
      sales:           sum((c) => c.salesByType?.[t]       ?? 0),
      receipts:        sum((c) => c.receiptsByType?.[t]     ?? 0),
      creditNotes:     sum((c) => c.creditNotesByType?.[t]  ?? 0),
      checkReturns:    0,
      advanceBalance:  0,
      outstanding:     sum((c) => c.outstandingByType?.[t]  ?? 0),
      overdue:         sum((c) => c.overdueByType?.[t]      ?? 0),
      criticalCount:   allCustomers.filter((c) => (c.outstandingByType?.[t] ?? 0) > 0 && c.risk === "critical").length,
      overLimitCount:  allCustomers.filter((c) => (c.outstandingByType?.[t] ?? 0) > 0 && c.utilization > 100).length,
      overdue180Count: allCustomers.filter((c) => (c.outstandingByType?.[t] ?? 0) > 0 && c.maxOverdueDays > 180).length,
    }));

    // Unmapped row — unallocated pool (advance balance sources) + all cheque returns.
    // Manual Other Payments carry no sale type, so their whole collection lands here
    // (the only untyped receipts bucket) — this is what makes the Total column foot to
    // the NET outstanding, which already reflects the Other-Payment reduction.
    const unmappedRow: SaleTypeBreakdownRow = {
      label:           "Unmapped",
      type:            "unmapped",
      openingBalance:  0,
      sales:           0,
      receipts:        sum((c) => (c.advanceBreakdown?.onAccount ?? 0) + (c.advanceBreakdown?.agstRefExcess ?? 0) + (c.otherPayments ?? 0)),
      creditNotes:     sum((c) => c.advanceBreakdown?.creditNotes ?? 0),
      checkReturns:    sum((c) => c.checkReturns ?? 0),
      advanceBalance:  sum((c) => c.advanceBalance ?? 0),
      outstanding:     0,
      overdue:         0,
      criticalCount:   0,
      overLimitCount:  0,
      overdue180Count: 0,
    };

    // Total row — uses actual customer field sums (= KPI card values for Outstanding etc.)
    const totalRow: SaleTypeBreakdownRow = {
      label:           "Total",
      type:            "total",
      openingBalance:  sum((c) => c.openingBalance),
      sales:           sum((c) => c.sales),
      receipts:        sum((c) => c.receipts + (c.otherPayments ?? 0)), // Tally receipts + Other Payments (NET outstanding reflects OP)
      creditNotes:     sum((c) => c.creditNotes),
      checkReturns:    sum((c) => c.checkReturns),
      advanceBalance:  sum((c) => c.advanceBalance),
      outstanding:     sum((c) => outstandingContribution(c)), // = KPI totalOutstanding (NET, see receivables.ts)
      overdue:         sum((c) => c.overdue),
      criticalCount:   allCustomers.filter((c) => c.risk === "critical").length,
      overLimitCount:  allCustomers.filter((c) => c.utilization > 100).length,
      overdue180Count: allCustomers.filter((c) => c.maxOverdueDays > 180).length,
    };

    return {
      rows: [obRow, ...typeRows, unmappedRow],
      total: totalRow,
    };
  }, [allCustomers]);

  const salesPersonOptions = useMemo(
    () => [...new Set(projectedConsolidatedCustomers.flatMap((c) => c.salesPersons ?? (c.salesPerson ? [c.salesPerson] : [])).filter(Boolean))].sort(),
    [projectedConsolidatedCustomers],
  );

  // Grouped customer rows — filter-aware (uses the same consolidatedCustomers
  // chain so toggling between Customer/Group view doesn't change which records
  // are included, only how they're aggregated).
  const groupedCustomers = useMemo<GroupedCustomer[]>(
    () => consolidateByGroup(consolidatedCustomers, customerGroupMap),
    [consolidatedCustomers, customerGroupMap],
  );

  return {
    loading,
    error,
    customers: projectedCustomers,
    allCustomers,
    consolidatedCustomers,
    groupedCustomers,
    customerGroupMap,
    dashboard,
    kpis,
    trend,
    aging,
    riskSegmentation,
    topRiskyCustomers,
    alerts,
    customerDetail: filteredCustomerDetail,
    outstandingByType,
    utilizationBuckets,
    companyLocationBreakdown,
    riskTrend,
    riskCountTrend,
    saleTypeBreakdown,
    lowCollectionCount,
    lowCollectionCustomers,
    salesPersonOptions,
  };
}
