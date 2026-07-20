import { useEffect, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import { useSamplingStore } from "../store";
import { requestSubject } from "../lib/format";
import type { SamplingRequest } from "../types";

/**
 * Record (or correct) testing completion — the date it finished, an internal
 * reference, and a tentative result date. Advances the request to the result step.
 * `editing` corrects it until the result is recorded; the server re-checks.
 */
export default function TestingModal({
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
  const [testingCompletedDate, setTestingCompletedDate] = useState("");
  const [internalRef, setInternalRef] = useState("");
  const [tentativeResultDate, setTentativeResultDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open && request) {
      setTestingCompletedDate(request.testingCompletedDate ?? "");
      setInternalRef(request.internalRef ?? "");
      setTentativeResultDate(request.tentativeResultDate ?? "");
      setErr(null);
      setBusy(false);
    }
  }, [open, request]);

  const save = async () => {
    if (!request) return;
    setBusy(true);
    setErr(null);
    try {
      const input = {
        testingCompletedDate: testingCompletedDate || null,
        internalRef: internalRef.trim() || null,
        tentativeResultDate: tentativeResultDate || null,
      };
      if (editing) await s.updateTesting(request, input);
      else await s.recordTesting(request, input);
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
      title={`${editing && !readOnly ? "Edit testing" : "Record testing"} — ${request?.reqNo ?? ""}`}
      subtitle={request ? requestSubject(request) : undefined}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <FieldLabel label="Testing completed on" hint="defaults to today if left blank">
          <TextInput type="date" value={testingCompletedDate} onChange={(e) => setTestingCompletedDate(e.target.value)} />
        </FieldLabel>
        <FieldLabel label="Internal reference">
          <TextInput value={internalRef} onChange={(e) => setInternalRef(e.target.value)} placeholder="e.g. lab batch / job no." />
        </FieldLabel>
        <FieldLabel label="Tentative result date">
          <TextInput type="date" value={tentativeResultDate} onChange={(e) => setTentativeResultDate(e.target.value)} />
        </FieldLabel>
        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Modal>
  );
}
