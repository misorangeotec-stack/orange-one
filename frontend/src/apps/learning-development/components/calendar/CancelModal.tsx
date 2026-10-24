import { useEffect, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import { useLdStore } from "../../store";
import { dmy } from "../../lib/format";
import type { TrainingSession } from "../../types";

/**
 * Cancel a training — requirement 4.
 *
 * ⚠ THE MAIL RULE IS THE SERVER'S, and this dialog only explains it: attendees
 *   are mailed a cancellation ONLY if the invitation (3 days before) had already
 *   gone to them. Before that, cancelling is silent apart from the bell — nobody
 *   is told about a meeting they never heard of.
 */
export default function CancelModal({
  open,
  onClose,
  session: x,
}: {
  open: boolean;
  onClose: () => void;
  session: TrainingSession;
}) {
  const s = useLdStore();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason("");
      setErr(null);
    }
  }, [open]);

  const mailed = (s.data?.nominations ?? []).filter(
    (n) => n.sessionId === x.id && n.status === "approved" && n.inviteMailedAt,
  ).length;

  const cancel = async () => {
    setBusy(true);
    setErr(null);
    try {
      await s.writes.cancelTraining(x.id, reason.trim());
      await s.refresh();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title="Cancel training"
      subtitle={`${x.title} · ${dmy(x.sessionDate)}`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Keep it</Button>
          <Button onClick={() => void cancel()} disabled={busy || !reason.trim()}>
            {busy ? "Cancelling…" : "Cancel training"}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <p
          className={
            "rounded-lg px-3 py-2 text-[13px] " +
            (mailed > 0 ? "bg-[#FFF7E6] text-navy" : "bg-[#F1F4F9] text-grey-2")
          }
        >
          {mailed > 0
            ? `${mailed} attendee${mailed === 1 ? " has" : "s have"} already had the invitation mail, so they will get a cancellation mail and the training will be removed from their calendar.`
            : "The invitation mail has not gone out yet, so no cancellation mail will be sent. Attendees see it in the bell only."}
        </p>
        <FieldLabel label="Reason" required>
          <TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Trainer unavailable — will be rescheduled" />
        </FieldLabel>
        <p className="text-[12px] text-grey-2">The training stays on the calendar, struck through, and is listed under Cancelled.</p>
        {err && <p className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-[13px] text-[#B42318]">{err}</p>}
      </div>
    </Modal>
  );
}
