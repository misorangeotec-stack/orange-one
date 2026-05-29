/**
 * Mock data for the Task Management app — shaped exactly like the Supabase tables
 * (real users + departments from the project). Dates are generated relative to
 * "today" so dashboards always have live-looking content during the frontend phase.
 * Stage B replaces these arrays with live Supabase queries (same shapes).
 */
import type {
  Department,
  Notification,
  Profile,
  RecurringTask,
  Task,
  TaskActivity,
  WeeklyPlan,
  WorkspaceSettings,
} from "../types";

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

// ---- departments (real) ----
export const departments: Department[] = [
  { id: "d1", name: "Management" },
  { id: "d2", name: "Accounting & Finance" },
  { id: "d3", name: "Administration" },
  { id: "d4", name: "AI & tech" },
  { id: "d5", name: "Research & Development" },
];

// ---- profiles (real users; roles assigned for a representative demo) ----
export const profiles: Profile[] = [
  { id: "u1", name: "Yash Agarwal", email: "yash@orangeotec.com", designation: "CAIO", avatarColor: "orange", departmentId: "d4", role: "admin", hodIds: [] },
  { id: "u2", name: "Aayush Rathi", email: "aayush@orangeotec.com", designation: "Director", avatarColor: "navy", departmentId: "d1", role: "admin", hodIds: [] },
  { id: "u3", name: "Karan Toshniwal", email: "karan@orangeotec.com", designation: "Director", avatarColor: "blue", departmentId: "d1", role: "hod", hodIds: [] },
  { id: "u4", name: "Ritesh Tulsyan", email: "ritesh@orangeotec.com", designation: "CFA", avatarColor: "teal", departmentId: "d2", role: "hod", hodIds: [] },
  { id: "u5", name: "Dimple", email: "dimple@orangeotec.com", designation: "Senior Manager", avatarColor: "violet", departmentId: "d3", role: "sub_hod", hodIds: ["u3"] },
  { id: "u6", name: "Aayushi Shah", email: "ea1@orangeotec.com", designation: "Executive Assistant", avatarColor: "rose", departmentId: "d3", role: "employee", hodIds: ["u3", "u5"] },
  { id: "u7", name: "Vivek Boid", email: "vivek.boid@orangeotec.com", designation: "Head - Plant", avatarColor: "green", departmentId: "d5", role: "employee", hodIds: ["u2"] },
  { id: "u8", name: "Master Admin", email: "master@taskflow.app", designation: "Master Admin", avatarColor: "navy", departmentId: "d1", role: "admin", hodIds: [] },
];

export const profileById = (id: string | null) => profiles.find((p) => p.id === id) ?? null;
export const departmentById = (id: string | null) => departments.find((dep) => dep.id === id) ?? null;

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
];

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
    lastRemarkAt: null,
  };
}
function addDaysIso(n: number) {
  return iso(addDays(d, n));
}

// ---- recurring tasks ----
export const recurringTasks: RecurringTask[] = [
  { id: "r1", title: "Submit daily sales report", description: "Every working day.", recurrenceType: "daily", weeklyDays: [], assignedTo: "u6", createdBy: "u3", departmentId: "d3", active: true },
  { id: "r2", title: "Weekly stock update", description: "Every Friday.", recurrenceType: "weekly", weeklyDays: [5], assignedTo: "u6", createdBy: "u3", departmentId: "d3", active: true },
  { id: "r3", title: "Weekly cash position report", description: "Every Monday.", recurrenceType: "weekly", weeklyDays: [1], assignedTo: "u7", createdBy: "u4", departmentId: "d2", active: false },
];

// ---- weekly plans (Red/Yellow/Green per doer, current ISO week) ----
export const weeklyPlans: WeeklyPlan[] = [
  { id: "w1", doerId: "u6", isoYear: 2026, isoWeek: 22, weekStart: WEEK_START, weekEnd: WEEK_END, redPct: 10, yellowPct: 25, greenPct: 65 },
  { id: "w2", doerId: "u7", isoYear: 2026, isoWeek: 22, weekStart: WEEK_START, weekEnd: WEEK_END, redPct: 5, yellowPct: 20, greenPct: 75 },
  { id: "w3", doerId: "u5", isoYear: 2026, isoWeek: 22, weekStart: WEEK_START, weekEnd: WEEK_END, redPct: 15, yellowPct: 30, greenPct: 55 },
];

// ---- task activity (audit trail) ----
export const activity: TaskActivity[] = [
  { id: "a1", taskId: "t7", type: "revised", actorId: "u6", note: "Awaiting vendor confirmation", createdAt: dt(0, 11) },
  { id: "a2", taskId: "t5", type: "completed", actorId: "u6", note: null, createdAt: dt(-1, 17) },
  { id: "a3", taskId: "t1", type: "started", actorId: "u6", note: null, createdAt: dt(0, 9) },
  { id: "a4", taskId: "t6", type: "assigned", actorId: "u3", note: null, createdAt: dt(0, 8) },
  { id: "a5", taskId: "t4", type: "followup", actorId: "u6", note: "Follow-up set to " + TOMORROW, createdAt: dt(-1, 15) },
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
