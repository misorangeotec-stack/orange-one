import { supabase } from "@/core/platform/supabase";
import type {
  ActivityType,
  Notification,
  RecurrenceType,
  RecurringTask,
  Task,
  TaskActivity,
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
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  lastRemarkAt: r.last_remark_at,
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
  monthlyDays: [], // no monthly recurrence in the live schema yet
  assignedTo: r.assigned_to,
  createdBy: r.created_by,
  departmentId: r.department_id,
  active: r.active,
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
  const [tasksRes, actRes, notifRes, recRes, planRes, wsRes] = await Promise.all([
    supabase.from("tasks").select("*"),
    supabase.from("task_activity").select("*"),
    supabase.from("notifications").select("*"),
    supabase.from("recurring_tasks").select("*"),
    supabase.from("weekly_plans").select("*"),
    supabase.from("workspace_settings").select("*").limit(1).maybeSingle(),
  ]);

  for (const res of [tasksRes, actRes, notifRes, recRes, planRes]) {
    if (res.error) throw new Error(res.error.message);
  }
  if (wsRes.error) throw new Error(wsRes.error.message);

  const ws = wsRes.data;
  return {
    tasks: (tasksRes.data ?? []).map(mapTask),
    activity: (actRes.data ?? []).map(mapActivity),
    notifications: (notifRes.data ?? []).map(mapNotification),
    recurringTasks: (recRes.data ?? []).map(mapRecurring),
    weeklyPlans: (planRes.data ?? []).map(mapPlan),
    workspace: ws
      ? { workspaceName: ws.workspace_name, weekStart: ws.week_start, maxRevisionsPerWeek: ws.max_revisions_per_week }
      : DEFAULT_WORKSPACE,
  };
}
