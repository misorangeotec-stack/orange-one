import { useEffect, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import { SectionHeading } from "@/shared/components/ui/Readout";
import { useSamplingStore } from "../store";
import { futureDateError, stepDateDefault, todayIso } from "../lib/format";
import StepRecap from "./StepRecap";
import type { SamplingRequest } from "../types";

/**
 * sample_to_lab — the hand-over recipient confirms they have the sample, records
 * the internal reference number and sends it on to the lab. Advances the request
 * to awaiting_lab_process.
 *
 * This is the lab branch's twin of SampleReceivedModal: same act, except it does
 * not close the request and it demands the internal reference the lab works from.
 */
export default function SampleToLabModal({
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
  const [receivedDate, setReceivedDate] = useState("");
  const [sentDate, setSentDate] = useState("");
  const [internalRef, setInternalRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open && request) {
      // Received is seeded BLANK on an older row, never `today`: these rows only ever
      // carried the sent date, and today against a past sent date would block a save
      // that was previously fine.
      setReceivedDate(request.labReceivedDate ?? "");
      setSentDate(stepDateDefault(request.labSentDate));
      setInternalRef(request.internalRef ?? "");
      setErr(null);
      setBusy(false);
    }
  }, [open, request]);

  const save = async () => {
    if (!request) return;
    if (!internalRef.trim()) {
      setErr("An internal reference number is required.");
      return;
    }
    const bad = futureDateError(receivedDate, "Date received") ?? futureDateError(sentDate, "Date sent to lab");
    if (bad) {
      setErr(bad);
      return;
    }
    // Both are yyyy-mm-dd, so a plain string compare is the date compare.
    if (receivedDate && sentDate && sentDate < receivedDate) {
      setErr("The date sent to the lab cannot be earlier than the date received.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const input = {
        internalRef: internalRef.trim(),
        labReceivedDate: receivedDate || null,
        labSentDate: sentDate || null,
      };
      if (editing) await s.updateSampleToLab(request, input);
      else await s.recordSampleToLab(request, input);
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
      // No subtitle: the recap below already shows the product / description.
      title={`${editing && !readOnly ? "Edit sample receipt" : readOnly ? "Sample received & sent to lab" : "Confirm received & send to lab"} — ${request?.reqNo ?? ""}`}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={busy}>
            {busy ? "Saving…" : editing ? "Save" : "Received & sent to lab"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {request && <StepRecap request={request} />}

        <div>
          <SectionHeading>Received &amp; sent to lab</SectionHeading>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-3.5">
            <FieldLabel label="Date received" hint="when the sample reached you">
              <TextInput type="date" max={todayIso()} value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
            </FieldLabel>
            <FieldLabel label="Date sent to lab" hint="today by default — never earlier than received">
              {/* `min` is the courtesy nudge; save() and the RPC are the real gate. */}
              <TextInput
                type="date"
                min={receivedDate || undefined}
                max={todayIso()}
                value={sentDate}
                onChange={(e) => setSentDate(e.target.value)}
              />
            </FieldLabel>
            {/* FieldLabel takes no className, so the span lives on a wrapper. */}
            <div className="sm:col-span-2">
              <FieldLabel label="Internal reference number" required hint="the reference the lab will work from">
                <TextInput value={internalRef} onChange={(e) => setInternalRef(e.target.value)} placeholder="e.g. LAB/2627/014" />
              </FieldLabel>
            </div>
          </div>
        </div>

        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Modal>
  );
}
