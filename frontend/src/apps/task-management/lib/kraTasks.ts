/**
 * KRA tasks — a task given against one of the assignee's KRAs (Admin → Organisation →
 * KRA Details), and the HOD's 1-10 review of it once it is done (20270107130000).
 *
 * THE SCORE (client, 05-10-2026). The task is worth the KRA's Wt% (W), split on KRA
 * Details into C "on completion" + (W − C) "on HOD review" — half and half by default,
 * moved by management where they decide (20% = 15 + 5):
 *   completed           → C                    (late or not — lateness is the HOD's call)
 *   reviewed, rating R  → C + (R/10) × (W − C)
 * e.g. Learning & Development 40% (20+20), rating 3 → 20 + 6 = 26%;
 *      a 20% KRA split 15+5, rating 3           → 15 + 1.5 = 16.5%.
 *
 * WHO. Only the employee's DIRECT HOD (a user_hods row — not anyone higher up) may give a
 * KRA task or review one. The DB trigger `guard_task_kra` enforces both; the checks here
 * only decide what to show.
 *
 * "Awaiting review" is not a status: it is completed + kraId + no rating. Every existing
 * scorecard therefore reads a KRA task exactly as any other completed task.
 */
import { supabase } from "@/core/platform/supabase";
import type { Task } from "../types";

/**
 * LOCAL TEST MODE: RETIRED 06-10-2026. It kept a task's KRA fields in the browser while
 * the live tasks table had no KRA columns. 20270107130000 is applied to live now, so on
 * localhost too the columns are the truth; a local copy would only disagree with them.
 * The helpers below stay as no-ops so their callers need no edit.
 */
export const KRA_TASKS_LOCAL = false as boolean;
const LOCAL_KEY = "kra-tasks:local-test:v1";

import { kraFieldsFromRow as kraFieldsFromColumns, type KraTaskFields } from "./kraColumns";
export type { KraTaskFields };

const NONE: KraTaskFields = { kraId: null, kraWeight: null, kraCompletionWeight: null, reviewRating: null, reviewedBy: null, reviewedAt: null, kraOpen: false, kraReviewerId: null };

const readLocal = (): Record<string, KraTaskFields> => {
  try {
    const v = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
};
const writeLocal = (m: Record<string, KraTaskFields>) => localStorage.setItem(LOCAL_KEY, JSON.stringify(m));

/** The KRA fields of a raw `tasks` row (kraColumns.ts; kept here for existing callers). */
export const kraFieldsFromRow = kraFieldsFromColumns;

/** Columns to add to the task insert. The trigger snapshots both weights itself. */
export const kraInsertColumns = (kraId: string | null | undefined): Record<string, unknown> =>
  kraId && !KRA_TASKS_LOCAL ? { kra_id: kraId } : {};

/** Test mode only: remember a new task's KRA (the weights are passed in, as the trigger would snapshot them). */
export function rememberKraLocally(
  taskId: string,
  kraId: string | null | undefined,
  kraWeight: number | null | undefined,
  kraCompletionWeight: number | null | undefined,
) {
  if (!KRA_TASKS_LOCAL || !kraId) return;
  writeLocal({ ...readLocal(), [taskId]: { ...NONE, kraId, kraWeight: kraWeight ?? 0, kraCompletionWeight: kraCompletionWeight ?? null } });
}

/** Test mode only: a reopen wipes the review, as the trigger does on live. */
export function clearReviewLocally(taskId: string) {
  if (!KRA_TASKS_LOCAL) return;
  const m = readLocal();
  if (m[taskId]) writeLocal({ ...m, [taskId]: { ...m[taskId], reviewRating: null, reviewedBy: null, reviewedAt: null } });
}

/**
 * Save the reviewer's 1-10 rating. An optional note goes on the timeline as a remark.
 * `kraId`: a Director's KRA task on the employee path, where the HOD picks the KRA in
 * the same save (guard_task_kra snapshots its weights).
 */
export async function saveKraReview(taskId: string, rating: number, actorId: string, note?: string, kraId?: string): Promise<void> {
  if (!Number.isInteger(rating) || rating < 1 || rating > 10) throw new Error("Pick a rating from 1 to 10.");
  if (KRA_TASKS_LOCAL) {
    const m = readLocal();
    if (!m[taskId]) throw new Error("This is not a KRA task.");
    writeLocal({ ...m, [taskId]: { ...m[taskId], reviewRating: rating, reviewedBy: actorId, reviewedAt: new Date().toISOString() } });
  } else {
    // The generated Database type predates the column.
    const { error } = await supabase
      .from("tasks")
      .update({ review_rating: rating, ...(kraId ? { kra_id: kraId } : {}) } as never)
      .eq("id", taskId);
    if (error) throw new Error(error.message);
  }
  const text = `KRA review: ${rating}/10${note?.trim() ? ` — ${note.trim()}` : ""}`;
  const { error: actErr } = await supabase
    .from("task_activity")
    .insert({ task_id: taskId, type: "remark", actor_id: actorId, note: text });
  if (actErr) throw new Error(actErr.message);
}

/** A KRA task: given against a KRA, or given as "KRA" by a Director (KRA picked later). */
export const isKraTask = (t: Task) => !!t.kraId || t.kraOpen;

/** Completed, a KRA task, and not yet rated — the reviewer's queue. */
export const awaitingKraReview = (t: Task) => isKraTask(t) && t.status === "completed" && t.reviewRating == null;

/**
 * Who rates this KRA task: the Director it names (a Director's task given to a HOD /
 * Sub-HOD), otherwise the assignee's DIRECT HOD. Mirrors guard_task_kra.
 */
export function isKraReviewerOf(t: Task, viewerId: string, hodIdsOf: (profileId: string) => string[] | undefined): boolean {
  if (t.kraReviewerId) return t.kraReviewerId === viewerId;
  return !!t.assignedTo && !!hodIdsOf(t.assignedTo)?.includes(viewerId);
}

/**
 * A Director's KRA task whose KRA is not picked yet. The assignee picks it in the
 * Mark complete popup (both paths); on the employee path their direct HOD may change it
 * at review (hodMayChangeKra).
 */
export const kraToPick = (t: Task): boolean => t.kraOpen && !t.kraId;

/** Employee path of a Director's KRA task: the reviewing HOD may change the picked KRA. */
export const hodMayChangeKra = (t: Task): boolean => t.kraOpen && !t.kraReviewerId;

export interface KraScore {
  /** What the task is worth: the KRA's Wt% when it was given. */
  max: number;
  /** Earned so far. */
  earned: number;
  /** The completion share C, and what the review can add (W − C). */
  completionMax: number;
  reviewMax: number;
  /** Earned for completing (C). 0 until completed. */
  completionPart: number;
  /** Earned from the HOD's rating: (R/10) × (W − C). 0 until reviewed. */
  reviewPart: number;
  stage: "open" | "awaiting-review" | "reviewed";
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function kraScore(t: Task): KraScore | null {
  if (!t.kraId) return null;
  const max = t.kraWeight ?? 0;
  // A task given before the split existed (or in an old local test) falls back to half.
  const completionMax = r2(Math.min(max, t.kraCompletionWeight ?? max / 2));
  const reviewMax = r2(max - completionMax);
  const base = { max, completionMax, reviewMax };
  if (t.status !== "completed") return { ...base, earned: 0, completionPart: 0, reviewPart: 0, stage: "open" };
  const reviewPart = t.reviewRating == null ? 0 : r2((t.reviewRating / 10) * reviewMax);
  return {
    ...base,
    earned: r2(completionMax + reviewPart),
    completionPart: completionMax,
    reviewPart,
    stage: t.reviewRating == null ? "awaiting-review" : "reviewed",
  };
}

/** "26%", "6.5%". */
export const pctLabel = (n: number) => `${r2(n)}%`;

/**
 * Task Category as one viewer sees it — the "Category" column and filter on the task
 * lists. "kra" / "others" as on Create Task; null = a KRA task this viewer may not see
 * (only the assignee and their DIRECT HOD may — useKraTaskAccess), shown as "—".
 */
export type TaskCategory = "kra" | "others";
export function taskCategoryFor(
  t: Task,
  viewerId: string,
  hodIdsOf: (profileId: string) => string[] | undefined,
): TaskCategory | null {
  if (!isKraTask(t)) return "others";
  const visible =
    t.assignedTo === viewerId || t.kraReviewerId === viewerId || (!!t.assignedTo && !!hodIdsOf(t.assignedTo)?.includes(viewerId));
  return visible ? "kra" : null;
}

export const TASK_CATEGORY_FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "kra", label: "KRA" },
  { value: "others", label: "Others" },
] as const;
export type TaskCategoryFilter = (typeof TASK_CATEGORY_FILTER_OPTIONS)[number]["value"];
