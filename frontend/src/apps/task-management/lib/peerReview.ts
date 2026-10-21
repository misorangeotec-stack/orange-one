/**
 * Peer task review (20270204120100).
 *
 * A peer task (a HOD / Sub-HOD handing one-off work sideways, TM-1) no longer closes
 * when the assignee marks it complete. It goes back to the person who GAVE it:
 *   completed, not closed  → awaiting the giver's review
 *   giver clicks Close     → closed (peerClosedAt stamped)
 *   giver clicks Reopen    → In Progress again, with the same assignee, and round again.
 *
 * "Awaiting review" is not a status — it is completed + peer + no close, the same shape
 * the KRA review uses — so every scorecard reads a completed peer task as before.
 * guard_task_peer_review enforces who may close / reopen; these only decide what to show.
 *
 * ⚠ BROWSER-FREE ON PURPOSE: core/workspace/mywork/items/tasks.ts imports this, and that
 *   file is compiled into the server bundles. No supabase, no storage here.
 */
import type { Task } from "../types";

/** Completed, a peer task, and not yet closed by the person who gave it. */
export const awaitingPeerReview = (t: Pick<Task, "isPeerAssignment" | "status" | "peerClosedAt">): boolean =>
  t.isPeerAssignment && t.status === "completed" && !t.peerClosedAt;

/** Sent back by the giver and not yet completed again — the "Re-opened" label. */
export const peerReopened = (t: Pick<Task, "isPeerAssignment" | "status" | "peerReopenCount">): boolean =>
  t.isPeerAssignment && t.peerReopenCount > 0 && t.status !== "completed" && t.status !== "shifted";

/**
 * Who reviews a peer task: the person who gave it — never the assignee. An admin may
 * stand in (also for the old shift copies whose creator became the assignee).
 */
export const isPeerReviewerOf = (t: Pick<Task, "isPeerAssignment" | "createdBy" | "assignedTo">, viewerId: string, isAdmin: boolean): boolean =>
  t.isPeerAssignment && t.assignedTo !== viewerId && (t.createdBy === viewerId || isAdmin);
