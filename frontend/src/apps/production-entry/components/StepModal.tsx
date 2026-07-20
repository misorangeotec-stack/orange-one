import { useEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import Combobox from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { useProductionStore } from "../store";
import { uploadQualityDocument } from "../data/productionWrites";
import { requestSubject } from "../lib/format";
import { STATUS_OPTIONS, STEP_CONFIG } from "../lib/stepConfig";
import type { QueueStep } from "../lib/queues";
import type { ProductionRequest } from "../types";

export interface StepModalProps {
  open: boolean;
  onClose: () => void;
  request: ProductionRequest | null;
  editing?: boolean;
  readOnly?: boolean;
}

/** Opens the stored quality document via a fresh short-lived signed URL. */
function QcDocLink({ path, name }: { path: string; name: string | null }) {
  const s = useProductionStore();
  const [busy, setBusy] = useState(false);
  const open = async () => {
    if (busy) return;
    setBusy(true);
    try {
      window.open(await s.qcDocumentUrl(path), "_blank", "noopener,noreferrer");
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
 * The ONE modal that records (or corrects) every workflow step. It reads the
 * step's field descriptors from lib/stepConfig, renders them, and calls the store's
 * generic recordStep / updateStep. `editing` corrects the entry until the next step
 * is recorded; the server re-checks that lock and refuses otherwise.
 *
 * Quality Checking additionally carries an optional test-report attachment.
 */
export default function StepModal({
  stepKey,
  open,
  onClose,
  request,
  editing = false,
  readOnly = false,
}: StepModalProps & { stepKey: QueueStep }) {
  const s = useProductionStore();
  const cfg = STEP_CONFIG[stepKey];
  const [values, setValues] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && request) {
      const seed: Record<string, string> = {};
      for (const f of cfg.fields) seed[f.key] = f.get(request);
      setValues(seed);
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      setErr(null);
      setBusy(false);
    }
  }, [open, request, cfg]);

  const setField = (key: string, v: string) => setValues((prev) => ({ ...prev, [key]: v }));

  const save = async () => {
    if (!request) return;
    setBusy(true);
    setErr(null);
    try {
      const payload: Record<string, string> = {};
      for (const f of cfg.fields) payload[f.key] = values[f.key] ?? "";

      if (cfg.hasAttachment && file) {
        const up = await uploadQualityDocument(request.id, file);
        payload.qc_attachment_path = up.path;
        payload.qc_attachment_name = up.name;
      }
      // On create with no file, seed empty attachment keys (a fresh row has none).
      // On edit with no file, OMIT them so the current file is kept (RPC keys on presence).
      if (cfg.hasAttachment && !file && !editing) {
        payload.qc_attachment_path = "";
        payload.qc_attachment_name = "";
      }

      if (editing) await s.updateStep(stepKey, request, payload);
      else await s.recordStep(stepKey, request, payload);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const existing =
    cfg.hasAttachment && request?.qcAttachmentPath ? (
      <QcDocLink path={request.qcAttachmentPath} name={request.qcAttachmentName} />
    ) : null;

  const titlePrefix = editing && !readOnly ? `Edit ${cfg.title.toLowerCase()}` : readOnly ? cfg.title : cfg.actionLabel;

  return (
    <Modal
      open={open}
      onClose={onClose}
      readOnly={readOnly}
      readOnlyHeader={existing ?? undefined}
      title={`${titlePrefix} — ${request?.reqNo ?? ""}`}
      subtitle={request ? requestSubject(request) : undefined}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {cfg.fields.map((f) => (
          <FieldLabel key={f.key} label={f.label} hint={f.hint}>
            {f.kind === "status" ? (
              <Combobox
                value={values[f.key] ?? ""}
                onChange={(v) => setField(f.key, v)}
                options={STATUS_OPTIONS}
                placeholder="Select status"
              />
            ) : f.kind === "textarea" ? (
              <TextArea rows={2} value={values[f.key] ?? ""} onChange={(e) => setField(f.key, e.target.value)} placeholder={f.placeholder} />
            ) : f.kind === "date" ? (
              <TextInput type="date" value={values[f.key] ?? ""} onChange={(e) => setField(f.key, e.target.value)} />
            ) : (
              <TextInput
                value={values[f.key] ?? ""}
                inputMode={f.kind === "number" ? "decimal" : undefined}
                onChange={(e) => setField(f.key, e.target.value)}
                placeholder={f.placeholder}
              />
            )}
          </FieldLabel>
        ))}

        {cfg.hasAttachment && (
          <FieldLabel label="Attachment of testing" hint={editing ? "choose a file to replace it" : "optional lab report"}>
            <input
              ref={fileRef}
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-[12.5px] text-grey file:mr-3 file:rounded-lg file:border-0 file:bg-page file:px-3 file:py-1.5 file:text-[12.5px] file:font-semibold file:text-navy hover:file:bg-line"
            />
            {editing && existing && <div className="mt-1 text-[12px] text-grey-2">Current file: {existing}</div>}
          </FieldLabel>
        )}

        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Modal>
  );
}
