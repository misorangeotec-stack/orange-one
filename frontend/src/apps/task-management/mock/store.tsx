import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppRole, Department, Notification, Profile, RecurringTask, Task, TaskActivity, WeeklyPlan, WorkspaceSettings } from "../types";
import { useSession } from "./session";
import { useDirectory } from "@/core/platform/store";
import { isoWeekOf } from "@/shared/lib/time";
import { fetchTaskData } from "../data/fetchTaskData";
import {
  insertTask,
  startTask as startTaskWrite,
  completeTask as completeTaskWrite,
  reviseTask as reviseTaskWrite,
  rescheduleTask as rescheduleTaskWrite,
  addRemark as addRemarkWrite,
  insertRecurring as insertRecurringWrite,
  updateRecurring as updateRecurringWrite,
  setRecurringActive as setRecurringActiveWrite,
  deleteRecurring as deleteRecurringWrite,
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
  createTask: (input: { title: string; description?: string; assignedTo: string | null; departmentId: string | null; dueDate: string | null }) => Promise<string>;
  startTask: (id: string) => Promise<void>;
  completeTask: (id: string, note?: string) => Promise<void>;
  reviseTask: (id: string, args: { followUpDate: string; note?: string }) => Promise<void>;
  rescheduleTask: (id: string, newDueDate: string) => Promise<string | null>;
  addRemark: (id: string, note: string, mentionedIds: string[]) => Promise<void>;

  recurringTasks: RecurringTask[];
  getRecurring: (id: string) => RecurringTask | undefined;
  createRecurring: (input: Omit<RecurringTask, "id">) => Promise<string>;
  updateRecurring: (id: string, patch: Partial<Omit<RecurringTask, "id">>) => Promise<void>;
  toggleRecurring: (id: string) => Promise<void>;
  deleteRecurring: (id: string) => Promise<void>;

  // directory (people + departments) — re-exposed from the portal core
  profiles: Profile[];
  departments: Department[];
  profileById: (id: string | null) => Profile | undefined;
  departmentById: (id: string | null) => Department | undefined;
  directReportIds: (hodId: string) => string[];
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
  setWeeklyPlan: (input: { doerId: string; weekStart: string; redPct: number; yellowPct: number; greenPct: number }) => void;

  workspace: WorkspaceSettings;
  updateWorkspace: (patch: Partial<WorkspaceSettings>) => void;

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
  const { user } = useSession();
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

  const value = useMemo<TaskStoreValue>(() => {
    const { directReportIds } = dir;

    const visibleTasks = (role: AppRole, userId: string): Task[] => {
      if (role === "admin") return tasks;
      if (role === "hod" || role === "sub_hod") {
        const team = new Set([userId, ...directReportIds(userId)]);
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
        const id = await insertTask({ ...input, createdBy: user.id });
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
        const newId = await rescheduleTaskWrite(task, newDueDate, user.id);
        await queryClient.invalidateQueries({ queryKey: ["taskData"] });
        return newId;
      },
      // addRemark: LIVE (B4). Posts a remark + fans out @mention notifications via
      // the add_task_remark RPC (notifications has no client INSERT policy), then refetches.
      addRemark: async (id, note, mentionedIds) => {
        await addRemarkWrite(id, note, mentionedIds);
        await queryClient.invalidateQueries({ queryKey: ["taskData"] });
      },

      recurringTasks,
      getRecurring: (id) => recurringTasks.find((r) => r.id === id),
      // Recurring CRUD: LIVE (B4). recurrence_type is daily/weekly only; monthly
      // (frontend-only) collapses to daily defensively. RLS scopes the writes.
      createRecurring: async (input) => {
        const id = await insertRecurringWrite({
          title: input.title,
          description: input.description ?? null,
          recurrenceType: input.recurrenceType === "weekly" ? "weekly" : "daily",
          weeklyDays: input.weeklyDays ?? [],
          assignedTo: input.assignedTo,
          departmentId: input.departmentId,
          active: input.active,
          createdBy: user.id,
        });
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
          recurrenceType: m.recurrenceType === "weekly" ? "weekly" : "daily",
          weeklyDays: m.weeklyDays ?? [],
          assignedTo: m.assignedTo,
          departmentId: m.departmentId,
          active: m.active,
        });
        await queryClient.invalidateQueries({ queryKey: ["taskData"] });
      },
      toggleRecurring: async (id) => {
        const cur = recurringTasks.find((r) => r.id === id);
        if (!cur) return;
        await setRecurringActiveWrite(id, !cur.active);
        await queryClient.invalidateQueries({ queryKey: ["taskData"] });
      },
      deleteRecurring: async (id) => {
        await deleteRecurringWrite(id);
        await queryClient.invalidateQueries({ queryKey: ["taskData"] });
      },

      // ---- directory (delegated to the portal core) ----
      profiles: dir.profiles,
      departments: dir.departments,
      profileById: dir.profileById,
      departmentById: dir.departmentById,
      directReportIds: dir.directReportIds,
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
      setWeeklyPlan: readOnly,

      workspace,
      updateWorkspace: readOnly,

      canWrite: false,
      canCreateTask: true,
      canStatusActions: true,
      canReschedule: true,
      canRemark: true,
      canRecurring: true,
    };
  }, [tasks, activity, notifications, recurringTasks, weeklyPlans, workspace, dir, user, queryClient]);

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
