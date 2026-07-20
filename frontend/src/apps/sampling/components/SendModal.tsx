import { useEffect, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import { useSamplingStore } from "../store";
import { requestSubject } from "../lib/format";
import type { SamplingRequest } from "../types";

/**
 * Record (or correct) the date an outward sample was DISPATCHED. Advances the
 * request to receipt confirmation. `editing` corrects it until the receipt is
 * confirmed; the server re-checks that lock.
 */
export default function SendModal({
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
  const [sentDate, setSentDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open && request) {
      setSentDate(request.sentDate ?? "");
      setErr(null);
      setBusy(false);
    }
  }, [open, request]);

  const save = async () => {
    if (!request) return;
    setBusy(true);
    setErr(null);
    try {
      const input = { sentDate: sentDate || null };
      if (editing) await s.updateSend(request, input);
      else await s.recordSend(request, input);
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
      title={`${editing && !readOnly ? "Edit sample dispatch" : "Sample sent"} — ${request?.reqNo ?? ""}`}
      subtitle={request ? requestSubject(request) : undefined}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <FieldLabel label="Date sent" hint="defaults to today if left blank">
          <TextInput type="date" value={sentDate} onChange={(e) => setSentDate(e.target.value)} />
        </FieldLabel>
        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Modal>
  );
}
