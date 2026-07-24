import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { useSamplingStore } from "../store";
import { futureDateError, stepDateDefault, todayIso } from "../lib/format";
import SampleSummary from "./SampleSummary";
import type { SamplingRequest } from "../types";

/** Opens the lab report the result was handed over with. */
function LabDocLink({ path, name }: { path: string; name: string | null }) {
  const s = useSamplingStore();
  const [busy, setBusy] = useState(false);
  const open = async () => {
    if (busy) return;
    setBusy(true);
    try {
      window.open(await s.resultDocumentUrl(path), "_blank", "noopener,noreferrer");
    } catch {
      /* surfaced elsewhere */
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      onClick={open}
      disabled={busy}
      className="inline-flex max-w-[240px] items-center gap-1.5 text-[12.5px] font-semibold text-orange hover:underline disabled:opacity-60"
    >
      <FileText className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{busy ? "Opening…" : name || "View lab report"}</span>
    </button>
  );
}

/**
 * result_received — the LAST step of the inward lab branch. Whoever the lab handed
 * the result to confirms they have it, which closes the request. It is the last
 * step, so nothing downstream can lock it: a closed request's receipt stays
 * editable, mirroring sample_received and result_handover.
 */
export default function ResultReceivedModal({
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
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open && request) {
      setReceivedDate(stepDateDefault(request.resultReceivedDate));
      setNote(request.resultReceivedNote ?? "");
      setErr(null);
      setBusy(false);
    }
  }, [open, request]);

  const save = async () => {
    if (!request) return;
    const bad = futureDateError(receivedDate, "Date received");
    if (bad) {
      setErr(bad);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const input = { resultReceivedDate: receivedDate || null, resultReceivedNote: note.trim() || null };
      if (editing) await s.updateResultReceived(request, input);
      else await s.recordResultReceived(request, input);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const report = request?.labDocPath ? <LabDocLink path={request.labDocPath} name={request.labDocName} /> : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      readOnly={readOnly}
      readOnlyHeader={report ?? undefined}
      size="xl"
      // No subtitle: SampleSummary below already shows the product / description.
      title={`${editing && !readOnly ? "Edit result receipt" : readOnly ? "Result received" : "Confirm result received"} — ${request?.reqNo ?? ""}`}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : editing ? "Save" : "Mark received & close"}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {request && <SampleSummary request={request} />}

        {request?.labComment && (
          <div className="rounded-xl bg-page px-4 py-3 space-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">Lab result</span>
            <div className="text-[13.5px] text-navy whitespace-pre-wrap">{request.labComment}</div>
            {report && <div>{report}</div>}
          </div>
        )}

        <FieldLabel label="Date received" hint="today by default — you can backdate, not post-date">
          <TextInput type="date" max={todayIso()} value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
        </FieldLabel>
        <FieldLabel label="Remarks" hint="optional">
          <TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything to note about the result" />
        </FieldLabel>
        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Modal>
  );
}
