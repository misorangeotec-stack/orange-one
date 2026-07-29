import { useEffect, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import SampleSummary from "./SampleSummary";
import { useSamplingStore } from "../store";
import { futureDateError, requestSubject, stepDateDefault, todayIso, totalSampleQty } from "../lib/format";
import type { SamplingRequest } from "../types";

/**
 * Record (or correct) the date an outward sample was DISPATCHED. Advances the
 * request to receipt confirmation. `editing` corrects it until the receipt is
 * confirmed; the server re-checks that lock.
 *
 * Opens with the SampleSummary recap: the dispatcher is packing this sample, so
 * what was asked for — product, and the colour/quantity list — has to be on
 * screen while they type what actually went. The gate outward entry no. comes
 * LAST because it is stamped at the gate, after everything else is known.
 *
 * "Quantity sent" PRE-FILLS with the recap's total, because in the ordinary case
 * what goes out is exactly what was asked for and retyping it is pure friction.
 * It stays an editable free-text box: a short shipment is a real thing, and the
 * dispatcher must be able to record what ACTUALLY went.
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
  const [gateEntryNo, setGateEntryNo] = useState("");
  const [sentQty, setSentQty] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open && request) {
      setSentDate(stepDateDefault(request.sentDate));
      setGateEntryNo(request.gateEntryNo ?? "");
      // `??`, not `||`: a fresh dispatch has no stored quantity and takes the
      // request's total; an edit or a read-only view keeps what was recorded,
      // even where that deliberately differs from the total.
      setSentQty(request.sentQty ?? totalSampleQty(request).text);
      setErr(null);
      setBusy(false);
    }
  }, [open, request]);

  const save = async () => {
    if (!request) return;
    const bad = futureDateError(sentDate, "Date sent");
    if (bad) {
      setErr(bad);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const input = { sentDate: sentDate || null, gateEntryNo: gateEntryNo.trim() || null, sentQty: sentQty.trim() || null };
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
        {request && <SampleSummary request={request} />}
        <FieldLabel label="Date sent" hint="today by default — you can backdate, not post-date">
          <TextInput type="date" max={todayIso()} value={sentDate} onChange={(e) => setSentDate(e.target.value)} />
        </FieldLabel>
        <FieldLabel label="Quantity sent" hint="totalled from the list above — change it if what went out differs">
          <TextInput value={sentQty} onChange={(e) => setSentQty(e.target.value)} placeholder="e.g. 500 ml" />
        </FieldLabel>
        <FieldLabel label="Gate outward entry no.">
          <TextInput value={gateEntryNo} onChange={(e) => setGateEntryNo(e.target.value)} placeholder="e.g. GT/2627/118" />
        </FieldLabel>
        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Modal>
  );
}
