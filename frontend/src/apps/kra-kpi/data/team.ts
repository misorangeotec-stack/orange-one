/**
 * The Team summary's one data call: `kpi_team(from, to)` (KPI-2).
 *
 * One line per person the caller may see — everyone for an admin, their reporting chain for a
 * HOD / sub-HOD — decided inside the RPC, which also refuses anyone with no team. Every figure
 * comes from the same rule functions as each person's own scorecard (kpi_report), so the two
 * pages cannot disagree. Shapes mirror supabase/migrations/20261129120000_kpi2_team.sql.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/core/platform/supabase";

// kpi_team is not in the generated Database types; called through an untyped alias, the
// standing convention for RPCs outside them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface TeamWeek {
  week_start: string;
  from: string;
  to: string;
  iso_week: number;
  iso_year: number;
}

export interface TeamPerson {
  user_id: string;
  name: string;
  designation: string | null;
  department: string | null;
  role: string | null;
  reports_to: string | null;
  /** Hidden by default, with the shared logins: an admin's figures include closing others' steps. */
  is_admin: boolean;
  /** On CC-1's exclusion list — the shared QC / QA logins. */
  is_excluded: boolean;
  given: number;
  done: number;
  on_time: number;
  last_given: number;
  last_done: number;
  last_on_time: number;
  modules: string[];
  /** Only the weeks this person had work in; a missing week reads as zero. */
  weeks: { week_start: string; given: number; done: number; on_time: number }[];
}

export interface KpiTeam {
  run_id: string;
  as_of: string;
  as_of_date: string;
  period: { from: string; to: string; kind: "week" | "month" | "custom" };
  last: { from: string; to: string };
  weeks: TeamWeek[];
  people: TeamPerson[];
  /** People the caller may see who had no work due in the period. */
  without_work: number;
}

/** Null when no nightly run has been written yet. */
export async function fetchKpiTeam(from: string, to: string): Promise<KpiTeam | null> {
  const { data, error } = await db.rpc("kpi_team", { p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  const t = data as KpiTeam | { as_of: null };
  return t && t.as_of ? (t as KpiTeam) : null;
}

export function useKpiTeam(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: ["kpi-team", from, to],
    queryFn: () => fetchKpiTeam(from, to),
    // Figures change once a night.
    staleTime: 10 * 60_000,
    enabled: enabled && !!from && !!to,
  });
}
