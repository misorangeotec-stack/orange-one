/**
 * Data hook for the Balance Sheet / P&L reports.
 *
 * Deliberately NOT routed through useAppData: those reports are built on the receivables customer
 * snapshot, whereas a financial statement needs the whole chart of accounts. Reading ConnectWave
 * directly keeps the two independent — and means the admin "Live (Tally)" toggle cannot change these
 * numbers, since they only ever have one source.
 */
import { useQuery } from "@tanstack/react-query";
import { loadFinancialStatements, fetchOutOfWindow, type FsData, type OowCompany } from "./financialStatements";

export function useFinancialStatements() {
  const { data, isLoading, error } = useQuery<FsData>({
    queryKey: ["financialStatements", "v1"],
    queryFn: loadFinancialStatements,
    staleTime: 5 * 60 * 1000,
  });

  return {
    companies: data?.companies ?? [],
    linesByCompany: data?.linesByCompany ?? {},
    unresolvedByCompany: data?.unresolvedByCompany ?? {},
    loading: isLoading,
    error: error instanceof Error ? error.message : error ? String(error) : null,
  };
}

/**
 * Per-company, per-ledger amounts to strip so a statement reads "as of" [fromIso, toIso] — the
 * vouchers dated outside the window (see fetchOutOfWindow). Cached per window; returns an empty map
 * (a no-op adjustment) while it loads or when neither bound clips anything.
 */
export function useAsOfAdjustment(companies: OowCompany[], fromIso: string | null, toIso: string | null) {
  const key = companies.map((c) => c.companyGuid).sort().join(",");
  const { data, isFetching } = useQuery({
    queryKey: ["fsAsOf", key, fromIso, toIso],
    queryFn: () => fetchOutOfWindow(companies, fromIso, toIso),
    enabled: companies.length > 0 && (!!fromIso || !!toIso),
    staleTime: 5 * 60 * 1000,
  });
  return { adjByCompany: data ?? {}, adjusting: isFetching };
}
