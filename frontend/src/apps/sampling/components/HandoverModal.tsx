import { useEffect, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { useSamplingStore } from "../store";
import { requestSubject } from "../lib/format";
import type { SamplingRequest } from "../types";

/**
 * Record (or correct) the RESULT HANDOVER — the date the result/report was handed
 * over, and an optional note. Recording closes the request. Handover is the last
 * step, so it stays editable after close (until held / cancelled); the server
 * re-checks that lock and refuses otherwise.
 */
export default function HandoverModal({
  open,
  onClose,
  request,
  editing = false,
  readOnly = false,
}: {
  open: boolean;
  onClose: () => void;
  request: SamplingRequest | null;
  editing?: boolean;
  readOnly?: boolean;
}) {
  const s = useSamplingStore();
  const [handoverDate, setHandoverDate] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open && request) {
      setHandoverDate(request.handoverDate ?? "");
      setNote(request.handoverNote ?? "");
      setErr(null);
      setBusy(false);
    }
  }, [open, request]);

  const save = async () => {
    if (!request) return;
    setBusy(true);
    setErr(null);
    try {
      const input = { handoverDate: handoverDate || null, handoverNote: note.trim() || null };
      if (editing) await s.updateHandover(request, input);
      else await s.recordHandover(request, input);
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
      readOnly={readOnly}
      title={`${editing && !readOnly ? "Edit result handover" : readOnly ? "Result handover" : "Record result handover"} — ${request?.reqNo ?? ""}`}
      subtitle={request ? requestSubject(request) : undefined}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : editing ? "Save" : "Save & close request"}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <FieldLabel label="Date handed over" hint="defaults to today if left blank">
          <TextInput type="date" value={handoverDate} onChange={(e) => setHandoverDate(e.target.value)} />
        </FieldLabel>
        <FieldLabel label="Note" hint="optional — who received it, how">
          <TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Report emailed to the requester" />
        </FieldLabel>
        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Modal>
  );
}
