/**
 * Read-model selectors over the mock data. These mirror the Supabase RLS
 * visibility rules so the UI shows what each role would actually see — and so
 * Stage B can replace them with equivalent queries without UI changes.
 */
import type { Task } from "../types";
import { isToday, isOverdue } from "@/shared/lib/time";

// Directory-dependent selectors (directReportIds / downlineIds / assignableUsers /
// visibleTasks) now live on the directory + task stores, since they read the live
// people + task lists. The transitive-downline walk has a single implementation in
// the core directory store; re-exported here for the pages that already import it.
export { computeDownlineIds as downlineIds } from "@/core/platform/store";

/**
 * A task counts toward scores / RYG / dashboard metrics only if it is neither
 * marked Not Applicable ("when" instances) nor a personal (self-tracking) task.
 * Personal tasks are visible in list views but must never affect any number.
 */
export const countsTowardMetrics = (t: Task) => !t.notApplicable && !t.isPersonal;

/**
 * Whether a task originated from a recurring template (vs an ad-hoc one-off).
 * Prefer the durable `fromRecurring` flag (stamped at generation, survives template
 * deletion); fall back to a still-live `recurringTaskId` link so instances created
 * before the flag column existed are still classified correctly while their
 * template remains. Both false → genuine one-off (or an orphan whose template was
 * deleted before the flag shipped, which is unrecoverable).
 */
export const isRecurringTask = (t: Task) => t.fromRecurring || t.recurringTaskId !== null;

export interface DashboardStats {
  dueToday: number;
  pending: number;
  inProgress: number;
  completed: number;
  revised: number;
  shifted: number;
  followUpDue: number;
  overdue: number;
  total: number;
  statusCounts: Record<Task["status"], number>;
}

export interface PersonReport {
  planned: number;
  completed: number;
  pending: number; // pending + in_progress
  revised: number;
  shifted: number;
  revisionTotal: number;
}

/** Planned-vs-actual style report numbers for one person, from a task list. */
export function reportFor(all: Task[], personId: string): PersonReport {
  // N/A instances ("when" tasks marked Not Applicable for the day) and personal
  // self-tracking tasks are excluded from every count so they never affect the
  // planned total or RYG buckets.
  const mine = all.filter((t) => t.assignedTo === personId && countsTowardMetrics(t));
  const r: PersonReport = { planned: mine.length, completed: 0, pending: 0, revised: 0, shifted: 0, revisionTotal: 0 };
  for (const t of mine) {
    if (t.status === "completed") r.completed++;
    else if (t.status === "pending" || t.status === "in_progress") r.pending++;
    else if (t.status === "revised") r.revised++;
    else if (t.status === "shifted") r.shifted++;
    r.revisionTotal += t.revisionCount;
  }
  return r;
}

// ---- Planned-vs-actual RYG ----

export interface RygPct {
  red: number;
  yellow: number;
  green: number;
  total: number; // task count (actual) or plan count (planned); 0 = nothing to show
}

const EMPTY_RYG: RygPct = { red: 0, yellow: 0, green: 0, total: 0 };

/**
 * Actual achieved RYG (%) for one person in one week, from their tasks:
 * Green = completed, Yellow = revised, Red = everything else (pending / in-progress / overdue / shifted).
 */
export function actualRygFor(all: Task[], personId: string, weekStart: string): RygPct {
  const mine = all.filter((t) => t.assignedTo === personId && t.weekStart === weekStart && countsTowardMetrics(t));
  const total = mine.length;
  if (!total) return EMPTY_RYG;
  let g = 0, y = 0;
  for (const t of mine) {
    if (t.status === "completed") g++;
    else if (t.status === "revised") y++;
  }
  const green = Math.round((g / total) * 100);
  const yellow = Math.round((y / total) * 100);
  return { green, yellow, red: 100 - green - yellow, total }; // red absorbs rounding so sum = 100
}

type PlanLookup = (doerId: string, weekStart: string) => { redPct: number; yellowPct: number; greenPct: number } | undefined;

/**
 * Planned (average of available plan %s) vs actual (pooled task buckets) across a set of
 * people over one or more weeks. Used for both per-week rows and the month rollup.
 */
export function aggregateRyg(people: string[], weeks: string[], all: Task[], planFor: PlanLookup): { planned: RygPct; actual: RygPct } {
  let pr = 0, py = 0, pg = 0, plans = 0;
  let g = 0, y = 0, tasks = 0;
  for (const pid of people) {
    for (const w of weeks) {
      const plan = planFor(pid, w);
      if (plan) { pr += plan.redPct; py += plan.yellowPct; pg += plan.greenPct; plans++; }
      for (const t of all) {
        if (t.assignedTo !== pid || t.weekStart !== w || !countsTowardMetrics(t)) continue;
        tasks++;
        if (t.status === "completed") g++;
        else if (t.status === "revised") y++;
      }
    }
  }
  const planned: RygPct = plans
    ? { yellow: Math.round(py / plans), green: Math.round(pg / plans), red: 0, total: plans }
    : { ...EMPTY_RYG };
  if (plans) planned.red = 100 - planned.yellow - planned.green;
  const actual: RygPct = tasks
    ? { yellow: Math.round((y / tasks) * 100), green: Math.round((g / tasks) * 100), red: 0, total: tasks }
    : { ...EMPTY_RYG };
  if (tasks) actual.red = 100 - actual.yellow - actual.green;
  return { planned, actual };
}

export function computeStats(list: Task[]): DashboardStats {
  const statusCounts: Record<Task["status"], number> = {
    pending: 0,
    in_progress: 0,
    completed: 0,
    revised: 0,
    shifted: 0,
  };
  let dueToday = 0,
    followUpDue = 0,
    overdue = 0,
    total = 0;
  for (const t of list) {
    if (!countsTowardMetrics(t)) continue; // N/A + personal tasks are excluded from every dashboard metric
    total++;
    statusCounts[t.status]++;
    if (isToday(t.dueDate) && t.status !== "completed") dueToday++;
    if (t.followUpDate && (isToday(t.followUpDate) || isOverdue(t.followUpDate)) && t.status !== "completed")
      followUpDue++;
    if (isOverdue(t.dueDate) && (t.status === "pending" || t.status === "in_progress")) overdue++;
  }
  // Counts reflect whatever list is passed in; the Dashboard scope toggle
  // ("this week" vs "all time") decides which tasks reach here.
  return {
    dueToday,
    pending: statusCounts.pending,
    inProgress: statusCounts.in_progress,
    completed: statusCounts.completed,
    revised: statusCounts.revised,
    shifted: statusCounts.shifted,
    followUpDue,
    overdue,
    total,
    statusCounts,
  };
}
