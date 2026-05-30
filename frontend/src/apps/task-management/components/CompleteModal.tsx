import { useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import { useTaskStore } from "../mock/store";
import type { Task } from "../types";

/** Confirm completion of a task, with an optional closing note. */
export default function CompleteModal({ task, open, onClose }: { task: Task; open: boolean; onClose: () => void }) {
  const { completeTask } = useTaskStore();
  const [note, setNote] = useState("");

  const submit = () => {
    completeTask(task.id, note.trim() || undefined);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Mark as complete"
      subtitle={task.title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit}>Mark complete</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl bg-[#E8F8EF] text-[#1f9d57] px-3.5 py-3 text-[13px] font-medium flex items-center gap-2.5">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
          Nice work! This will be marked completed and timestamped.
        </div>
        <FieldLabel label="Completion note" hint="optional">
          <TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything to record about how it was done?" />
        </FieldLabel>
      </div>
    </Modal>
  );
}
