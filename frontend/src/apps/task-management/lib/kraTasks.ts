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
 * LOCAL TEST MODE — on localhost (`npm run dev`) the KRA link and the rating are kept in
 * this browser, keyed by task id. The local app talks to the LIVE database, where the
 * tasks table has no KRA columns until the migration runs. The task itself is still a real
 * task on live; only its KRA fields stay local. Mirrors kras.ts (the KRAs themselves).
 */
export const KRA_TASKS_LOCAL = import.meta.env.DEV;
const LOCAL_KEY = "kra-tasks:local-test:v1";

export interface KraTaskFields {
  kraId: string | null;
  kraWeight: number | null;
  kraCompletionWeight: number | null;
  reviewRating: number | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
}

const NONE: KraTaskFields = { kraId: null, kraWeight: null, kraCompletionWeight: null, reviewRating: null, reviewedBy: null, reviewedAt: null };

const readLocal = (): Record<string, KraTaskFields> => {
  try {
    const v = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
};
const writeLocal = (m: Record<string, KraTaskFields>) => localStorage.setItem(LOCAL_KEY, JSON.stringify(m));

/** The KRA fields of a raw `tasks` row — from its columns, or the local store in test mode. */
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
export function kraFieldsFromRow(r: any): KraTaskFields {
  if (KRA_TASKS_LOCAL) return { ...NONE, ...readLocal()[r.id] };
  return {
    kraId: r.kra_id ?? null,
    kraWeight: r.kra_weight == null ? null : Number(r.kra_weight),
    kraCompletionWeight: r.kra_completion_weight == null ? null : Number(r.kra_completion_weight),
    reviewRating: r.review_rating ?? null,
    reviewedBy: r.reviewed_by ?? null,
    reviewedAt: r.reviewed_at ?? null,
  };
}

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

/** Save the HOD's 1-10 rating. An optional note goes on the timeline as a remark. */
export async function saveKraReview(taskId: string, rating: number, actorId: string, note?: string): Promise<void> {
  if (!Number.isInteger(rating) || rating < 1 || rating > 10) throw new Error("Pick a rating from 1 to 10.");
  if (KRA_TASKS_LOCAL) {
    const m = readLocal();
    if (!m[taskId]) throw new Error("This is not a KRA task.");
    writeLocal({ ...m, [taskId]: { ...m[taskId], reviewRating: rating, reviewedBy: actorId, reviewedAt: new Date().toISOString() } });
  } else {
    // The generated Database type predates the column.
    const { error } = await supabase
      .from("tasks")
      .update({ review_rating: rating } as never)
      .eq("id", taskId);
    if (error) throw new Error(error.message);
  }
  const text = `KRA review: ${rating}/10${note?.trim() ? ` — ${note.trim()}` : ""}`;
  const { error: actErr } = await supabase
    .from("task_activity")
    .insert({ task_id: taskId, type: "remark", actor_id: actorId, note: text });
  if (actErr) throw new Error(actErr.message);
}

export const isKraTask = (t: Task) => !!t.kraId;

/** Completed, a KRA task, and not yet rated — the HOD's queue. */
export const awaitingKraReview = (t: Task) => !!t.kraId && t.status === "completed" && t.reviewRating == null;

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
