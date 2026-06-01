import { useState, useEffect, useMemo, useCallback } from "react";
import type {
  EximSummary,
  EximTransaction,
  EximFilters,
  EximKPIs,
  EximCat3Node,
  EximEntitySummary,
  EximEntityIndex,
  EximYearTrend,
  EximCategoryByYear,
} from "./eximTypes";

interface UseEximDataResult {
  loading: boolean;
  error: string | null;
  summary: EximSummary | null;

  // Derived / filtered
  kpis: EximKPIs | null;
  cat3Tree: EximCat3Node[];
  filteredBuyers: EximEntityIndex[];
  filteredSellers: EximEntityIndex[];
  topBuyers: EximEntitySummary[];
  topSellers: EximEntitySummary[];
  yearTrend: EximYearTrend[];
  categoryByYear: EximCategoryByYear[];

  // Transactions (lazy-loaded, for detail table)
  transactionsLoading: boolean;
  filteredTransactions: EximTransaction[];
  loadTransactions: () => void;
  transactionsLoaded: boolean;
}

export function useEximData(filters: EximFilters = {}): UseEximDataResult {
  const [summary, setSummary] = useState<EximSummary | null>(null);
  const [allTransactions, setAllTransactions] = useState<EximTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [transactionsLoaded, setTransactionsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/data/exim_summary.json")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data: EximSummary) => { setSummary(data); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  const loadTransactions = useCallback(() => {
    if (transactionsLoaded || transactionsLoading) return;
    setTransactionsLoading(true);
    fetch("/data/exim_transactions.json")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data: EximTransaction[]) => {
        setAllTransactions(data);
        setTransactionsLoaded(true);
        setTransactionsLoading(false);
      })
      .catch((e) => { setError(e.message); setTransactionsLoading(false); });
  }, [transactionsLoaded, transactionsLoading]);

  const { year, buyerCountries, sellerCountries, cat3, subcat3, buyers, sellers } = filters;

  // Normalise all multi-select arrays to Sets for O(1) lookups
  const cat3Set             = useMemo(() => new Set(cat3             ?? []), [cat3]);
  const buyersSet           = useMemo(() => new Set(buyers           ?? []), [buyers]);
  const sellersSet          = useMemo(() => new Set(sellers          ?? []), [sellers]);
  const buyerCountriesSet   = useMemo(() => new Set(buyerCountries   ?? []), [buyerCountries]);
  const sellerCountriesSet  = useMemo(() => new Set(sellerCountries  ?? []), [sellerCountries]);
  const hasCat3             = cat3Set.size > 0;
  const hasBuyers           = buyersSet.size > 0;
  const hasSellers          = sellersSet.size > 0;
  const hasBuyerCountries   = buyerCountriesSet.size > 0;
  const hasSellerCountries  = sellerCountriesSet.size > 0;
  // subcat3 only meaningful when exactly one cat3 is selected
  const effectiveSubcat3 = cat3Set.size === 1 ? subcat3 : undefined;

  // ── Filtered Cat3 tree ─────────────────────────────────────────────────────
  const cat3Tree = useMemo<EximCat3Node[]>(() => {
    if (!summary) return [];

    // When any entity filter (country, buyer, seller) is active and transactions are loaded,
    // recalculate quantities from filtered transactions so category totals match the KPI card.
    if ((hasBuyerCountries || hasSellerCountries || hasBuyers || hasSellers) && transactionsLoaded && allTransactions.length > 0) {
      let txns = allTransactions;
      if (year)                txns = txns.filter((t) => t.year === year);
      if (hasBuyerCountries)   txns = txns.filter((t) => buyerCountriesSet.has(t.buyerCountry));
      if (hasSellerCountries)  txns = txns.filter((t) => sellerCountriesSet.has(t.sellerCountry));
      if (hasBuyers)           txns = txns.filter((t) => buyersSet.has(t.buyer));
      if (hasSellers)          txns = txns.filter((t) => sellersSet.has(t.seller));

      // Build per-category and per-subcategory totals from the filtered transaction set
      type SubMap = Map<string, { qty: number; value: number }>;
      const catMap = new Map<string, { qty: number; value: number; subcats: SubMap }>();
      for (const t of txns) {
        if (!catMap.has(t.cat3)) catMap.set(t.cat3, { qty: 0, value: 0, subcats: new Map() });
        const cat = catMap.get(t.cat3)!;
        cat.qty   += t.qty;
        cat.value += t.value;
        const subKey = t.subcat3 || "(unclassified)";
        if (!cat.subcats.has(subKey)) cat.subcats.set(subKey, { qty: 0, value: 0 });
        const sub = cat.subcats.get(subKey)!;
        sub.qty   += t.qty;
        sub.value += t.value;
      }

      const r2 = (n: number) => Math.round(n * 100) / 100;
      const origMap = new Map(summary.cat3Tree.map((n) => [n.name, n]));

      const tree: EximCat3Node[] = [];
      for (const [catName, catData] of catMap.entries()) {
        const orig = origMap.get(catName);
        const subcategories = orig
          ? orig.subcategories
              .map((sub) => {
                const sd = catData.subcats.get(sub.name);
                return sd ? { ...sub, totalQty: r2(sd.qty), totalValue: r2(sd.value) } : null;
              })
              .filter(Boolean) as EximCat3Node["subcategories"]
          : [];
        tree.push({
          ...(orig ?? { name: catName, transactionCount: 0, byYear: {}, subcategories: [] }),
          totalQty:   r2(catData.qty),
          totalValue: r2(catData.value),
          subcategories,
        });
      }

      tree.sort((a, b) => b.totalQty - a.totalQty);
      return tree;
    }

    let tree = summary.cat3Tree;
    if (year) {
      tree = tree
        .map((node) => {
          const yd = node.byYear[String(year)];
          if (!yd || yd.qty === 0) return null;
          return { ...node, totalQty: yd.qty, totalValue: yd.value };
        })
        .filter(Boolean) as EximCat3Node[];
      tree.sort((a, b) => b.totalQty - a.totalQty);
    }
    return tree;
  }, [summary, year, hasBuyerCountries, buyerCountriesSet, hasSellerCountries, sellerCountriesSet, hasBuyers, buyersSet, hasSellers, sellersSet, transactionsLoaded, allTransactions]);

  // ── Filtered buyers ────────────────────────────────────────────────────────
  const filteredBuyers = useMemo<EximEntityIndex[]>(() => {
    if (!summary) return [];
    if (!hasSellers && !hasCat3 && !hasSellerCountries && !hasBuyerCountries) return summary.allBuyers;

    // Transaction-based path: accurate AND intersection across all active dimensions
    if (transactionsLoaded && allTransactions.length > 0) {
      let txns = allTransactions;
      if (year)                txns = txns.filter((t) => t.year === year);
      if (hasBuyerCountries)   txns = txns.filter((t) => buyerCountriesSet.has(t.buyerCountry));
      if (hasSellerCountries)  txns = txns.filter((t) => sellerCountriesSet.has(t.sellerCountry));
      if (hasCat3)             txns = txns.filter((t) => cat3Set.has(t.cat3));
      if (effectiveSubcat3)    txns = txns.filter((t) => t.subcat3 === effectiveSubcat3);
      if (hasSellers)          txns = txns.filter((t) => sellersSet.has(t.seller));
      const uniqueNames = [...new Set(txns.map((t) => t.buyer))];
      const allBuyersMap = new Map(summary.allBuyers.map((b) => [b.name, b]));
      return uniqueNames
        .map((name) => allBuyersMap.get(name) ?? { name, country: "", totalValue: 0 })
        .sort((a, b) => b.totalValue - a.totalValue);
    }

    // Summary-based fallback: best-effort AND intersection
    let candidateNames: Set<string> | null = null;
    const intersect = (names: Iterable<string>) => {
      const s = new Set(names);
      candidateNames = candidateNames === null ? s : new Set([...candidateNames].filter((n) => s.has(n)));
    };

    if (hasCat3) {
      intersect(summary.topBuyers
        .filter((b) => [...cat3Set].some((c) => c in b.cat3Split))
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
  }, [summary, allTransactions, transactionsLoaded, year, hasBuyerCountries, buyerCountriesSet, hasSellerCountries, sellerCountriesSet, hasSellers, sellersSet, hasCat3, cat3Set, effectiveSubcat3]);

  // ── Filtered sellers ───────────────────────────────────────────────────────
  const filteredSellers = useMemo<EximEntityIndex[]>(() => {
    if (!summary) return [];
    if (!hasBuyers && !hasCat3 && !hasSellerCountries && !hasBuyerCountries) return summary.allSellers;

    // Transaction-based path: accurate AND intersection across all active dimensions
    if (transactionsLoaded && allTransactions.length > 0) {
      let txns = allTransactions;
      if (year)                txns = txns.filter((t) => t.year === year);
      if (hasBuyerCountries)   txns = txns.filter((t) => buyerCountriesSet.has(t.buyerCountry));
      if (hasSellerCountries)  txns = txns.filter((t) => sellerCountriesSet.has(t.sellerCountry));
      if (hasCat3)             txns = txns.filter((t) => cat3Set.has(t.cat3));
      if (effectiveSubcat3)    txns = txns.filter((t) => t.subcat3 === effectiveSubcat3);
      if (hasBuyers)           txns = txns.filter((t) => buyersSet.has(t.buyer));
      const uniqueNames = [...new Set(txns.map((t) => t.seller))];
      const allSellersMap = new Map(summary.allSellers.map((s) => [s.name, s]));
      return uniqueNames
        .map((name) => allSellersMap.get(name) ?? { name, country: "", totalValue: 0 })
        .sort((a, b) => b.totalValue - a.totalValue);
    }

    // Summary-based fallback: best-effort AND intersection
    let candidateNames: Set<string> | null = null;
    const intersect = (names: Iterable<string>) => {
      const s = new Set(names);
      candidateNames = candidateNames === null ? s : new Set([...candidateNames].filter((n) => s.has(n)));
    };

    if (hasCat3) {
      intersect(summary.topSellers
        .filter((s) => [...cat3Set].some((c) => c in s.cat3Split))
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
  }, [summary, allTransactions, transactionsLoaded, year, hasBuyerCountries, buyerCountriesSet, hasSellerCountries, sellerCountriesSet, hasBuyers, buyersSet, hasCat3, cat3Set, effectiveSubcat3]);

  // ── KPIs ───────────────────────────────────────────────────────────────────
  const kpis = useMemo<EximKPIs | null>(() => {
    if (!summary) return null;
    if (!year && !hasBuyerCountries && !hasSellerCountries && !hasCat3 && !hasBuyers && !hasSellers) return summary.kpis;

    if (transactionsLoaded && allTransactions.length > 0) {
      let txns = allTransactions;
      if (year)                txns = txns.filter((t) => t.year === year);
      if (hasBuyerCountries)   txns = txns.filter((t) => buyerCountriesSet.has(t.buyerCountry));
      if (hasSellerCountries)  txns = txns.filter((t) => sellerCountriesSet.has(t.sellerCountry));
      if (hasCat3)             txns = txns.filter((t) => cat3Set.has(t.cat3));
      if (effectiveSubcat3)    txns = txns.filter((t) => t.subcat3 === effectiveSubcat3);
      if (hasBuyers)           txns = txns.filter((t) => buyersSet.has(t.buyer));
      if (hasSellers)          txns = txns.filter((t) => sellersSet.has(t.seller));

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
  }, [summary, allTransactions, transactionsLoaded, year, hasBuyerCountries, buyerCountriesSet, hasSellerCountries, sellerCountriesSet, hasCat3, cat3Set, effectiveSubcat3, hasBuyers, buyersSet, hasSellers, sellersSet]);

  // ── Top buyers / sellers ───────────────────────────────────────────────────
  const topBuyers  = useMemo(() => summary?.topBuyers.slice(0, 10)  ?? [], [summary]);
  const topSellers = useMemo(() => summary?.topSellers.slice(0, 10) ?? [], [summary]);

  // ── Year trend / category-by-year ─────────────────────────────────────────
  const yearTrend      = useMemo(() => summary?.yearTrend      ?? [], [summary]);
  const categoryByYear = useMemo(() => summary?.categoryByYear ?? [], [summary]);

  // ── Filtered transactions ──────────────────────────────────────────────────
  const filteredTransactions = useMemo<EximTransaction[]>(() => {
    if (!transactionsLoaded || allTransactions.length === 0) return [];
    let txns = allTransactions;
    if (year)                txns = txns.filter((t) => t.year === year);
    if (hasBuyerCountries)   txns = txns.filter((t) => buyerCountriesSet.has(t.buyerCountry));
    if (hasSellerCountries)  txns = txns.filter((t) => sellerCountriesSet.has(t.sellerCountry));
    if (hasCat3)             txns = txns.filter((t) => cat3Set.has(t.cat3));
    if (effectiveSubcat3)    txns = txns.filter((t) => t.subcat3 === effectiveSubcat3);
    if (hasBuyers)           txns = txns.filter((t) => buyersSet.has(t.buyer));
    if (hasSellers)          txns = txns.filter((t) => sellersSet.has(t.seller));
    return txns;
  }, [allTransactions, transactionsLoaded, year, hasBuyerCountries, buyerCountriesSet, hasSellerCountries, sellerCountriesSet, hasCat3, cat3Set, effectiveSubcat3, hasBuyers, buyersSet, hasSellers, sellersSet]);

  return {
    loading, error, summary, kpis,
    cat3Tree, filteredBuyers, filteredSellers,
    topBuyers, topSellers, yearTrend, categoryByYear,
    transactionsLoading, filteredTransactions, loadTransactions, transactionsLoaded,
  };
}
