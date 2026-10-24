import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import Combobox from "@/shared/components/ui/Combobox";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import { fetchKras, KRAS_QUERY_KEY } from "@/core/admin/kras";
import { useTaskStore } from "../mock/store";
import { useSession } from "../mock/session";
import { kraToPick, pctLabel, seesKraWeights } from "../lib/kraTasks";
import type { Task } from "../types";

/** Confirm completion of a task, with an optional closing note. */
export default function CompleteModal({ task, open, onClose, onCompleted }: { task: Task; open: boolean; onClose: () => void; onCompleted?: () => void }) {
  const { completeTask, taskLocationsComplete, actorById } = useTaskStore();
  const { user, role } = useSession();
  const [note, setNote] = useState("");
  // A Director's KRA task: whoever does it says which of their own KRAs it belongs to
  // before it can be completed (guard_task_kra refuses it otherwise).
  const mustPickKra = kraToPick(task);
  const iPick = mustPickKra && task.assignedTo === user.id;
  const krasQ = useQuery({ queryKey: KRAS_QUERY_KEY, queryFn: fetchKras, enabled: open && iPick });
  const myKras = (krasQ.data ?? []).filter((k) => k.profileId === user.id && k.active).sort((a, b) => a.sortOrder - b.sortOrder);
  const [kraId, setKraId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // A location still pending = neither done nor marked Not Applicable.
  const pendingLocations = task.locations.filter((l) => !l.completedAt && !l.naAt).length;
  const blocked = task.locations.length > 0 && !taskLocationsComplete(task);

  // Reset on open — the modal stays mounted, so clear any stale note/state.
  useEffect(() => {
    if (open) {
      setNote("");
      setKraId("");
      setBusy(false);
      setError("");
    }
  }, [open]);

  const submit = async () => {
    if (iPick && !kraId) {
      setError("Pick which of your KRAs this task belongs to.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await completeTask(task.id, note.trim() || undefined, iPick ? kraId : undefined);
      onClose();
      onCompleted?.();
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
          <Button onClick={submit} disabled={busy || blocked || (mustPickKra && !iPick)}>{busy ? "Saving…" : "Mark complete"}</Button>
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
        {mustPickKra && (
          iPick ? (
            <FieldLabel
              label="Which KRA does this belong to?"
              required
              hint={!krasQ.isLoading && myKras.length === 0 ? "No KRAs set for you yet — ask HR to add them" : undefined}
            >
              <Combobox
                value={kraId}
                onChange={(v) => { setKraId(v); setError(""); }}
                placeholder="Pick your KRA"
                options={myKras.map((k) => ({ value: k.id, label: k.name, sublabel: seesKraWeights(role) ? `KRA · Wt ${pctLabel(k.weight)}` : "KRA" }))}
              />
              <p className="mt-1.5 text-[12px] text-grey">
                Given as a KRA task by {actorById(task.createdBy)?.name ?? "a Director"}.{" "}
                {task.kraReviewerId
                  ? `${actorById(task.kraReviewerId)?.name ?? "The Director"} reviews it 1–10 once it is complete.`
                  : "Your HOD reviews it 1–10 once it is complete, and may change the KRA you pick."}
              </p>
            </FieldLabel>
          ) : (
            <p className="rounded-xl bg-[#FFF6E5] px-3.5 py-3 text-[13px] text-[#9a6200]">
              Only {actorById(task.assignedTo)?.name ?? "the assignee"} can complete this KRA task — they pick which of their KRAs it belongs to.
            </p>
          )
        )}
        <FieldLabel label="Completion note" hint="optional">
          <TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} placeholder="Anything to record about how it was done?" />
        </FieldLabel>
        {error && <p className="text-[13px] text-[#d4493f]">{error}</p>}
      </div>
    </Modal>
  );
}
