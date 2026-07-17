import { exportSheetsToXlsx, GROUP_ROW_STYLE, type ExportColumn } from "@/shared/lib/exportXlsx";
import { formatDate, weekEndOf } from "@/shared/lib/time";
import { rygCounts } from "../components/RygCells";
// Type-only: erased at compile, so this does not create an import cycle with
// DepartmentReport (which imports the function below).
import type { Group } from "../components/DepartmentReport";
import type { AppRole } from "../types";

const ROLE_LABEL: Record<AppRole, string> = { admin: "Admin", hod: "HOD", sub_hod: "Sub-HOD", employee: "Employee" };

/**
 * The Master Analysis report as a workbook: the RYG scorecard, the plan-vs-actual
 * numbers, and the About sheet that says what they mean.
 *
 * Both sheets are flattened from the same `Group[]` the table renders — post-search,
 * post-sort — so the file is what was on screen. The one deliberate divergence:
 * member rows are always emitted, even under a collapsed department. Collapsing is a
 * screen affordance for scrolling, not a filter on the data.
 *
 * Counts come from `rygCounts` and the Red split from the `redCounts` already on each
 * group/row, rather than being re-derived here — those functions *are* the column
 * definitions, and a second copy of that arithmetic would drift from the screen.
 */

/** A cell that has no meaning rather than a value of zero. */
const BLANK = "";

/** Members sit under their department's roll-up, so their name is indented to match the
 *  screen's hierarchy. The Level column still carries it for anyone sorting or filtering. */
const INDENT = "    ";

/** Bands a department's roll-up row, so it reads apart from the members beneath it. */
const bandDepartment = (r: { level: "Department" | "Member" }) => (r.level === "Department" ? GROUP_ROW_STYLE : undefined);

/** Percentages only mean something once something was planned — otherwise 0% reads as a real result. */
const pct = (has: boolean, v: number): number | string => (has ? v : BLANK);

type Flat = {
  level: "Department" | "Member";
  department: string;
  member: string;
  role: string;
  designation: string;
  planned: number;
  green: number;
  greenPct: number | string;
  yellow: number;
  yellowPct: number | string;
  red: number;
  redPct: number | string;
  redPending: number;
  redInProgress: number;
  redShifted: number;
};

const SCORECARD_COLUMNS: ExportColumn<Flat>[] = [
  { header: "Level", width: 11, value: (r) => r.level },
  { header: "Department", width: 24, value: (r) => r.department },
  { header: "Member", width: 22, value: (r) => r.member },
  { header: "Role", width: 10, value: (r) => r.role },
  { header: "Designation", width: 22, value: (r) => r.designation },
  { header: "Planned", width: 9, value: (r) => r.planned },
  { header: "Green", width: 8, value: (r) => r.green },
  { header: "Green %", width: 9, value: (r) => r.greenPct },
  { header: "Yellow", width: 8, value: (r) => r.yellow },
  { header: "Yellow %", width: 9, value: (r) => r.yellowPct },
  { header: "Red", width: 8, value: (r) => r.red },
  { header: "Red %", width: 9, value: (r) => r.redPct },
  { header: "Red – Pending", width: 14, value: (r) => r.redPending },
  { header: "Red – In progress", width: 16, value: (r) => r.redInProgress },
  { header: "Red – Shifted", width: 13, value: (r) => r.redShifted },
];

function flattenScorecard(groups: Group[]): Flat[] {
  const out: Flat[] = [];
  for (const g of groups) {
    const c = rygCounts(g.agg);
    const has = !!g.agg.planned;
    out.push({
      level: "Department",
      department: g.name,
      member: BLANK,
      role: BLANK,
      designation: BLANK,
      planned: g.agg.planned,
      green: c.green,
      greenPct: pct(has, g.actual.green),
      yellow: c.yellow,
      yellowPct: pct(has, g.actual.yellow),
      red: c.red,
      redPct: pct(has, g.actual.red),
      redPending: g.red.pending,
      redInProgress: g.red.inProgress,
      redShifted: g.red.shifted,
    });
    for (const { p, r, actual, red } of g.rows) {
      const rc = rygCounts(r);
      const rowHas = !!r.planned;
      out.push({
        level: "Member",
        department: g.name,
        member: `${INDENT}${p.name}`,
        role: ROLE_LABEL[p.role],
        designation: p.designation ?? BLANK,
        planned: r.planned,
        green: rc.green,
        greenPct: pct(rowHas, actual.green),
        yellow: rc.yellow,
        yellowPct: pct(rowHas, actual.yellow),
        red: rc.red,
        redPct: pct(rowHas, actual.red),
        redPending: red.pending,
        redInProgress: red.inProgress,
        redShifted: red.shifted,
      });
    }
  }
  return out;
}

type PvA = {
  level: "Department" | "Member";
  department: string;
  member: string;
  planG: number | string;
  planY: number | string;
  planR: number | string;
  actualG: number | string;
  actualY: number | string;
  actualR: number | string;
  delta: number | string;
};

const PVA_COLUMNS: ExportColumn<PvA>[] = [
  { header: "Level", width: 11, value: (r) => r.level },
  { header: "Department", width: 24, value: (r) => r.department },
  { header: "Member", width: 22, value: (r) => r.member },
  { header: "Plan Green %", width: 12, value: (r) => r.planG },
  { header: "Plan Yellow %", width: 13, value: (r) => r.planY },
  { header: "Plan Red %", width: 11, value: (r) => r.planR },
  { header: "Actual Green %", width: 14, value: (r) => r.actualG },
  { header: "Actual Yellow %", width: 15, value: (r) => r.actualY },
  { header: "Actual Red %", width: 13, value: (r) => r.actualR },
  { header: "Green vs plan", width: 13, value: (r) => r.delta },
];

/** Mirrors GreenDelta: a delta needs both sides to exist. */
const deltaOf = (planned: { green: number; total: number }, actual: { green: number; total: number }): number | string =>
  planned.total && actual.total ? actual.green - planned.green : BLANK;

function flattenPlanVsActual(groups: Group[]): PvA[] {
  const out: PvA[] = [];
  // Same row filter as the on-screen table: a department with neither a plan nor a
  // result has nothing to compare.
  for (const g of groups.filter((x) => x.planned.total || x.actual.total)) {
    out.push({
      level: "Department",
      department: g.name,
      member: BLANK,
      planG: pct(!!g.planned.total, g.planned.green),
      planY: pct(!!g.planned.total, g.planned.yellow),
      planR: pct(!!g.planned.total, g.planned.red),
      actualG: pct(!!g.actual.total, g.actual.green),
      actualY: pct(!!g.actual.total, g.actual.yellow),
      actualR: pct(!!g.actual.total, g.actual.red),
      delta: deltaOf(g.planned, g.actual),
    });
    for (const { p, planned, actual } of g.rows.filter((r) => r.planned.total || r.actual.total)) {
      out.push({
        level: "Member",
        department: g.name,
        member: `${INDENT}${p.name}`,
        planG: pct(!!planned.total, planned.green),
        planY: pct(!!planned.total, planned.yellow),
        planR: pct(!!planned.total, planned.red),
        actualG: pct(!!actual.total, actual.green),
        actualY: pct(!!actual.total, actual.yellow),
        actualR: pct(!!actual.total, actual.red),
        delta: deltaOf(planned, actual),
      });
    }
  }
  return out;
}

const NOTES = [
  "Shaded, bold rows are department roll-ups; the indented rows beneath each one are its members. The Level column says which is which.",
  "Green = completed on time · Yellow = revised, needed rework · Red = still pending, in progress or shifted.",
  "Planned = Green + Yellow + Red. N/A and personal tasks are excluded from every number.",
  "Red – Pending / In progress / Shifted are the task statuses behind the Red column, and sum to it.",
  "Percentages are rounded; Red absorbs the rounding so Green + Yellow + Red = 100.",
  "Plan vs Actual: the plan G/Y/R is the average of members' planned targets, while the actual pools their tasks.",
  "A blank percentage means nothing was planned for that person or department this week — it is not a score of 0.",
];

export function exportMasterAnalysis({
  groups,
  weekStart,
  filters,
}: {
  /** The groups as rendered — already searched and sorted. */
  groups: Group[];
  weekStart: string;
  /** What narrowed this export, in plain English. */
  filters: string[];
}): void {
  exportSheetsToXlsx({
    // The week covered, not just the day it was pulled — two weeks' exports must not
    // collide in a downloads folder. exportSheetsToXlsx appends today's date.
    fileName: `Master_Analysis_week_${formatDate(weekStart)}`,
    title: `Master Analysis — week of ${formatDate(weekStart)} to ${formatDate(weekEndOf(weekStart))}`,
    sheets: [
      { sheetName: "Master Analysis", columns: SCORECARD_COLUMNS, rows: flattenScorecard(groups), rowStyle: bandDepartment },
      { sheetName: "Plan vs Actual", columns: PVA_COLUMNS, rows: flattenPlanVsActual(groups), rowStyle: bandDepartment },
    ],
    filters,
    notes: NOTES,
  });
}
