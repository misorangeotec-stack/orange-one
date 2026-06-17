import { useEffect, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import { useTaskStore } from "../mock/store";
import type { Task } from "../types";

/** Confirm completion of a task, with an optional closing note. */
export default function CompleteModal({ task, open, onClose }: { task: Task; open: boolean; onClose: () => void }) {
  const { completeTask, taskLocationsComplete } = useTaskStore();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // A location still pending = neither done nor marked Not Applicable.
  const pendingLocations = task.locations.filter((l) => !l.completedAt && !l.naAt).length;
  const blocked = task.locations.length > 0 && !taskLocationsComplete(task);

  // Reset on open — the modal stays mounted, so clear any stale note/state.
  useEffect(() => {
    if (open) {
      setNote("");
      setBusy(false);
      setError("");
    }
  }, [open]);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await completeTask(task.id, note.trim() || undefined);
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
      title="Mark as complete"
      subtitle={task.title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || blocked}>{busy ? "Saving…" : "Mark complete"}</Button>
        </>
      }
    >
      <div className="space-y-4">
        {blocked ? (
          <div className="rounded-xl bg-[#FDF1E7] text-[#b65a16] px-3.5 py-3 text-[13px] font-medium flex items-center gap-2.5">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v5" /><path d="M12 16h.01" /></svg>
            {pendingLocations} location{pendingLocations === 1 ? "" : "s"} still pending — tick off or mark Not Applicable every location before completing this task.
          </div>
        ) : (
          <div className="rounded-xl bg-[#E8F8EF] text-[#1f9d57] px-3.5 py-3 text-[13px] font-medium flex items-center gap-2.5">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
            Nice work! This will be marked completed and timestamped.
          </div>
        )}
        <FieldLabel label="Completion note" hint="optional">
          <TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} placeholder="Anything to record about how it was done?" />
        </FieldLabel>
        {error && <p className="text-[13px] text-[#d4493f]">{error}</p>}
      </div>
    </Modal>
  );
}
