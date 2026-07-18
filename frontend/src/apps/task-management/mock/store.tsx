import { createContext, useContext, useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import type { AppRole, AvatarColor, Department, Location, Notification, Profile, RecurringTask, Task, TaskActivity, TaskLocation, WeeklyPlan, WorkspaceSettings } from "../types";
import { useSession } from "./session";
import { useDirectory } from "@/core/platform/store";
import { fetchOrgPeople, type OrgPerson } from "@/core/platform/orgPeople";
import { supabase } from "@/core/platform/supabase";
import { isoWeekOf, weekEndOf, weekStartOf, todayIso } from "@/shared/lib/time";
import { fetchTaskData, fetchTaskActivity, type TaskData } from "../data/fetchTaskData";
import { useMyNotifications, TASK_NOTIF_KEY } from "../lib/useMyNotifications";
import {
  insertTask,
  updatePersonalTask as updatePersonalTaskWrite,
  deletePersonalTask as deletePersonalTaskWrite,
  updateTask as updateTaskWrite,
  deleteTask as deleteTaskWrite,
  startTask as startTaskWrite,
  completeTask as completeTaskWrite,
  reopenTask as reopenTaskWrite,
  setTaskNotApplicable as setTaskNotApplicableWrite,
  reviseTask as reviseTaskWrite,
  rescheduleTask as rescheduleTaskWrite,
  addRemark as addRemarkWrite,
  markNotificationsRead as markNotificationsReadWrite,
  markNotificationsUnread as markNotificationsUnreadWrite,
  insertRecurring as insertRecurringWrite,
  updateRecurring as updateRecurringWrite,
  setRecurringActive as setRecurringActiveWrite,
  generateRecurringNow as generateRecurringNowWrite,
  deleteRecurring as deleteRecurringWrite,
  upsertWeeklyPlan as upsertWeeklyPlanWrite,
  updateWorkspaceSettings as updateWorkspaceSettingsWrite,
  setTaskLocationDone as setTaskLocationDoneWrite,
  setTaskLocationNa as setTaskLocationNaWrite,
  setTaskLocationsDone as setTaskLocationsDoneWrite,
  insertLocation as insertLocationWrite,
  updateLocation as updateLocationWrite,
  deleteLocation as deleteLocationWrite,
  type LocationWriteInput,
} from "../data/taskWrites";

/**
 * Task-domain store (Stage B B3b, READ-ONLY). Loads the live task tables for the
 * signed-in user (RLS-gated) via React Query and exposes the same interface the
 * screens already consume — read selectors are real; the directory (people +
 * departments) is re-exposed from the portal core. Writes are disabled this phase
 * (`canWrite` is false; mutations are inert no-ops) until a safe write path is
 * agreed, so nothing here can change production data.
 */

const mondayOf = (iso: string) => {
  const d = new Date(iso);
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return d.toISOString().slice(0, 10);
};
const today = new Date();
const WEEK_START = mondayOf(today.toISOString());
const WEEK_END = (() => {
  const d = new Date(WEEK_START);
  d.setDate(d.getDate() + 6);
  return d.toISOString().slice(0, 10);
})();

export interface RevisionInfo {
  usedThisWeek: number;
  remaining: number;
  allowed: boolean;
  max: number;
}

interface TaskStoreValue {
  tasks: Task[];
  activity: TaskActivity[];
  notifications: Notification[];
  getTask: (id: string) => Task | undefined;
  activityFor: (taskId: string) => TaskActivity[];
  revisionInfo: (task: Task) => RevisionInfo;
  createTask: (input: { title: string; description?: string; assignedTo: string | null; departmentId: string | null; dueDate: string | null; locationIds?: string[] }) => Promise<string>;
  /** Create a personal (self-tracking) task. Self-assigned and excluded from every score/RYG/dashboard metric. */
  createPersonalTask: (input: { title: string; description?: string; dueDate: string | null }) => Promise<string>;
  /** Edit a personal task's title/description/due date. */
  updatePersonalTask: (id: string, patch: { title: string; description?: string; dueDate: string | null }) => Promise<void>;
  /** Delete a personal task (creator only, RLS-enforced). */
  deletePersonalTask: (id: string) => Promise<void>;
  /**
   * Edit a pending one-off task: title, description, due date, locations. Never
   * reassigns. Pending-only + creator/assignee/admin is a UI-level guard (see
   * canEditRow / canEditOneOff) — `tasks_update` RLS is deliberately wider.
   */
  updateTask: (id: string, patch: { title: string; description?: string; dueDate: string | null; locationIds: string[] }) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  startTask: (id: string) => Promise<void>;
  completeTask: (id: string, note?: string) => Promise<void>;
  reopenTask: (id: string) => Promise<void>;
  /** Mark a "when" task instance Not Applicable for its day, or back to applicable. Reversible. */
  setTaskNotApplicable: (id: string, value: boolean) => Promise<void>;
  /** True when this task was generated from a "when" recurring template (so N/A is offered). */
  isWhenTask: (task: Task) => boolean;
  /**
   * Revise with a follow-up date. A follow-up in a LATER week is treated as a
   * shift (original → 'shifted', a continuation task opens in that week) and
   * returns the new task's id; a same/earlier-week follow-up is a true in-week
   * revision (capped 2/week) and returns null.
   */
  reviseTask: (id: string, args: { followUpDate: string; note?: string }) => Promise<string | null>;
  rescheduleTask: (id: string, newDueDate: string) => Promise<string | null>;
  addRemark: (id: string, note: string, mentionedIds: string[]) => Promise<void>;
  markNotificationsRead: (ids: string[]) => Promise<void>;
  /** Put notifications back to unread (the undo for opening a task). */
  markNotificationsUnread: (ids: string[]) => Promise<void>;
  /** My notifications, newest first — the bell, the Notifications page, the dashboard panel. */
  myNotifications: Notification[];
  /** How many of mine are unread (bell dot, nav badge, dashboard count). */
  unreadCount: number;
  /**
   * Task ids I've been assigned but not yet looked at — drives the task-list row
   * highlight. A Set because TaskTable tests it once per rendered row.
   */
  unreadAssignedTaskIds: Set<string>;
  /**
   * Mark every unread notification for one task read. Called when the assignee
   * OPENS the task, which is what clears the row highlight. No-ops when there is
   * nothing unread, so re-opening a task doesn't spend a write.
   */
  markTaskNotificationsRead: (taskId: string) => Promise<void>;

  recurringTasks: RecurringTask[];
  getRecurring: (id: string) => RecurringTask | undefined;
  createRecurring: (input: Omit<RecurringTask, "id" | "createdAt">) => Promise<string>;
  updateRecurring: (id: string, patch: Partial<Omit<RecurringTask, "id" | "createdAt">>) => Promise<void>;
  toggleRecurring: (id: string) => Promise<void>;
  /** Force-generate today's task instance for a template (manual "Generate now"); returns the task id. */
  generateRecurringNow: (id: string) => Promise<string | null>;
  deleteRecurring: (id: string) => Promise<void>;

  // locations
  locations: Location[];
  /** Active locations, sorted for display (the picker source). */
  activeLocations: Location[];
  locationById: (id: string | null) => Location | undefined;
  /** True when every location on a task is resolved — done OR N/A (so it may be completed). */
  taskLocationsComplete: (task: Task) => boolean;
  /** Tick / untick one location on a task's checklist. */
  setTaskLocationDone: (taskLocationId: string, done: boolean) => Promise<void>;
  /** Mark / unmark one location as Not Applicable (counts as resolved for completion). */
  setTaskLocationNa: (taskLocationId: string, na: boolean) => Promise<void>;
  /** Select all / Clear all — tick every location at once, or reset them (done AND N/A cleared). */
  setTaskLocationsDone: (taskLocationIds: string[], done: boolean) => Promise<void>;
  /** Admin location-master CRUD. */
  addLocation: (input: LocationWriteInput) => Promise<string>;
  editLocation: (id: string, input: LocationWriteInput) => Promise<void>;
  removeLocation: (id: string) => Promise<void>;
  /** True for admins — the location master is admin-managed. */
  canManageLocations: boolean;

  // directory (people + departments) — re-exposed from the portal core
  profiles: Profile[];
  /**
   * Org-wide, name-only people list for @mention pickers (every user, not just
   * the RLS-visible downline/same-dept set) so a HOD can tag a senior in another
   * department or any cross-department colleague. No phone/email (phone = login
   * password). Falls back to `profiles` until the org list loads.
   */
  mentionablePeople: OrgPerson[];
  departments: Department[];
  profileById: (id: string | null) => Profile | undefined;
  /**
   * Resolve an activity/actor id to a display name + avatar color, falling back
   * to the org-wide people list when the RLS-scoped directory can't see them
   * (e.g. a cross-department assigner). Use this for activity/creator display so
   * out-of-scope actors don't render as "Someone".
   */
  actorById: (id: string | null) => { id: string; name: string; avatarColor: AvatarColor | string } | undefined;
  departmentById: (id: string | null) => Department | undefined;
  directReportIds: (hodId: string) => string[];
  downlineIds: (rootId: string) => string[];
  assignableUsers: (role: AppRole, userId: string) => Profile[];
  visibleTasks: (role: AppRole, userId: string) => Task[];
  addDepartment: (input: { name: string; description?: string }) => string;
  updateDepartment: (id: string, patch: { name?: string; description?: string }) => void;
  deleteDepartment: (id: string) => void;
  addUser: (input: { name: string; email?: string; designation?: string; role: AppRole; departmentId: string | null; hodIds?: string[] }) => string;
  updateUser: (id: string, patch: Partial<Pick<Profile, "name" | "email" | "designation" | "role" | "departmentId" | "hodIds" | "avatarColor">>) => void;
  deleteUser: (id: string) => void;

  weeklyPlans: WeeklyPlan[];
  weeklyPlanFor: (doerId: string, weekStart: string) => WeeklyPlan | undefined;
  setWeeklyPlan: (input: { doerId: string; weekStart: string; redPct: number; yellowPct: number; greenPct: number }) => Promise<void>;

  workspace: WorkspaceSettings;
  updateWorkspace: (patch: Partial<WorkspaceSettings>) => Promise<void>;
  /** True for admins — workspace settings save live (admin-only under RLS). */
  canManageWorkspace: boolean;

  /** False during the read-only phase — UIs disable write controls. */
  canWrite: boolean;
  /** B4 rollout: the create-task write path is live (other flows still read-only). */
  canCreateTask: boolean;
  /** B4 rollout: the Start / Complete / Revise status actions are live. */
  canStatusActions: boolean;
  /** B4 rollout: due-date reschedule + shift-to-next-week is live. */
  canReschedule: boolean;
  /** B4 rollout: posting @mention remarks (+ notification fan-out) is live. */
  canRemark: boolean;
  /** B4 rollout: recurring-task CRUD (create/edit/toggle/delete) is live. */
  canRecurring: boolean;
  /** B4 rollout: setting a doer's weekly RYG plan is live. */
  canWeeklyPlan: boolean;
}

const StoreContext = createContext<TaskStoreValue | null>(null);

const DEFAULT_WORKSPACE: WorkspaceSettings = { workspaceName: "Orange O Tec", weekStart: "mon", maxRevisionsPerWeek: 2 };

const readOnly = () => {
  if (import.meta.env.DEV) console.warn("Task store is read-only in this phase — write ignored.");
};
const readOnlyId = () => {
  readOnly();
  return "";
};

/**
 * Optimistically rewrite one task_location row across every cached taskData query,
 * so a location tick/N/A shows instantly before the Supabase write returns. The
 * follow-up invalidate reconciles with server truth (true timestamps, by-names).
 */
function patchTaskLocation(
  queryClient: QueryClient,
  taskLocationId: string,
  update: (l: TaskLocation) => TaskLocation
) {
  queryClient.setQueriesData<TaskData>({ queryKey: ["taskData"] }, (prev) => {
    // The ["taskData"] prefix also matches the deferred ["taskData","activity",…]
    // query, whose payload has no `tasks` — skip it so we only patch the core.
    if (!prev || !prev.tasks) return prev;
    let changed = false;
    const tasks = prev.tasks.map((t) => {
      if (!t.locations.some((l) => l.id === taskLocationId)) return t;
      changed = true;
      return { ...t, locations: t.locations.map((l) => (l.id === taskLocationId ? update(l) : l)) };
    });
    return changed ? { ...prev, tasks } : prev;
  });
}

export function TaskStoreProvider({ children }: { children: ReactNode }) {
  const { user, role } = useSession();
  const dir = useDirectory();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["taskData", user?.id ?? null],
    queryFn: fetchTaskData,
    enabled: !!user,
  });
  // Deferred, NON-blocking slice: the org-scale activity timeline. Nested under
  // the ["taskData"] prefix so every existing invalidateQueries(["taskData"])
  // (remarks, status changes) and the IndexedDB persistence auto-cover it — but
  // the "Loading tasks…" gate below waits only on the core query, so a cold load
  // paints without this history.
  const { data: activityData } = useQuery({
    queryKey: ["taskData", "activity", user?.id ?? null],
    queryFn: fetchTaskActivity,
    enabled: !!user,
  });
  // The notification feed is its OWN root key (not under ["taskData"]) and owns
  // its realtime subscription — see lib/useMyNotifications for why. Consequence:
  // writes that touch notifications must invalidate BOTH keys.
  const { notifications } = useMyNotifications(user?.id);
  // Org-wide people list for @mention pickers (see mentionablePeople). Cached
  // for 5 min; safe to share across the app since it carries no sensitive fields.
  const { data: orgPeople } = useQuery({
    queryKey: ["orgPeople"],
    queryFn: fetchOrgPeople,
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  const tasks = data?.tasks ?? [];
  const activity = activityData?.activity ?? [];
  const recurringTasks = data?.recurringTasks ?? [];
  const weeklyPlans = data?.weeklyPlans ?? [];
  const workspace = data?.workspace ?? DEFAULT_WORKSPACE;
  const locations = data?.locations ?? [];

  const value = useMemo<TaskStoreValue>(() => {
    const { downlineIds } = dir;

    // Org-wide id → person map (name + avatar only) so activity actors can be
    // named even when they fall outside the viewer's RLS-scoped directory — e.g.
    // a Director in another department who assigned a recurring task. Without
    // this, profileById misses them and the UI renders "Someone".
    const orgPeopleById = new Map((orgPeople ?? []).map((p) => [p.id, p] as const));
    const actorById: TaskStoreValue["actorById"] = (id) => {
      if (!id) return undefined;
      const p = dir.profileById(id);
      if (p) return { id: p.id, name: p.name, avatarColor: p.avatarColor };
      const o = orgPeopleById.get(id);
      if (o) return { id: o.id, name: o.name, avatarColor: o.avatarColor };
      return undefined;
    };

    const visibleTasks = (role: AppRole, userId: string): Task[] => {
      if (role === "admin") return tasks;
      if (role === "hod" || role === "sub_hod") {
        const team = new Set([userId, ...downlineIds(userId)]);
        return tasks.filter((t) => t.assignedTo === userId || t.createdBy === userId || (t.assignedTo && team.has(t.assignedTo)));
      }
      return tasks.filter((t) => t.assignedTo === userId || t.createdBy === userId);
    };

    const revisionInfo = (task: Task): RevisionInfo => {
      const max = workspace.maxRevisionsPerWeek;
      const revisedThisWeek =
        task.lastRevisedAt && task.lastRevisedAt.slice(0, 10) >= WEEK_START && task.lastRevisedAt.slice(0, 10) <= WEEK_END;
      const usedThisWeek = revisedThisWeek ? task.revisionCount : 0;
      const remaining = Math.max(0, max - usedThisWeek);
      const allowed = remaining > 0 && task.status !== "completed" && task.status !== "shifted";
      return { usedThisWeek, remaining, allowed, max };
    };

    // The feed is already user-scoped by RLS and by the query's own .eq(), but
    // filter defensively so a cached row from another session can never surface.
    const myNotifications = notifications.filter((n) => n.userId === user.id);
    const unread = myNotifications.filter((n) => !n.readAt);
    const unreadAssignedTaskIds = new Set(
      unread.filter((n) => n.type === "assigned" && n.taskId).map((n) => n.taskId as string)
    );

    return {
      tasks,
      activity,
      notifications,
      myNotifications,
      unreadCount: unread.length,
      unreadAssignedTaskIds,
      getTask: (id) => tasks.find((t) => t.id === id),
      activityFor: (taskId) => activity.filter((a) => a.taskId === taskId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      revisionInfo,

      // ---- mutations ----
      // createTask: LIVE (B4 first flow). Inserts under RLS (created_by = auth uid)
      // then refetches. Other task mutations stay inert no-ops until wired.
      createTask: async (input) => {
        const id = await insertTask({ ...input, locationIds: input.locationIds ?? [], createdBy: user.id });
        await queryClient.invalidateQueries({ queryKey: ["taskData"] });
        return id;
      },
      // Personal tasks: self-assigned, flagged is_personal, no locations. Excluded
      // from every metric in the selectors, so they never touch a score. Department
      // is set to the creator's own for sensible display in list views only.
      createPersonalTask: async (input) => {
        const id = await insertTask({
          title: input.title,
          description: input.description,
          assignedTo: user.id,
          departmentId: dir.profileById(user.id)?.departmentId ?? null,
          dueDate: input.dueDate,
          locationIds: [],
          isPersonal: true,
          createdBy: user.id,
        });
        await queryClient.invalidateQueries({ queryKey: ["taskData"] });
        return id;
      },
      updatePersonalTask: async (id, patch) => {
        await updatePersonalTaskWrite(id, patch);
        await queryClient.invalidateQueries({ queryKey: ["taskData"] });
      },
      deletePersonalTask: async (id) => {
        await deletePersonalTaskWrite(id);
        await queryClient.invalidateQueries({ queryKey: ["taskData"] });
      },
      updateTask: async (id, patch) => {
        await updateTaskWrite(id, patch);
        await queryClient.invalidateQueries({ queryKey: ["taskData"] });
      },
      deleteTask: async (id) => {
        await deleteTaskWrite(id);
        await queryClient.invalidateQueries({ queryKey: ["taskData"] });
      },
      // startTask / completeTask / reviseTask: LIVE (B4). The DB trigger logs the
      // status-change activity (started is logged by the write itself); refetch after.
      startTask: async (id) => {
        await startTaskWrite(id, user.id);
        await queryClient.invalidateQueries({ queryKey: ["taskData"] });
      },
      completeTask: async (id, note) => {
        await completeTaskWrite(id, user.id, note);
        await queryClient.invalidateQueries({ queryKey: ["taskData"] });
      },
      // reopenTask: LIVE. Reverses a completion (current-week only, gated in the UI):
      // status → in_progress, completed_at cleared, and a 'reopened' activity logged.
      reopenTask: async (id) => {
        await reopenTaskWrite(id, user.id);
        await queryClient.invalidateQueries({ queryKey: ["taskData"] });
      },
      // setTaskNotApplicable: LIVE. A plain not_applicable column update under the
      // task UPDATE RLS (same path as complete). Reversible; excluded from reports
      // in the selectors. Only offered for "when" instances (see isWhenTask).
      setTaskNotApplicable: async (id, value) => {
        await setTaskNotApplicableWrite(id, value);
        await queryClient.invalidateQueries({ queryKey: ["taskData"] });
      },
      isWhenTask: (task) => {
        if (!task.recurringTaskId) return false;
        return recurringTasks.find((r) => r.id === task.recurringTaskId)?.recurrenceType === "when";
      },
      reviseTask: async (id, args) => {
        const task = tasks.find((t) => t.id === id);
        if (!task) return null;
        // A follow-up date in a LATER week is a shift, not a revision: route it
        // through the continuation mechanism (original → 'shifted', a fresh task
        // opens in the new week) so the move is visible as a shift, and it's
        // allowed even when the weekly revision limit is reached. Same-week (or
        // earlier) follow-ups are true in-week revisions, capped at 2/week.
        const targetWeek = weekStartOf(args.followUpDate);
        const currentWeek = task.weekStart ?? weekStartOf(todayIso());
        if (targetWeek > currentWeek) {
          const newId = await rescheduleTaskWrite(task, args.followUpDate);
          if (args.note && newId) await addRemarkWrite(newId, args.note, []);
          await queryClient.invalidateQueries({ queryKey: ["taskData"] });
          return newId;
        }
        if (!revisionInfo(task).allowed) return null; // weekly revision limit / closed guard
        await reviseTaskWrite(id, user.id, { ...args, currentRevisionCount: task.revisionCount });
        await queryClient.invalidateQueries({ queryKey: ["taskData"] });
        return null;
      },
      // rescheduleTask: LIVE (B4). Same/earlier week → move due date; future week →
      // create a linked continuation task + mark the original shifted. Trigger logs
      // the shifted/created activity; refetch and return the new id (if any).
      rescheduleTask: async (id, newDueDate) => {
        const task = tasks.find((t) => t.id === id);
        if (!task || !newDueDate) return null;
        const newId = await rescheduleTaskWrite(task, newDueDate);
        await queryClient.invalidateQueries({ queryKey: ["taskData"] });
        return newId;
      },
      // addRemark: LIVE (B4). Posts a remark + fans out @mention notifications via
      // the add_task_remark RPC (notifications has no client INSERT policy), then refetches.
      addRemark: async (id, note, mentionedIds) => {
        await addRemarkWrite(id, note, mentionedIds);
        await queryClient.invalidateQueries({ queryKey: ["taskData"] });
        // Fans out @mention notifications, so refresh the feed's own key too.
        await queryClient.invalidateQueries({ queryKey: [TASK_NOTIF_KEY] });
      },
      // Mark own notifications read (always allowed — RLS scopes to the caller).
      markNotificationsRead: async (ids) => {
        if (ids.length === 0) return;
        await markNotificationsReadWrite(ids);
        await queryClient.invalidateQueries({ queryKey: [TASK_NOTIF_KEY] });
      },
      markNotificationsUnread: async (ids) => {
        if (ids.length === 0) return;
        await markNotificationsUnreadWrite(ids);
        await queryClient.invalidateQueries({ queryKey: [TASK_NOTIF_KEY] });
      },
      // Clearing a task's highlight when its assignee opens it. Guarded: with
      // nothing unread this is a no-op, so revisiting a task costs no write.
      markTaskNotificationsRead: async (taskId) => {
        const ids = notifications
          .filter((n) => n.taskId === taskId && n.userId === user.id && !n.readAt)
          .map((n) => n.id);
        if (ids.length === 0) return;
        await markNotificationsReadWrite(ids);
        await queryClient.invalidateQueries({ queryKey: [TASK_NOTIF_KEY] });
      },

      recurringTasks,
      getRecurring: (id) => recurringTasks.find((r) => r.id === id),
      // Recurring CRUD: LIVE (B4). recurrence_type is daily/weekly/monthly; the
      // write layer keeps only the day-set that matches the type. RLS scopes the writes.
      createRecurring: async (input) => {
        const id = await insertRecurringWrite({
          title: input.title,
          description: input.description ?? null,
          recurrenceType: input.recurrenceType,
          weeklyDays: input.weeklyDays ?? [],
          monthlyDays: input.monthlyDays ?? [],
          monthlyNth: input.monthlyNth ?? null,
          monthlyWeekday: input.monthlyWeekday ?? null,
          assignedTo: input.assignedTo,
          departmentId: input.departmentId,
          active: input.active,
          locationIds: input.locationIds ?? [],
          createdBy: user.id,
        });
        // Materialise today's instance immediately if the template is active and
        // fires today (otherwise it would wait for the next 06:00 IST cron run).
        // Best-effort: a generation failure shouldn't fail the template create.
        if (input.active) {
          try {
            await generateRecurringNowWrite(id);
          } catch {
            /* template saved; today's instance will be created by the next cron run */
          }
        }
        await queryClient.invalidateQueries({ queryKey: ["taskData"] });
        return id;
      },
      updateRecurring: async (id, patch) => {
        const cur = recurringTasks.find((r) => r.id === id);
        if (!cur) return;
        const m = { ...cur, ...patch };
        await updateRecurringWrite(id, {
          title: m.title,
          description: m.description ?? null,
          recurrenceType: m.recurrenceType,
          weeklyDays: m.weeklyDays ?? [],
          monthlyDays: m.monthlyDays ?? [],
          monthlyNth: m.monthlyNth ?? null,
          monthlyWeekday: m.monthlyWeekday ?? null,
          assignedTo: m.assignedTo,
          departmentId: m.departmentId,
          active: m.active,
          locationIds: m.locationIds ?? [],
        });
        // If the edit leaves the template active, ensure today's instance exists
        // (e.g. activating via the edit form). Idempotent, so no duplicate if it
        // already generated today. Best-effort.
        if (m.active) {
          try {
            await generateRecurringNowWrite(id);
          } catch {
            /* saved; today's instance will be created by the next cron run */
          }
        }
        await queryClient.invalidateQueries({ queryKey: ["taskData"] });
      },
      toggleRecurring: async (id) => {
        const cur = recurringTasks.find((r) => r.id === id);
        if (!cur) return;
        const nowActive = !cur.active;
        await setRecurringActiveWrite(id, nowActive);
        // Re-activating a template should drop today's instance in right away,
        // same as creating an active one. Best-effort (see createRecurring).
        if (nowActive) {
          try {
            await generateRecurringNowWrite(id);
          } catch {
            /* toggled active; today's instance will be created by the next cron run */
          }
        }
        await queryClient.invalidateQueries({ queryKey: ["taskData"] });
      },
      // Manual on-demand generation (force = true): creates today's instance on
      // any day, ignoring the schedule. Idempotent. Returns the task id so the UI
      // can jump straight to it.
      generateRecurringNow: async (id) => {
        const taskId = await generateRecurringNowWrite(id, true);
        await queryClient.invalidateQueries({ queryKey: ["taskData"] });
        return taskId;
      },
      deleteRecurring: async (id) => {
        await deleteRecurringWrite(id);
        await queryClient.invalidateQueries({ queryKey: ["taskData"] });
      },

      // ---- locations ----
      locations,
      activeLocations: locations
        .filter((l) => l.active)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
      locationById: (id) => (id ? locations.find((l) => l.id === id) : undefined),
      taskLocationsComplete: (task) =>
        task.locations.every((l) => l.completedAt !== null || l.naAt !== null),
      // Location toggles flip the React Query cache OPTIMISTICALLY first, so the
      // tick/N/A renders the instant the user clicks instead of after the Supabase
      // round-trip + full refetch (which felt like a dead click). The network write
      // then runs in the background and we invalidate to reconcile timestamps/by-names;
      // a failed write rolls back by refetching the server truth.
      setTaskLocationDone: async (taskLocationId, done) => {
        patchTaskLocation(queryClient, taskLocationId, (l) => ({
          ...l,
          completedAt: done ? new Date().toISOString() : null,
          completedBy: done ? user.id : null,
          ...(done ? { naAt: null, naBy: null } : {}),
        }));
        try {
          await setTaskLocationDoneWrite(taskLocationId, done, user.id);
          await queryClient.invalidateQueries({ queryKey: ["taskData"] });
        } catch (e) {
          await queryClient.invalidateQueries({ queryKey: ["taskData"] });
          throw e;
        }
      },
      setTaskLocationNa: async (taskLocationId, na) => {
        patchTaskLocation(queryClient, taskLocationId, (l) => ({
          ...l,
          naAt: na ? new Date().toISOString() : null,
          naBy: na ? user.id : null,
          ...(na ? { completedAt: null, completedBy: null } : {}),
        }));
        try {
          await setTaskLocationNaWrite(taskLocationId, na, user.id);
          await queryClient.invalidateQueries({ queryKey: ["taskData"] });
        } catch (e) {
          await queryClient.invalidateQueries({ queryKey: ["taskData"] });
          throw e;
        }
      },
      // Bulk tick / reset, same optimistic-first pattern as the single-row toggles:
      // patch every row in the cache, then one `.in(...)` write for the whole set.
      setTaskLocationsDone: async (taskLocationIds, done) => {
        for (const id of taskLocationIds) {
          patchTaskLocation(queryClient, id, (l) => ({
            ...l,
            completedAt: done ? new Date().toISOString() : null,
            completedBy: done ? user.id : null,
            naAt: null,
            naBy: null,
          }));
        }
        try {
          await setTaskLocationsDoneWrite(taskLocationIds, done, user.id);
          // Deliberately NOT awaited. The optimistic patch above already shows the
          // final state, so awaiting the ["taskData"] refetch here only kept the
          // Select all / Clear all buttons disabled for the length of a full
          // reload. Let the cache reconcile timestamps/by-names in the background.
          void queryClient.invalidateQueries({ queryKey: ["taskData"] });
        } catch (e) {
          // Failure path still awaits: the optimistic patch is wrong and must be
          // rolled back to server truth before the caller surfaces the error.
          await queryClient.invalidateQueries({ queryKey: ["taskData"] });
          throw e;
        }
      },
      addLocation: async (input) => {
        const id = await insertLocationWrite({ ...input, createdBy: user.id });
        await queryClient.invalidateQueries({ queryKey: ["taskData"] });
        return id;
      },
      editLocation: async (id, input) => {
        await updateLocationWrite(id, input);
        await queryClient.invalidateQueries({ queryKey: ["taskData"] });
      },
      removeLocation: async (id) => {
        await deleteLocationWrite(id);
        await queryClient.invalidateQueries({ queryKey: ["taskData"] });
      },
      canManageLocations: role === "admin",

      // ---- directory (delegated to the portal core) ----
      profiles: dir.profiles,
      // Org-wide @mention list — every user, falling back to the RLS-scoped
      // directory until list_org_people() resolves.
      mentionablePeople:
        orgPeople && orgPeople.length
          ? orgPeople
          : dir.profiles.map((p) => ({
              id: p.id,
              name: p.name,
              designation: p.designation,
              departmentId: p.departmentId,
              avatarColor: p.avatarColor,
              role: p.role,
            })),
      departments: dir.departments,
      profileById: dir.profileById,
      actorById,
      departmentById: dir.departmentById,
      directReportIds: dir.directReportIds,
      downlineIds: dir.downlineIds,
      assignableUsers: dir.assignableUsers,
      visibleTasks,
      addDepartment: readOnlyId,
      updateDepartment: readOnly,
      deleteDepartment: readOnly,
      addUser: readOnlyId,
      updateUser: readOnly,
      deleteUser: readOnly,

      weeklyPlans,
      weeklyPlanFor: (doerId, weekStart) => {
        const { isoYear, isoWeek } = isoWeekOf(weekStart);
        return weeklyPlans.find((p) => p.doerId === doerId && p.isoYear === isoYear && p.isoWeek === isoWeek);
      },
      // setWeeklyPlan: LIVE (B4). Upsert keyed by (doer, iso year+week); branches
      // update vs insert to preserve created_by. RLS allows admin / hod-of-doer.
      setWeeklyPlan: async ({ doerId, weekStart, redPct, yellowPct, greenPct }) => {
        const { isoYear, isoWeek } = isoWeekOf(weekStart);
        const existing = weeklyPlans.find((p) => p.doerId === doerId && p.isoYear === isoYear && p.isoWeek === isoWeek);
        await upsertWeeklyPlanWrite({
          existingId: existing?.id ?? null,
          doerId,
          isoYear,
          isoWeek,
          weekStart,
          weekEnd: weekEndOf(weekStart),
          redPct,
          yellowPct,
          greenPct,
          createdBy: user.id,
        });
        await queryClient.invalidateQueries({ queryKey: ["taskData"] });
      },

      workspace,
      updateWorkspace: async (patch) => {
        await updateWorkspaceSettingsWrite(patch);
        await queryClient.invalidateQueries({ queryKey: ["taskData"] });
      },
      canManageWorkspace: role === "admin",

      canWrite: false,
      canCreateTask: true,
      canStatusActions: true,
      canReschedule: true,
      canRemark: true,
      canRecurring: true,
      canWeeklyPlan: true,
    };
  }, [tasks, activity, notifications, recurringTasks, weeklyPlans, workspace, locations, orgPeople, dir, user, role, queryClient]);

  // The realtime notification subscription used to live here. It now belongs to
  // useMyNotifications (called above) so the portal home screen gets the same
  // live bell without mounting this provider — and so there is only ever one
  // subscription to the `notifications:<uid>` channel.

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-page-grad text-grey text-sm">
        Loading tasks…
      </div>
    );
  }
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-page-grad px-6 text-center">
        <div className="max-w-sm">
          <p className="text-[15px] font-semibold text-navy">Couldn't load tasks</p>
          <p className="text-[13px] text-grey mt-1">{(error as Error).message}</p>
        </div>
      </div>
    );
  }

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useTaskStore(): TaskStoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useTaskStore must be used within TaskStoreProvider");
  return ctx;
}
