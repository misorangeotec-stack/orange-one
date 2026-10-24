/**
 * Which tasks a Task Management score may count, and what kind a task is.
 *
 * MOVED here unchanged from `mock/selectors.ts` (KPI-1, 18-09-2026), which still
 * re-exports every name, so no importer changed. The reason is the server:
 * `selectors.ts` re-exports `computeDownlineIds` from `core/platform/store.tsx`,
 * which is React, so the KRA / KPI job (supabase/kpi) could not bundle it. These
 * predicates are pure and now live where both the screens and the job can reach
 * them — one copy, so the scorecard and the nightly facts can never disagree about
 * which tasks count.
 *
 * Keep this file free of React, `window` and `import.meta.env`: the job's build
 * refuses to finish if any of them reaches its import graph.
 */
import type { Task } from "../types";

/** A predicate deciding which tasks a score is allowed to count. */
export type TaskCounts = (t: Task) => boolean;

/**
 * Work somebody actually OWES, whoever ends up scoring it: everything except
 * Not-Applicable ("when") instances and personal self-tracking tasks.
 *
 * This is the predicate for WORKLISTS and REMINDERS — "due today", "overdue",
 * My Work — where a peer task must still appear, because the person has to do
 * it. It is what `countsTowardMetrics` meant before TM-1 split the two, and it
 * is what `core/workspace/mywork/items/tasks.ts` inlines (deliberately; see the
 * note in its header).
 */
export const countsTowardWorkload: TaskCounts = (t) => !t.notApplicable && !t.isPersonal;

/**
 * A task counts toward a person's OWN score / RYG / report only if it is neither
 * Not Applicable, nor personal, nor **peer work**.
 *
 * ⚠ THE PEER EXCLUSION IS LOAD-BEARING AND IT LIVES HERE ON PURPOSE. Eight
 *   separate screens compute an own-score from a list that is not pre-filtered
 *   by kind — the Scorecard's total and its Planned-vs-Actual table, both
 *   Dashboard RYG panels, PlanVsActual, EmployeeReport, DepartmentReport
 *   (Master Analysis) and the scorecard export's team row. Filtering at each of
 *   them would be eight chances to miss one. Every selector funnels through this
 *   predicate instead, so all eight are correct with no edit, and anything added
 *   later is correct by default. The KRA / KPI scorecard (KPI-1) is the ninth.
 *
 *   It also fails SAFE: a surface that forgets omits peer work from a score,
 *   which is the conservative direction. The client settled (07-09-2026) that a
 *   peer task is scored in the peer block and NOWHERE else, so a HOD's own score
 *   keeps counting only their own team's work.
 *
 * Pass `countsTowardPeerMetrics` to score the peer block, and
 * `countsTowardWorkload` for a worklist.
 */
export const countsTowardMetrics: TaskCounts = (t) =>
  !t.notApplicable && !t.isPersonal && !t.isPeerAssignment;

/**
 * The peer block's mirror of `countsTowardMetrics` — the ONLY predicate under
 * which peer work counts. Same arithmetic, opposite side of the same split, so
 * `metrics + peer = workload` for any list.
 */
export const countsTowardPeerMetrics: TaskCounts = (t) =>
  !t.notApplicable && !t.isPersonal && t.isPeerAssignment;

/** A HOD/Sub-HOD handed this to a peer. See tasks.is_peer_assignment (migration 20261116120000). */
export const isPeerTask = (t: Task) => t.isPeerAssignment;

/**
 * Whether a task originated from a recurring template (vs an ad-hoc one-off).
 * Prefer the durable `fromRecurring` flag (stamped at generation, survives template
 * deletion); fall back to a still-live `recurringTaskId` link so instances created
 * before the flag column existed are still classified correctly while their
 * template remains. Both false → genuine one-off (or an orphan whose template was
 * deleted before the flag shipped, which is unrecoverable).
 */
export const isRecurringTask = (t: Task) => t.fromRecurring || t.recurringTaskId !== null;
