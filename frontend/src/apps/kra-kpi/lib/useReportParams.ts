/**
 * The report's period (and, on the Scorecard, its person) kept in the URL, so a view can be
 * shared and survives a reload. One copy for both pages — the Scorecard and the Team summary
 * (KPI-2) step through periods by exactly the same rules.
 */
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { periodFromParams, type Period, type PeriodMode } from "./period";

export function useReportParams() {
  const [params, setParams] = useSearchParams();
  const period = useMemo(
    () => periodFromParams(params.get("mode"), params.get("from"), params.get("to")),
    [params],
  );

  const set = (next: Partial<{ user: string; mode: PeriodMode; from: string; to: string }>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
    if (next.mode && next.mode !== "custom") p.delete("to");
    setParams(p, { replace: true });
  };
  const setPeriod = (p: Period) => set({ mode: p.mode, from: p.from, to: p.mode === "custom" ? p.to : undefined });

  return { params, period, set, setPeriod };
}

/** The URL query that opens a report page on this period (and person), for links between the two pages. */
export function reportQuery(period: Period, user?: string): string {
  const p = new URLSearchParams();
  if (user) p.set("user", user);
  p.set("mode", period.mode);
  p.set("from", period.from);
  if (period.mode === "custom") p.set("to", period.to);
  return p.toString();
}
