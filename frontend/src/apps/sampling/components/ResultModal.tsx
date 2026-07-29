import { useEffect, useMemo, useRef, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import Combobox from "@/shared/components/ui/Combobox";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import { SectionHeading } from "@/shared/components/ui/Readout";
import StepRecap from "./StepRecap";
import DocLink from "./DocLink";
import { useSamplingStore } from "../store";
import { uploadResultDocument } from "../data/samplingWrites";
import type { SamplingRequest } from "../types";

/**
 * Record (or correct) the OUTWARD result — "Result Received": the result the party
 * came back with, as a comment (required), WHOM IT IS HANDED OVER TO (required),
 * and an optional report attachment. Recording moves the request to result
 * handover. The result stays editable until the handover is recorded; the server
 * re-checks.
 *
 * Not to be confused with ResultReceivedModal, which is the LAB branch's own
 * (differently keyed) result-received step.
 *
 * "RESULT HANDOVER TO" REPLACED THE FREE-TEXT "RESULT OWNER". It is a master-backed
 * pick, not a typed name, because the person chosen is ROUTED to: they are notified
 * the moment the result lands and the request appears in their Result Handover
 * queue — the outward twin of the lab branch's "result goes to". A typed name
 * could not be notified and could not act, which is what made the old field inert.
 * There is deliberately no free-text escape hatch for the same reason.
 *
 * Rows recorded before the master existed keep their `resultOwner` text — the RPC
 * simply stopped writing that column — and the detail page still shows it.
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
  const [handoverTo, setHandoverTo] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Keyed on the USER id, not the master row id: that is what the request stores
  // and what authorization and notification both resolve against.
  const recipientOptions = useMemo(
    () => s.activeResultRecipients.map((r) => ({ value: r.userId, label: r.name })),
    [s.activeResultRecipients],
  );

  useEffect(() => {
    if (open && request) {
      setComment(request.resultComment ?? "");
      setHandoverTo(request.resultHandoverToId ?? "");
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
    if (!handoverTo) {
      setErr("Please choose whom the result is handed over to.");
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
      const base = {
        resultComment: comment.trim(),
        resultHandoverToId: handoverTo,
        // Denormalised so the request still reads right if the user is later removed.
        resultHandoverToName: recipientOptions.find((o) => o.value === handoverTo)?.label ?? null,
      };
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

  const existing = request?.attachmentPath ? (
    <DocLink path={request.attachmentPath} name={request.attachmentName} />
  ) : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      readOnly={readOnly}
      readOnlyHeader={existing ?? undefined}
      size="xl"
      title={`${editing && !readOnly ? "Edit result received" : readOnly ? "Result received" : "Record result received"} — ${request?.reqNo ?? ""}`}
      // No subtitle: the recap below already shows the product / description.
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : editing ? "Save" : "Save & send for handover"}</Button>
        </>
      }
    >
      <div className="space-y-4">
        {request && <StepRecap request={request} />}

        <div>
          <SectionHeading>Result</SectionHeading>
          <div className="mt-3 space-y-3.5">
            <FieldLabel label="Result comment" required>
              <TextArea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="The result the party came back with" />
            </FieldLabel>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-3.5">
              <FieldLabel label="Result handover to" required hint="they are notified and can action the handover">
                <Combobox
                  value={handoverTo}
                  onChange={setHandoverTo}
                  options={recipientOptions}
                  placeholder={recipientOptions.length ? "Select a person" : "No recipients in the master yet"}
                  searchable={recipientOptions.length > 6}
                />
              </FieldLabel>
              <FieldLabel label="Attachment" hint={editing ? "choose a file to replace it" : "optional lab report"}>
                <input
                  ref={fileRef}
                  type="file"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-[12.5px] text-grey file:mr-3 file:rounded-lg file:border-0 file:bg-page file:px-3 file:py-1.5 file:text-[12.5px] file:font-semibold file:text-navy hover:file:bg-line"
                />
              </FieldLabel>
            </div>
            {editing && existing && <div className="text-[12px] text-grey-2">Current file: {existing}</div>}
          </div>
        </div>

        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Modal>
  );
}
