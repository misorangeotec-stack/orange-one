import { supabase } from "@/core/platform/supabase";
import type {
  ActivityType,
  Location,
  Notification,
  NotificationType,
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
  recurringTasks: RecurringTask[];
  weeklyPlans: WeeklyPlan[];
  workspace: WorkspaceSettings;
  locations: Location[];
}

/**
 * The org-scale activity/remarks timeline, which the task list and dashboard
 * don't need in order to first-paint. Fetched by `fetchTaskActivity` in a
 * SEPARATE, non-blocking query so the "Loading tasks…" gate clears without
 * waiting for the whole org's history.
 *
 * Notifications USED to ride along here. They now have their own narrow,
 * user-scoped query (`fetchMyNotifications`) because the bell is also rendered
 * from `/home`, which must not pay for the org's whole history — and because two
 * sources for one list is how they drift.
 */
export interface TaskActivityData {
  activity: TaskActivity[];
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
  fromRecurring: r.from_recurring ?? false,
  completedAt: r.completed_at,
  notApplicable: r.not_applicable ?? false,
  notApplicableAt: r.not_applicable_at ?? null,
  isPersonal: r.is_personal ?? false,
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
  naAt: r.na_at ?? null,
  naBy: r.na_by ?? null,
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
  type: r.type as NotificationType,
  taskId: r.task_id,
  actorId: r.actor_id,
  // PostgREST returns the embedded row as an object (or null when the task is no
  // longer readable under RLS). Older callers that didn't request the join get
  // undefined, which normalises to null too.
  taskTitle: r.tasks?.title ?? null,
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
  monthlyNth: r.monthly_nth ?? null,
  monthlyWeekday: r.monthly_weekday ?? null,
  assignedTo: r.assigned_to,
  createdBy: r.created_by,
  departmentId: r.department_id,
  active: r.active,
  createdAt: r.created_at,
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

/**
 * PostgREST caps a single response at the project's "Max rows" setting (default
 * 1000). An admin / senior HOD sees the whole org's rows under RLS, so an
 * unbounded `select("*")` silently drops everything past row 1000 — e.g.
 * `task_locations` is well over 1000 org-wide, so many tasks would render with
 * no/partial companies for them while a normal employee (tiny RLS set) sees all
 * of theirs. Page through every table by its `id` PK so all RLS-visible rows
 * load regardless of who is signed in. (`id` is a stable, unique sort key, so
 * range pages never skip or duplicate.)
 */
const PAGE_SIZE = 1000;
type PagedTable =
  | "tasks"
  | "task_activity"
  | "notifications"
  | "recurring_tasks"
  | "weekly_plans"
  | "locations"
  | "task_locations"
  | "recurring_task_locations";
async function fetchAll(table: PagedTable): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

export async function fetchTaskData(): Promise<TaskData> {
  const [tasksData, recData, planData, wsRes, locData, taskLocData, recLocData] = await Promise.all([
    fetchAll("tasks"),
    fetchAll("recurring_tasks"),
    fetchAll("weekly_plans"),
    supabase.from("workspace_settings").select("*").limit(1).maybeSingle(),
    fetchAll("locations"),
    fetchAll("task_locations"),
    fetchAll("recurring_task_locations"),
  ]);

  if (wsRes.error) throw new Error(wsRes.error.message);

  // Group the checklist rows by their parent for attachment.
  const taskLocs = taskLocData.map(mapTaskLocation);
  const taskLocsByTask = new Map<string, TaskLocation[]>();
  for (const tl of taskLocs) {
    const list = taskLocsByTask.get(tl.taskId) ?? [];
    list.push(tl);
    taskLocsByTask.set(tl.taskId, list);
  }
  const recLocIdsByTpl = new Map<string, string[]>();
  for (const row of recLocData) {
    const list = recLocIdsByTpl.get(row.recurring_task_id) ?? [];
    list.push(row.location_id);
    recLocIdsByTpl.set(row.recurring_task_id, list);
  }

  const tasks = tasksData.map(mapTask).map((t) => ({ ...t, locations: taskLocsByTask.get(t.id) ?? [] }));
  const recurringTasks = recData
    .map(mapRecurring)
    .map((r) => ({ ...r, locationIds: recLocIdsByTpl.get(r.id) ?? [] }));

  const ws = wsRes.data;
  return {
    tasks,
    recurringTasks,
    weeklyPlans: planData.map(mapPlan),
    workspace: ws
      ? { workspaceName: ws.workspace_name, weekStart: ws.week_start, maxRevisionsPerWeek: ws.max_revisions_per_week }
      : DEFAULT_WORKSPACE,
    locations: locData.map(mapLocation),
  };
}

/**
 * Deferred, non-blocking companion to `fetchTaskData`: the org-scale activity
 * timeline + notification rows. Loaded in a background query so a cold first
 * load isn't gated on paging through the whole org's history. Every consumer
 * tolerates these being empty (`?? []`), so they render empty then fill in.
 */
export async function fetchTaskActivity(): Promise<TaskActivityData> {
  const actData = await fetchAll("task_activity");
  return { activity: actData.map(mapActivity) };
}

/**
 * My notification feed — the source for the bell (in-app AND on /home), the
 * Notifications page, the dashboard panel and the task-list highlight.
 *
 * Deliberately NOT the paged `fetchAll` used above: this is one narrow, indexed
 * read (idx_notif_user_unread covers user_id + created_at) rather than a walk of
 * every RLS-visible row. `tasks(title)` is an embedded join so a caller with no
 * tasks array — i.e. the portal home screen — can still render the text; it
 * resolves to null if the task stopped being readable, which the message builder
 * handles.
 *
 * PAGED, not capped. An earlier version took the first 200, which looked safe —
 * the bell shows a handful and the page paginates. But the Tagged screen derives
 * its whole task set from this list (every task I've ever been @mentioned in), so
 * a cap silently drops old tagged tasks once the count is exceeded. That is the
 * same silent-truncation trap documented on `fetchAll` above, and assignment
 * notifications make it reachable: one per task assigned, forever.
 *
 * Paged by `id` (stable + unique, so ranges never skip or duplicate) and sorted
 * newest-first here, since every consumer wants it in that order.
 */
export async function fetchMyNotifications(userId: string): Promise<Notification[]> {
  const out: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("notifications")
      .select("id,user_id,type,task_id,actor_id,read_at,created_at,tasks(title)")
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out.map(mapNotification).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
