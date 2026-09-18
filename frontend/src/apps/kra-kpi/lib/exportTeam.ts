/**
 * The Team summary as one workbook (KPI-2) — decided by the user, 19-09-2026: the summary PLUS
 * every person's MIS sheet, so the whole weekly review is one file.
 *
 *   Sheet 1 · "Team"      one row per person in view, as the page shows them.
 *   Sheet 2… · one per person with work due — the client's two-rows-per-task MIS layout, built
 *             by the SAME builder as a person's own export (exportKpi.ts → misSheet) from that
 *             person's own kpi_report, so the pack and the individual download cannot differ.
 *   About     what the numbers mean.
 */
import { exportSheetsToXlsx, type ExportSheet } from "@/shared/lib/exportXlsx";
import { formatDateTime } from "@/shared/lib/time";
import { fetchKpiReport, type KpiReport } from "../data/report";
import type { KpiTeam } from "../data/team";
import { fmtScore } from "../facts/score";
import { misNotes, misSheet } from "./exportKpi";
import { periodLabel, periodWord, type Period } from "./period";
import { moduleSplit, toGridRows, totalsOf } from "./rows";
import { LOW_VOLUME, type TeamRow } from "./team";

/** Excel's rules for a tab name: 31 characters, none of \ / ? * [ ] :, and unique in the file. */
function tabNames(names: string[]): string[] {
  const used = new Set<string>(["team", "about this export"]);
  return names.map((n) => {
    const base = n.replace(/[\\/?*[\]:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Person";
    let name = base;
    for (let i = 2; used.has(name.toLowerCase()); i++) {
      const tag = ` (${i})`;
      name = base.slice(0, 31 - tag.length) + tag;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

/** Fetch each person's own report, a few at a time. */
async function reportsFor(ids: string[], period: Period, onProgress: (done: number, total: number) => void) {
  const out = new Map<string, KpiReport | null>();
  let done = 0;
  const queue = [...ids];
  const worker = async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      out.set(id, await fetchKpiReport(id, period.from, period.to));
      onProgress(++done, ids.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, ids.length) }, worker));
  return out;
}

const fmtChange = (x: number | null) => (x === null ? "—" : x === 0 ? "0.0" : `${x > 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}`);

export async function exportTeam(o: {
  period: Period;
  team: KpiTeam;
  /** The rows the page shows — the admins switch and any band / department already applied. */
  rows: TeamRow[];
  totals: { given: number; done: number; onTime: number; score: number | null; lastScore: number | null };
  scope: string;
  viewing: string[];
  onProgress: (done: number, total: number) => void;
}): Promise<void> {
  const { period, team, rows, totals, scope, viewing, onProgress } = o;
  const W = periodWord(period.mode);
  // Highest score first, as the page opens: a full workload before low volume, no work last.
  // The personal sheets follow the same order.
  const key = (r: TeamRow) => (r.score === null ? -2000 : r.lowVolume ? r.score - 1000 : r.score);
  const ordered = [...rows].sort((a, b) => key(b) - key(a) || a.name.localeCompare(b.name));

  const summary: ExportSheet<TeamRow> = {
    sheetName: "Team",
    preamble: [
      ["KRA / KPI — team summary"],
      ["Who", scope],
      [W, periodLabel(period)],
      ["As of", formatDateTime(team.as_of)],
      ["Team score", `${fmtScore(totals.score)} (last ${W.toLowerCase()} ${fmtScore(totals.lastScore)})`],
      [],
    ],
    preambleStyle: (r, c) =>
      r === 0 && c === 0 ? { font: { bold: true, sz: 14, color: { rgb: "0B1F3A" } } } : c === 0 && r > 0 && r < 5 ? { font: { bold: true, color: { rgb: "5B6B7F" } } } : undefined,
    columns: [
      // The score leads, as on the page (the user, 19-09-2026).
      { header: "Person", width: 24, value: (r) => r.name },
      { header: "Score", width: 9, value: (r) => (r.score === null ? "—" : r.score) },
      { header: "Low volume", width: 11, value: (r) => (r.lowVolume ? "Yes" : "") },
      { header: "Tasks given", width: 11, value: (r) => r.given },
      { header: "Done", width: 9, value: (r) => r.done },
      { header: "On time", width: 9, value: (r) => r.onTime },
      { header: "Late", width: 9, value: (r) => r.late },
      { header: "Not done", width: 9, value: (r) => r.missed },
      { header: `Last ${W.toLowerCase()}`, width: 11, value: (r) => (r.lastScore === null ? "—" : r.lastScore) },
      { header: "Change", width: 9, value: (r) => fmtChange(r.change) },
      { header: "% not done", width: 11, value: (r) => (r.pct1 === null ? "—" : r.pct1) },
      { header: "% not on time", width: 13, value: (r) => (r.pct2 === null ? "—" : r.pct2) },
      { header: "Department", width: 22, value: (r) => r.department || "—" },
      { header: "Designation", width: 22, value: (r) => r.designation || "—" },
      { header: "Reports to", width: 22, value: (r) => r.reportsTo || "—" },
      { header: "Worked in", width: 40, value: (r) => r.modules.join(", ") },
    ],
    rows: ordered,
    rowStyle: (r) => (r.band === "low" ? { fill: { fgColor: { rgb: "FDECEB" } } } : undefined),
    freezeCols: 1,
  };

  // One MIS sheet per person with work due, from their own report.
  const withWork = ordered.filter((r) => r.given > 0);
  const reports = await reportsFor(withWork.map((r) => r.id), period, onProgress);
  const names = tabNames(withWork.map((r) => r.name));
  const personal: ExportSheet<unknown>[] = [];
  let notInUse: string[] = [];
  withWork.forEach((r, i) => {
    const report = reports.get(r.id);
    if (!report) return;
    notInUse = report.footer.skipped.map((s) => s.name);
    const grid = toGridRows(report.rows);
    personal.push(
      misSheet(
        { personName: r.name, period, report, rows: grid, totals: totalsOf(grid, report.rows), modules: moduleSplit(grid, report.rows) },
        names[i],
      ) as ExportSheet<unknown>,
    );
  });

  await exportSheetsToXlsx({
    fileName: `KRA_KPI_Team_${period.from}_to_${period.to}`,
    title: `KRA / KPI — team summary — ${periodLabel(period)}`,
    sheets: [summary, ...personal],
    filters: [`${W}: ${periodLabel(period)}`, `Who: ${scope}`, ...viewing, `As of: ${formatDateTime(team.as_of)}`],
    notes: [
      "The Team sheet has one row per person; each person with work due then has their own sheet in the weekly MIS layout, exactly as their own scorecard exports it.",
      "The team score adds up everyone's work first (on time 1, late ½, not done 0, over everything given) — not an average of people's scores.",
      `Low volume = fewer than ${LOW_VOLUME} pieces of work in the ${W.toLowerCase()}: shown, but not comparable with a full workload. Rows below 70 (not low volume) are shaded.`,
      ...misNotes(period, null, notInUse),
    ],
  });
}
