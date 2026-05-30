import { useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { useTaskStore } from "../mock/store";
import type { Task } from "../types";

/** Revise a task with a follow-up date. Blocked once the weekly revision limit is hit. */
export default function ReviseModal({ task, open, onClose }: { task: Task; open: boolean; onClose: () => void }) {
  const { reviseTask, revisionInfo } = useTaskStore();
  const info = revisionInfo(task);
  const [followUpDate, setFollowUpDate] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const submit = () => {
    if (!followUpDate) {
      setError("A follow-up date is required when revising.");
      return;
    }
    reviseTask(task.id, { followUpDate, note: note.trim() || undefined });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Revise task"
      subtitle={task.title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!info.allowed}>Submit revision</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div
          className={
            "rounded-xl px-3.5 py-3 text-[13px] font-medium " +
            (info.allowed ? "bg-[#FEF6E6] text-[#B7820E]" : "bg-[#FDECEA] text-[#d4493f]")
          }
        >
          {info.allowed ? (
            <>Revisions used this week: <b>{info.usedThisWeek}/{info.max}</b> · {info.remaining} remaining</>
          ) : (
            <>Revision limit reached ({info.max}/week). This task can only be completed, kept pending, or shifted to next week.</>
          )}
        </div>

        <FieldLabel label="Follow-up date" required>
          <TextInput type="date" value={followUpDate} onChange={(e) => { setFollowUpDate(e.target.value); setError(""); }} disabled={!info.allowed} />
        </FieldLabel>

        <FieldLabel label="Reason / note" hint="optional">
          <TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} disabled={!info.allowed} placeholder="Why is this being revised? What's the new plan?" />
        </FieldLabel>

        {error && <p className="text-[13px] text-[#d4493f]">{error}</p>}
      </div>
    </Modal>
  );
}
