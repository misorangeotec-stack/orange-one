import { useState } from "react";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import { useHrStore } from "../../store";
import type { Candidate } from "../../types";

/**
 * Save a candidate for future reference — or take them back out of the bucket.
 *
 * A FLAG, NOT A STAGE MOVE. The card stays exactly where it is on this vacancy; HR can
 * still Disqualify them here. What changes is that the candidate now also sits in the
 * Future Reference bucket, where the HR people named in Setup can find them for the
 * next vacancy. The note is the reason, and it is shown in the bucket.
 */
export default function FutureReferenceModal({
  candidate: c,
  open,
  onClose,
}: {
  candidate: Candidate;
  open: boolean;
  onClose: () => void;
}) {
  const s = useHrStore();
  const saved = !!c.futureRefAt;
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await s.setFutureReference(c.id, !saved, note.trim() || undefined);
      onClose();
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
      title={saved ? "Remove from future reference" : "Save for future reference"}
      subtitle={c.name}
      footer={
        <div className="flex items-center justify-end gap-2">
          {err && <span className="mr-auto text-[12.5px] text-ryg-red">{err}</span>}
          <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={busy}>
            {busy ? "Saving…" : saved ? "Remove" : "Save for future"}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-[12.5px] leading-snug text-grey-2">
          {saved ? (
            <>
              They will leave the <strong className="font-semibold text-navy">Future Reference</strong> bucket.
              Their stage on this vacancy does not change.
            </>
          ) : (
            <>
              The candidate goes into the <strong className="font-semibold text-navy">Future Reference</strong>{" "}
              bucket, where HR can pick them up for a later vacancy. Their stage on this vacancy does not change —
              you can still disqualify them here.
            </>
          )}
        </p>
        {saved && c.futureRefNote && (
          <p className="rounded-lg bg-page px-3 py-2 text-[12.5px] text-navy">Saved because: {c.futureRefNote}</p>
        )}
        <FieldLabel label={saved ? "Reason (optional)" : "Why keep them? (optional)"}>
          <TextArea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={saved ? "e.g. placed elsewhere, no longer interested" : "e.g. good fit for a Surat sales role"}
          />
        </FieldLabel>
      </div>
    </Modal>
  );
}
