import { createContext, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Notification, Task, TaskActivity } from "../types";
import {
  activity as seedActivity,
  notifications as seedNotifications,
  profileById,
  tasks as seedTasks,
  WEEK_START,
  WEEK_END,
  workspaceSettings,
} from "./data";
import { useSession } from "./session";

/**
 * In-memory task store for the frontend phase. Implements the same mutations the
 * backend will (create / start / revise / shift / complete / remark) so the UI is
 * fully interactive during the audit. Business rules that the DB does NOT enforce
 * (revision limit, shift linkage, mention fan-out) live here and will move to the
 * data layer / RPCs in Stage B.
 */

const nowIso = () => new Date().toISOString();
/** Monday (week start) of the week containing the given ISO date. */
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
  /**
   * Reschedule a task's due date. If the new date falls in a FUTURE week, the task
   * is automatically shifted: a linked task is created for that week and the
   * current one is marked "shifted". Returns the new task id when a shift happened.
   */
  rescheduleTask: (id: string, newDueDate: string) => string | null;
  addRemark: (id: string, note: string, mentionedIds: string[]) => void;
}

const StoreContext = createContext<TaskStoreValue | null>(null);

export function TaskStoreProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const actorRef = useRef(user.id);
  actorRef.current = user.id;

  const [tasks, setTasks] = useState<Task[]>(() => seedTasks.map((t) => ({ ...t })));
  const [activity, setActivity] = useState<TaskActivity[]>(() => seedActivity.map((a) => ({ ...a })));
  const [notifications, setNotifications] = useState<Notification[]>(() => seedNotifications.map((n) => ({ ...n })));
  const seq = useRef(1000);
  const nextId = (p: string) => `${p}${++seq.current}`;

  const value = useMemo<TaskStoreValue>(() => {
    const logActivity = (taskId: string, type: TaskActivity["type"], note: string | null = null) =>
      setActivity((prev) => [
        { id: nextId("a"), taskId, type, actorId: actorRef.current, note, createdAt: nowIso() },
        ...prev,
      ]);

    const patch = (id: string, fn: (t: Task) => Task) =>
      setTasks((prev) => prev.map((t) => (t.id === id ? fn(t) : t)));

    const revisionInfo = (task: Task): RevisionInfo => {
      const max = workspaceSettings.maxRevisionsPerWeek;
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
      activityFor: (taskId) =>
        activity.filter((a) => a.taskId === taskId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      revisionInfo,

      createTask: ({ title, description, assignedTo, departmentId, dueDate }) => {
        const id = nextId("t");
        const creator = actorRef.current;
        const task: Task = {
          id,
          title,
          description: description ?? null,
          status: "pending",
          dueDate,
          weekStart: dueDate ? mondayOf(dueDate) : WEEK_START,
          createdBy: creator,
          assignedTo,
          departmentId,
          revisionCount: 0,
          lastRevisedAt: null,
          followUpDate: null,
          shiftedFromTaskId: null,
          shiftedToTaskId: null,
          recurringTaskId: null,
          completedAt: null,
          createdAt: nowIso(),
          lastRemarkAt: null,
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
        patch(id, (t) => ({
          ...t,
          status: "revised",
          revisionCount: t.revisionCount + 1,
          lastRevisedAt: nowIso(),
          followUpDate,
        }));
        logActivity(id, "revised", note || null);
        logActivity(id, "followup", `Follow-up set to ${followUpDate}`);
      },

      rescheduleTask: (id, newDueDate) => {
        const task = tasks.find((t) => t.id === id);
        if (!task || !newDueDate) return null;
        const targetWeek = mondayOf(newDueDate);

        // Same/earlier week → just move the due date, no shift.
        if (targetWeek <= (task.weekStart ?? WEEK_START)) {
          patch(id, (t) => ({ ...t, dueDate: newDueDate }));
          return null;
        }

        // Future week → shift: create a linked task in that week, mark this one shifted.
        const newId = nextId("t");
        const newTask: Task = {
          ...task,
          id: newId,
          status: "pending",
          weekStart: targetWeek,
          dueDate: newDueDate,
          revisionCount: 0,
          lastRevisedAt: null,
          followUpDate: null,
          shiftedFromTaskId: id,
          shiftedToTaskId: null,
          completedAt: null,
          createdAt: nowIso(),
        };
        setTasks((prev) => [newTask, ...prev.map((t) => (t.id === id ? { ...t, status: "shifted" as const, shiftedToTaskId: newId } : t))]);
        logActivity(id, "shifted");
        logActivity(newId, "created");
        return newId;
      },

      addRemark: (id, note, mentionedIds) => {
        const activityId = nextId("a");
        setActivity((prev) => [
          { id: activityId, taskId: id, type: "remark", actorId: actorRef.current, note, createdAt: nowIso() },
          ...prev,
        ]);
        patch(id, (t) => ({ ...t, lastRemarkAt: nowIso() }));
        if (mentionedIds.length) {
          setNotifications((prev) => [
            ...mentionedIds
              .filter((uid) => profileById(uid))
              .map((uid) => ({
                id: nextId("n"),
                userId: uid,
                type: "mention" as const,
                taskId: id,
                actorId: actorRef.current,
                readAt: null,
                createdAt: nowIso(),
              })),
            ...prev,
          ]);
        }
      },
    };
  }, [tasks, activity, notifications]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useTaskStore(): TaskStoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useTaskStore must be used within TaskStoreProvider");
  return ctx;
}
