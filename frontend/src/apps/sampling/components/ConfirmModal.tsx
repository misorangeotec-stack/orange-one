import { useEffect, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import SampleSummary from "./SampleSummary";
import { useSamplingStore } from "../store";
import { futureDateError, stepDateDefault, todayIso } from "../lib/format";
import type { SamplingRequest } from "../types";

/**
 * Record (or correct) the date the party CONFIRMED receipt of an outward sample,
 * and when they expect to TEST it. Advances the request straight to the RESULT —
 * outward no longer runs a testing step. `editing` corrects it until the result
 * is recorded; the server re-checks that lock.
 *
 * Opens with the FULL recap: confirming receipt usually means having chased the
 * contact person, so their name, number and address belong on screen — along with
 * our company and exactly what was sent.
 *
 * THE TWO DATES ARE OPPOSITES and are deliberately handled differently. The
 * received date records something that already happened, so it caps at today. The
 * tentative testing date is a FORECAST — it is supposed to be in the future, so it
 * carries no `max` and never goes through `futureDateError`. It is also optional:
 * the party may not have committed to a date, and that must not block recording
 * that they have the sample.
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
  const [partyTestingDate, setPartyTestingDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open && request) {
      setPartyReceivedDate(stepDateDefault(request.partyReceivedDate));
      // No `stepDateDefault`: a forecast nobody has given us must stay blank, not
      // silently claim the party will test it today.
      setPartyTestingDate(request.partyTestingDate ?? "");
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
      const input = {
        partyReceivedDate: partyReceivedDate || null,
        partyTestingDate: partyTestingDate || null,
      };
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
      size="xl"
      title={`${editing && !readOnly ? "Edit receipt confirmation" : "Confirm receipt"} — ${request?.reqNo ?? ""}`}
      // No subtitle: the recap below already shows the product / description.
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {request && <SampleSummary request={request} variant="full" />}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-3.5">
          <FieldLabel label="Date the party received the sample" hint="today by default — you can backdate, not post-date">
            <TextInput type="date" max={todayIso()} value={partyReceivedDate} onChange={(e) => setPartyReceivedDate(e.target.value)} />
          </FieldLabel>
          {/* Deliberately NO `max` and no futureDateError: this is a forecast. */}
          <FieldLabel label="Tentative testing date" hint="when the party expects to test it — a forecast, so it can be in the future">
            <TextInput type="date" value={partyTestingDate} onChange={(e) => setPartyTestingDate(e.target.value)} />
          </FieldLabel>
        </div>
        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Modal>
  );
}
