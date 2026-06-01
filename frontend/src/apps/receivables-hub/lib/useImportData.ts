import { useState, useEffect, useMemo, useCallback } from "react";
import type {
  ImportSummary,
  ImportTransaction,
  ImportFilters,
  ImportKPIs,
  ImportGroupNode,
  ImportEntitySummary,
  ImportEntityIndex,
  ImportYearTrend,
  ImportGroupByYear,
  ImportProductMonthRow,
} from "./importTypes";

interface UseImportDataResult {
  loading: boolean;
  error: string | null;
  summary: ImportSummary | null;

  // Derived / filtered
  kpis: ImportKPIs | null;
  groupTree: ImportGroupNode[];
  filteredBuyers: ImportEntityIndex[];
  filteredSellers: ImportEntityIndex[];
  topBuyers: ImportEntitySummary[];
  topSellers: ImportEntitySummary[];
  yearTrend: ImportYearTrend[];
  groupByYear: ImportGroupByYear[];
  productMonthMatrix: ImportProductMonthRow[];

  // Transactions (lazy-loaded, for detail table)
  transactionsLoading: boolean;
  filteredTransactions: ImportTransaction[];
  loadTransactions: () => void;
  transactionsLoaded: boolean;
}

export function useImportData(filters: ImportFilters = {}): UseImportDataResult {
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [allTransactions, setAllTransactions] = useState<ImportTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [transactionsLoaded, setTransactionsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/data/import_summary.json")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data: ImportSummary) => { setSummary(data); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  const loadTransactions = useCallback(() => {
    if (transactionsLoaded || transactionsLoading) return;
    setTransactionsLoading(true);
    fetch("/data/import_transactions.json")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data: ImportTransaction[]) => {
        setAllTransactions(data);
        setTransactionsLoaded(true);
        setTransactionsLoading(false);
      })
      .catch((e) => { setError(e.message); setTransactionsLoading(false); });
  }, [transactionsLoaded, transactionsLoading]);

  const { year, products, groups, subGroup, buyers, sellers, pivotMonth, pivotUnit, pivotProduct } = filters;

  // Normalise all multi-select arrays to Sets for O(1) lookups
  const productsSet = useMemo(() => new Set(products ?? []), [products]);
  const groupsSet   = useMemo(() => new Set(groups   ?? []), [groups]);
  const buyersSet   = useMemo(() => new Set(buyers   ?? []), [buyers]);
  const sellersSet  = useMemo(() => new Set(sellers  ?? []), [sellers]);
  const hasProducts = productsSet.size > 0;
  const hasGroups   = groupsSet.size > 0;
  const hasBuyers   = buyersSet.size > 0;
  const hasSellers  = sellersSet.size > 0;
  // subGroup only meaningful when exactly one group is selected
  const effectiveSubGroup = groupsSet.size === 1 ? subGroup : undefined;

  // Helper: apply all standard + pivot filters to a transaction array
  // skipPivotMonth: true for productMonthMatrix (all months still shown, unit highlights rows)
  // skipPivotUnit: true for unitProductMatrix (all units shown, month highlights rows)
  const applyFilters = useCallback((txns: typeof allTransactions, opts?: { skipPivotMonth?: boolean; skipPivotUnit?: boolean }) => {
    if (year)               txns = txns.filter((t) => t.year === year);
    if (hasProducts)        txns = txns.filter((t) => productsSet.has(t.product));
    if (hasGroups)          txns = txns.filter((t) => groupsSet.has(t.group));
    if (effectiveSubGroup)  txns = txns.filter((t) => t.subGroup === effectiveSubGroup);
    if (hasBuyers)          txns = txns.filter((t) => buyersSet.has(t.buyer));
    if (hasSellers)         txns = txns.filter((t) => sellersSet.has(t.seller));
    if (!opts?.skipPivotMonth && pivotMonth)   txns = txns.filter((t) => t.date?.slice(0, 7) === pivotMonth);
    if (!opts?.skipPivotUnit  && pivotUnit)    txns = txns.filter((t) => (t.unit || "—") === pivotUnit);
    if (pivotProduct)       txns = txns.filter((t) => t.product === pivotProduct);
    return txns;
  }, [year, hasProducts, productsSet, hasGroups, groupsSet, effectiveSubGroup, hasBuyers, buyersSet, hasSellers, sellersSet, pivotMonth, pivotUnit, pivotProduct]);

  // ── Filtered Group tree ────────────────────────────────────────────────────
  const groupTree = useMemo<ImportGroupNode[]>(() => {
    if (!summary) return [];

    // When entity filters (buyer/seller/product) are active and transactions loaded,
    // recalculate from filtered transactions so group totals match KPI card.
    const anyPivot = pivotMonth || pivotUnit || pivotProduct;
    if ((hasBuyers || hasSellers || hasProducts || anyPivot) && transactionsLoaded && allTransactions.length > 0) {
      let txns = applyFilters(allTransactions);

      type SubMap = Map<string, { qty: number; value: number }>;
      const grpMap = new Map<string, { qty: number; value: number; subcats: SubMap }>();
      for (const t of txns) {
        if (!grpMap.has(t.group)) grpMap.set(t.group, { qty: 0, value: 0, subcats: new Map() });
        const grp = grpMap.get(t.group)!;
        grp.qty   += t.qty;
        grp.value += t.value;
        const subKey = t.subGroup || "(unclassified)";
        if (!grp.subcats.has(subKey)) grp.subcats.set(subKey, { qty: 0, value: 0 });
        const sub = grp.subcats.get(subKey)!;
        sub.qty   += t.qty;
        sub.value += t.value;
      }

      const r2 = (n: number) => Math.round(n * 100) / 100;
      const origMap = new Map(summary.groupTree.map((n) => [n.name, n]));
      const tree: ImportGroupNode[] = [];
      for (const [grpName, grpData] of grpMap.entries()) {
        const orig = origMap.get(grpName);
        const subcategories = orig
          ? orig.subcategories
              .map((sub) => {
                const sd = grpData.subcats.get(sub.name);
                return sd ? { ...sub, totalQty: r2(sd.qty), totalValue: r2(sd.value) } : null;
              })
              .filter(Boolean) as ImportGroupNode["subcategories"]
          : [];
        tree.push({
          ...(orig ?? { name: grpName, transactionCount: 0, byYear: {}, subcategories: [] }),
          totalQty:   r2(grpData.qty),
          totalValue: r2(grpData.value),
          subcategories,
        });
      }
      tree.sort((a, b) => b.totalQty - a.totalQty);
      return tree;
    }

    let tree = summary.groupTree;
    if (year) {
      tree = tree
        .map((node) => {
          const yd = node.byYear[String(year)];
          if (!yd || yd.qty === 0) return null;
          return { ...node, totalQty: yd.qty, totalValue: yd.value };
        })
        .filter(Boolean) as ImportGroupNode[];
      tree.sort((a, b) => b.totalQty - a.totalQty);
    }
    return tree;
  }, [summary, applyFilters, pivotMonth, pivotUnit, pivotProduct, year, hasProducts, hasBuyers, hasSellers, transactionsLoaded, allTransactions]);

  // ── Filtered buyers ────────────────────────────────────────────────────────
  const filteredBuyers = useMemo<ImportEntityIndex[]>(() => {
    if (!summary) return [];
    const anyPivot = pivotMonth || pivotUnit || pivotProduct;
    if (!hasSellers && !hasGroups && !hasProducts && !anyPivot) return summary.allBuyers;

    if (transactionsLoaded && allTransactions.length > 0) {
      const txns = applyFilters(allTransactions.filter((t) => !hasSellers || sellersSet.has(t.seller)));
      const uniqueNames = [...new Set(txns.map((t) => t.buyer))];
      const allBuyersMap = new Map(summary.allBuyers.map((b) => [b.name, b]));
      return uniqueNames
        .map((name) => allBuyersMap.get(name) ?? { name, country: "", totalValue: 0 })
        .sort((a, b) => b.totalValue - a.totalValue);
    }

    // Summary-based fallback
    let candidateNames: Set<string> | null = null;
    const intersect = (names: Iterable<string>) => {
      const s = new Set(names);
      candidateNames = candidateNames === null ? s : new Set([...candidateNames].filter((n) => s.has(n)));
    };

    if (hasGroups) {
      intersect(summary.topBuyers
        .filter((b) => [...groupsSet].some((g) => g in b.groupSplit))
        .map((b) => b.name));
    }
    if (hasSellers) {
      const fromSellers = new Set<string>();
      for (const sellerName of sellersSet) {
        const sel = summary.topSellers.find((s) => s.name === sellerName);
        sel?.buyers?.forEach((b) => fromSellers.add(b));
      }
      intersect(fromSellers);
    }

    if (candidateNames === null) return summary.allBuyers;
    const finalNames = candidateNames as Set<string>;
    return summary.allBuyers.filter((b) => finalNames.has(b.name));
  }, [summary, applyFilters, allTransactions, transactionsLoaded, pivotMonth, pivotUnit, pivotProduct, hasProducts, hasSellers, sellersSet, hasGroups, groupsSet]);

  // ── Filtered sellers ───────────────────────────────────────────────────────
  const filteredSellers = useMemo<ImportEntityIndex[]>(() => {
    if (!summary) return [];
    const anyPivot = pivotMonth || pivotUnit || pivotProduct;
    if (!hasBuyers && !hasGroups && !hasProducts && !anyPivot) return summary.allSellers;

    if (transactionsLoaded && allTransactions.length > 0) {
      const txns = applyFilters(allTransactions.filter((t) => !hasBuyers || buyersSet.has(t.buyer)));
      const uniqueNames = [...new Set(txns.map((t) => t.seller))];
      const allSellersMap = new Map(summary.allSellers.map((s) => [s.name, s]));
      return uniqueNames
        .map((name) => allSellersMap.get(name) ?? { name, country: "", totalValue: 0 })
        .sort((a, b) => b.totalValue - a.totalValue);
    }

    // Summary-based fallback
    let candidateNames: Set<string> | null = null;
    const intersect = (names: Iterable<string>) => {
      const s = new Set(names);
      candidateNames = candidateNames === null ? s : new Set([...candidateNames].filter((n) => s.has(n)));
    };

    if (hasGroups) {
      intersect(summary.topSellers
        .filter((s) => [...groupsSet].some((g) => g in s.groupSplit))
        .map((s) => s.name));
    }
    if (hasBuyers) {
      const fromBuyers = new Set<string>();
      for (const buyerName of buyersSet) {
        const byr = summary.topBuyers.find((b) => b.name === buyerName);
        byr?.sellers?.forEach((s) => fromBuyers.add(s));
      }
      intersect(fromBuyers);
    }

    if (candidateNames === null) return summary.allSellers;
    const finalNames = candidateNames as Set<string>;
    return summary.allSellers.filter((s) => finalNames.has(s.name));
  }, [summary, applyFilters, allTransactions, transactionsLoaded, pivotMonth, pivotUnit, pivotProduct, hasProducts, hasBuyers, buyersSet, hasGroups, groupsSet]);

  // ── KPIs ───────────────────────────────────────────────────────────────────
  const kpis = useMemo<ImportKPIs | null>(() => {
    if (!summary) return null;
    const anyPivot = pivotMonth || pivotUnit || pivotProduct;
    if (!year && !hasProducts && !hasGroups && !hasBuyers && !hasSellers && !anyPivot) return summary.kpis;

    if (transactionsLoaded && allTransactions.length > 0) {
      const txns = applyFilters(allTransactions);
      const totalQty   = txns.reduce((s, t) => s + t.qty, 0);
      const totalValue = txns.reduce((s, t) => s + t.value, 0);
      return {
        totalTransactions: txns.length,
        totalQuantityKgs:  Math.round(totalQty   * 100) / 100,
        totalValueUsd:     Math.round(totalValue * 100) / 100,
        totalBuyers:  new Set(txns.map((t) => t.buyer)).size,
        totalSellers: new Set(txns.map((t) => t.seller)).size,
        avgPricePerUnit: totalQty > 0 ? Math.round((totalValue / totalQty) * 100) / 100 : 0,
      };
    }

    return summary.kpis;
  }, [summary, applyFilters, allTransactions, transactionsLoaded, pivotMonth, pivotUnit, pivotProduct, year, hasProducts, hasGroups, hasBuyers, hasSellers]);

  // ── Top buyers / sellers ───────────────────────────────────────────────────
  const topBuyers  = useMemo(() => summary?.topBuyers.slice(0, 10)  ?? [], [summary]);
  const topSellers = useMemo(() => summary?.topSellers.slice(0, 10) ?? [], [summary]);

  // ── Year trend / group-by-year ─────────────────────────────────────────────
  const yearTrend    = useMemo(() => summary?.yearTrend  ?? [], [summary]);
  const groupByYear  = useMemo(() => summary?.groupByYear ?? [], [summary]);

  // ── Product × Month pivot (recomputed from transactions when filters active) ──
  const productMonthMatrix = useMemo<ImportProductMonthRow[]>(() => {
    if (!summary) return [];

    const anyFilter = year || hasProducts || hasGroups || hasBuyers || hasSellers;
    if (!anyFilter) return summary.productMonthMatrix;

    if (transactionsLoaded && allTransactions.length > 0) {
      // skipPivotMonth: all months still visible; pivotUnit/pivotProduct narrow the data
      const txns = applyFilters(allTransactions, { skipPivotMonth: true });

      // Build month → product map from filtered transactions
      const monthMap = new Map<string, { label: string; products: Map<string, { qty: number; value: number }> }>();
      for (const t of txns) {
        if (!t.month || !t.year) continue;
        const mkey = t.date ? t.date.slice(0, 7) : "";
        if (!mkey) continue;
        if (!monthMap.has(mkey)) monthMap.set(mkey, { label: t.month, products: new Map() });
        const entry = monthMap.get(mkey)!;
        if (!entry.products.has(t.product)) entry.products.set(t.product, { qty: 0, value: 0 });
        const pd = entry.products.get(t.product)!;
        pd.qty   += t.qty;
        pd.value += t.value;
      }

      const r2 = (n: number) => Math.round(n * 100) / 100;
      const allProds = summary.products;
      const result: ImportProductMonthRow[] = [];
      for (const [mkey, entry] of [...monthMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const row: ImportProductMonthRow = { month: entry.label, monthKey: mkey };
        for (const prod of allProds) {
          const pd = entry.products.get(prod) ?? { qty: 0, value: 0 };
          row[prod] = { qty: r2(pd.qty), value: r2(pd.value) };
        }
        result.push(row);
      }
      return result;
    }

    return summary.productMonthMatrix;
  }, [summary, applyFilters, allTransactions, transactionsLoaded, pivotUnit, pivotProduct, year, hasProducts, hasGroups, hasBuyers, hasSellers]);

  // ── Filtered transactions ──────────────────────────────────────────────────
  const filteredTransactions = useMemo<ImportTransaction[]>(() => {
    if (!transactionsLoaded || allTransactions.length === 0) return [];
    return applyFilters(allTransactions);
  }, [applyFilters, allTransactions, transactionsLoaded]);

  return {
    loading, error, summary, kpis,
    groupTree, filteredBuyers, filteredSellers,
    topBuyers, topSellers, yearTrend, groupByYear, productMonthMatrix,
    transactionsLoading, filteredTransactions, loadTransactions, transactionsLoaded,
  };
}
