import { useEffect, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { useTaskStore } from "../mock/store";
import type { Task } from "../types";

/**
 * Create or edit a personal (self-tracking) task. Pass `task` to edit; omit it to
 * create. Personal tasks are self-assigned and excluded from every score/RYG/
 * dashboard metric — this is the only creation path available to team-less users.
 */
export default function PersonalTaskModal({
  task,
  open,
  onClose,
  onCreated,
}: {
  task?: Task;
  open: boolean;
  onClose: () => void;
  onCreated?: (id: string) => void;
}) {
  const { createPersonalTask, updatePersonalTask } = useTaskStore();
  const editing = !!task;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // The modal stays mounted (rendered with open=false); reset/prefill each open.
  useEffect(() => {
    if (open) {
      setTitle(task?.title ?? "");
      setDescription(task?.description ?? "");
      setDueDate(task?.dueDate ?? "");
      setError("");
      setBusy(false);
    }
  }, [open, task]);

  const submit = async () => {
    if (!title.trim()) {
      setError("Please enter a task title.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const patch = {
        title: title.trim(),
        description: description.trim() || undefined,
        dueDate: dueDate || null,
      };
      if (editing) {
        await updatePersonalTask(task!.id, patch);
        onClose();
      } else {
        const id = await createPersonalTask(patch);
        onClose();
        onCreated?.(id);
      }
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
      title={editing ? "Edit other task" : "Add other task"}
      subtitle="Just for your own tracking — it won't affect any scores or reports."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Saving…" : editing ? "Save changes" : "Add task"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FieldLabel label="Task title" required>
          <TextInput
            value={title}
            onChange={(e) => { setTitle(e.target.value); setError(""); }}
            placeholder="e.g. Tidy up my inbox"
            autoFocus
          />
        </FieldLabel>

        <FieldLabel label="Description" hint="optional">
          <TextArea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Any details or notes…" />
        </FieldLabel>

        <FieldLabel label="Due date" hint="optional">
          <TextInput type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </FieldLabel>

        {error && <p className="text-[13px] text-[#d4493f]">{error}</p>}
      </div>
    </Modal>
  );
}
