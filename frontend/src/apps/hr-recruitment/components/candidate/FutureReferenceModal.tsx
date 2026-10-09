import { useState } from "react";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import { useHrStore } from "../../store";
import { STAGE_LABEL } from "../../lib/board";
import type { Candidate } from "../../types";

/**
 * Move a candidate OUT of the pipeline and into the Future Reference bucket.
 *
 * Not a copy: the same candidate leaves the board (and the queues, and the counts) and
 * waits in the bucket until somebody presses "Move to pipeline" there. Their stage is
 * remembered, so going back to the same vacancy puts them back where they were.
 */
export default function FutureReferenceModal({
  candidate: c,
  open,
  onClose,
  onDone,
}: {
  candidate: Candidate;
  open: boolean;
  onClose: () => void;
  /** After a successful save — the host usually leaves the page, the card is gone. */
  onDone?: () => void;
}) {
  const s = useHrStore();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await s.saveFutureReference(c.id, note.trim() || undefined);
      onClose();
      onDone?.();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Move to Future Reference"
      subtitle={c.name}
      footer={
        <div className="flex items-center justify-end gap-2">
          {err && <span className="mr-auto text-[12.5px] text-ryg-red">{err}</span>}
          <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={busy}>
            {busy ? "Moving…" : "Move to Future Reference"}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-[12.5px] leading-snug text-grey-2">
          {c.name} will <strong className="font-semibold text-navy">leave this pipeline</strong> and wait in the{" "}
          <strong className="font-semibold text-navy">Future Reference</strong> bucket. From there HR can move them
          back to this vacancy (at {STAGE_LABEL[c.stage]}) or into another open vacancy.
        </p>
        <FieldLabel label="Why keep them? (optional)">
          <TextArea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. good fit for a Surat sales role"
          />
        </FieldLabel>
      </div>
    </Modal>
  );
}
