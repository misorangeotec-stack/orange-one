import { createContext, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { AppRole, Department, Notification, Profile, RecurringTask, Task, TaskActivity, WeeklyPlan, WorkspaceSettings } from "../types";
import {
  activity as seedActivity,
  notifications as seedNotifications,
  recurringTasks as seedRecurring,
  tasks as seedTasks,
  weeklyPlans as seedWeeklyPlans,
  WEEK_START,
  WEEK_END,
  workspaceSettings as seedWorkspace,
} from "./data";
import { useSession } from "./session";
import { useDirectory } from "@/core/platform/store";
import { formatDate, isoWeekOf, weekEndOf } from "@/shared/lib/time";

/**
 * In-memory app store for the frontend phase. Owns the task domain (tasks, activity,
 * notifications, recurring templates, weekly plans, workspace settings) and implements
 * the same mutations the backend will. The directory (people + departments) now lives
 * in the portal core (core/platform/store); this store reads it via useDirectory() and
 * re-exposes those fields so its existing consumers stay unchanged. Business rules the
 * DB does NOT enforce (revision limit, shift linkage, mention fan-out) live here and
 * move to the data layer / RPCs in Stage B.
 */

const nowIso = () => new Date().toISOString();
const mondayOf = (iso: string) => {
  const d = new Date(iso);
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return d.toISOString().slice(0, 10);
};

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
  createTask: (input: { title: string; description?: string; assignedTo: string | null; departmentId: string | null; dueDate: string | null }) => string;
  startTask: (id: string) => void;
  completeTask: (id: string, note?: string) => void;
  reviseTask: (id: string, args: { followUpDate: string; note?: string }) => void;
  rescheduleTask: (id: string, newDueDate: string) => string | null;
  addRemark: (id: string, note: string, mentionedIds: string[]) => void;

  // recurring task templates
  recurringTasks: RecurringTask[];
  getRecurring: (id: string) => RecurringTask | undefined;
  createRecurring: (input: Omit<RecurringTask, "id">) => string;
  updateRecurring: (id: string, patch: Partial<Omit<RecurringTask, "id">>) => void;
  toggleRecurring: (id: string) => void;
  deleteRecurring: (id: string) => void;

  // directory (people + departments)
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

  // weekly plans (Red/Yellow/Green targets per doer per ISO week)
  weeklyPlans: WeeklyPlan[];
  weeklyPlanFor: (doerId: string, weekStart: string) => WeeklyPlan | undefined;
  setWeeklyPlan: (input: { doerId: string; weekStart: string; redPct: number; yellowPct: number; greenPct: number }) => void;

  // workspace settings (singleton)
  workspace: WorkspaceSettings;
  updateWorkspace: (patch: Partial<WorkspaceSettings>) => void;
}

const StoreContext = createContext<TaskStoreValue | null>(null);

export function TaskStoreProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const dir = useDirectory();
  const actorRef = useRef(user.id);
  actorRef.current = user.id;

  const [tasks, setTasks] = useState<Task[]>(() => seedTasks.map((t) => ({ ...t })));
  const [activity, setActivity] = useState<TaskActivity[]>(() => seedActivity.map((a) => ({ ...a })));
  const [notifications, setNotifications] = useState<Notification[]>(() => seedNotifications.map((n) => ({ ...n })));
  const [recurringTasks, setRecurring] = useState<RecurringTask[]>(() => seedRecurring.map((r) => ({ ...r })));
  const [workspace, setWorkspace] = useState<WorkspaceSettings>(() => ({ ...seedWorkspace }));
  const [weeklyPlans, setWeeklyPlans] = useState<WeeklyPlan[]>(() => seedWeeklyPlans.map((p) => ({ ...p })));
  const seq = useRef(1000);
  const nextId = (p: string) => `${p}${++seq.current}`;

  const value = useMemo<TaskStoreValue>(() => {
    const logActivity = (taskId: string, type: TaskActivity["type"], note: string | null = null) =>
      setActivity((prev) => [{ id: nextId("a"), taskId, type, actorId: actorRef.current, note, createdAt: nowIso() }, ...prev]);

    // Every task mutation flows through patch, so stamp updatedAt here once.
    const patch = (id: string, fn: (t: Task) => Task) =>
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...fn(t), updatedAt: nowIso() } : t)));

    // Directory (people + departments) is owned by the portal core; reuse it here.
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

      createTask: ({ title, description, assignedTo, departmentId, dueDate }) => {
        const id = nextId("t");
        const creator = actorRef.current;
        const task: Task = {
          id, title, description: description ?? null, status: "pending", dueDate,
          weekStart: dueDate ? mondayOf(dueDate) : WEEK_START,
          createdBy: creator, assignedTo, departmentId,
          revisionCount: 0, lastRevisedAt: null, followUpDate: null,
          shiftedFromTaskId: null, shiftedToTaskId: null, recurringTaskId: null,
          completedAt: null, createdAt: nowIso(), updatedAt: nowIso(), lastRemarkAt: null,
        };
        setTasks((prev) => [task, ...prev]);
        logActivity(id, "created");
        if (assignedTo && assignedTo !== creator) logActivity(id, "assigned");
        return id;
      },

      startTask: (id) => {
        patch(id, (t) => ({ ...t, status: "in_progress" }));
        logActivity(id, "started");
      },

      completeTask: (id, note) => {
        patch(id, (t) => ({ ...t, status: "completed", completedAt: nowIso() }));
        logActivity(id, "completed", note || null);
      },

      reviseTask: (id, { followUpDate, note }) => {
        const task = tasks.find((t) => t.id === id);
        if (!task || !revisionInfo(task).allowed) return;
        patch(id, (t) => ({ ...t, status: "revised", revisionCount: t.revisionCount + 1, lastRevisedAt: nowIso(), followUpDate }));
        logActivity(id, "revised", note || null);
        logActivity(id, "followup", `Follow-up set to ${formatDate(followUpDate)}`);
      },

      rescheduleTask: (id, newDueDate) => {
        const task = tasks.find((t) => t.id === id);
        if (!task || !newDueDate) return null;
        const targetWeek = mondayOf(newDueDate);
        if (targetWeek <= (task.weekStart ?? WEEK_START)) {
          patch(id, (t) => ({ ...t, dueDate: newDueDate }));
          return null;
        }
        const newId = nextId("t");
        const newTask: Task = {
          ...task, id: newId, status: "pending", weekStart: targetWeek, dueDate: newDueDate,
          revisionCount: 0, lastRevisedAt: null, followUpDate: null,
          shiftedFromTaskId: id, shiftedToTaskId: null, completedAt: null, createdAt: nowIso(), updatedAt: nowIso(),
        };
        setTasks((prev) => [newTask, ...prev.map((t) => (t.id === id ? { ...t, status: "shifted" as const, shiftedToTaskId: newId, updatedAt: nowIso() } : t))]);
        logActivity(id, "shifted");
        logActivity(newId, "created");
        return newId;
      },

      addRemark: (id, note, mentionedIds) => {
        setActivity((prev) => [{ id: nextId("a"), taskId: id, type: "remark", actorId: actorRef.current, note, createdAt: nowIso() }, ...prev]);
        patch(id, (t) => ({ ...t, lastRemarkAt: nowIso() }));
        if (mentionedIds.length) {
          setNotifications((prev) => [
            ...mentionedIds
              .filter((uid) => dir.profiles.some((p) => p.id === uid))
              .map((uid) => ({ id: nextId("n"), userId: uid, type: "mention" as const, taskId: id, actorId: actorRef.current, readAt: null, createdAt: nowIso() })),
            ...prev,
          ]);
        }
      },

      recurringTasks,
      getRecurring: (id) => recurringTasks.find((r) => r.id === id),
      createRecurring: (input) => {
        const id = nextId("r");
        setRecurring((prev) => [{ ...input, id }, ...prev]);
        return id;
      },
      updateRecurring: (id, p) => setRecurring((prev) => prev.map((r) => (r.id === id ? { ...r, ...p } : r))),
      toggleRecurring: (id) => setRecurring((prev) => prev.map((r) => (r.id === id ? { ...r, active: !r.active } : r))),
      deleteRecurring: (id) => setRecurring((prev) => prev.filter((r) => r.id !== id)),

      // ---- directory (delegated to the portal core; re-exposed for existing consumers) ----
      profiles: dir.profiles,
      departments: dir.departments,
      profileById: dir.profileById,
      departmentById: dir.departmentById,
      directReportIds: dir.directReportIds,
      assignableUsers: dir.assignableUsers,
      visibleTasks,
      addDepartment: dir.addDepartment,
      updateDepartment: dir.updateDepartment,
      deleteDepartment: dir.deleteDepartment,
      addUser: dir.addUser,
      updateUser: dir.updateUser,
      deleteUser: dir.deleteUser,

      // ---- weekly plans ----
      weeklyPlans,
      weeklyPlanFor: (doerId, weekStart) => {
        const { isoYear, isoWeek } = isoWeekOf(weekStart);
        return weeklyPlans.find((p) => p.doerId === doerId && p.isoYear === isoYear && p.isoWeek === isoWeek);
      },
      setWeeklyPlan: ({ doerId, weekStart, redPct, yellowPct, greenPct }) => {
        const { isoYear, isoWeek } = isoWeekOf(weekStart);
        const weekEnd = weekEndOf(weekStart);
        setWeeklyPlans((prev) => {
          const idx = prev.findIndex((p) => p.doerId === doerId && p.isoYear === isoYear && p.isoWeek === isoWeek);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = { ...next[idx], weekStart, weekEnd, redPct, yellowPct, greenPct };
            return next;
          }
          return [{ id: nextId("w"), doerId, isoYear, isoWeek, weekStart, weekEnd, redPct, yellowPct, greenPct }, ...prev];
        });
      },

      workspace,
      updateWorkspace: (patch) => setWorkspace((prev) => ({ ...prev, ...patch })),
    };
  }, [tasks, activity, notifications, recurringTasks, dir, workspace, weeklyPlans]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useTaskStore(): TaskStoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useTaskStore must be used within TaskStoreProvider");
  return ctx;
}
