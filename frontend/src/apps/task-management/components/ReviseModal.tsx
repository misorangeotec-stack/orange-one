import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { weekStartOf, todayIso } from "@/shared/lib/time";
import { useTaskStore } from "../mock/store";
import type { Task } from "../types";

/**
 * Revise a task with a follow-up date. If the follow-up lands in a LATER week the
 * action becomes a shift (the task is marked Shifted and a fresh copy opens in
 * that week) — allowed even once the weekly revision limit is hit. A same-week
 * follow-up is a true in-week revision and is blocked at the limit.
 */
export default function ReviseModal({ task, open, onClose }: { task: Task; open: boolean; onClose: () => void }) {
  const { reviseTask, revisionInfo } = useTaskStore();
  const navigate = useNavigate();
  const info = revisionInfo(task);
  const [followUpDate, setFollowUpDate] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // A follow-up in a later week than the task's current week is a shift, not a
  // revision (so it doesn't consume a revision and isn't blocked at the limit).
  const isShift = !!followUpDate && weekStartOf(followUpDate) > (task.weekStart ?? weekStartOf(todayIso()));

  // The modal stays mounted (rendered with open=false), so reset its fields each
  // time it opens — otherwise a prior revision's note/date would silently re-post.
  useEffect(() => {
    if (open) {
      setFollowUpDate("");
      setNote("");
      setError("");
      setBusy(false);
    }
  }, [open]);

  const submit = async () => {
    if (!followUpDate) {
      setError("A follow-up date is required when revising.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const shiftedToId = await reviseTask(task.id, { followUpDate, note: note.trim() || undefined });
      onClose();
      // Shifted to a later week → jump to the continuation task that opened there.
      if (shiftedToId) navigate(`/task-management/tasks/${shiftedToId}`);
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
      title="Revise task"
      subtitle={task.title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !followUpDate || (!isShift && !info.allowed)}>
            {busy ? "Saving…" : isShift ? "Shift to that week" : "Submit revision"}
          </Button>
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
            <>Revision limit reached ({info.max}/week). This task can only be completed, kept pending, or shifted — pick a follow-up date in a later week to shift it.</>
          )}
        </div>

        <FieldLabel
          label="Follow-up date"
          required
          hint={isShift ? "later week → the task is marked Shifted and a fresh copy opens there (no revision used)" : "due date moves to this date (uses one revision)"}
        >
          <TextInput type="date" value={followUpDate} onChange={(e) => { setFollowUpDate(e.target.value); setError(""); }} />
        </FieldLabel>

        <FieldLabel label="Reason / note" hint="optional">
          <TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why is this being revised / shifted? What's the new plan?" />
        </FieldLabel>

        {error && <p className="text-[13px] text-[#d4493f]">{error}</p>}
      </div>
    </Modal>
  );
}
