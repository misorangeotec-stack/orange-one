import { supabase } from "@/core/platform/supabase";

/**
 * Task-domain writes (Stage B B4, option B = careful live writes). Each function
 * performs one mutation under RLS as the signed-in user. Rolled out one flow at a
 * time; until a flow is wired + verified its store method stays an inert no-op.
 */

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
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
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
 * Revise a task: bump the revision count, stamp last_revised_at, and set the
 * follow-up date. The trigger auto-logs both 'revised' and 'followup', so we only
 * add the optional reason as a 'remark'. The 2-per-week limit is enforced in the
 * store before this is called (and the UI disables the control at the limit).
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
 * (on the continuation insert), so we don't log either here. RLS requires the
 * continuation's created_by = auth.uid() (no admin bypass on insert), so the
 * shifter owns the new row while the original assignee/department carry over.
 *
 * NOTE: this is two writes (insert + update) without a transaction. If the second
 * write fails the continuation is left pending and the original un-shifted — both
 * rows are still valid/recoverable. An atomic RPC is a candidate follow-up.
 */
export async function rescheduleTask(
  task: {
    id: string;
    title: string;
    description: string | null;
    assignedTo: string | null;
    departmentId: string | null;
    weekStart: string | null;
  },
  newDueDate: string,
  actorId: string
): Promise<string | null> {
  const targetWeek = mondayOf(newDueDate);
  const currentWeek = task.weekStart ?? mondayOf(new Date().toISOString());
  if (targetWeek <= currentWeek) {
    const { error } = await supabase.from("tasks").update({ due_date: newDueDate }).eq("id", task.id);
    if (error) throw new Error(error.message);
    return null;
  }

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      title: task.title,
      description: task.description ?? null,
      assigned_to: task.assignedTo,
      department_id: task.departmentId,
      due_date: newDueDate,
      week_start: targetWeek,
      created_by: actorId,
      status: "pending",
      shifted_from_task_id: task.id,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const newId = data.id as string;

  const { error: updErr } = await supabase
    .from("tasks")
    .update({ status: "shifted", shifted_to_task_id: newId })
    .eq("id", task.id);
  if (updErr) throw new Error(updErr.message);
  return newId;
}

/**
 * Post a remark and fan out @mention notifications via the `add_task_remark`
 * SECURITY DEFINER RPC. The RPC inserts the remark activity (actor = auth.uid()),
 * bumps tasks.last_remark_at, and inserts one notification per mentioned user —
 * all atomically and under a server-side visibility guard. (Done as an RPC because
 * notifications has RLS with no INSERT policy for the client.) Returns the new
 * remark activity id.
 */
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
// The live recurrence_type enum is daily/weekly only (no monthly); weekly_days
// is an int[] (0=Sun..6=Sat). RLS: insert created_by=auth.uid(); update
// created_by/admin/hod-of-assignee; delete created_by/admin.

export type RecurringWriteInput = {
  title: string;
  description: string | null;
  recurrenceType: "daily" | "weekly";
  weeklyDays: number[];
  assignedTo: string | null;
  departmentId: string | null;
  active: boolean;
};

/** Insert a recurring-task template (returns the new id). */
export async function insertRecurring(input: RecurringWriteInput & { createdBy: string }): Promise<string> {
  const { data, error } = await supabase
    .from("recurring_tasks")
    .insert({
      title: input.title,
      description: input.description,
      recurrence_type: input.recurrenceType,
      weekly_days: input.recurrenceType === "weekly" ? input.weeklyDays : [],
      assigned_to: input.assignedTo,
      department_id: input.departmentId,
      created_by: input.createdBy,
      active: input.active,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
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
      assigned_to: input.assignedTo,
      department_id: input.departmentId,
      active: input.active,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
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
