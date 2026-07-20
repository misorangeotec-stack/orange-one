import { useEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { useSamplingStore } from "../store";
import { uploadResultDocument } from "../data/samplingWrites";
import { requestSubject } from "../lib/format";
import type { SamplingRequest } from "../types";

/** Opens the stored result document via a fresh short-lived signed URL. */
function ResultDocLink({ path, name }: { path: string; name: string | null }) {
  const s = useSamplingStore();
  const [busy, setBusy] = useState(false);
  const open = async () => {
    if (busy) return;
    setBusy(true);
    try {
      window.open(await s.resultDocumentUrl(path), "_blank", "noopener,noreferrer");
    } catch {
      /* surfaced elsewhere; keep the host quiet */
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
 * Record (or correct) the RESULT — a comment (required), the result owner, and an
 * optional lab-report attachment. Recording closes the request. The result is the
 * last step, so it stays editable after close (until held / cancelled); the server
 * re-checks.
 */
export default function ResultModal({
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
  const [comment, setComment] = useState("");
  const [owner, setOwner] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && request) {
      setComment(request.resultComment ?? "");
      setOwner(request.resultOwner ?? "");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      setErr(null);
      setBusy(false);
    }
  }, [open, request]);

  const save = async () => {
    if (!request) return;
    if (!comment.trim()) {
      setErr("A result comment is required.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      let attach: { attachmentPath?: string | null; attachmentName?: string | null } = {};
      if (file) {
        const up = await uploadResultDocument(request.id, file);
        attach = { attachmentPath: up.path, attachmentName: up.name };
      }
      // On create, always pass the attachment keys (a fresh row has none). On edit,
      // pass them only when a new file replaces — an absent key keeps the current one.
      const base = { resultComment: comment.trim(), resultOwner: owner.trim() || null };
      if (editing) {
        await s.updateResult(request, { ...base, ...attach });
      } else {
        await s.recordResult(request, { ...base, attachmentPath: attach.attachmentPath ?? null, attachmentName: attach.attachmentName ?? null });
      }
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const existing =
    request?.attachmentPath ? <ResultDocLink path={request.attachmentPath} name={request.attachmentName} /> : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      readOnly={readOnly}
      readOnlyHeader={existing ?? undefined}
      title={`${editing && !readOnly ? "Edit result" : readOnly ? "Result" : "Record result"} — ${request?.reqNo ?? ""}`}
      subtitle={request ? requestSubject(request) : undefined}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : editing ? "Save" : "Save & close request"}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <FieldLabel label="Result comment" required>
          <TextArea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="The outcome of the testing" />
        </FieldLabel>
        <FieldLabel label="Result owner">
          <TextInput value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Who signed off the result" />
        </FieldLabel>
        <FieldLabel label="Attachment" hint={editing ? "choose a file to replace it" : "optional lab report"}>
          <input
            ref={fileRef}
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-[12.5px] text-grey file:mr-3 file:rounded-lg file:border-0 file:bg-page file:px-3 file:py-1.5 file:text-[12.5px] file:font-semibold file:text-navy hover:file:bg-line"
          />
        </FieldLabel>
        {editing && existing && (
          <div className="text-[12px] text-grey-2">
            Current file: {existing}
          </div>
        )}
        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Modal>
  );
}
