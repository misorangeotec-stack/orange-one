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
