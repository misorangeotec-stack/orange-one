/**
 * Task Management → work items. See ./README.md for why this is not in the provider.
 */
import { appName } from "@/apps/appInfo";
import type { TaskData } from "@/apps/task-management/data/fetchTaskData";
import { awaitingPeerReview, isPeerReviewerOf } from "@/apps/task-management/lib/peerReview";
import type { WorkItem } from "../types";

/**
 * ⚠ `assignedTo === uid` IS NOT OPTIONAL. RLS hands an HOD their entire transitive
 *   downline's tasks, so without it a manager's personal list fills up with their
 *   team's work.
 *
 * ⚠ `notApplicable` / `isPersonal` mirror `countsTowardWorkload`
 *   (task-management/mock/selectors.ts) — the same two exclusions every other
 *   dashboard metric applies. It is inlined rather than imported because that
 *   module re-exports from the React store, which the server cannot load.
 *
 * ⚠ IT DELIBERATELY DOES **NOT** EXCLUDE PEER TASKS, and must not start.
 *   `countsTowardMetrics` gained a `!isPeerAssignment` arm in TM-1 so a peer
 *   task stays out of the receiver's own SCORE. This is not a score — it is
 *   what somebody owes, and a peer task is work they have to do. Adding the
 *   arm here would silently drop it from My Work AND from the live 09:00
 *   snapshot email, whose SQL twin `public.user_snapshot()` does not exclude
 *   it either. The two are compared against each other on purpose
 *   (work-snapshot carries SQL's count through as `tasks_sql` to catch drift),
 *   so if either ever gains the arm, BOTH must.
 *
 * ⚠ A DENY-LIST, DELIBERATELY. A status added later counts as OPEN, so new work
 *   can never vanish from someone's list without anyone noticing. Getting this
 *   wrong once reported 14 items and 11 overdue for a user whose screen said 8 / 6.
 *
 * This provider ignores `isAdmin` on purpose: a task has exactly one assignee, so
 * an admin still sees only their own.
 */
export function taskWorkItems(data: TaskData, uid: string): WorkItem[] {
  return data.tasks
    .filter(
      (t) =>
        t.assignedTo === uid &&
        !t.notApplicable &&
        !t.isPersonal &&
        t.status !== "completed" &&
        t.status !== "shifted",
    )
    .map((t) => ({
      id: `tasks:${t.id}:task`,
      source: "tasks",
      sourceLabel: appName("task-management"),
      ref: t.title,
      detail: t.description || undefined,
      dueIso: t.dueDate,
      to: `/task-management/tasks/${t.id}`,
      // A task has exactly one assignee, so it is always personal.
      assignment: "direct" as const,
      // Task Category: given against one of the assignee's KRAs, or an ordinary task.
      // The assignee may always see their own KRA (useKraTaskAccess).
      category: t.kraId || t.kraOpen ? "KRA" : "Other",
    }));
}

/**
 * Peer tasks this person GAVE that the assignee has completed and that wait for their
 * review — close it, or reopen it for rework (lib/peerReview.ts, 20270204120100).
 *
 * ⚠ SEPARATE FROM taskWorkItems, AND CALLED ONLY BY THE SCREEN'S PROVIDER (not yet by
 *   the snapshot email). taskWorkItems is cross-checked against SQL's
 *   `public.user_snapshot()` count (`tasks_sql`); folding reviews into it would make the
 *   two disagree. Putting reviews in the mail needs both changed together.
 *
 * No due date, deliberately: the peer tasks completed before the review existed all
 * land here at go-live (74 on live, 21-10-2026), and dating them by completion would
 * count every one as an overdue approval overnight.
 */
export function peerReviewWorkItems(data: TaskData, uid: string): WorkItem[] {
  return data.tasks
    .filter((t) => awaitingPeerReview(t) && isPeerReviewerOf(t, uid, false))
    .map((t) => ({
      id: `tasks:${t.id}:peer-review`,
      source: "tasks",
      sourceLabel: appName("task-management"),
      ref: t.title,
      detail: t.description || undefined,
      stage: "Peer review",
      dueIso: null,
      to: `/task-management/tasks/${t.id}`,
      assignment: "direct" as const,
      isApproval: true,
      category: "Other",
    }));
}
