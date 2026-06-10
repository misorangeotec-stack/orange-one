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

export type RecurrenceType = "daily" | "weekly" | "monthly" | "when" | "quarterly";

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

/** A location is a company + place pair (e.g. Otec · Surat), or the special General entry. */
export interface Location {
  id: string;
  company: string | null; // null for the General entry
  name: string; // the place, e.g. "Surat"; "General" for the general entry
  isGeneral: boolean;
  active: boolean;
  sortOrder: number;
}

/** A row in a task's per-location checklist. `completedAt` set = that location is done. */
export interface TaskLocation {
  id: string;
  taskId: string;
  locationId: string;
  completedAt: string | null; // ISO datetime
  completedBy: string | null;
}

/** Human label for a location: "Otec · Surat", or "General" / a bare place name. */
export function locationLabel(loc: Pick<Location, "company" | "name" | "isGeneral">): string {
  if (loc.isGeneral) return loc.name || "General";
  return loc.company ? `${loc.company} · ${loc.name}` : loc.name;
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
  notApplicable: boolean; // "when" instances can be marked N/A for the day → excluded from all report metrics
  notApplicableAt: string | null; // ISO datetime — when N/A was set (null when applicable)
  createdAt: string; // ISO datetime
  updatedAt: string; // ISO datetime — bumped on any task change (status, revise, remark, reschedule)
  lastRemarkAt: string | null;
  locations: TaskLocation[]; // per-location checklist (empty for tasks with no locations)
}

export interface RecurringTask {
  id: string;
  title: string;
  description: string | null;
  recurrenceType: RecurrenceType;
  weeklyDays: number[]; // 0=Sun..6=Sat (used when weekly)
  monthlyDays: number[]; // 1..31 (used when monthly, day-of-month mode); MONTH_LAST_DAY = last day of month
  monthlyNth: number | null; // monthly Nth-weekday mode: 1..5 (e.g. 1 = 1st); null = day-of-month mode
  monthlyWeekday: number | null; // monthly Nth-weekday mode: 0=Sun..6=Sat (e.g. 6 = Saturday); null = day-of-month mode
  assignedTo: string | null;
  createdBy: string;
  departmentId: string | null;
  active: boolean;
  locationIds: string[]; // locations each generated task is tagged with
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
