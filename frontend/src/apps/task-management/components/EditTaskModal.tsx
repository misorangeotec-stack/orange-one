import { useEffect, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import Avatar from "@/shared/components/ui/Avatar";
import { useTaskStore } from "../mock/store";
import LocationPicker from "./LocationPicker";
import type { Task } from "../types";

/**
 * Edit a pending one-off task: title, description, due date, locations.
 *
 * The assignee is shown read-only on purpose — handing a task to someone else
 * stays a delete-and-recreate, which keeps the department derivation and the RLS
 * downline check out of this path entirely. Callers gate on canEditRow /
 * canEditOneOff (pending, non-recurring, creator/assignee/admin); personal
 * "Other" tasks go to PersonalTaskModal instead, since they never have locations.
 */
export default function EditTaskModal({
  task,
  open,
  onClose,
}: {
  task: Task;
  open: boolean;
  onClose: () => void;
}) {
  const { updateTask, profileById, departmentById } = useTaskStore();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [locationIds, setLocationIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // The modal stays mounted (rendered with open=false) and the table reuses one
  // instance across every row — so prefill on each open, or row B shows row A.
  useEffect(() => {
    if (open) {
      setTitle(task.title);
      setDescription(task.description ?? "");
      setDueDate(task.dueDate ?? "");
      setLocationIds(task.locations.map((tl) => tl.locationId));
      setError("");
      setBusy(false);
    }
  }, [open, task]);

  const assignee = profileById(task.assignedTo);
  const departmentName = departmentById(task.departmentId)?.name;

  const submit = async () => {
    if (!title.trim()) {
      setError("Please enter a task title.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await updateTask(task.id, {
        title: title.trim(),
        description: description.trim() || undefined,
        dueDate: dueDate || null,
        locationIds,
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit task"
      subtitle={task.title}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button>
        </>
      }
    >
      <div className="space-y-5">
        <FieldLabel label="Task title" required>
          <TextInput
            value={title}
            onChange={(e) => { setTitle(e.target.value); setError(""); }}
            placeholder="e.g. Submit daily sales report"
            autoFocus
          />
        </FieldLabel>

        <FieldLabel label="Description" hint="optional">
          <TextArea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Add any details, context, or links…" />
        </FieldLabel>

        <div className="grid sm:grid-cols-2 gap-4">
          {/* Read-only: to move a task to someone else, delete it and create a new one. */}
          <div className="block">
            <span className="flex items-baseline justify-between gap-3 mb-1.5">
              <span className="text-[13px] font-medium text-navy shrink-0">Assigned to</span>
              <span className="text-[11px] text-grey-2">can't be changed</span>
            </span>
            {/* The department is a second line inside the box — as a label hint it
                was long enough to wrap and shunt "Assigned to" out of line. */}
            <div className="w-full rounded-xl border border-line bg-page px-3.5 py-2 flex items-center gap-2 min-w-0">
              {assignee && <Avatar name={assignee.name} color={assignee.avatarColor} size={26} />}
              <span className="min-w-0">
                <span className="block text-[14px] text-grey truncate leading-tight">{assignee?.name ?? "Unassigned"}</span>
                {departmentName && <span className="block text-[11px] text-grey-2 truncate leading-tight mt-0.5">{departmentName}</span>}
              </span>
            </div>
          </div>

          <FieldLabel label="Due date" hint="optional">
            <TextInput type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </FieldLabel>
        </div>

        <LocationPicker value={locationIds} onChange={setLocationIds} />

        {error && <p className="text-[13px] text-[#d4493f]">{error}</p>}
      </div>
    </Modal>
  );
}
