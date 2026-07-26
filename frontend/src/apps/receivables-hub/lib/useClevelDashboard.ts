/**
 * React Query hooks for the C-Level Dashboard's ConnectWave-backed data.
 * Mirrors useFinancialStatements.ts (staleTime 5m, one query per source).
 * Company-scoped: every hook is keyed by companyGuid and disabled until one is picked.
 */
import { useQuery } from "@tanstack/react-query";
import {
  loadClevelTrends,
  loadClevelLedgerRollup,
  loadClevelGst,
  loadClevelStock,
} from "./clevelDashboard";

const opts = (guid: string) => ({ enabled: !!guid, staleTime: 5 * 60 * 1000 });

export function useClevelTrends(companyGuid: string) {
  return useQuery({
    queryKey: ["clevel", "trends", companyGuid],
    queryFn: () => loadClevelTrends(companyGuid),
    ...opts(companyGuid),
  });
}

export function useClevelLedgerRollup(companyGuid: string) {
  return useQuery({
    queryKey: ["clevel", "ledgerRollup", companyGuid],
    queryFn: () => loadClevelLedgerRollup(companyGuid),
    ...opts(companyGuid),
  });
}

export function useClevelGst(companyGuid: string) {
  return useQuery({
    queryKey: ["clevel", "gst", companyGuid],
    queryFn: () => loadClevelGst(companyGuid),
    ...opts(companyGuid),
  });
}

export function useClevelStock(companyGuid: string) {
  return useQuery({
    queryKey: ["clevel", "stock", companyGuid],
    queryFn: () => loadClevelStock(companyGuid),
    ...opts(companyGuid),
  });
}
