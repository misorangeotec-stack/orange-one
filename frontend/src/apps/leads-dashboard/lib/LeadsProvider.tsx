/**
 * App-root context for the Leads Dashboard: loads the data ONCE (useLeadsData)
 * and holds the shared filter state, so the Overview and All-Leads pages read the
 * same leads and the same active filters (a filter set on one page carries to the
 * other). Also exposes derived filter options + the filtered lead set.
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useLeadsData, type LeadsData } from "./useLeadsData";
import { applyFilters, emptyFilters, type LeadFilters } from "./transforms";
import type { Lead } from "./types";

interface LeadsCtx extends LeadsData {
  filters: LeadFilters;
  setFilters: (f: LeadFilters) => void;
  resetFilters: () => void;
  activeFilterCount: number;
  filtered: Lead[];
}

const Ctx = createContext<LeadsCtx | null>(null);

export function LeadsProvider({ children }: { children: ReactNode }) {
  const data = useLeadsData();
  const [filters, setFilters] = useState<LeadFilters>(() => emptyFilters());

  const filtered = useMemo(() => applyFilters(data.leads, filters), [data.leads, filters]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.from || filters.to) n++;
    n += filters.salespeople.length ? 1 : 0;
    n += filters.categories.length ? 1 : 0;
    n += filters.interests.length ? 1 : 0;
    n += filters.askedAbout.length ? 1 : 0;
    n += filters.followUps.length ? 1 : 0;
    n += filters.locations.length ? 1 : 0;
    n += filters.hasVoice ? 1 : 0;
    n += filters.company.trim() ? 1 : 0;
    return n;
  }, [filters]);

  const value = useMemo<LeadsCtx>(
    () => ({ ...data, filters, setFilters, resetFilters: () => setFilters(emptyFilters()), activeFilterCount, filtered }),
    [data, filters, activeFilterCount, filtered]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLeads(): LeadsCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useLeads must be used within LeadsProvider");
  return ctx;
}
