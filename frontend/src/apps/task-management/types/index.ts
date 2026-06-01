/**
 * Domain types for the Task Management app — mirror the Supabase schema so that
 * when the backend is wired (Stage B), mock data swaps to live queries with no
 * shape changes. Enum string values match the DB enums exactly.
 *
 * Identity types (AppRole, AvatarColor, Department, Profile) are now portal-wide
 * and live in core/platform; re-exported here so existing imports keep resolving.
 */
export type { AppRole, AvatarColor, Department, Profile } from "@/core/platform/types";

export type TaskStatus = "pending" | "in_progress" | "completed" | "revised" | "shifted";

export type RecurrenceType = "daily" | "weekly" | "monthly";

/** Sentinel day-of-month value meaning "last day of the month" (> any real day). */
export const MONTH_LAST_DAY = 32;

export type ActivityType =
  | "created"
  | "assigned"
  | "revised"
  | "followup"
  | "completed"
  | "shifted"
  | "started"
  | "remark";

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  dueDate: string | null; // ISO date
  weekStart: string | null; // ISO date (Monday of its week)
  createdBy: string;
  assignedTo: string | null;
  departmentId: string | null;
  revisionCount: number;
  lastRevisedAt: string | null; // ISO datetime
  followUpDate: string | null; // ISO date
  shiftedFromTaskId: string | null;
  shiftedToTaskId: string | null;
  recurringTaskId: string | null;
  completedAt: string | null; // ISO datetime
  createdAt: string; // ISO datetime
  updatedAt: string; // ISO datetime — bumped on any task change (status, revise, remark, reschedule)
  lastRemarkAt: string | null;
}

export interface RecurringTask {
  id: string;
  title: string;
  description: string | null;
  recurrenceType: RecurrenceType;
  weeklyDays: number[]; // 0=Sun..6=Sat (used when weekly)
  monthlyDays: number[]; // 1..31 (used when monthly); MONTH_LAST_DAY = last day of month
  assignedTo: string | null;
  createdBy: string;
  departmentId: string | null;
  active: boolean;
}

export interface WeeklyPlan {
  id: string;
  doerId: string;
  isoYear: number;
  isoWeek: number;
  weekStart: string;
  weekEnd: string;
  redPct: number;
  yellowPct: number;
  greenPct: number;
}

export interface TaskActivity {
  id: string;
  taskId: string;
  type: ActivityType;
  actorId: string | null;
  note: string | null;
  createdAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  type: "mention";
  taskId: string | null;
  actorId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface WorkspaceSettings {
  workspaceName: string;
  weekStart: "mon" | "sun";
  maxRevisionsPerWeek: number;
}
