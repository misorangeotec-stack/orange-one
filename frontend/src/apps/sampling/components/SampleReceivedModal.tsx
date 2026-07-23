import { useEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { useSamplingStore } from "../store";
import { uploadReceivedDocument } from "../data/samplingWrites";
import { requestSubject } from "../lib/format";
import SampleSummary from "./SampleSummary";
import type { SamplingRequest } from "../types";

/** Opens the stored received-sample document via a fresh short-lived signed URL. */
function ReceivedDocLink({ path, name }: { path: string; name: string | null }) {
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
      <span className="truncate">{busy ? "Opening…" : name || "View attachment"}</span>
    </button>
  );
}

/**
 * sample_received — the recipient (or, for a free-text recipient, a step owner)
 * confirms the sample was received. A date, plus an OPTIONAL note and OPTIONAL
 * attachment. Recording closes the request; it stays editable after close.
 */
export default function SampleReceivedModal({
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
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && request) {
      setReceivedDate(request.sampleReceivedDate ?? "");
      setNote(request.sampleReceivedNote ?? "");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      setErr(null);
      setBusy(false);
    }
  }, [open, request]);

  const save = async () => {
    if (!request) return;
    setBusy(true);
    setErr(null);
    try {
      let attach: { docPath?: string | null; docName?: string | null } = {};
      if (file) {
        const up = await uploadReceivedDocument(request.id, file);
        attach = { docPath: up.path, docName: up.name };
      }
      const base = { sampleReceivedDate: receivedDate || null, sampleReceivedNote: note.trim() || null };
      if (editing) {
        await s.updateSampleReceived(request, { ...base, ...attach });
      } else {
        await s.recordSampleReceived(request, { ...base, docPath: attach.docPath ?? null, docName: attach.docName ?? null });
      }
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const existing =
    request?.sampleReceivedDocPath ? <ReceivedDocLink path={request.sampleReceivedDocPath} name={request.sampleReceivedDocName} /> : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      readOnly={readOnly}
      readOnlyHeader={existing ?? undefined}
      size="xl"
      title={`${editing && !readOnly ? "Edit sample receipt" : readOnly ? "Sample received" : "Confirm sample received"} — ${request?.reqNo ?? ""}`}
      subtitle={request ? requestSubject(request) : undefined}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : editing ? "Save" : "Mark received & close"}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {request && <SampleSummary request={request} />}
        <FieldLabel label="Date received" hint="defaults to today if left blank">
          <TextInput type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
        </FieldLabel>
        <FieldLabel label="Remarks" hint="optional">
          <TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything to note about the received sample" />
        </FieldLabel>
        <FieldLabel label="Attachment" hint={editing ? "choose a file to replace it" : "optional"}>
          <input
            ref={fileRef}
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-[12.5px] text-grey file:mr-3 file:rounded-lg file:border-0 file:bg-page file:px-3 file:py-1.5 file:text-[12.5px] file:font-semibold file:text-navy hover:file:bg-line"
          />
        </FieldLabel>
        {editing && existing && <div className="text-[12px] text-grey-2">Current file: {existing}</div>}
        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Modal>
  );
}
