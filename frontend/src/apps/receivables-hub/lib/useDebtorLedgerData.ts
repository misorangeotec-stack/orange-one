/**
 * useDebtorLedgerData.ts — one customer's (or group's) ledgers, resolved and loaded.
 *
 * The React half of the Debtor Analysis report: it fetches and resolves, and computes nothing
 * that debtorAnalysis.ts could compute purely. Everything here is lifted from CustomerDetail,
 * which has done all of it inline since before there was a second page that needed it.
 *
 * ── Why it is a hook and not a copy ───────────────────────────────────────────────────────
 * The Live source deliberately keeps transaction lists OUT of the bulk snapshot — they are only
 * ever read one customer at a time — so each page fetches them per ledger. Those fetches are
 * cached on `["cwLedgerTxns", entityIds, fySuffix]`, which means the Analysis page is free ONLY
 * if it derives `entityIds` exactly as Customer Detail does: same muster lookup, same name
 * fallback, same sort. Deriving it here, once, is what makes the second page a cache hit rather
 * than a second round trip. A hand-copied resolution that drifts by one ledger silently doubles
 * the load and shows two screens two different customers.
 *
 * ── The traps it carries over, all of them load-bearing ───────────────────────────────────
 *  - Group membership is resolved by GUID first. 387 ledger names repeat across companies, so a
 *    pure name match drags in same-named ledgers whose own muster row says a different group.
 *  - `overdue` is ALREADY net of On Account — the database caps it per ledger. `onAccount` is a
 *    display figure for the bridge line, not something to subtract again.
 *  - On the group route the consolidated customer's id is `G:<groupName>` and belongs to no
 *    ledger, so per-ledger figures are summed over `activeEntities`, never read off `customer`.
 *  - `Agst Ref` invoice lines are Tally's internal advance bookkeeping and are excluded; the
 *    balance test is `amount > 0 || pending < 0` so genuine credit bills still come through.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAppData, consolidateByName, consolidateByGroup } from "@hub/lib/useAppData";
import { useReceivablesSource } from "@hub/lib/sourceContext";
import { useFY } from "@hub/lib/fyContext";
import type { Customer, CustomerGroupMap, Invoice, MonthlyTrend } from "@hub/lib/types";
import type { DebtorVoucherStreams } from "@hub/lib/debtorAnalysis";

/** An entity-tagged row: which company / location of this customer it came from. */
type Tagged<T> = T & { _company: string; _location: string };

export interface DebtorLedgerData {
  loading: boolean;
  error: string | null;
  /** The consolidated customer / group. Null when the name resolves to nothing in scope. */
  customer: Customer | null;
  allEntities: Customer[];
  activeEntities: Customer[];
  isConsolidated: boolean;
  groupChildNames: string[];
  entityCompanies: string[];
  entityLocations: string[];
  /** Consolidated month-by-month trend, in LAKHS, UNPINNED (debtorAnalysis does the pinning). */
  trend: MonthlyTrend[];
  vouchers: DebtorVoucherStreams;
  invoices: Tagged<Invoice>[];
  /** Normalised bill ref → ISO raise date. Live only; undefined elsewhere. */
  billMeta: Record<string, string> | undefined;
  onAccount: number;
  overdueNet: number;
  overdueGross: number;
  /** False while the Live voucher fetch is still in flight — the gate for any column derived
   *  from dated vouchers, which would otherwise render a fabricated zero on first paint. */
  vouchersReady: boolean;
  asOfDate: string | undefined;
  source: string;
  fySuffix: string;
  fyLabel: string;
}

export interface DebtorLedgerOptions {
  /** The decoded route param — a Tally name, or a group name on the group route. */
  name: string;
  isGroupRoute: boolean;
  entityCompany?: string;
  entityLocation?: string;
  selectedChildren?: Set<string> | null;
  /** normalizeSaleType output. Forced to "all" on Live by the caller. */
  effectiveSaleType?: string;
}

export function useDebtorLedgerData(opts: DebtorLedgerOptions): DebtorLedgerData {
  const {
    name, isGroupRoute,
    entityCompany = "all", entityLocation = "all",
    selectedChildren = null, effectiveSaleType = "all",
  } = opts;

  const source = useReceivablesSource();
  const { suffix: fySuffix, label: fyLabel } = useFY();

  const {
    loading, error, customers, allCustomers,
    customerDetail: baseCustomerDetail, customerGroupMap, dashboard,
  } = useAppData({ saleType: effectiveSaleType });

  // ── Group membership ──────────────────────────────────────────────────────────────────────
  const groupChildNames = useMemo<string[]>(() => {
    if (!isGroupRoute) return [];
    const explicit = customerGroupMap.groups?.[name] ?? [];
    if (explicit.length > 0) return [...explicit].sort();
    return [name];   // an ungrouped customer reached via /group/:name
  }, [isGroupRoute, customerGroupMap.groups, name]);

  // ── All raw ledgers for this customer / group ─────────────────────────────────────────────
  const allEntities = useMemo(() => {
    if (isGroupRoute) {
      const childSet = new Set(groupChildNames);
      const byLedgerId = customerGroupMap.byLedgerId ?? {};
      return allCustomers.filter((c) => {
        const mapped = byLedgerId[c.id];
        return mapped ? mapped === name : childSet.has(c.name);
      });
    }
    return allCustomers.filter((c) => c.name === name);
  }, [allCustomers, name, isGroupRoute, groupChildNames, customerGroupMap.byLedgerId]);

  // ── Live: lazily fetch these ledgers' voucher history ─────────────────────────────────────
  const entityIds = useMemo(() => [...allEntities.map((e) => e.id)].sort(), [allEntities]);
  const { data: liveTxns } = useQuery({
    queryKey: ["cwLedgerTxns", entityIds, fySuffix],
    queryFn: () =>
      import("@hub/lib/connectwaveFetcher").then((m) => m.fetchConnectwaveLedgerTxns(entityIds, fySuffix)),
    enabled: source === "connectwave" && entityIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const customerDetail = useMemo(() => {
    if (source !== "connectwave" || !liveTxns) return baseCustomerDetail;
    const merged: typeof baseCustomerDetail = { ...baseCustomerDetail };
    for (const [id, lists] of Object.entries(liveTxns.byLedger)) {
      const base = baseCustomerDetail[id] ?? { invoices: [], trend: [], receiptTransactions: [] };
      // Fold in the bills rebuilt from Tally's allocations so SETTLED invoices appear too — the
      // snapshot carries open bills only. The snapshot's row WINS wherever a bill is in both: it
      // is authoritative for pending / dueDate / overdueDays, which a rebuilt row cannot know.
      const rebuilt = liveTxns.invoicesByLedger[id] ?? [];
      const open = new Set(base.invoices.map((inv) => (inv.number ?? "").trim().toUpperCase()));
      const settled = rebuilt.filter((inv) => !open.has((inv.number ?? "").trim().toUpperCase()));
      const typeByRef = new Map(rebuilt.map((inv) => [(inv.number ?? "").trim().toUpperCase(), inv.voucherType]));
      const openWithType = base.invoices.map((inv) => {
        const t = typeByRef.get((inv.number ?? "").trim().toUpperCase());
        return t && t !== inv.voucherType ? { ...inv, voucherType: t } : inv;
      });
      merged[id] = { ...base, ...lists, invoices: [...openWithType, ...settled] };
    }
    return merged;
  }, [source, liveTxns, baseCustomerDetail]);

  const billMeta = source === "connectwave" ? liveTxns?.billMeta : undefined;
  const vouchersReady = source !== "connectwave" || liveTxns !== undefined;

  // ── Company / location option lists, each narrowed by the other ───────────────────────────
  const entityCompanies = useMemo(
    () => [...new Set(
      allEntities.filter((c) => entityLocation === "all" || c.location === entityLocation).map((c) => c.company),
    )].sort(),
    [allEntities, entityLocation],
  );
  const entityLocations = useMemo(
    () => [...new Set(
      allEntities.filter((c) => entityCompany === "all" || c.company === entityCompany).map((c) => c.location),
    )].sort(),
    [allEntities, entityCompany],
  );

  // ── The ledgers currently in view ─────────────────────────────────────────────────────────
  const activeEntities = useMemo(() => {
    let list = allEntities;
    if (isGroupRoute && selectedChildren && selectedChildren.size > 0) {
      list = list.filter((c) => selectedChildren.has(c.name));
    }
    if (entityCompany !== "all")  list = list.filter((c) => c.company  === entityCompany);
    if (entityLocation !== "all") list = list.filter((c) => c.location === entityLocation);
    return list;
  }, [allEntities, entityCompany, entityLocation, isGroupRoute, selectedChildren]);

  const projectedById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const projectedActiveEntities = useMemo<Customer[]>(() => {
    if (effectiveSaleType === "all") return activeEntities;
    return activeEntities
      .map((e) => projectedById.get(e.id))
      .filter((c): c is Customer => Boolean(c));
  }, [activeEntities, projectedById, effectiveSaleType]);

  // ── The consolidated customer ─────────────────────────────────────────────────────────────
  const customer = useMemo(() => {
    if (activeEntities.length === 0) return null;
    const consolidate = (ents: Customer[]): Customer | null => {
      if (ents.length === 0) return null;
      if (isGroupRoute) {
        const byName = consolidateByName(ents);
        if (byName.length === 0) return null;
        // Force every selected child into the one group. BOTH keys are populated: groupNameOf()
        // resolves by ledger id first, so a name-only synthetic map would let a child with a real
        // muster entry escape into its own group.
        const synthetic: CustomerGroupMap = { byLedgerId: {}, mapping: {}, groups: { [name]: [] } };
        for (const c of byName) {
          synthetic.mapping[c.name] = name;
          synthetic.groups[name].push(c.name);
          for (const id of c.constituentIds ?? []) synthetic.byLedgerId[id] = name;
        }
        return consolidateByGroup(byName, synthetic)[0] ?? null;
      }
      if (ents.length === 1) return ents[0];
      return consolidateByName(ents)[0] ?? null;
    };
    if (effectiveSaleType === "all") return consolidate(activeEntities);
    if (projectedActiveEntities.length > 0) return consolidate(projectedActiveEntities);
    const base = consolidate(activeEntities);
    return base
      ? { ...base, sales: 0, receipts: 0, creditNotes: 0, outstanding: 0, overdue: 0, maxOverdueDays: 0 }
      : null;
  }, [activeEntities, projectedActiveEntities, effectiveSaleType, isGroupRoute, name]);

  const isConsolidated = allEntities.length > 1 && activeEntities.length > 1;

  // ── On Account, and the overdue bridge ────────────────────────────────────────────────────
  // Summed over RAW ledgers: the database caps On Account per ledger, and the consolidated
  // customer has no ledger of its own on the group route.
  const netOnAccount = source === "connectwave" && effectiveSaleType === "all";
  const onAccount = useMemo(
    () => (netOnAccount ? activeEntities.reduce((t, c) => t + (c.onAccount ?? 0), 0) : 0),
    [netOnAccount, activeEntities],
  );
  // ⚠ Already NET — collection_refresh() caps it in the database. Subtracting onAccount again
  // here was a double deduction worth ~₹11.6 Cr book-wide.
  const overdueNet = customer?.overdue ?? 0;
  const overdueGross = customer?.overdueGross ?? (overdueNet + onAccount);

  // ── Merged transaction streams ────────────────────────────────────────────────────────────
  const tag = <T,>(e: Customer, rows: readonly T[]): Tagged<T>[] =>
    rows.map((r) => ({ ...r, _company: e.company, _location: e.location }));

  const invoices = useMemo(() =>
    activeEntities
      .flatMap((e) => tag(e, (customerDetail[e.id]?.invoices ?? [])
        .filter((inv) => inv.billType !== "Agst Ref" && (inv.amount > 0 || inv.pending < 0))))
      .sort((a, b) => a.date.localeCompare(b.date)),
    [activeEntities, customerDetail],
  );

  const vouchers = useMemo<DebtorVoucherStreams>(() => ({
    creditNotes: activeEntities
      .flatMap((e) => customerDetail[e.id]?.creditNoteTransactions ?? [])
      .sort((a, b) => a.date.localeCompare(b.date)),
    debitNotes: activeEntities
      .flatMap((e) => customerDetail[e.id]?.debitNoteTransactions ?? [])
      .sort((a, b) => a.date.localeCompare(b.date)),
    journals: activeEntities
      .flatMap((e) => customerDetail[e.id]?.journalTransactions ?? [])
      .sort((a, b) => a.date.localeCompare(b.date)),
    receipts: activeEntities
      .flatMap((e) => (customerDetail[e.id]?.receiptTransactions ?? []).filter((t) => t.date))
      .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "")),
  }), [activeEntities, customerDetail]);

  // ── Consolidated monthly trend ────────────────────────────────────────────────────────────
  // Summed by month across the ledgers in view. Deliberately UNPINNED: pinning the as-of month
  // to the headline figures is debtorAnalysis's job, so the report and its exports pin once,
  // identically, rather than each doing it their own way.
  const trend = useMemo<MonthlyTrend[]>(() => {
    const byMonth = new Map<string, MonthlyTrend>();
    for (const e of activeEntities) {
      for (const t of customerDetail[e.id]?.trend ?? []) {
        const m = byMonth.get(t.month);
        if (!m) {
          byMonth.set(t.month, { ...t });
        } else {
          m.sales       += t.sales;
          m.receipts    += t.receipts;
          m.creditNotes += t.creditNotes;
          m.outstanding += t.outstanding;
          m.overdue     += t.overdue;
        }
      }
    }
    return [...byMonth.values()];
  }, [activeEntities, customerDetail]);

  return {
    loading, error,
    customer, allEntities, activeEntities, isConsolidated, groupChildNames,
    entityCompanies, entityLocations,
    trend, vouchers, invoices, billMeta,
    onAccount, overdueNet, overdueGross,
    vouchersReady,
    asOfDate: dashboard?.asOfDate,
    source, fySuffix, fyLabel,
  };
}
