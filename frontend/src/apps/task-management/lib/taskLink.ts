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
 * Which slice of the week a task-list link is restricted to. The three are a
 * PARTITION - every task is exactly one of them, with peer winning - so the
 * cards they drill from add up to the total above them.
 */
export type TaskKind = "recurring" | "oneoff" | "peer";

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

/** Route to a single task's detail page. */
export function taskDetailPath(id: string): string {
  return `/task-management/tasks/${id}`;
}

/** The task-list route a given role lands on (mirrors TaskManagementApp's RequireRole gates). */
export function taskListRouteForRole(role: AppRole): string {
  if (role === "admin") return "/task-management/all";
  if (role === "hod" || role === "sub_hod") return "/task-management/team";
  return "/task-management/tasks";
}

/**
 * Where a task-list link should actually land, given what it is filtered to.
 *
 * 🔴 PEER LINKS MUST NOT GO TO TEAM TASKS. Team Tasks scopes to
 *   `assignedTo in [self, ...downline]` and, when the viewer has no reports, it
 *   replaces the whole table with a "No team members mapped" empty state. A peer
 *   counterparty is BY DEFINITION not in your team, so every number on the peer
 *   card drilled into a page telling the viewer they had no team - while that
 *   same page's header read "1 task across your team". Found by browser-testing
 *   as a real HOD; an admin lands on All Tasks and would never have seen it.
 *
 *   The peer board is the screen built for exactly these rows and reads the same
 *   deep-link params, so peer links go there for every role.
 */
function routeFor(role: AppRole, kind?: TaskKind): string {
  if (kind === "peer") return "/task-management/peer";
  return taskListRouteForRole(role);
}

/** Display name of that route, so a link to it can say where it goes. Matches the nav labels. */
export function taskListLabelForRole(role: AppRole, kind?: TaskKind): string {
  if (kind === "peer") return "Peer Tasks";
  if (role === "admin") return "All Tasks";
  if (role === "hod" || role === "sub_hod") return "Team Tasks";
  return "My Tasks";
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
  /** Restrict to recurring, one-off, or peer (HOD-to-HOD) tasks. */
  kind?: TaskKind;
  /**
   * Restrict to "Other" (self-tracking, is_personal) tasks. Mutually exclusive
   * with metricOnly — the score lists exclude these; the Other-tasks card includes
   * only these. When set, do NOT also set metricOnly.
   */
  personal?: boolean;
  /**
   * Restrict to tasks that count toward scores — i.e. exclude personal
   * (self-tracking) and Not-Applicable tasks. Set this whenever the link comes
   * from a score/RYG/status number so the list matches the number behind it.
   */
  metricOnly?: boolean;
}

/** Build a deep-link to the role-appropriate task list, pre-filtered. */
export function taskListLink({ role, assignee, dept, weekStart, statuses, colour, kind, personal, metricOnly }: TaskLinkParams): string {
  const base = routeFor(role, kind);
  const sp = new URLSearchParams();
  // Employees only ever see their own tasks and My Tasks has no assignee filter,
  // so the assignee param is redundant (and would be a no-op) there.
  if (assignee && role !== "employee") sp.set("assignee", assignee);
  if (dept) sp.set("dept", dept);
  if (weekStart) sp.set("week", weekStart);
  const resolved = colour ? COLOUR_STATUSES[colour] : statuses;
  if (resolved && resolved.length) sp.set("status", resolved.join(","));
  if (kind) sp.set("kind", kind);
  if (personal) sp.set("personal", "1");
  if (metricOnly) sp.set("metric", "1");
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}

/** The deep-link contract's params — the ones taskListLink emits and parseTaskFilters reads. */
const LINK_PARAMS = ["assignee", "dept", "week", "status", "kind", "personal", "metric"] as const;

/**
 * Canonical signature of the deep-link contract in a URL — the identity of "the set
 * of tasks this link asks for". Sticky filter snapshots (shared/lib/stickyState) are
 * keyed on it, so a link asking for something DIFFERENT wins over a stale snapshot
 * (a scorecard drill-down must never show the filters you last had), while a link
 * asking for the same thing restores it.
 *
 * Only the seven contract params count. `view`, `q`, `sort`, page etc. are sticky
 * state, not part of what a link asks for.
 */
export function taskLinkSignature(params: URLSearchParams): string {
  const sp = new URLSearchParams();
  for (const k of LINK_PARAMS) {
    const v = params.get(k);
    if (v !== null) sp.set(k, v);
  }
  sp.sort();
  return sp.toString();
}

export interface ParsedTaskFilters {
  assignee?: string;
  dept?: string;
  week?: string;
  statuses: StatusFilter[];
  /** Restrict to recurring, one-off or peer tasks (undefined = all three). */
  kind?: TaskKind;
  /** Restrict to "Other" (self-tracking, is_personal) tasks only. */
  personal: boolean;
  /**
   * Exclude whatever the score behind the link excludes, so the list matches the
   * number that was clicked. 🔴 That depends on `kind`: for peer links it means
   * countsTowardPeerMetrics, everywhere else countsTowardMetrics - which excludes
   * peer tasks. Reading it as a fixed predicate makes every peer drill-down empty.
   */
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
  const rawKind = params.get("kind");
  const kind: TaskKind | undefined =
    rawKind === "recurring" || rawKind === "oneoff" || rawKind === "peer" ? rawKind : undefined;
  return {
    assignee,
    dept,
    week,
    statuses,
    kind,
    personal: params.get("personal") === "1",
    metricOnly: params.get("metric") === "1",
  };
}
