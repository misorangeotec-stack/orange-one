/**
 * The KRA / KPI Scorecard as the client's own weekly MIS sheet (KPI-1).
 *
 * The screen shows one row per task so every column can sort and filter; the sheet the
 * client reviews has TWO rows per task — "All work should be done" and "All work should
 * be done on time" — with the Task / System cell spanning both. This export writes that
 * layout exactly, so it drops straight into the weekly review:
 *
 *   Task/System · KRA · KPI · Last Week Actual % · Current Week Planned ·
 *   Current Week Actual · Current Week Actual % · Next Week Planned
 *
 * (Benchmark was dropped by the user on 18-09-2026 and is not written.) "Week" becomes
 * "Month" or "Period" when the report is not a week. Row 2's Planned is work DONE, not
 * work given — the sheet's own convention, reproduced by facts/score.ts.
 *
 * The person and the period go in the preamble; the totals and the score out of 100 go
 * at the foot. A second sheet lists every item behind the counts.
 */
import { exportSheetsToXlsx, GROUP_ROW_STYLE, type ExportColumn, type ExportSheet } from "@/shared/lib/exportXlsx";
import { formatDate, formatDateTime } from "@/shared/lib/time";
import type { KpiReport, ReportItem } from "../data/report";
import { periodLabel, periodWord, type Period } from "./period";
import type { GridRow, ModuleSplit, Totals } from "./rows";
import { outcomeLabel } from "./outcome";

type Cell = string | number;
interface SheetRow {
  a: string;
  b: string;
  c: string;
  d: Cell;
  e: Cell;
  f: Cell;
  g: Cell;
  h: Cell;
  band?: "total" | "score";
}

const pct = (x: number | null): Cell => (x === null ? "—" : x);
const plannedNext = (n: number, upto: boolean): Cell => (upto && n > 0 ? `up to ${n}` : n);

function pairOf(name: string, r: Pick<GridRow, "given" | "done" | "onTime" | "pct1" | "pct2" | "last1" | "last2" | "next" | "upto">, band?: SheetRow["band"]): SheetRow[] {
  return [
    {
      a: name, b: "All work should be done", c: "% work not done",
      d: pct(r.last1), e: r.given, f: r.done, g: pct(r.pct1), h: plannedNext(r.next, r.upto), band,
    },
    {
      a: "", b: "All work should be done on time", c: "% work not done on time",
      d: pct(r.last2), e: r.done, f: r.onTime, g: pct(r.pct2), h: "", band,
    },
  ];
}

const TITLE_STYLE = { font: { bold: true, sz: 14, color: { rgb: "0B1F3A" } } };
const LABEL_STYLE = { font: { bold: true, color: { rgb: "5B6B7F" } } };
const SCORE_STYLE = { font: { bold: true, color: { rgb: "0B1F3A" } }, fill: { fgColor: { rgb: "FFE7D9" } } };

export interface MisInput {
  personName: string;
  period: Period;
  report: KpiReport;
  rows: GridRow[];
  totals: Totals;
  modules: ModuleSplit[];
}

/**
 * One person's sheet in the client's layout. Built apart from the download so the Team summary
 * (KPI-2) can put one per person into a single workbook — the whole weekly review in one file.
 */
export function misSheet(o: MisInput, sheetName = "KRA KPI"): ExportSheet<SheetRow> {
  const { personName, period, report, rows, totals, modules } = o;
  const W = periodWord(period.mode);

  const ordered = [...rows].sort((x, y) => x.moduleName.localeCompare(y.moduleName) || x.label.localeCompare(y.label));
  const body: SheetRow[] = ordered.flatMap((r) => pairOf(`${r.moduleName} · ${r.label}`, r));
  const totalPair = pairOf("Total — all work", totals, "total");
  const scoreRows: SheetRow[] = [
    {
      a: "Score out of 100", b: "On time 1 · late ½ · not done 0", c: "(on time + ½ late) ÷ given",
      d: pct(totals.lastScore), e: totals.given, f: "", g: pct(totals.score), h: "", band: "score",
    },
    ...modules.map((m): SheetRow => ({
      a: `Score — ${m.moduleName}`, b: "", c: "", d: pct(m.lastScore), e: m.given, f: "", g: pct(m.score), h: "",
    })),
  ];
  const all = [...body, ...totalPair, ...scoreRows];

  const preamble: (string | number)[][] = [
    ["KRA / KPI Scorecard"],
    ["Name", personName],
    [W, periodLabel(period)],
    ["As of", formatDateTime(report.as_of)],
    ["Rule", `Work counts in the ${W.toLowerCase()} it was due. It joins Planned once it is done or its due date has passed.`],
    [],
  ];
  const headerRow = preamble.length;
  const first = headerRow + 1;

  const columns: ExportColumn<SheetRow>[] = [
    { header: "Task/System", width: 46, value: (r) => r.a },
    { header: "KRA", width: 30, value: (r) => r.b },
    { header: "KPI", width: 24, value: (r) => r.c },
    { header: `Last ${W} Actual %`, width: 16, value: (r) => r.d },
    { header: `Current ${W} Planned`, width: 16, value: (r) => r.e },
    { header: `Current ${W} Actual`, width: 16, value: (r) => r.f },
    { header: `Current ${W} Actual %`, width: 17, value: (r) => r.g },
    { header: `Next ${W} Planned`, width: 16, value: (r) => r.h },
  ];

  // The Task / System cell spans both rows of each pair, as on the client's sheet.
  const merges = [];
  for (let i = 0; i < body.length + totalPair.length; i += 2) {
    merges.push({ s: { r: first + i, c: 0 }, e: { r: first + i + 1, c: 0 } });
  }

  return {
    sheetName,
    columns,
    rows: all,
    preamble,
    preambleStyle: (r, c) => (r === 0 && c === 0 ? TITLE_STYLE : c === 0 && r > 0 && r < 5 ? LABEL_STYLE : undefined),
    merges,
    rowStyle: (r) => (r.band === "total" ? GROUP_ROW_STYLE : r.band === "score" ? SCORE_STYLE : undefined),
    // Task names are stored whole; wrap them in their merged cell rather than cut them.
    cellStyle: (_r, c) => (c === 0 ? { alignment: { wrapText: true, vertical: "center" } } : undefined),
    freezeCols: 1,
  };
}

/** Every piece of work behind one person's counts. */
function itemsSheet(o: MisInput): ExportSheet<ReportItem> {
  const { period, report, rows } = o;
  const W = periodWord(period.mode);
  const perName: Record<ReportItem["per"], string> = {
    cur: `This ${W.toLowerCase()}`,
    last: `Last ${W.toLowerCase()}`,
    next: `Next ${W.toLowerCase()}`,
  };
  const labelOf = new Map(rows.map((r) => [`${r.source}|${r.module}|${r.rowKey}`, r]));
  return {
    sheetName: "Items",
    columns: [
      { header: "Period", width: 12, value: (i) => perName[i.per] },
      { header: "Module", width: 22, value: (i) => labelOf.get(`${i.source}|${i.module}|${i.row_key}`)?.moduleName ?? i.module },
      { header: "Task/System", width: 40, value: (i) => labelOf.get(`${i.source}|${i.module}|${i.row_key}`)?.label ?? i.row_key },
      { header: "Reference", width: 30, value: (i) => (i.round_no > 1 ? `${i.ref} (round ${i.round_no})` : i.ref) },
      { header: "Due", width: 12, value: (i) => formatDate(i.due_date) },
      { header: "Done", width: 20, value: (i) => (i.done_at ? formatDateTime(i.done_at) : "") },
      { header: "Outcome", width: 18, value: (i) => outcomeLabel(i) },
      { header: "Days late", width: 10, value: (i) => (i.days_late && i.days_late > 0 ? i.days_late : "") },
    ],
    rows: report.items,
    freezeCols: 1,
  };
}

/**
 * What the numbers mean, for the About sheet — one person's export and the team pack alike.
 * `bulkClosed` is one person's count for the period, or null where it does not apply.
 */
export function misNotes(period: Period, bulkClosed: number | null, notInUse: string[]): string[] {
  const W = periodWord(period.mode);
  return [
    `Work counts in the ${W.toLowerCase()} it was DUE. It joins Planned once it is done, or once its due date has passed; work due later in a running ${W.toLowerCase()} is still due, not missed.`,
    "Done = closed at any time up to the as-of. On time = closed on or before the due date (Indian calendar day). A task finished after its deadline was revised is done but late.",
    "% work not done = (done − planned) ÷ planned × 100. % work not done on time = (on time − done) ÷ done × 100 — the second row's base is work DONE, as on the weekly MIS sheet. No base, no percentage: shown as —.",
    "Score out of 100 = (on time + ½ × late) ÷ planned × 100, pooled across every row. The same rule as the monthly FMS ranking.",
    "A team step with several owners counts for each of them until someone closes it; then only the person who closed it gets it. An admin who closes someone's step gets the credit.",
    ...(bulkClosed === null
      ? ["Tasks closed by an admin bulk close are not scored."]
      : [`${bulkClosed} task(s) due in this ${W.toLowerCase()} were closed by an admin bulk close and are not scored.`]),
    "Next planned includes recurring tasks not generated yet (they are created one day at a time); \"up to\" marks tasks that can still be marked Not Applicable. FMS steps have no due date until the step before them closes, so only those already due are counted.",
    ...(notInUse.length ? [`Not counted — not in use yet: ${notInUse.join(", ")}.`] : []),
  ];
}

/** One person's scorecard, downloaded: their MIS sheet and the items behind it. */
export async function exportKpiScorecard(o: MisInput): Promise<void> {
  const { personName, period, report } = o;
  const W = periodWord(period.mode);
  const safe = personName.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  await exportSheetsToXlsx({
    fileName: `KRA_KPI_${safe}_${period.from}_to_${period.to}`,
    title: `KRA / KPI Scorecard — ${personName} — ${periodLabel(period)}`,
    sheets: [misSheet(o), itemsSheet(o)],
    filters: [`Person: ${personName}`, `${W}: ${periodLabel(period)}`, `As of: ${formatDateTime(report.as_of)}`],
    notes: misNotes(period, report.footer.bulk_closed, report.footer.skipped.map((s) => s.name)),
  });
}
