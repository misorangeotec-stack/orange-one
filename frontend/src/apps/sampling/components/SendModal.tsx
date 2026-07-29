import { useEffect, useRef, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import { SectionHeading } from "@/shared/components/ui/Readout";
import SampleSummary from "./SampleSummary";
import DocLink from "./DocLink";
import { useSamplingStore } from "../store";
import { uploadSendDocument } from "../data/samplingWrites";
import { futureDateError, stepDateDefault, todayIso, totalSampleQty } from "../lib/format";
import type { SamplingRequest } from "../types";

/**
 * Record (or correct) the date an outward sample was DISPATCHED. Advances the
 * request to receipt confirmation. `editing` corrects it until the receipt is
 * confirmed; the server re-checks that lock.
 *
 * Opens with the FULL recap: the dispatcher is packing this sample and addressing
 * it, so our company, the receiving company's contact person, number and address,
 * and the colour/quantity list all have to be on screen while they work. The gate
 * outward entry no. comes LAST because it is stamped at the gate, after everything
 * else is known.
 *
 * "Quantity sent" PRE-FILLS with the recap's total, because in the ordinary case
 * what goes out is exactly what was asked for and retyping it is pure friction.
 * It stays an editable free-text box: a short shipment is a real thing, and the
 * dispatcher must be able to record what ACTUALLY went.
 *
 * THE GATE PASS IS MANDATORY ON A NEW DISPATCH, and so is the gate entry no. — a
 * sample that left the premises has both. On an EDIT the attachment is
 * grandfathered: dispatches recorded before it existed have none, and an edit's
 * job is to correct a date, not to strand a live request behind a document hunt.
 * The server enforces exactly the same asymmetry.
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
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && request) {
      setSentDate(stepDateDefault(request.sentDate));
      setGateEntryNo(request.gateEntryNo ?? "");
      // `??`, not `||`: a fresh dispatch has no stored quantity and takes the
      // request's total; an edit or a read-only view keeps what was recorded,
      // even where that deliberately differs from the total.
      setSentQty(request.sentQty ?? totalSampleQty(request).text);
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
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
    if (!gateEntryNo.trim()) {
      setErr("The gate outward entry no. is required.");
      return;
    }
    // Required on a new dispatch; grandfathered on an edit of one recorded before
    // the attachment existed. "Must END UP with one" — same test LabProcessModal uses.
    if (!file && !request.sendDocPath) {
      setErr("A gate-pass attachment is required.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      let attach: { docPath?: string | null; docName?: string | null } = {};
      if (file) {
        const up = await uploadSendDocument(request.id, file);
        attach = { docPath: up.path, docName: up.name };
      }
      // On create, always pass the attachment keys (a fresh row has none). On edit,
      // pass them only when a new file replaces — an absent key keeps the current one.
      const base = {
        sentDate: sentDate || null,
        gateEntryNo: gateEntryNo.trim() || null,
        sentQty: sentQty.trim() || null,
      };
      if (editing) {
        await s.updateSend(request, { ...base, ...attach });
      } else {
        await s.recordSend(request, { ...base, docPath: attach.docPath ?? null, docName: attach.docName ?? null });
      }
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const existing = request?.sendDocPath ? (
    <DocLink path={request.sendDocPath} name={request.sendDocName} fallback="View gate pass" />
  ) : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      readOnly={readOnly}
      // Outside the body: `readOnly` wraps the children in a disabled fieldset,
      // which would make this button inert exactly when it is most wanted.
      readOnlyHeader={existing ?? undefined}
      size="xl"
      title={`${editing && !readOnly ? "Edit sample dispatch" : "Sample sent"} — ${request?.reqNo ?? ""}`}
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
          <FieldLabel label="Date sent" hint="today by default — you can backdate, not post-date">
            <TextInput type="date" max={todayIso()} value={sentDate} onChange={(e) => setSentDate(e.target.value)} />
          </FieldLabel>
          <FieldLabel label="Quantity sent" hint="totalled from the list above — change it if what went out differs">
            <TextInput value={sentQty} onChange={(e) => setSentQty(e.target.value)} placeholder="e.g. 500 ml" />
          </FieldLabel>
          <FieldLabel label="Gate outward entry no." required>
            <TextInput value={gateEntryNo} onChange={(e) => setGateEntryNo(e.target.value)} placeholder="e.g. GT/2627/118" />
          </FieldLabel>
        </div>

        <div>
          <SectionHeading>Gate pass</SectionHeading>
          <div className="mt-3">
            <FieldLabel
              label="Attachment"
              required={!request?.sendDocPath}
              hint={request?.sendDocPath ? "choose a file to replace it" : "the signed gate pass / dispatch document"}
            >
              <input
                ref={fileRef}
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-[12.5px] text-grey file:mr-3 file:rounded-lg file:border-0 file:bg-page file:px-3 file:py-1.5 file:text-[12.5px] file:font-semibold file:text-navy hover:file:bg-line"
              />
            </FieldLabel>
            {existing && <div className="mt-2 text-[12px] text-grey-2">Current file: {existing}</div>}
          </div>
        </div>

        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Modal>
  );
}
