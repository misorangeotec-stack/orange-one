/**
 * Deep-link contract for drilling from a RYG/status number (Weekly Scorecard,
 * Dashboard, Reports) into the role-appropriate task LIST, pre-filtered to the
 * exact person / department / week / status behind that number.
 *
 * The destination differs by role (mirrors the RequireRole gates in
 * TaskManagementApp): admin → All Tasks, HOD/sub-HOD → Team Tasks, employee →
 * My Tasks. Each destination reads the same params via `parseTaskFilters`, so a
 * link built here is honoured identically everywhere.
 */
import type { AppRole, StatusFilter, TaskStatus } from "../types";

export type RygColour = "green" | "yellow" | "red";

/**
 * Colour → underlying task statuses, matching `rygCounts` (RygCells.tsx) and
 * `reportFor` (selectors.ts): green = completed, yellow = revised, red =
 * everything still open (pending / in-progress / shifted).
 */
export const COLOUR_STATUSES: Record<RygColour, TaskStatus[]> = {
  green: ["completed"],
  yellow: ["revised"],
  red: ["pending", "in_progress", "shifted"],
};

/** The task-list route a given role lands on (mirrors TaskManagementApp's RequireRole gates). */
export function taskListRouteForRole(role: AppRole): string {
  if (role === "admin") return "/task-management/all";
  if (role === "hod" || role === "sub_hod") return "/task-management/team";
  return "/task-management/tasks";
}

export interface TaskLinkParams {
  role: AppRole;
  /** Filter to a single assignee. Ignored for employees (My Tasks is always self-scoped). */
  assignee?: string;
  /** Filter to a single department (only surfaces on the admin All Tasks view). */
  dept?: string;
  /** Exact ISO-Monday week to filter to (the source may be viewing a historical week). */
  weekStart?: string;
  /** Explicit statuses, used for single-status drills (the scorecard pills). */
  statuses?: StatusFilter[];
  /** RYG colour, expanded to its statuses; takes precedence over `statuses`. */
  colour?: RygColour;
  /**
   * Restrict to tasks that count toward scores — i.e. exclude personal
   * (self-tracking) and Not-Applicable tasks. Set this whenever the link comes
   * from a score/RYG/status number so the list matches the number behind it.
   */
  metricOnly?: boolean;
}

/** Build a deep-link to the role-appropriate task list, pre-filtered. */
export function taskListLink({ role, assignee, dept, weekStart, statuses, colour, metricOnly }: TaskLinkParams): string {
  const base = taskListRouteForRole(role);
  const sp = new URLSearchParams();
  // Employees only ever see their own tasks and My Tasks has no assignee filter,
  // so the assignee param is redundant (and would be a no-op) there.
  if (assignee && role !== "employee") sp.set("assignee", assignee);
  if (dept) sp.set("dept", dept);
  if (weekStart) sp.set("week", weekStart);
  const resolved = colour ? COLOUR_STATUSES[colour] : statuses;
  if (resolved && resolved.length) sp.set("status", resolved.join(","));
  if (metricOnly) sp.set("metric", "1");
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}

export interface ParsedTaskFilters {
  assignee?: string;
  dept?: string;
  week?: string;
  statuses: StatusFilter[];
  /** Exclude personal + Not-Applicable tasks, matching the score behind the link. */
  metricOnly: boolean;
}

const VALID_STATUS = new Set<StatusFilter>([
  "pending",
  "in_progress",
  "completed",
  "revised",
  "shifted",
  "not_applicable",
]);

/** Read the deep-link filter contract off a URLSearchParams, so destinations seed identically. */
export function parseTaskFilters(params: URLSearchParams): ParsedTaskFilters {
  const assignee = params.get("assignee") ?? undefined;
  const dept = params.get("dept") ?? undefined;
  const week = params.get("week") ?? undefined;
  const statuses = (params.get("status") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is StatusFilter => VALID_STATUS.has(s as StatusFilter));
  return { assignee, dept, week, statuses, metricOnly: params.get("metric") === "1" };
}
