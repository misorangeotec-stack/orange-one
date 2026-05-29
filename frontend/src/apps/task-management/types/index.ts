/**
 * Domain types for the Task Management app — mirror the Supabase schema so that
 * when the backend is wired (Stage B), mock data swaps to live queries with no
 * shape changes. Enum string values match the DB enums exactly.
 */

export type AppRole = "admin" | "hod" | "sub_hod" | "employee";

export type TaskStatus = "pending" | "in_progress" | "completed" | "revised" | "shifted";

export type RecurrenceType = "daily" | "weekly";

export type ActivityType =
  | "created"
  | "assigned"
  | "revised"
  | "followup"
  | "completed"
  | "shifted"
  | "started"
  | "remark";

/** Named avatar colors stored on profiles.avatar_color → hex used by the UI. */
export type AvatarColor = "blue" | "orange" | "teal" | "violet" | "rose" | "green" | "navy";

export interface Department {
  id: string;
  name: string;
  description?: string | null;
}

export interface Profile {
  id: string;
  name: string;
  email: string | null;
  designation: string | null;
  avatarColor: AvatarColor;
  departmentId: string | null;
  /** Effective role (from user_roles). */
  role: AppRole;
  /** employee_id → hod_id links (user_hods); an employee may report to many HODs. */
  hodIds: string[];
}

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
  lastRemarkAt: string | null;
}

export interface RecurringTask {
  id: string;
  title: string;
  description: string | null;
  recurrenceType: RecurrenceType;
  weeklyDays: number[]; // 0=Sun..6=Sat
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
