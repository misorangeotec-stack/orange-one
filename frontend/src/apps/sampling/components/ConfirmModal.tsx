import { useEffect, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import { useSamplingStore } from "../store";
import { futureDateError, requestSubject, stepDateDefault, todayIso } from "../lib/format";
import type { SamplingRequest } from "../types";

/**
 * Record (or correct) the date the party CONFIRMED receipt of an outward sample.
 * Advances the request to testing. `editing` corrects it until testing is
 * recorded; the server re-checks that lock.
 */
export default function ConfirmModal({
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
  const [partyReceivedDate, setPartyReceivedDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open && request) {
      setPartyReceivedDate(stepDateDefault(request.partyReceivedDate));
      setErr(null);
      setBusy(false);
    }
  }, [open, request]);

  const save = async () => {
    if (!request) return;
    const bad = futureDateError(partyReceivedDate, "Date the party received the sample");
    if (bad) {
      setErr(bad);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const input = { partyReceivedDate: partyReceivedDate || null };
      if (editing) await s.updateConfirm(request, input);
      else await s.recordConfirm(request, input);
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
      title={`${editing && !readOnly ? "Edit receipt confirmation" : "Confirm receipt"} — ${request?.reqNo ?? ""}`}
      subtitle={request ? requestSubject(request) : undefined}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <FieldLabel label="Date the party received the sample" hint="today by default — you can backdate, not post-date">
          <TextInput type="date" max={todayIso()} value={partyReceivedDate} onChange={(e) => setPartyReceivedDate(e.target.value)} />
        </FieldLabel>
        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Modal>
  );
}
