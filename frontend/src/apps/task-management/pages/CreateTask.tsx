import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextInput, TextArea, Select } from "@/shared/components/ui/Form";
import { useSession } from "../mock/session";
import { useTaskStore } from "../mock/store";
import { departments, profileById } from "../mock/data";
import { assignableUsers } from "../mock/selectors";

/** Create a one-time task. Assignee options depend on the current user's role. */
export default function CreateTask() {
  const navigate = useNavigate();
  const { user, role } = useSession();
  const { createTask } = useTaskStore();
  const canAssign = assignableUsers(role, user.id);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignedTo, setAssignedTo] = useState(user.id);
  const [departmentId, setDepartmentId] = useState(user.departmentId ?? "");
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState("");

  const onAssigneeChange = (id: string) => {
    setAssignedTo(id);
    const dept = profileById(id)?.departmentId;
    if (dept) setDepartmentId(dept);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("Please enter a task title.");
      return;
    }
    const id = createTask({
      title: title.trim(),
      description: description.trim() || undefined,
      assignedTo,
      departmentId: departmentId || null,
      dueDate: dueDate || null,
    });
    navigate(`/task-management/tasks/${id}`);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <button onClick={() => navigate(-1)} className="text-[13px] text-grey hover:text-orange font-medium inline-flex items-center gap-1">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          Back
        </button>
        <h2 className="text-[22px] font-bold text-navy mt-2">Create Task</h2>
        <p className="text-grey text-[13px] mt-1">
          {role === "employee" ? "Add a task for yourself." : "Assign a task to a team member or yourself."}
        </p>
      </div>

      <Card className="p-6">
        <form onSubmit={submit} className="space-y-4">
          <FieldLabel label="Task title" required>
            <TextInput value={title} onChange={(e) => { setTitle(e.target.value); setError(""); }} placeholder="e.g. Submit daily sales report" autoFocus />
          </FieldLabel>

          <FieldLabel label="Description" hint="optional">
            <TextArea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="Add any details, context, or links…" />
          </FieldLabel>

          <div className="grid sm:grid-cols-2 gap-4">
            <FieldLabel label="Assign to">
              <Select value={assignedTo} onChange={(e) => onAssigneeChange(e.target.value)} disabled={canAssign.length <= 1}>
                {canAssign.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.id === user.id ? " (me)" : ""}
                  </option>
                ))}
              </Select>
            </FieldLabel>

            <FieldLabel label="Department">
              <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                <option value="">— None —</option>
                {departments.map((dp) => (
                  <option key={dp.id} value={dp.id}>
                    {dp.name}
                  </option>
                ))}
              </Select>
            </FieldLabel>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <FieldLabel label="Due date" hint="optional">
              <TextInput type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </FieldLabel>
          </div>

          {error && <p className="text-[13px] text-[#d4493f]">{error}</p>}

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <Button variant="ghost" onClick={() => navigate(-1)}>Cancel</Button>
            <Button type="submit">Create Task</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
