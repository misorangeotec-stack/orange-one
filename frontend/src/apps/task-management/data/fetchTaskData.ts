import { supabase } from "@/core/platform/supabase";
import type {
  ActivityType,
  Location,
  Notification,
  RecurrenceType,
  RecurringTask,
  Task,
  TaskActivity,
  TaskLocation,
  TaskStatus,
  WeeklyPlan,
  WorkspaceSettings,
} from "../types";

/**
 * Live task-domain loader (Stage B B3b, READ-ONLY). Pulls the task tables for the
 * signed-in user (RLS-gated) and maps snake_case rows to the frontend types. No
 * writes — the task store stays read-only until a safe write path is agreed.
 */

export interface TaskData {
  tasks: Task[];
  activity: TaskActivity[];
  notifications: Notification[];
  recurringTasks: RecurringTask[];
  weeklyPlans: WeeklyPlan[];
  workspace: WorkspaceSettings;
  locations: Location[];
}

const DEFAULT_WORKSPACE: WorkspaceSettings = { workspaceName: "Orange O Tec", weekStart: "mon", maxRevisionsPerWeek: 2 };

/* eslint-disable @typescript-eslint/no-explicit-any */
const mapTask = (r: any): Task => ({
  id: r.id,
  title: r.title,
  description: r.description,
  status: r.status as TaskStatus,
  dueDate: r.due_date,
  weekStart: r.week_start,
  createdBy: r.created_by,
  assignedTo: r.assigned_to,
  departmentId: r.department_id,
  revisionCount: r.revision_count ?? 0,
  lastRevisedAt: r.last_revised_at,
  followUpDate: r.follow_up_date,
  shiftedFromTaskId: r.shifted_from_task_id,
  shiftedToTaskId: r.shifted_to_task_id,
  recurringTaskId: r.recurring_task_id,
  completedAt: r.completed_at,
  notApplicable: r.not_applicable ?? false,
  notApplicableAt: r.not_applicable_at ?? null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  lastRemarkAt: r.last_remark_at,
  locations: [], // attached after the fetch from task_locations
});

const mapLocation = (r: any): Location => ({
  id: r.id,
  company: r.company,
  name: r.name,
  isGeneral: r.is_general,
  active: r.active,
  sortOrder: r.sort_order ?? 0,
});

const mapTaskLocation = (r: any): TaskLocation => ({
  id: r.id,
  taskId: r.task_id,
  locationId: r.location_id,
  completedAt: r.completed_at,
  completedBy: r.completed_by,
});

const mapActivity = (r: any): TaskActivity => ({
  id: r.id,
  taskId: r.task_id,
  type: r.type as ActivityType,
  actorId: r.actor_id,
  note: r.note,
  createdAt: r.created_at,
});

const mapNotification = (r: any): Notification => ({
  id: r.id,
  userId: r.user_id,
  type: r.type as "mention",
  taskId: r.task_id,
  actorId: r.actor_id,
  readAt: r.read_at,
  createdAt: r.created_at,
});

const mapRecurring = (r: any): RecurringTask => ({
  id: r.id,
  title: r.title,
  description: r.description,
  recurrenceType: r.recurrence_type as RecurrenceType,
  weeklyDays: r.weekly_days ?? [],
  monthlyDays: r.monthly_days ?? [],
  assignedTo: r.assigned_to,
  createdBy: r.created_by,
  departmentId: r.department_id,
  active: r.active,
  locationIds: [], // attached after the fetch from recurring_task_locations
});

const mapPlan = (r: any): WeeklyPlan => ({
  id: r.id,
  doerId: r.doer_id,
  isoYear: r.iso_year,
  isoWeek: r.iso_week,
  weekStart: r.week_start,
  weekEnd: r.week_end,
  redPct: r.red_pct,
  yellowPct: r.yellow_pct,
  greenPct: r.green_pct,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function fetchTaskData(): Promise<TaskData> {
  const [tasksRes, actRes, notifRes, recRes, planRes, wsRes, locRes, taskLocRes, recLocRes] = await Promise.all([
    supabase.from("tasks").select("*"),
    supabase.from("task_activity").select("*"),
    supabase.from("notifications").select("*"),
    supabase.from("recurring_tasks").select("*"),
    supabase.from("weekly_plans").select("*"),
    supabase.from("workspace_settings").select("*").limit(1).maybeSingle(),
    supabase.from("locations").select("*"),
    supabase.from("task_locations").select("*"),
    supabase.from("recurring_task_locations").select("*"),
  ]);

  for (const res of [tasksRes, actRes, notifRes, recRes, planRes, locRes, taskLocRes, recLocRes]) {
    if (res.error) throw new Error(res.error.message);
  }
  if (wsRes.error) throw new Error(wsRes.error.message);

  // Group the checklist rows by their parent for attachment.
  const taskLocs = (taskLocRes.data ?? []).map(mapTaskLocation);
  const taskLocsByTask = new Map<string, TaskLocation[]>();
  for (const tl of taskLocs) {
    const list = taskLocsByTask.get(tl.taskId) ?? [];
    list.push(tl);
    taskLocsByTask.set(tl.taskId, list);
  }
  const recLocIdsByTpl = new Map<string, string[]>();
  for (const row of recLocRes.data ?? []) {
    const list = recLocIdsByTpl.get(row.recurring_task_id) ?? [];
    list.push(row.location_id);
    recLocIdsByTpl.set(row.recurring_task_id, list);
  }

  const tasks = (tasksRes.data ?? []).map(mapTask).map((t) => ({ ...t, locations: taskLocsByTask.get(t.id) ?? [] }));
  const recurringTasks = (recRes.data ?? [])
    .map(mapRecurring)
    .map((r) => ({ ...r, locationIds: recLocIdsByTpl.get(r.id) ?? [] }));

  const ws = wsRes.data;
  return {
    tasks,
    activity: (actRes.data ?? []).map(mapActivity),
    notifications: (notifRes.data ?? []).map(mapNotification),
    recurringTasks,
    weeklyPlans: (planRes.data ?? []).map(mapPlan),
    workspace: ws
      ? { workspaceName: ws.workspace_name, weekStart: ws.week_start, maxRevisionsPerWeek: ws.max_revisions_per_week }
      : DEFAULT_WORKSPACE,
    locations: (locRes.data ?? []).map(mapLocation),
  };
}
