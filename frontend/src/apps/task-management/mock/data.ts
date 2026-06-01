/**
 * Mock data for the Task Management app — shaped exactly like the Supabase tables
 * (real users + departments from the project). Dates are generated relative to
 * "today" so dashboards always have live-looking content during the frontend phase.
 * Stage B replaces these arrays with live Supabase queries (same shapes).
 */
import type {
  Notification,
  RecurringTask,
  Task,
  TaskActivity,
  WeeklyPlan,
  WorkspaceSettings,
} from "../types";
import { formatDate, addWeeks, weekEndOf, isoWeekOf } from "@/shared/lib/time";

// ---- date helpers (relative to real today, week starts Monday) ----
const d = new Date();
const iso = (dt: Date) => dt.toISOString().slice(0, 10);
const addDays = (base: Date, n: number) => {
  const x = new Date(base);
  x.setDate(x.getDate() + n);
  return x;
};
const dow = (d.getDay() + 6) % 7; // 0=Mon..6=Sun
export const WEEK_START = iso(addDays(d, -dow));
export const WEEK_END = iso(addDays(d, 6 - dow));
const TODAY = iso(d);
const YESTERDAY = iso(addDays(d, -1));
const TOMORROW = iso(addDays(d, 1));
const dt = (days: number, h = 10) => {
  const x = addDays(d, days);
  x.setHours(h, 0, 0, 0);
  return x.toISOString();
};

// ---- directory (people + departments) — now portal-wide, sourced from core/platform ----
// Re-exported so existing task-management imports (e.g. `from "./data"`) keep working.
export { departments, profiles, profileById, departmentById } from "@/core/platform/data";
import { profileById } from "@/core/platform/data";

// Historical tasks for prior weeks — realistic titles, only status + weekStart matter for RYG.
// Declared before `tasks` because the array below calls weekTasks()/mkWeekTask() during
// module init, which read these — keeping them here avoids a temporal-dead-zone crash.
const HIST_TITLES = [
  "Daily sales report", "Bank reconciliation", "Vendor follow-up", "Stock movement update",
  "Petty cash audit", "CRM record cleanup", "Invoice filing", "Cash position report",
];
let histSeq = 100;

// ---- tasks ----
export const tasks: Task[] = [
  mkTask("t1", "Submit daily sales report", "Compile and submit the daily sales numbers to the HOD.", "in_progress", { due: TODAY, by: "u3", to: "u6", dept: "d3" }),
  mkTask("t2", "Follow up with vendor on PO-2289", "Confirm dispatch date and share tracking.", "pending", { due: TODAY, by: "u6", to: "u6", dept: "d3", followUp: TOMORROW }),
  mkTask("t3", "Prepare weekly stock update", "Friday weekly stock movement summary.", "pending", { due: TOMORROW, by: "u3", to: "u6", dept: "d3" }),
  mkTask("t4", "Reconcile April bank statements", "Match ledger entries with bank statement.", "revised", { due: YESTERDAY, by: "u4", to: "u6", dept: "d2", rev: 1, lastRev: dt(-1), followUp: TOMORROW }),
  mkTask("t5", "Update CRM contact records", "Clean up duplicate contacts.", "completed", { due: YESTERDAY, by: "u6", to: "u6", dept: "d3", completed: dt(-1, 17) }),
  mkTask("t6", "Draft board meeting agenda", "Agenda for the monthly board review.", "pending", { due: TODAY, by: "u3", to: "u6", dept: "d1" }),
  mkTask("t7", "Renew AMC contracts", "Three AMC contracts expire this month.", "revised", { due: TODAY, by: "u6", to: "u6", dept: "d3", rev: 2, lastRev: dt(0), followUp: addDaysIso(2) }),
  mkTask("t8", "Onboard new plant technician", "Complete onboarding checklist.", "in_progress", { due: TOMORROW, by: "u2", to: "u7", dept: "d5" }),
  mkTask("t9", "Quarterly GST filing prep", "Collate invoices for GST return.", "pending", { due: addDaysIso(3), by: "u4", to: "u7", dept: "d2" }),
  mkTask("t10", "Audit petty cash register", "Verify entries vs receipts.", "completed", { due: addDaysIso(-2), by: "u4", to: "u6", dept: "d2", completed: dt(-2, 16) }),
  mkTask("t11", "Shift: Website copy review", "Carried to next week.", "shifted", { due: YESTERDAY, by: "u3", to: "u6", dept: "d3" }),
  mkTask("t12", "Prepare investor deck v3", "Incorporate Q1 numbers.", "in_progress", { due: addDaysIso(2), by: "u2", to: "u7", dept: "d1" }),
  // ---- prior-week history (powers the monthly Plan-vs-Actual view) ----
  ...weekTasks("u6", addWeeks(WEEK_START, -1), { completed: 4, revised: 1, red: 1 }),
  ...weekTasks("u7", addWeeks(WEEK_START, -1), { completed: 4, revised: 1, red: 1 }),
  ...weekTasks("u5", addWeeks(WEEK_START, -1), { completed: 3, revised: 1, red: 2 }),
  ...weekTasks("u6", addWeeks(WEEK_START, -2), { completed: 3, revised: 1, red: 2 }),
  ...weekTasks("u7", addWeeks(WEEK_START, -2), { completed: 5, revised: 1, red: 0 }),
  ...weekTasks("u6", addWeeks(WEEK_START, -3), { completed: 4, revised: 2, red: 1 }),
];

function mkWeekTask(to: string, week: string, status: Task["status"]): Task {
  const id = `t${++histSeq}`;
  const at = (h: number) => week + `T${String(h).padStart(2, "0")}:00:00Z`;
  return {
    id,
    title: HIST_TITLES[histSeq % HIST_TITLES.length],
    description: "Weekly task.",
    status,
    dueDate: week,
    weekStart: week,
    createdBy: "u3",
    assignedTo: to,
    departmentId: profileById(to)?.departmentId ?? null,
    revisionCount: status === "revised" ? 1 : 0,
    lastRevisedAt: status === "revised" ? at(14) : null,
    followUpDate: null,
    shiftedFromTaskId: null,
    shiftedToTaskId: null,
    recurringTaskId: null,
    completedAt: status === "completed" ? at(16) : null,
    createdAt: at(9),
    updatedAt: at(16),
    lastRemarkAt: null,
  };
}
/** Build a week's worth of resolved tasks with a given RYG mix (red modelled as shifted). */
function weekTasks(to: string, week: string, mix: { completed: number; revised: number; red: number }): Task[] {
  const out: Task[] = [];
  for (let i = 0; i < mix.completed; i++) out.push(mkWeekTask(to, week, "completed"));
  for (let i = 0; i < mix.revised; i++) out.push(mkWeekTask(to, week, "revised"));
  for (let i = 0; i < mix.red; i++) out.push(mkWeekTask(to, week, "shifted"));
  return out;
}

function mkTask(
  id: string,
  title: string,
  description: string,
  status: Task["status"],
  o: { due?: string; by: string; to: string; dept: string; rev?: number; lastRev?: string; followUp?: string; completed?: string }
): Task {
  return {
    id,
    title,
    description,
    status,
    dueDate: o.due ?? null,
    weekStart: WEEK_START,
    createdBy: o.by,
    assignedTo: o.to,
    departmentId: o.dept,
    revisionCount: o.rev ?? 0,
    lastRevisedAt: o.lastRev ?? null,
    followUpDate: o.followUp ?? null,
    shiftedFromTaskId: null,
    shiftedToTaskId: null,
    recurringTaskId: null,
    completedAt: o.completed ?? null,
    createdAt: dt(-5),
    updatedAt: o.lastRev ?? o.completed ?? dt(-5),
    lastRemarkAt: null,
  };
}
function addDaysIso(n: number) {
  return iso(addDays(d, n));
}

// ---- recurring tasks ----
export const recurringTasks: RecurringTask[] = [
  { id: "r1", title: "Submit daily sales report", description: "Every working day.", recurrenceType: "daily", weeklyDays: [], monthlyDays: [], assignedTo: "u6", createdBy: "u3", departmentId: "d3", active: true },
  { id: "r2", title: "Weekly stock update", description: "Every Friday.", recurrenceType: "weekly", weeklyDays: [5], monthlyDays: [], assignedTo: "u6", createdBy: "u3", departmentId: "d3", active: true },
  { id: "r3", title: "Weekly cash position report", description: "Every Monday.", recurrenceType: "weekly", weeklyDays: [1], monthlyDays: [], assignedTo: "u7", createdBy: "u4", departmentId: "d2", active: false },
  { id: "r4", title: "Monthly expense report", description: "Due on the 1st of each month.", recurrenceType: "monthly", weeklyDays: [], monthlyDays: [1], assignedTo: "u7", createdBy: "u4", departmentId: "d2", active: true },
];

// ---- weekly plans (Red/Yellow/Green target per doer per ISO week) ----
let planSeq = 0;
function mkPlan(doerId: string, weekStart: string, red: number, yellow: number, green: number): WeeklyPlan {
  const { isoYear, isoWeek } = isoWeekOf(weekStart);
  return { id: `w${++planSeq}`, doerId, isoYear, isoWeek, weekStart, weekEnd: weekEndOf(weekStart), redPct: red, yellowPct: yellow, greenPct: green };
}
export const weeklyPlans: WeeklyPlan[] = [
  // current week
  mkPlan("u6", WEEK_START, 10, 25, 65),
  mkPlan("u7", WEEK_START, 5, 20, 75),
  mkPlan("u5", WEEK_START, 15, 30, 55),
  // prior weeks of the month (for Plan-vs-Actual history)
  mkPlan("u6", addWeeks(WEEK_START, -1), 10, 20, 70),
  mkPlan("u7", addWeeks(WEEK_START, -1), 10, 20, 70),
  mkPlan("u5", addWeeks(WEEK_START, -1), 20, 30, 50),
  mkPlan("u6", addWeeks(WEEK_START, -2), 15, 25, 60),
  mkPlan("u7", addWeeks(WEEK_START, -2), 5, 15, 80),
  mkPlan("u6", addWeeks(WEEK_START, -3), 10, 30, 60),
];

// ---- task activity (audit trail) ----
export const activity: TaskActivity[] = [
  { id: "a1", taskId: "t7", type: "revised", actorId: "u6", note: "Awaiting vendor confirmation", createdAt: dt(0, 11) },
  { id: "a2", taskId: "t5", type: "completed", actorId: "u6", note: null, createdAt: dt(-1, 17) },
  { id: "a3", taskId: "t1", type: "started", actorId: "u6", note: null, createdAt: dt(0, 9) },
  { id: "a4", taskId: "t6", type: "assigned", actorId: "u3", note: null, createdAt: dt(0, 8) },
  { id: "a5", taskId: "t4", type: "followup", actorId: "u6", note: "Follow-up set to " + formatDate(TOMORROW), createdAt: dt(-1, 15) },
  { id: "a6", taskId: "t3", type: "created", actorId: "u3", note: null, createdAt: dt(-1, 10) },
];

// ---- notifications (mentions) ----
export const notifications: Notification[] = [
  { id: "n1", userId: "u6", type: "mention", taskId: "t6", actorId: "u3", readAt: null, createdAt: dt(0, 8) },
  { id: "n2", userId: "u6", type: "mention", taskId: "t4", actorId: "u4", readAt: null, createdAt: dt(-1, 15) },
  { id: "n3", userId: "u6", type: "mention", taskId: "t1", actorId: "u3", readAt: dt(-1, 9), createdAt: dt(-1, 9) },
];

// ---- workspace settings (singleton) ----
export const workspaceSettings: WorkspaceSettings = {
  workspaceName: "Orange O Tec",
  weekStart: "mon",
  maxRevisionsPerWeek: 2,
};

export const TODAY_ISO = TODAY;
