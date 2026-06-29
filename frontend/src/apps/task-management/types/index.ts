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

/**
 * "Not Applicable" is a separate boolean flag on a task, not a status enum value,
 * but filter UIs surface it as a pseudo-status so users can isolate or include
 * N/A tasks. `StatusFilter` is the status enum plus that pseudo-value, and the
 * helpers below are the single source of truth for the dropdown options and the
 * filtering rule (N/A overrides the underlying status, matching StatusChip).
 */
export type StatusFilter = TaskStatus | "not_applicable";

export const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "in_progress", label: "In Progress" },
  { value: "revised", label: "Revised" },
  { value: "completed", label: "Completed" },
  { value: "shifted", label: "Shifted" },
  { value: "not_applicable", label: "Not Applicable" },
];

/** A task's effective status for filtering: N/A overrides the underlying status. */
export const effectiveStatus = (t: { status: TaskStatus; notApplicable: boolean }): StatusFilter =>
  t.notApplicable ? "not_applicable" : t.status;

/** Whether a task passes a status-filter selection (empty selection = match all). */
export const matchesStatusFilter = (
  t: { status: TaskStatus; notApplicable: boolean },
  statuses: StatusFilter[],
): boolean => statuses.length === 0 || statuses.includes(effectiveStatus(t));

export type RecurrenceType = "daily" | "weekly" | "monthly" | "when" | "quarterly";

/** Short, badge-friendly label for a recurrence type (e.g. "Weekly", "As & When"). */
export const RECURRENCE_LABEL: Record<RecurrenceType, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  when: "As and When",
};

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
  | "reopened"
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

/**
 * A row in a task's per-location checklist. A location is *resolved* (counts
 * toward completion) when it is either done (`completedAt` set) OR marked Not
 * Applicable (`naAt` set). The two are mutually exclusive — setting one clears
 * the other. A task completes once every location is resolved.
 */
export interface TaskLocation {
  id: string;
  taskId: string;
  locationId: string;
  completedAt: string | null; // ISO datetime — set = this location is done
  completedBy: string | null;
  naAt: string | null; // ISO datetime — set = this location is Not Applicable for the task
  naBy: string | null;
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
  // Durable "born from a recurring template" flag, stamped at generation time and
  // never cleared. recurringTaskId is ON DELETE SET NULL, so it goes null if the
  // template is deleted; this flag survives that, keeping the task classified as
  // recurring. Use isRecurringTask() (selectors) rather than reading either alone.
  fromRecurring: boolean;
  completedAt: string | null; // ISO datetime
  notApplicable: boolean; // "when" instances can be marked N/A for the day → excluded from all report metrics
  notApplicableAt: string | null; // ISO datetime — when N/A was set (null when applicable)
  isPersonal: boolean; // user-created self-tracking task → self-assigned and excluded from every score/RYG/dashboard metric
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
