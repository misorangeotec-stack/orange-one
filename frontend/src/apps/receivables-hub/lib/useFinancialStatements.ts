/**
 * Data hook for the Balance Sheet / P&L reports.
 *
 * Deliberately NOT routed through useAppData: those reports are built on the receivables customer
 * snapshot, whereas a financial statement needs the whole chart of accounts. Reading ConnectWave
 * directly keeps the two independent — and means the admin "Live (Tally)" toggle cannot change these
 * numbers, since they only ever have one source.
 */
import { useQuery } from "@tanstack/react-query";
import { loadFinancialStatements, type FsData } from "./financialStatements";

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
