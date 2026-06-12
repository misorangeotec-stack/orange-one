import { createContext, useContext, useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppRole, Department, Location, Notification, Profile, RecurringTask, Task, TaskActivity, WeeklyPlan, WorkspaceSettings } from "../types";
import { useSession } from "./session";
import { useDirectory } from "@/core/platform/store";
import { supabase } from "@/core/platform/supabase";
import { isoWeekOf, weekEndOf } from "@/shared/lib/time";
import { fetchTaskData } from "../data/fetchTaskData";
import {
  insertTask,
  startTask as startTaskWrite,
  completeTask as completeTaskWrite,
  setTaskNotApplicable as setTaskNotApplicableWrite,
  reviseTask as reviseTaskWrite,
  rescheduleTask as rescheduleTaskWrite,
  addRemark as addRemarkWrite,
  markNotificationsRead as markNotificationsReadWrite,
  insertRecurring as insertRecurringWrite,
  updateRecurring as updateRecurringWrite,
  setRecurringActive as setRecurringActiveWrite,
  generateRecurringNow as generateRecurringNowWrite,
  deleteRecurring as deleteRecurringWrite,
  upsertWeeklyPlan as upsertWeeklyPlanWrite,
  updateWorkspaceSettings as updateWorkspaceSettingsWrite,
  setTaskLocationDone as setTaskLocationDoneWrite,
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
  startTask: (id: string) => Promise<void>;
  completeTask: (id: string, note?: string) => Promise<void>;
  /** Mark a "when" task instance Not Applicable for its day, or back to applicable. Reversible. */
  setTaskNotApplicable: (id: string, value: boolean) => Promise<void>;
  /** True when this task was generated from a "when" recurring template (so N/A is offered). */
  isWhenTask: (task: Task) => boolean;
  reviseTask: (id: string, args: { followUpDate: string; note?: string }) => Promise<void>;
  rescheduleTask: (id: string, newDueDate: string) => Promise<string | null>;
  addRemark: (id: string, note: string, mentionedIds: string[]) => Promise<void>;
  markNotificationsRead: (ids: string[]) => Promise<void>;

  recurringTasks: RecurringTask[];
  getRecurring: (id: string) => RecurringTask | undefined;
  createRecurring: (input: Omit<RecurringTask, "id">) => Promise<string>;
  updateRecurring: (id: string, patch: Partial<Omit<RecurringTask, "id">>) => Promise<void>;
  toggleRecurring: (id: string) => Promise<void>;
  /** Force-generate today's task instance for a template (manual "Generate now"); returns the task id. */
  generateRecurringNow: (id: string) => Promise<string | null>;
  deleteRecurring: (id: string) => Promise<void>;

  // locations
  locations: Location[];
  /** Active locations, sorted for display (the picker source). */
  activeLocations: Location[];
  locationById: (id: string | null) => Location | undefined;
  /** True when a task has no pending locations (so it may be completed). */
  taskLocationsComplete: (task: Task) => boolean;
  /** Tick / untick one location on a task's checklist. */
  setTaskLocationDone: (taskLocationId: string, done: boolean) => Promise<void>;
  /** Admin location-master CRUD. */
  addLocation: (input: LocationWriteInput) => Promise<string>;
  editLocation: (id: string, input: LocationWriteInput) => Promise<void>;
  removeLocation: (id: string) => Promise<void>;
  /** True for admins — the location master is admin-managed. */
  canManageLocations: boolean;

  // directory (people + departments) — re-exposed from the portal core
  profiles: Profile[];
  departments: Department[];
  profileById: (id: string | null) => Profile | undefined;
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

export function TaskStoreProvider({ children }: { children: ReactNode }) {
  const { user, role } = useSession();
  const dir = useDirectory();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["taskData", user?.id ?? null],
    queryFn: fetchTaskData,
    enabled: !!user,
  });

  const tasks = data?.tasks ?? [];
  const activity = data?.activity ?? [];
  const notifications = data?.notifications ?? [];
  const recurringTasks = data?.recurringTasks ?? [];
  const weeklyPlans = data?.weeklyPlans ?? [];
  const workspace = data?.workspace ?? DEFAULT_WORKSPACE;
  const locations = data?.locations ?? [];

  const value = useMemo<TaskStoreValue>(() => {
    const { downlineIds } = dir;

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

    return {
      tasks,
      activity,
      notifications,
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
        if (!task || !revisionInfo(task).allowed) return; // weekly limit / closed guard
        await reviseTaskWrite(id, user.id, { ...args, currentRevisionCount: task.revisionCount });
        await queryClient.invalidateQueries({ queryKey: ["taskData"] });
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
      },
      // Mark own notifications read (always allowed — RLS scopes to the caller).
      markNotificationsRead: async (ids) => {
        await markNotificationsReadWrite(ids);
        await queryClient.invalidateQueries({ queryKey: ["taskData"] });
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
      taskLocationsComplete: (task) => task.locations.every((l) => l.completedAt !== null),
      setTaskLocationDone: async (taskLocationId, done) => {
        await setTaskLocationDoneWrite(taskLocationId, done, user.id);
        await queryClient.invalidateQueries({ queryKey: ["taskData"] });
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
      departments: dir.departments,
      profileById: dir.profileById,
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
  }, [tasks, activity, notifications, recurringTasks, weeklyPlans, workspace, locations, dir, user, role, queryClient]);

  // Realtime: push the bell + task data when one of my notifications changes
  // (e.g. someone @mentions me). RLS scopes the stream to my own rows; we also
  // filter server-side by user_id. Any event just refetches the task query.
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        () => { void queryClient.invalidateQueries({ queryKey: ["taskData"] }); }
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [userId, queryClient]);

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
