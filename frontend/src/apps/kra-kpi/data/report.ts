/**
 * The KRA / KPI Scorecard's one data call: `kpi_report(person, from, to)`.
 *
 * Everything on the screen and in the export comes from this single RPC, which reads
 * the facts the nightly `kpi-facts` job wrote (supabase/functions/kpi-facts) and checks
 * the caller itself — their own report, their reporting chain's, or anyone's for an
 * admin. The browser never reads `kpi_facts` directly; row-level security would return
 * nothing to a non-admin anyway.
 *
 * The shapes below mirror public.kpi_report exactly
 * (supabase/migrations/20261128121000_kpi1_facts.sql).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/core/platform/supabase";

// kpi_report is not in the generated Database types; called through an untyped alias,
// the standing convention for RPCs outside them (see asset-maintenance/data/assetFetch.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface ReportRow {
  source: "fms" | "task";
  /** CC-1's module key, or "task-management". */
  module: string;
  /** Null only for a Task Management row that exists solely as a projection. */
  module_name: string | null;
  row_key: string;
  /** Null only for a projection-only row — see tpl_title / tpl_description. */
  row_label: string | null;
  tpl_title: string | null;
  tpl_description: string | null;
  given: number;
  done: number;
  on_time: number;
  /** Open, due later in the period — not held against anyone yet. */
  still_due: number;
  /** Recurring dates later in the period the generator has not minted yet. */
  still_due_projected: number;
  last_given: number;
  last_done: number;
  last_on_time: number;
  next_planned: number;
  next_projected: number;
  /** A "when" template: its tasks can still be marked Not Applicable, so planned is "up to". */
  upto: boolean;
}

export type Outcome = "on_time" | "late" | "missed" | "due" | "projected";

export interface ReportItem {
  per: "cur" | "last" | "next";
  source: "fms" | "task";
  module: string;
  row_key: string;
  item_id: string | null;
  entity_id: string | null;
  ref: string;
  round_no: number;
  due_date: string;
  done_at: string | null;
  done_date_ist: string | null;
  revised: boolean;
  outcome: Outcome;
  /** Late: done date − due date. Missed: as-of − due date. */
  days_late: number | null;
}

export interface TrendWeek {
  week_start: string;
  from: string;
  to: string;
  iso_week: number;
  iso_year: number;
  /**
   * Always false since 20261128122000: every trend week is whole, Monday to Sunday, even
   * where it reaches outside the period. Kept only because the RPC still returns it.
   */
  partial: boolean;
  given: number;
  done: number;
  on_time: number;
}

export interface KpiReport {
  run_id: string;
  as_of: string;
  as_of_date: string;
  finished_at: string | null;
  period: { from: string; to: string; kind: "week" | "month" | "custom" };
  last: { from: string; to: string };
  next: { from: string; to: string };
  rows: ReportRow[];
  items: ReportItem[];
  trend: TrendWeek[];
  footer: {
    bulk_closed: number;
    bulk_closed_last: number;
    dropped: Record<string, { name: string | null; dropped: Record<string, number> | null }>;
    skipped: { module: string; name: string; why: string }[];
  };
}

/** Null when no nightly run has been written yet. */
export async function fetchKpiReport(person: string, from: string, to: string): Promise<KpiReport | null> {
  const { data, error } = await db.rpc("kpi_report", { p_person: person, p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  const rep = data as KpiReport | { as_of: null };
  return rep && rep.as_of ? (rep as KpiReport) : null;
}

export function useKpiReport(person: string, from: string, to: string) {
  return useQuery({
    queryKey: ["kpi-report", person, from, to],
    queryFn: () => fetchKpiReport(person, from, to),
    // Figures change once a night; a person flicking between weeks should not refetch.
    staleTime: 10 * 60_000,
    enabled: !!person && !!from && !!to,
  });
}
