/**
 * From kpi_team's lines to what the Team summary (KPI-2) shows — one derivation for the
 * table, its score filters and the export. The arithmetic is facts/score.ts's, so a person's
 * figures here are exactly their own scorecard's. (No team-wide totals: the user removed them,
 * 19-09-2026 — a pooled team figure is carried by the busiest few people.)
 *
 * Decided by the user, 19-09-2026:
 *  · admins and the shared logins (QC, QA) are HIDDEN by default and shown on request;
 *  · fewer than 10 pieces of work in the period is marked LOW VOLUME — shown, never hidden,
 *    and kept out of the score bands, because 2 tasks at 50 is not 300 at 50.
 */
import { pctNotDone, pctNotOnTime, scoreOf } from "../facts/score";
import type { TeamPerson } from "../data/team";

export const LOW_VOLUME = 10;

export type Band = "top" | "middle" | "low" | "low_volume" | "none";
export const BAND_LABEL: Record<Band, string> = {
  top: "90 and above",
  middle: "70 to 89",
  low: "Below 70",
  low_volume: `Under ${LOW_VOLUME} pieces of work`,
  none: "No work due",
};

export interface TeamRow {
  id: string;
  name: string;
  department: string;
  designation: string;
  reportsTo: string;
  hiddenByDefault: boolean;
  given: number;
  done: number;
  onTime: number;
  late: number;
  missed: number;
  pct1: number | null;
  pct2: number | null;
  score: number | null;
  lastScore: number | null;
  /** This period's score minus last period's, one decimal; null when either has no work. */
  change: number | null;
  lowVolume: boolean;
  band: Band;
  modules: string[];
  weeks: TeamPerson["weeks"];
}

const bandOf = (given: number, score: number | null): Band =>
  given === 0 || score === null ? "none" : given < LOW_VOLUME ? "low_volume" : score >= 90 ? "top" : score >= 70 ? "middle" : "low";

export function toTeamRows(people: TeamPerson[], showHidden: boolean): TeamRow[] {
  return people
    .filter((p) => showHidden || !(p.is_admin || p.is_excluded))
    .map((p) => {
      const cur = { given: p.given, done: p.done, onTime: p.on_time };
      const score = scoreOf(cur);
      const lastScore = scoreOf({ given: p.last_given, done: p.last_done, onTime: p.last_on_time });
      return {
        id: p.user_id,
        name: p.name,
        department: p.department ?? "",
        designation: p.designation ?? "",
        reportsTo: p.reports_to ?? "",
        hiddenByDefault: p.is_admin || p.is_excluded,
        given: p.given,
        done: p.done,
        onTime: p.on_time,
        late: p.done - p.on_time,
        missed: p.given - p.done,
        pct1: pctNotDone(cur),
        pct2: pctNotOnTime(cur),
        score,
        lastScore,
        change: score !== null && lastScore !== null ? Math.round((score - lastScore) * 10) / 10 : null,
        lowVolume: p.given > 0 && p.given < LOW_VOLUME,
        band: bandOf(p.given, score),
        modules: p.modules,
        weeks: p.weeks,
      };
    });
}

export function bandCounts(rows: TeamRow[]): Record<Band, number> {
  const out: Record<Band, number> = { top: 0, middle: 0, low: 0, low_volume: 0, none: 0 };
  for (const r of rows) out[r.band]++;
  return out;
}
