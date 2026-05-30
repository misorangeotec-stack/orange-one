/**
 * Read-model selectors over the mock data. These mirror the Supabase RLS
 * visibility rules so the UI shows what each role would actually see — and so
 * Stage B can replace them with equivalent queries without UI changes.
 */
import type { AppRole, Task } from "../types";
import { profiles } from "./data";
import { isToday, isOverdue } from "@/shared/lib/time";

/** Direct reports of an HOD/sub-HOD (employee.hodIds includes hodId). */
export function directReportIds(hodId: string): string[] {
  return profiles.filter((p) => p.hodIds.includes(hodId)).map((p) => p.id);
}

/** Users the current user may assign a task to (self + reports for HOD, everyone for admin). */
export function assignableUsers(role: AppRole, userId: string) {
  if (role === "admin") return profiles;
  if (role === "hod" || role === "sub_hod") {
    const ids = new Set([userId, ...directReportIds(userId)]);
    return profiles.filter((p) => ids.has(p.id));
  }
  return profiles.filter((p) => p.id === userId);
}

/** Tasks visible to a user given their role (RLS-equivalent). Pass the live task list. */
export function visibleTasks(role: AppRole, userId: string, all: Task[]): Task[] {
  if (role === "admin") return all;
  if (role === "hod" || role === "sub_hod") {
    const team = new Set([userId, ...directReportIds(userId)]);
    return all.filter(
      (t) => t.assignedTo === userId || t.createdBy === userId || (t.assignedTo && team.has(t.assignedTo))
    );
  }
  // employee
  return all.filter((t) => t.assignedTo === userId || t.createdBy === userId);
}

export interface DashboardStats {
  dueToday: number;
  pending: number;
  inProgress: number;
  completedThisWeek: number;
  revised: number;
  shifted: number;
  followUpDue: number;
  overdue: number;
  total: number;
  statusCounts: Record<Task["status"], number>;
}

export function computeStats(list: Task[]): DashboardStats {
  const statusCounts: Record<Task["status"], number> = {
    pending: 0,
    in_progress: 0,
    completed: 0,
    revised: 0,
    shifted: 0,
  };
  let dueToday = 0,
    completedThisWeek = 0,
    followUpDue = 0,
    overdue = 0;
  for (const t of list) {
    statusCounts[t.status]++;
    if (isToday(t.dueDate) && t.status !== "completed") dueToday++;
    if (t.status === "completed") completedThisWeek++;
    if (t.followUpDate && (isToday(t.followUpDate) || isOverdue(t.followUpDate)) && t.status !== "completed")
      followUpDue++;
    if (isOverdue(t.dueDate) && (t.status === "pending" || t.status === "in_progress")) overdue++;
  }
  return {
    dueToday,
    pending: statusCounts.pending,
    inProgress: statusCounts.in_progress,
    completedThisWeek,
    revised: statusCounts.revised,
    shifted: statusCounts.shifted,
    followUpDue,
    overdue,
    total: list.length,
    statusCounts,
  };
}
