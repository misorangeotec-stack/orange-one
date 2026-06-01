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
