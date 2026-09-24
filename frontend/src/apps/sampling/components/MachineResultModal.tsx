import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { FieldRow, SectionHeading } from "@/shared/components/ui/Readout";
import { useSamplingStore } from "../store";
import { futureDateError, stepDateDefault, todayIso } from "../lib/format";
import StepRecap from "./StepRecap";
import type { SamplingRequest } from "../types";

/** Opens the machine testing report the result was handed over with. */
function MachineDocLink({ path, name }: { path: string; name: string | null }) {
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
      <span className="truncate">{busy ? "Opening…" : name || "View machine report"}</span>
    </button>
  );
}

/**
 * machine_result — the LAST step of the machine tail, and the twin of
 * ResultReceivedModal. Whoever machine testing handed the result to confirms they
 * have it, which closes the request. Being last, nothing downstream can lock it:
 * a closed request's receipt stays editable.
 */
export default function MachineResultModal({
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
      setReceivedDate(stepDateDefault(request.machineResultReceivedDate));
      setNote(request.machineResultReceivedNote ?? "");
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
      const input = {
        machineResultReceivedDate: receivedDate || null,
        machineResultReceivedNote: note.trim() || null,
      };
      if (editing) await s.updateMachineResultReceived(request, input);
      else await s.recordMachineResultReceived(request, input);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const report = request?.machineDocPath ? (
    <MachineDocLink path={request.machineDocPath} name={request.machineDocName} />
  ) : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      readOnly={readOnly}
      readOnlyHeader={report ?? undefined}
      size="xl"
      title={`${editing && !readOnly ? "Edit machine result receipt" : readOnly ? "Machine result received" : "Confirm machine result received"} — ${request?.reqNo ?? ""}`}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : editing ? "Save" : "Mark received & close"}</Button>
        </>
      }
    >
      <div className="space-y-4">
        {request && <StepRecap request={request} />}

        {/* What machine testing came back with — the thing this step is confirming
            receipt OF, so it sits with the briefing rather than among the inputs. */}
        {request?.machineComment && (
          <div className="rounded-xl bg-page px-4 py-3.5">
            <FieldRow label="Machine testing result" value={<span className="whitespace-pre-wrap">{request.machineComment}</span>} />
            {report && (
              <div className="mt-2">
                <FieldRow label="Machine report" value={report} />
              </div>
            )}
          </div>
        )}

        <div>
          <SectionHeading>Result receipt</SectionHeading>
          <div className="mt-3 space-y-3.5">
            <FieldLabel label="Date received" hint="today by default — you can backdate, not post-date">
              <TextInput type="date" max={todayIso()} value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
            </FieldLabel>
            <FieldLabel label="Remarks" hint="optional">
              <TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything to note about the result" />
            </FieldLabel>
          </div>
        </div>

        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Modal>
  );
}
