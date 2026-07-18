import { supabase } from "@/core/platform/supabase";
import type { WorkspaceSettings } from "../types";
import type { Database } from "@/core/platform/database.types";

type WorkspaceSettingsUpdate = Database["public"]["Tables"]["workspace_settings"]["Update"];

/**
 * Task-domain writes (Stage B B4, option B = careful live writes). Each function
 * performs one mutation under RLS as the signed-in user. Rolled out one flow at a
 * time; until a flow is wired + verified its store method stays an inert no-op.
 */

/**
 * Update the singleton workspace settings row (admin-only under the
 * `workspace_update_admin` RLS policy). The row always exists (id = true), so an
 * UPDATE is all that's needed.
 */
export async function updateWorkspaceSettings(patch: Partial<WorkspaceSettings>): Promise<void> {
  const fields: WorkspaceSettingsUpdate = {};
  if (patch.workspaceName !== undefined) fields.workspace_name = patch.workspaceName;
  if (patch.weekStart !== undefined) fields.week_start = patch.weekStart;
  if (patch.maxRevisionsPerWeek !== undefined) fields.max_revisions_per_week = patch.maxRevisionsPerWeek;
  if (Object.keys(fields).length === 0) return;
  const { error } = await supabase.from("workspace_settings").update(fields).eq("id", true);
  if (error) throw new Error(error.message);
}

const mondayOf = (iso: string) => {
  const d = new Date(iso);
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return d.toISOString().slice(0, 10);
};

/**
 * Insert a one-time task. RLS requires created_by = auth.uid(), so the caller
 * passes the current user's id. Returns the new task id.
 */
export async function insertTask(input: {
  title: string;
  description?: string | null;
  assignedTo: string | null;
  departmentId: string | null;
  dueDate: string | null;
  createdBy: string;
  locationIds?: string[];
  isPersonal?: boolean;
}): Promise<string> {
  const weekStart = mondayOf(input.dueDate ?? new Date().toISOString());
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      title: input.title,
      description: input.description ?? null,
      assigned_to: input.assignedTo,
      department_id: input.departmentId,
      due_date: input.dueDate,
      week_start: weekStart,
      created_by: input.createdBy,
      status: "pending",
      is_personal: input.isPersonal ?? false,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const taskId = data.id as string;

  // Attach the per-location checklist (optional). Done as a second insert under
  // RLS (the task_locations policy allows the task's creator).
  const locationIds = input.locationIds ?? [];
  if (locationIds.length) {
    const { error: locErr } = await supabase
      .from("task_locations")
      .insert(locationIds.map((location_id) => ({ task_id: taskId, location_id })));
    if (locErr) throw new Error(locErr.message);
  }
  return taskId;
}

/**
 * Edit a personal (self-tracking) task's basics: title, description, due date.
 * Recomputes week_start from the new due date (kept consistent with insertTask;
 * harmless since personal tasks are excluded from every week-keyed metric). Runs
 * under the existing task UPDATE RLS (creator is the assignee here).
 */
export async function updatePersonalTask(
  taskId: string,
  patch: { title: string; description?: string | null; dueDate: string | null }
): Promise<void> {
  const { error } = await supabase
    .from("tasks")
    .update({
      title: patch.title,
      description: patch.description ?? null,
      due_date: patch.dueDate,
      week_start: mondayOf(patch.dueDate ?? new Date().toISOString()),
    })
    .eq("id", taskId);
  if (error) throw new Error(error.message);
}

/**
 * Edit a pending one-off task's basics: title, description, due date, locations.
 * Deliberately never touches assigned_to / department_id / status — reassignment
 * stays a delete-and-recreate, so there's no downline (RLS WITH CHECK) question.
 *
 * NOTE the guard set (pending, non-personal, non-recurring, caller is creator /
 * assignee / admin) is enforced in the UI only — see canEditRow in TaskTable and
 * canEditOneOff in TaskDetail. Unlike DELETE, the `tasks_update` policy carries no
 * status guard, and it can't be tightened additively: Postgres ORs permissive
 * policies, and a RESTRICTIVE one would break start / complete / revise.
 */
export async function updateTask(
  taskId: string,
  patch: { title: string; description?: string | null; dueDate: string | null; locationIds: string[] }
): Promise<void> {
  const { error } = await supabase
    .from("tasks")
    .update({
      title: patch.title,
      description: patch.description ?? null,
      due_date: patch.dueDate,
      // Scorecards bucket on week_start, so it must follow the due date.
      week_start: mondayOf(patch.dueDate ?? new Date().toISOString()),
    })
    .eq("id", taskId);
  if (error) throw new Error(error.message);

  // Reconcile the checklist by DIFF, not wipe-and-reinsert: a kept location must
  // keep its completed_at / na_at. (syncRecurringLocations can be blunt — those
  // rows carry no state — this one can't.)
  const { data: existing, error: readErr } = await supabase
    .from("task_locations")
    .select("location_id")
    .eq("task_id", taskId);
  if (readErr) throw new Error(readErr.message);

  const before = new Set((existing ?? []).map((r) => r.location_id as string));
  const after = new Set(patch.locationIds);
  const removed = [...before].filter((id) => !after.has(id));
  const added = [...after].filter((id) => !before.has(id));

  if (removed.length) {
    const { error: delErr } = await supabase
      .from("task_locations")
      .delete()
      .eq("task_id", taskId)
      .in("location_id", removed);
    if (delErr) throw new Error(delErr.message);
  }
  if (added.length) {
    const { error: insErr } = await supabase
      .from("task_locations")
      .insert(added.map((location_id) => ({ task_id: taskId, location_id })));
    if (insErr) throw new Error(insErr.message);
  }
}

/**
 * Delete a personal task. RLS (policy `tasks_delete_personal`) restricts this to
 * the creator's own is_personal rows, so standard assigned tasks can't be deleted
 * this way even if the id is passed.
 */
export async function deletePersonalTask(taskId: string): Promise<void> {
  const { error } = await supabase.from("tasks").delete().eq("id", taskId);
  if (error) throw new Error(error.message);
}

/**
 * Delete a pending one-off task. RLS (policy `tasks_delete_pending`) enforces the
 * guard set — status='pending', non-personal, non-recurring, and the caller is the
 * creator, assignee, or an admin — so a started/completed task (or someone with no
 * claim on it) can't be deleted this way even if the id is passed.
 */
export async function deleteTask(taskId: string): Promise<void> {
  const { error } = await supabase.from("tasks").delete().eq("id", taskId);
  if (error) throw new Error(error.message);
}

/**
 * Tick (or untick) a single location on a task's checklist. Sets completed_at +
 * completed_by (or clears them). Marking done also clears any N/A flag on the row
 * (done and N/A are mutually exclusive). RLS limits this to people who can act on
 * the parent task. Untick is allowed while the task is still open so a mis-tick
 * can be corrected before completion.
 */
export async function setTaskLocationDone(
  taskLocationId: string,
  done: boolean,
  actorId: string
): Promise<void> {
  const { error } = await supabase
    .from("task_locations")
    .update({
      completed_at: done ? new Date().toISOString() : null,
      completed_by: done ? actorId : null,
      ...(done ? { na_at: null, na_by: null } : {}),
    })
    .eq("id", taskLocationId);
  if (error) throw new Error(error.message);
}

/**
 * Tick (or reset) EVERY location on a task's checklist in one round-trip — the
 * "Select all" / "Clear all" shortcut on a multi-location task. `done: true`
 * ticks each row (clearing any N/A, same as the single-row toggle); `done: false`
 * resets the rows to untouched, clearing BOTH the done and the N/A flags, so
 * "Clear all" leaves a clean checklist rather than a mix of blank and N/A rows.
 * Same task-scoped RLS as setTaskLocationDone.
 */
export async function setTaskLocationsDone(
  taskLocationIds: string[],
  done: boolean,
  actorId: string
): Promise<void> {
  if (taskLocationIds.length === 0) return;
  const { error } = await supabase
    .from("task_locations")
    .update({
      completed_at: done ? new Date().toISOString() : null,
      completed_by: done ? actorId : null,
      na_at: null,
      na_by: null,
    })
    .in("id", taskLocationIds);
  if (error) throw new Error(error.message);
}

/**
 * Mark (or unmark) a single location as Not Applicable for the task. An N/A
 * location counts as resolved for the completion gate, so a task whose remaining
 * locations are all done-or-N/A can be completed. Marking N/A also clears any
 * done flag on the row (the two are mutually exclusive). Same task-scoped RLS as
 * setTaskLocationDone; reversible while the task is open.
 */
export async function setTaskLocationNa(
  taskLocationId: string,
  na: boolean,
  actorId: string
): Promise<void> {
  const { error } = await supabase
    .from("task_locations")
    .update({
      na_at: na ? new Date().toISOString() : null,
      na_by: na ? actorId : null,
      ...(na ? { completed_at: null, completed_by: null } : {}),
    })
    .eq("id", taskLocationId);
  if (error) throw new Error(error.message);
}

/**
 * Mark a task in progress. The DB trigger `log_task_activity` only auto-logs
 * status changes for completed/revised/shifted (NOT started), so we insert the
 * 'started' activity row ourselves (RLS: actor_id = auth.uid()).
 */
export async function startTask(taskId: string, actorId: string): Promise<void> {
  const { error } = await supabase.from("tasks").update({ status: "in_progress" }).eq("id", taskId);
  if (error) throw new Error(error.message);
  const { error: actErr } = await supabase
    .from("task_activity")
    .insert({ task_id: taskId, type: "started", actor_id: actorId });
  if (actErr) throw new Error(actErr.message);
}

/**
 * Mark a task complete (timestamped). The trigger auto-logs the 'completed'
 * activity, so we do NOT insert one (avoids double-logging). Any optional note is
 * recorded as a 'remark' so it shows on the timeline.
 */
export async function completeTask(taskId: string, actorId: string, note?: string): Promise<void> {
  const { error } = await supabase
    .from("tasks")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", taskId);
  if (error) throw new Error(error.message);
  if (note) {
    const { error: actErr } = await supabase
      .from("task_activity")
      .insert({ task_id: taskId, type: "remark", actor_id: actorId, note });
    if (actErr) throw new Error(actErr.message);
  }
}

/**
 * Reopen a completed task: back to in_progress and clear the completion timestamp.
 * The DB trigger only auto-logs completed/revised/shifted, so we insert the 'reopened'
 * activity row ourselves (RLS: actor_id = auth.uid()). Location checklist rows keep their
 * historical timestamps as an audit trail; the location gate re-applies on re-completion.
 */
export async function reopenTask(taskId: string, actorId: string): Promise<void> {
  const { error } = await supabase
    .from("tasks")
    .update({ status: "in_progress", completed_at: null })
    .eq("id", taskId);
  if (error) throw new Error(error.message);
  const { error: actErr } = await supabase
    .from("task_activity")
    .insert({ task_id: taskId, type: "reopened", actor_id: actorId });
  if (actErr) throw new Error(actErr.message);
}

/**
 * Mark a "when" task instance Not Applicable for its day (or back to applicable).
 * Reversible: only the not_applicable flag changes, the underlying status is kept.
 * A plain column update under the existing task UPDATE RLS (assignee/creator/admin/
 * HOD) — same path completeTask uses. N/A instances are filtered out of all report
 * metrics in the selectors, so this does not touch status or any count directly.
 */
export async function setTaskNotApplicable(taskId: string, value: boolean): Promise<void> {
  const { error } = await supabase
    .from("tasks")
    .update({ not_applicable: value, not_applicable_at: value ? new Date().toISOString() : null })
    .eq("id", taskId);
  if (error) throw new Error(error.message);
}

/**
 * In-week revise: bump the revision count, stamp last_revised_at, set the
 * follow-up date, and move the deadline to it (due_date = follow-up, week_start =
 * that date's Monday — the same week, since the store only routes here when the
 * follow-up is in the current/earlier week). A later-week follow-up is a *shift*,
 * not a revision, and is handled in the store via rescheduleTask instead.
 * Keeping due_date in sync means a revised task isn't flagged overdue before its
 * follow-up arrives.
 *
 * The trigger auto-logs both 'revised' and 'followup', so we only add the optional
 * reason as a 'remark'. The 2-per-week limit is enforced in the store before this
 * is called (and the UI disables the control at the limit).
 */
export async function reviseTask(
  taskId: string,
  actorId: string,
  args: { followUpDate: string; note?: string; currentRevisionCount: number }
): Promise<void> {
  const { error } = await supabase
    .from("tasks")
    .update({
      status: "revised",
      revision_count: args.currentRevisionCount + 1,
      last_revised_at: new Date().toISOString(),
      follow_up_date: args.followUpDate,
      due_date: args.followUpDate,
      week_start: mondayOf(args.followUpDate),
    })
    .eq("id", taskId);
  if (error) throw new Error(error.message);
  if (args.note) {
    const { error: actErr } = await supabase
      .from("task_activity")
      .insert({ task_id: taskId, type: "remark", actor_id: actorId, note: args.note });
    if (actErr) throw new Error(actErr.message);
  }
}

/**
 * Reschedule a task by its due date.
 *  - Same week or earlier  → just move the due date (returns null).
 *  - A future week         → create a *continuation* task in that week and mark
 *                            the original `shifted`, linked both ways. Returns the
 *                            new task's id so the caller can navigate to it.
 *
 * The trigger auto-logs `shifted` (on the original's status update) and `created`
 * (on the continuation insert), so we don't log either here. The future-week shift
 * runs in the `shift_task_to_week` RPC so the insert + update are one transaction
 * (no half-applied shift); RLS still applies inside it.
 */
export async function rescheduleTask(
  task: {
    id: string;
    weekStart: string | null;
  },
  newDueDate: string
): Promise<string | null> {
  const targetWeek = mondayOf(newDueDate);
  const currentWeek = task.weekStart ?? mondayOf(new Date().toISOString());
  if (targetWeek <= currentWeek) {
    const { error } = await supabase.from("tasks").update({ due_date: newDueDate }).eq("id", task.id);
    if (error) throw new Error(error.message);
    return null;
  }

  // Future week → atomic shift via RPC (single transaction; the function sets
  // created_by = auth.uid() inside, satisfying the insert RLS, and marks the
  // original 'shifted' in the same transaction).
  const { data, error } = await supabase.rpc("shift_task_to_week", {
    p_task_id: task.id,
    p_new_due_date: newDueDate,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/**
 * Post a remark and fan out @mention notifications via the `add_task_remark`
 * SECURITY DEFINER RPC. The RPC inserts the remark activity (actor = auth.uid()),
 * bumps tasks.last_remark_at, and inserts one notification per mentioned user —
 * all atomically and under a server-side visibility guard. (Done as an RPC because
 * notifications has RLS with no INSERT policy for the client.) Returns the new
 * remark activity id.
 */
/**
 * Mark the given notifications read (read_at = now). RLS limits the update to the
 * caller's own rows (user_id = auth.uid()), so passing ids is safe.
 */
export async function markNotificationsRead(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .in("id", ids);
  if (error) throw new Error(error.message);
}

/**
 * Put notifications back to unread (read_at = null) — the "I'll deal with this
 * later" escape hatch, and the undo for the auto-mark-read that fires when you
 * open a task. Same RLS as above: the caller can only touch their own rows.
 */
export async function markNotificationsUnread(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: null })
    .in("id", ids);
  if (error) throw new Error(error.message);
}

export async function addRemark(taskId: string, note: string, mentionedIds: string[]): Promise<string> {
  const { data, error } = await supabase.rpc("add_task_remark", {
    p_task_id: taskId,
    p_note: note,
    p_mentioned: mentionedIds,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/* ----------------------------- recurring tasks ----------------------------- */
// recurrence_type enum is daily/weekly/monthly/when. weekly_days is an int[]
// (0=Sun..6=Sat); monthly_days is an int[] (1..31; 32 = last day of month).
// "when" fires every working day Mon–Sat and its instances may be marked N/A.
// RLS: insert created_by=auth.uid(); update created_by/admin/hod-of-assignee;
// delete created_by/admin.

export type RecurringWriteInput = {
  title: string;
  description: string | null;
  recurrenceType: "daily" | "weekly" | "monthly" | "when" | "quarterly";
  weeklyDays: number[];
  monthlyDays: number[];
  monthlyNth: number | null; // monthly Nth-weekday mode (e.g. 1 = 1st); null = day-of-month mode
  monthlyWeekday: number | null; // monthly Nth-weekday mode (0=Sun..6=Sat); null = day-of-month mode
  assignedTo: string | null;
  departmentId: string | null;
  active: boolean;
  locationIds: string[];
};

/** Replace a template's location set: delete the old rows, insert the new set. */
async function syncRecurringLocations(recurringTaskId: string, locationIds: string[]): Promise<void> {
  const { error: delErr } = await supabase
    .from("recurring_task_locations")
    .delete()
    .eq("recurring_task_id", recurringTaskId);
  if (delErr) throw new Error(delErr.message);
  if (locationIds.length) {
    const { error: insErr } = await supabase
      .from("recurring_task_locations")
      .insert(locationIds.map((location_id) => ({ recurring_task_id: recurringTaskId, location_id })));
    if (insErr) throw new Error(insErr.message);
  }
}

/** Insert a recurring-task template (returns the new id). */
export async function insertRecurring(input: RecurringWriteInput & { createdBy: string }): Promise<string> {
  const { data, error } = await supabase
    .from("recurring_tasks")
    .insert({
      title: input.title,
      description: input.description,
      recurrence_type: input.recurrenceType,
      weekly_days: input.recurrenceType === "weekly" ? input.weeklyDays : [],
      monthly_days: input.recurrenceType === "monthly" ? input.monthlyDays : [],
      monthly_nth: input.recurrenceType === "monthly" ? input.monthlyNth : null,
      monthly_weekday: input.recurrenceType === "monthly" ? input.monthlyWeekday : null,
      assigned_to: input.assignedTo,
      department_id: input.departmentId,
      created_by: input.createdBy,
      active: input.active,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const id = data.id as string;
  await syncRecurringLocations(id, input.locationIds);
  return id;
}

/** Update a recurring-task template. */
export async function updateRecurring(id: string, input: RecurringWriteInput): Promise<void> {
  const { error } = await supabase
    .from("recurring_tasks")
    .update({
      title: input.title,
      description: input.description,
      recurrence_type: input.recurrenceType,
      weekly_days: input.recurrenceType === "weekly" ? input.weeklyDays : [],
      monthly_days: input.recurrenceType === "monthly" ? input.monthlyDays : [],
      monthly_nth: input.recurrenceType === "monthly" ? input.monthlyNth : null,
      monthly_weekday: input.recurrenceType === "monthly" ? input.monthlyWeekday : null,
      assigned_to: input.assignedTo,
      department_id: input.departmentId,
      active: input.active,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  await syncRecurringLocations(id, input.locationIds);
}

/**
 * Generate TODAY's task instance for one recurring template, right now — so a
 * freshly created/activated template shows up immediately instead of waiting for
 * the 06:00 IST cron job. Runs the same dedup as the bulk job via the
 * `generate_recurring_task_now` SECURITY DEFINER RPC (which carries an owner/
 * admin/HOD permission guard).
 *
 * `force` controls the firing-day rule:
 *  - false (default, automatic save/activate paths): only generates if the
 *    template fires today; returns null otherwise.
 *  - true (the manual "Generate now" button): generates today's instance on ANY
 *    day, ignoring the daily/weekly schedule.
 * Either way a paused template no-ops (null), and it's idempotent — returns the
 * existing task id if today's instance already exists.
 */
export async function generateRecurringNow(
  recurringTaskId: string,
  force = false
): Promise<string | null> {
  const { data, error } = await supabase.rpc("generate_recurring_task_now", {
    p_recurring_id: recurringTaskId,
    p_force: force,
  });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

/** Flip a recurring template's active flag (caller passes the new value). */
export async function setRecurringActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase.from("recurring_tasks").update({ active }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Delete a recurring-task template. */
export async function deleteRecurring(id: string): Promise<void> {
  const { error } = await supabase.from("recurring_tasks").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/* ------------------------------- locations -------------------------------- */
// Admin-managed master list (RLS: select for all; insert/update/delete admin only).
// Each entry is a company + place pair, or the special General entry (is_general).

export type LocationWriteInput = {
  company: string | null;
  name: string;
  isGeneral: boolean;
  active: boolean;
  sortOrder: number;
};

/** Insert a location (returns the new id). */
export async function insertLocation(input: LocationWriteInput & { createdBy: string }): Promise<string> {
  const { data, error } = await supabase
    .from("locations")
    .insert({
      company: input.isGeneral ? null : input.company,
      name: input.name,
      is_general: input.isGeneral,
      active: input.active,
      sort_order: input.sortOrder,
      created_by: input.createdBy,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

/** Update a location. */
export async function updateLocation(id: string, input: LocationWriteInput): Promise<void> {
  const { error } = await supabase
    .from("locations")
    .update({
      company: input.isGeneral ? null : input.company,
      name: input.name,
      is_general: input.isGeneral,
      active: input.active,
      sort_order: input.sortOrder,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Delete a location. Fails (FK on_delete restrict) if it is still referenced by
 * any task or recurring template — callers should surface that and offer to
 * deactivate (active=false) instead.
 */
export async function deleteLocation(id: string): Promise<void> {
  const { error } = await supabase.from("locations").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/* ------------------------------ weekly plans ------------------------------ */
// One RYG plan per (doer_id, iso_year, iso_week) — UNIQUE constraint; red+yellow+
// green must sum to 100 (CHECK, enforced in the UI before submit). RLS: insert/
// update for admin OR hod-of-doer. We branch update-vs-insert (rather than upsert)
// so an edit by a different manager doesn't overwrite the original created_by.

/** Insert or update a doer's weekly RYG plan. Pass existingId when one already exists. */
export async function upsertWeeklyPlan(input: {
  existingId: string | null;
  doerId: string;
  isoYear: number;
  isoWeek: number;
  weekStart: string;
  weekEnd: string;
  redPct: number;
  yellowPct: number;
  greenPct: number;
  createdBy: string;
}): Promise<void> {
  if (input.existingId) {
    const { error } = await supabase
      .from("weekly_plans")
      .update({
        week_start: input.weekStart,
        week_end: input.weekEnd,
        red_pct: input.redPct,
        yellow_pct: input.yellowPct,
        green_pct: input.greenPct,
      })
      .eq("id", input.existingId);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("weekly_plans").insert({
      doer_id: input.doerId,
      iso_year: input.isoYear,
      iso_week: input.isoWeek,
      week_start: input.weekStart,
      week_end: input.weekEnd,
      red_pct: input.redPct,
      yellow_pct: input.yellowPct,
      green_pct: input.greenPct,
      created_by: input.createdBy,
    });
    if (error) throw new Error(error.message);
  }
}
