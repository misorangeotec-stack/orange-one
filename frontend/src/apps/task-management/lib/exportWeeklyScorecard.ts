import { exportSheetsToXlsx, GROUP_ROW_STYLE, type ExportColumn } from "@/shared/lib/exportXlsx";
import { addWeeks, formatDate, weekEndOf } from "@/shared/lib/time";
import { actualRygFor, aggregateRyg, computeStats, isRecurringTask, reportFor } from "../mock/selectors";
import { rygCounts } from "../components/RygCells";
import type { AppRole, Profile, Task, WeeklyPlan } from "../types";

/**
 * The Weekly Scorecard as a workbook: one row per person instead of one screen per
 * person, so a manager can scan the whole team in a single pass rather than driving
 * the team-member dropdown N times.
 *
 * Every number here is produced by calling the *same* selectors the screen calls,
 * with the same arguments — `actualRygFor`, `reportFor` + `rygCounts`, `computeStats`,
 * `aggregateRyg`. None of the arithmetic is repeated locally. A second copy of that
 * maths would drift from the screen, and a sheet that quietly disagrees with the page
 * it came from is worse than no sheet at all.
 */

/** A cell that has no meaning rather than a value of zero. */
const BLANK = "";

const ROLE_LABEL: Record<AppRole, string> = { admin: "Admin", hod: "HOD", sub_hod: "Sub-HOD", employee: "Employee" };

/** Members sit under the team roll-up, so their name is indented to match the screen's hierarchy. */
const INDENT = "    ";

/** Bands the team roll-up row so it reads apart from the people beneath it. */
const bandTeam = (r: { level: "Team" | "Member" }) => (r.level === "Team" ? GROUP_ROW_STYLE : undefined);

/**
 * Percentages only mean something once there was something to measure — otherwise
 * 0% reads as a real result ("they scored zero") rather than "nothing happened here".
 */
const pct = (has: boolean, v: number): number | string => (has ? v : BLANK);

/** A delta needs both sides to exist — mirrors CompareRow on the screen. */
const deltaOf = (planned: number | null, actual: number | null): number | string =>
  planned !== null && actual !== null ? actual - planned : BLANK;

/**
 * Pooled RYG percentages from summed counts. Reproduces `actualRygFor` exactly for a
 * set of people: green = completed, yellow = revised, and red absorbs the rounding so
 * the three always sum to 100.
 */
function pooledPct(green: number, yellow: number, total: number): { green: number; yellow: number; red: number } {
  if (!total) return { green: 0, yellow: 0, red: 0 };
  const g = Math.round((green / total) * 100);
  const y = Math.round((yellow / total) * 100);
  return { green: g, yellow: y, red: 100 - g - y };
}

/** One task-type slice (total / recurring / one-off) as it appears on a card. */
interface Slice {
  total: number;
  green: number;
  yellow: number;
  red: number;
  greenPct: number;
  yellowPct: number;
  redPct: number;
}

/**
 * Score one slice of a person's week the way `ActualScoreBlock` does: the RYG
 * percentages from `actualRygFor`, and the task counts behind them from
 * `reportFor` → `rygCounts`. N/A and personal tasks are dropped inside those
 * selectors, so the slice is passed in unfiltered exactly as the screen passes it.
 */
function sliceOf(tasks: Task[], personId: string, weekStart: string): Slice {
  const ryg = actualRygFor(tasks, personId, weekStart);
  const counts = rygCounts(reportFor(tasks, personId));
  return {
    total: ryg.total,
    green: counts.green,
    yellow: counts.yellow,
    red: counts.red,
    greenPct: ryg.green,
    yellowPct: ryg.yellow,
    redPct: ryg.red,
  };
}

export interface ScorecardRow {
  level: "Team" | "Member";
  member: string;
  role: string;
  designation: string;
  department: string;

  /** This week's saved plan. */
  planG: number | string;
  planY: number | string;
  planR: number | string;

  /** Recurring + one-off combined — the headline "Actual score" card. */
  total: Slice;
  /** Statuses behind Red, from `computeStats`. */
  pending: number;
  inProgress: number;
  shifted: number;
  greenVsPlan: number | string;

  recurring: Slice;
  oneOff: Slice;

  /** Next week's saved plan. */
  nextG: number | string;
  nextY: number | string;
  nextR: number | string;

  /** Personal / self-tracking tasks — all-time, and never scored. */
  otherTotal: number;
  otherPending: number;
  otherInProgress: number;
  otherCompleted: number;

  /** Kept off the sheet; drives the Plan vs Actual rows without re-deriving them. */
  raw: {
    hasTasks: boolean;
    hasPlan: boolean;
    hasNextPlan: boolean;
    planG: number | null;
    planY: number | null;
    planR: number | null;
    nextG: number | null;
    nextY: number | null;
    nextR: number | null;
  };
}

type PlanLookup = (doerId: string, weekStart: string) => WeeklyPlan | undefined;

/**
 * Index the store's task list by assignee once, so building N rows stays O(tasks)
 * rather than O(people × tasks). The selectors filter by `assignedTo` themselves,
 * so handing them a pre-filtered list is equivalent to handing them the whole one.
 */
export function groupTasksByAssignee(tasks: Task[]): Map<string, Task[]> {
  const byPerson = new Map<string, Task[]>();
  for (const t of tasks) {
    if (!t.assignedTo) continue;
    const list = byPerson.get(t.assignedTo);
    if (list) list.push(t);
    else byPerson.set(t.assignedTo, [t]);
  }
  return byPerson;
}

/**
 * One person's full scorecard row. Mirrors WeeklyScorecard.tsx step for step:
 * the week's tasks, the recurring/one-off split, both plans, and the all-time
 * personal counters.
 */
export function buildScorecardRow(args: {
  profile: Profile;
  departmentName: string;
  /** This person's tasks (all weeks — the personal counters are all-time). */
  tasks: Task[];
  weekStart: string;
  weeklyPlanFor: PlanLookup;
}): ScorecardRow {
  const { profile, departmentName, tasks, weekStart, weeklyPlanFor } = args;
  const id = profile.id;

  const weekTasks = tasks.filter((t) => t.weekStart === weekStart);
  const recurringTasks = weekTasks.filter(isRecurringTask);
  const oneOffTasks = weekTasks.filter((t) => !isRecurringTask(t));

  const total = sliceOf(weekTasks, id, weekStart);
  const stats = computeStats(weekTasks);

  const thisPlan = weeklyPlanFor(id, weekStart);
  const nextPlan = weeklyPlanFor(id, addWeeks(weekStart, 1));
  const hasTasks = total.total > 0;

  // Personal (self-tracking) tasks are excluded from every score, so they never
  // reach the counts above. Counted all-time, since they aren't week-planned.
  let otherTotal = 0, otherPending = 0, otherInProgress = 0, otherCompleted = 0;
  for (const t of tasks) {
    if (!t.isPersonal) continue;
    otherTotal++;
    if (t.status === "pending") otherPending++;
    else if (t.status === "in_progress") otherInProgress++;
    else if (t.status === "completed") otherCompleted++;
  }

  return {
    level: "Member",
    member: `${INDENT}${profile.name}`,
    role: ROLE_LABEL[profile.role],
    designation: profile.designation ?? BLANK,
    department: departmentName,
    planG: pct(!!thisPlan, thisPlan?.greenPct ?? 0),
    planY: pct(!!thisPlan, thisPlan?.yellowPct ?? 0),
    planR: pct(!!thisPlan, thisPlan?.redPct ?? 0),
    total,
    pending: stats.pending,
    inProgress: stats.inProgress,
    shifted: stats.shifted,
    greenVsPlan: deltaOf(thisPlan?.greenPct ?? null, hasTasks ? total.greenPct : null),
    recurring: sliceOf(recurringTasks, id, weekStart),
    oneOff: sliceOf(oneOffTasks, id, weekStart),
    nextG: pct(!!nextPlan, nextPlan?.greenPct ?? 0),
    nextY: pct(!!nextPlan, nextPlan?.yellowPct ?? 0),
    nextR: pct(!!nextPlan, nextPlan?.redPct ?? 0),
    otherTotal,
    otherPending,
    otherInProgress,
    otherCompleted,
    raw: {
      hasTasks,
      hasPlan: !!thisPlan,
      hasNextPlan: !!nextPlan,
      planG: thisPlan?.greenPct ?? null,
      planY: thisPlan?.yellowPct ?? null,
      planR: thisPlan?.redPct ?? null,
      nextG: nextPlan?.greenPct ?? null,
      nextY: nextPlan?.yellowPct ?? null,
      nextR: nextPlan?.redPct ?? null,
    },
  };
}

/**
 * The team roll-up that heads an all-employees export — the first number a manager
 * looks for. The headline figures come from `aggregateRyg` (the shared pooling rule);
 * the slice splits and status counts are summed from the member rows already built,
 * so the roll-up can never disagree with the rows beneath it.
 *
 * Note the deliberate asymmetry, inherited from `aggregateRyg` and called out in the
 * notes: the *planned* side averages people's targets, while the *actual* side pools
 * their tasks.
 */
export function buildTeamRow(args: {
  rows: ScorecardRow[];
  people: Profile[];
  allTasks: Task[];
  weekStart: string;
  weeklyPlanFor: PlanLookup;
}): ScorecardRow {
  const { rows, people, allTasks, weekStart, weeklyPlanFor } = args;
  const ids = people.map((p) => p.id);
  const { planned, actual } = aggregateRyg(ids, [weekStart], allTasks, weeklyPlanFor);
  const next = aggregateRyg(ids, [addWeeks(weekStart, 1)], allTasks, weeklyPlanFor).planned;

  const sum = (pick: (r: ScorecardRow) => number) => rows.reduce((n, r) => n + pick(r), 0);
  const sumSlice = (pick: (r: ScorecardRow) => Slice): Slice => {
    const total = sum((r) => pick(r).total);
    const green = sum((r) => pick(r).green);
    const yellow = sum((r) => pick(r).yellow);
    const p = pooledPct(green, yellow, total);
    return { total, green, yellow, red: sum((r) => pick(r).red), greenPct: p.green, yellowPct: p.yellow, redPct: p.red };
  };

  const hasTasks = actual.total > 0;
  const hasPlan = planned.total > 0;

  return {
    level: "Team",
    member: `All ${people.length} team member${people.length === 1 ? "" : "s"}`,
    role: BLANK,
    designation: BLANK,
    department: BLANK,
    planG: pct(hasPlan, planned.green),
    planY: pct(hasPlan, planned.yellow),
    planR: pct(hasPlan, planned.red),
    total: sumSlice((r) => r.total),
    pending: sum((r) => r.pending),
    inProgress: sum((r) => r.inProgress),
    shifted: sum((r) => r.shifted),
    greenVsPlan: deltaOf(hasPlan ? planned.green : null, hasTasks ? actual.green : null),
    recurring: sumSlice((r) => r.recurring),
    oneOff: sumSlice((r) => r.oneOff),
    nextG: pct(next.total > 0, next.green),
    nextY: pct(next.total > 0, next.yellow),
    nextR: pct(next.total > 0, next.red),
    otherTotal: sum((r) => r.otherTotal),
    otherPending: sum((r) => r.otherPending),
    otherInProgress: sum((r) => r.otherInProgress),
    otherCompleted: sum((r) => r.otherCompleted),
    raw: {
      hasTasks,
      hasPlan,
      hasNextPlan: next.total > 0,
      planG: hasPlan ? planned.green : null,
      planY: hasPlan ? planned.yellow : null,
      planR: hasPlan ? planned.red : null,
      nextG: next.total > 0 ? next.green : null,
      nextY: next.total > 0 ? next.yellow : null,
      nextR: next.total > 0 ? next.red : null,
    },
  };
}

/* ------------------------------ sheet 1 ---------------------------------- */

/** A slice's percentage only means something once the slice has tasks in it. */
const slicePct = (s: Slice, key: "greenPct" | "yellowPct" | "redPct") => pct(s.total > 0, s[key]);

const SCORECARD_COLUMNS: ExportColumn<ScorecardRow>[] = [
  { header: "Level", width: 9, value: (r) => r.level },
  { header: "Member", width: 24, value: (r) => r.member },
  { header: "Role", width: 10, value: (r) => r.role },
  { header: "Designation", width: 22, value: (r) => r.designation },
  { header: "Department", width: 22, value: (r) => r.department },

  { header: "Plan Green %", width: 12, value: (r) => r.planG },
  { header: "Plan Yellow %", width: 13, value: (r) => r.planY },
  { header: "Plan Red %", width: 11, value: (r) => r.planR },

  { header: "Total tasks", width: 11, value: (r) => r.total.total },
  { header: "Green %", width: 9, value: (r) => slicePct(r.total, "greenPct") },
  { header: "Yellow %", width: 9, value: (r) => slicePct(r.total, "yellowPct") },
  { header: "Red %", width: 8, value: (r) => slicePct(r.total, "redPct") },
  { header: "Green", width: 8, value: (r) => r.total.green },
  { header: "Yellow", width: 8, value: (r) => r.total.yellow },
  { header: "Red", width: 8, value: (r) => r.total.red },
  { header: "Pending", width: 9, value: (r) => r.pending },
  { header: "In progress", width: 12, value: (r) => r.inProgress },
  { header: "Shifted", width: 9, value: (r) => r.shifted },
  { header: "Green vs plan", width: 13, value: (r) => r.greenVsPlan },

  { header: "Recurring tasks", width: 14, value: (r) => r.recurring.total },
  { header: "Recurring Green %", width: 17, value: (r) => slicePct(r.recurring, "greenPct") },
  { header: "Recurring Yellow %", width: 18, value: (r) => slicePct(r.recurring, "yellowPct") },
  { header: "Recurring Red %", width: 15, value: (r) => slicePct(r.recurring, "redPct") },

  { header: "One-off tasks", width: 13, value: (r) => r.oneOff.total },
  { header: "One-off Green %", width: 15, value: (r) => slicePct(r.oneOff, "greenPct") },
  { header: "One-off Yellow %", width: 16, value: (r) => slicePct(r.oneOff, "yellowPct") },
  { header: "One-off Red %", width: 13, value: (r) => slicePct(r.oneOff, "redPct") },

  { header: "Next week Green %", width: 17, value: (r) => r.nextG },
  { header: "Next week Yellow %", width: 18, value: (r) => r.nextY },
  { header: "Next week Red %", width: 16, value: (r) => r.nextR },

  { header: "Other tasks (all-time)", width: 20, value: (r) => r.otherTotal },
  { header: "Other – Pending", width: 15, value: (r) => r.otherPending },
  { header: "Other – In progress", width: 18, value: (r) => r.otherInProgress },
  { header: "Other – Completed", width: 17, value: (r) => r.otherCompleted },
];

/* ------------------------------ sheet 2 ---------------------------------- */

interface PvARow {
  level: "Team" | "Member";
  member: string;
  bucket: string;
  planned: number | string;
  actual: number | string;
  delta: number | string;
  next: number | string;
}

const PVA_COLUMNS: ExportColumn<PvARow>[] = [
  { header: "Level", width: 9, value: (r) => r.level },
  { header: "Member", width: 24, value: (r) => r.member },
  { header: "Bucket", width: 26, value: (r) => r.bucket },
  { header: "This week planned %", width: 19, value: (r) => r.planned },
  { header: "Actual %", width: 10, value: (r) => r.actual },
  { header: "Difference", width: 11, value: (r) => r.delta },
  { header: "Next week planned %", width: 19, value: (r) => r.next },
];

/** The on-screen Planned vs Actual vs Next table, three rows per person. */
function flattenPlanVsActual(rows: ScorecardRow[]): PvARow[] {
  const buckets: { label: string; plan: "planG" | "planY" | "planR"; next: "nextG" | "nextY" | "nextR"; actual: "greenPct" | "yellowPct" | "redPct" }[] = [
    { label: "Green (on time)", plan: "planG", next: "nextG", actual: "greenPct" },
    { label: "Yellow (revised)", plan: "planY", next: "nextY", actual: "yellowPct" },
    { label: "Red (shifted/missed/open)", plan: "planR", next: "nextR", actual: "redPct" },
  ];
  const out: PvARow[] = [];
  for (const r of rows) {
    for (const b of buckets) {
      const planned = r.raw[b.plan];
      const actual = r.raw.hasTasks ? r.total[b.actual] : null;
      out.push({
        level: r.level,
        member: r.member,
        bucket: b.label,
        planned: planned !== null ? planned : BLANK,
        actual: actual !== null ? actual : BLANK,
        delta: deltaOf(planned, actual),
        next: r.raw[b.next] !== null ? (r.raw[b.next] as number) : BLANK,
      });
    }
  }
  return out;
}

/* ------------------------------ workbook --------------------------------- */

const NOTES = [
  "One row per person: everything the Weekly Scorecard screen shows for that person, for the week named above.",
  "Green = completed on time · Yellow = revised, needed rework · Red = still pending, in progress or shifted.",
  "Total tasks = Green + Yellow + Red. Tasks marked Not Applicable, and personal (self-tracking) tasks, are excluded from every score.",
  "Pending / In progress / Shifted are the task statuses behind the Red column, and sum to it.",
  "Recurring and one-off tasks are scored independently; the Total columns are the two combined.",
  "Percentages are rounded; Red absorbs the rounding so Green + Yellow + Red = 100.",
  "A blank percentage means nothing was planned, or that slice had no tasks — it is NOT a score of 0.",
  "Other tasks are personal, self-tracking tasks. They are counted ALL-TIME (not just this week) and never affect any score.",
  "The shaded, bold top row is the team roll-up. Its planned figures are the average of members' targets, while its actual figures pool everyone's tasks.",
];

/** Names reach the file system here, so strip anything a file name cannot carry. */
const safeFileName = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "employee";

export function exportWeeklyScorecard({
  rows,
  weekStart,
  filters,
  singleName,
}: {
  /** Member rows in the order shown on screen; the team roll-up, if any, first. */
  rows: ScorecardRow[];
  weekStart: string;
  /** What narrowed this export, in plain English. */
  filters: string[];
  /** Set when exporting exactly one person — puts their name in the file name. */
  singleName?: string;
}): void {
  const stem = singleName
    ? `Weekly_Scorecard_${safeFileName(singleName)}_week_${formatDate(weekStart)}`
    : `Weekly_Scorecard_week_${formatDate(weekStart)}`;

  exportSheetsToXlsx({
    // The week covered, not just the day it was pulled — two weeks' exports must not
    // collide in a downloads folder. exportSheetsToXlsx appends today's date.
    fileName: stem,
    title: `Weekly Scorecard — week of ${formatDate(weekStart)} to ${formatDate(weekEndOf(weekStart))}`,
    sheets: [
      { sheetName: "Weekly Scorecard", columns: SCORECARD_COLUMNS, rows, rowStyle: bandTeam },
      { sheetName: "Plan vs Actual", columns: PVA_COLUMNS, rows: flattenPlanVsActual(rows), rowStyle: bandTeam },
    ],
    filters,
    notes: NOTES,
  });
}
