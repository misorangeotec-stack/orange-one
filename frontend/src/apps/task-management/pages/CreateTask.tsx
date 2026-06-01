import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import Combobox from "@/shared/components/ui/Combobox";
import Avatar from "@/shared/components/ui/Avatar";
import { useSession } from "../mock/session";
import { useTaskStore } from "../mock/store";

/** Create a one-time task. Assignee options depend on the current user's role. */
export default function CreateTask() {
  const navigate = useNavigate();
  const { user, role } = useSession();
  const { createTask, assignableUsers, departmentById, profileById, canWrite } = useTaskStore();
  const canAssign = assignableUsers(role, user.id);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignedTo, setAssignedTo] = useState(user.id);
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState("");

  // Department is derived from the assignee — never selected manually.
  const departmentId = profileById(assignedTo)?.departmentId ?? null;
  const departmentName = departmentById(departmentId)?.name;

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
      departmentId,
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
            <FieldLabel label="Assign to" hint={departmentName ? `Dept: ${departmentName}` : undefined}>
              <Combobox
                value={assignedTo}
                onChange={setAssignedTo}
                disabled={canAssign.length <= 1}
                options={canAssign.map((p) => {
                  const dept = departmentById(p.departmentId)?.name;
                  const sub = [p.designation, dept].filter(Boolean).join(" · ");
                  return {
                    value: p.id,
                    label: p.id === user.id ? `${p.name} (me)` : p.name,
                    sublabel: sub || undefined,
                    icon: <Avatar name={p.name} color={p.avatarColor} size={22} />,
                  };
                })}
              />
            </FieldLabel>

            <FieldLabel label="Due date" hint="optional">
              <TextInput type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </FieldLabel>
          </div>

          {error && <p className="text-[13px] text-[#d4493f]">{error}</p>}

          <div className="flex items-center justify-end gap-2.5 pt-2">
            {!canWrite && <span className="mr-auto text-[12.5px] text-grey-2">Read-only preview — saving is being wired next.</span>}
            <Button variant="ghost" onClick={() => navigate(-1)}>{canWrite ? "Cancel" : "Back"}</Button>
            <Button type="submit" disabled={!canWrite}>Create Task</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
