import { useEffect, useMemo, useRef, useState } from "react";
import { FileText } from "lucide-react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { useSession } from "@/core/platform/session";
import { useSamplingStore } from "../store";
import { uploadLabDocument } from "../data/samplingWrites";
import { futureDateError, stepDateDefault, todayIso } from "../lib/format";
import SampleSummary from "./SampleSummary";
import type { SamplingRequest } from "../types";

/** Opens the stored lab report via a fresh short-lived signed URL. */
function LabDocLink({ path, name }: { path: string; name: string | null }) {
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
      <span className="truncate">{busy ? "Opening…" : name || "View lab report"}</span>
    </button>
  );
}

/**
 * lab_process — ONE step, TWO passes, so ONE modal with two faces.
 *
 *   pass 1 (labStartedAt is null): only the tentative result date. Saving it says
 *     "the lab has the sample" and leaves the request exactly where it is — it is
 *     still this step's work.
 *   pass 2: the tick is the completion switch. Left off, saving still only moves
 *     the tentative date. Turned on, comments AND a lab report become required —
 *     mirrored by the RPC, which raises on either — and the request advances to
 *     result_received.
 *
 * Whom the result goes to defaults to the recipient chosen on the request form,
 * with a free-text option for someone off-system (a `free:` sentinel, exactly as
 * CollectModal does it). A free-text name leaves lab_result_to_id null, which
 * routes result_received to that step's owners instead.
 */
export default function LabProcessModal({
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
  const session = useSession();
  const selfId = session.user?.id ?? "";

  const [tentative, setTentative] = useState("");
  const [done, setDone] = useState(false);
  const [completedDate, setCompletedDate] = useState("");
  const [comment, setComment] = useState("");
  const [pick, setPick] = useState("");           // a userId, selfId, or `free:<name>`
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Pass 2 is reached either by having already completed it (an edit) or by ticking.
  const started = !!request?.labStartedAt;
  const completed = !!request?.labCompletedAt;

  useEffect(() => {
    if (open && request) {
      setTentative(request.labTentativeDate ?? "");
      setDone(!!request.labCompletedAt);
      setCompletedDate(stepDateDefault(request.labCompletedDate));
      setComment(request.labComment ?? "");
      setPick(
        request.labResultToId ||
          (request.labResultToName ? `free:${request.labResultToName}` : request.handoverRecipientId || selfId),
      );
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      setErr(null);
      setBusy(false);
    }
  }, [open, request, selfId]);

  const options: ComboOption[] = useMemo(() => {
    const opts: ComboOption[] = [
      ...(selfId ? [{ value: selfId, label: "Self (me)" }] : []),
      ...s.activeRecipients.filter((r) => r.userId !== selfId).map((r) => ({ value: r.userId, label: r.name })),
    ];
    if (pick.startsWith("free:")) opts.push({ value: pick, label: pick.slice(5) });
    return opts;
  }, [s.activeRecipients, selfId, pick]);

  const existing = request?.labDocPath ? <LabDocLink path={request.labDocPath} name={request.labDocName} /> : null;

  const save = async () => {
    if (!request) return;
    setErr(null);

    // ---- pass 1: just the tentative date ----------------------------------
    if (!done) {
      if (!tentative) {
        setErr("A tentative result date is required.");
        return;
      }
      setBusy(true);
      try {
        const input = { labTentativeDate: tentative };
        if (started) await s.updateLabStart(request, input);
        else await s.recordLabStart(request, input);
        onClose();
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setBusy(false);
      }
      return;
    }

    // ---- pass 2: completion -----------------------------------------------
    if (!comment.trim()) {
      setErr("Test comments are required to complete the lab process.");
      return;
    }
    if (!file && !request.labDocPath) {
      setErr("A lab testing attachment is required to complete the lab process.");
      return;
    }
    if (!pick.trim()) {
      setErr("Record whom the result is handed over to.");
      return;
    }
    const bad = futureDateError(completedDate, "Testing completed on");
    if (bad) {
      setErr(bad);
      return;
    }

    setBusy(true);
    try {
      let attach: { docPath?: string | null; docName?: string | null } = {};
      if (file) {
        const up = await uploadLabDocument(request.id, file);
        attach = { docPath: up.path, docName: up.name };
      }

      let toId: string | null = null;
      let toName: string | null = null;
      if (pick.startsWith("free:")) {
        toName = pick.slice(5).trim() || null;
      } else {
        toId = pick;
        toName =
          pick === selfId ? session.user?.name ?? "Self" : s.activeRecipients.find((r) => r.userId === pick)?.name ?? null;
      }

      const base = {
        labCompletedDate: completedDate || null,
        labComment: comment.trim(),
        labResultToId: toId,
        labResultToName: toName,
      };
      if (completed) {
        // Editing a finished lab process: also allow correcting the tentative date.
        await s.updateLabComplete(request, { ...base, labTentativeDate: tentative || null, ...attach });
      } else {
        await s.recordLabComplete(request, {
          ...base,
          docPath: attach.docPath ?? null,
          docName: attach.docName ?? null,
        });
      }
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const heading = editing && !readOnly ? "Edit lab process" : readOnly ? "Lab process" : started ? "Lab process" : "Sample at the lab";
  const cta = busy ? "Saving…" : done ? (completed ? "Save" : "Complete lab process") : started ? "Save" : "Save — sample at lab";

  return (
    <Modal
      open={open}
      onClose={onClose}
      readOnly={readOnly}
      readOnlyHeader={existing ?? undefined}
      size="xl"
      // No subtitle: SampleSummary below already shows the product / description.
      title={`${heading} — ${request?.reqNo ?? ""}`}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={busy}>{cta}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {request && <SampleSummary request={request} />}

        {request?.internalRef && (
          <div className="rounded-xl bg-page px-4 py-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">Internal reference</span>
            <div className="text-[13.5px] text-navy">{request.internalRef}</div>
          </div>
        )}

        <FieldLabel
          label="Tentative result date from lab"
          required
          hint={started ? "the date the lab committed to" : "recording this confirms the lab has the sample"}
        >
          {/* Deliberately NOT capped at today: this is a forecast. */}
          <TextInput type="date" value={tentative} onChange={(e) => setTentative(e.target.value)} />
        </FieldLabel>

        {started && (
          <>
            <label className="flex items-center gap-2.5 rounded-xl bg-page px-4 py-3 cursor-pointer">
              <input
                type="checkbox"
                checked={done}
                onChange={(e) => setDone(e.target.checked)}
                className="w-4 h-4 accent-orange"
              />
              <span className="text-[13.5px] font-semibold text-navy">Testing is complete</span>
              <span className="text-[12px] text-grey-2">— tick to record the result and close this step</span>
            </label>

            {done && (
              <>
                <FieldLabel label="Testing completed on" hint="today by default — you can backdate, not post-date">
                  <TextInput type="date" max={todayIso()} value={completedDate} onChange={(e) => setCompletedDate(e.target.value)} />
                </FieldLabel>
                <FieldLabel label="Test comments" required>
                  <TextArea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="The outcome of the lab testing" />
                </FieldLabel>
                <FieldLabel
                  label="Lab testing attachment"
                  required
                  hint={request?.labDocPath ? "choose a file to replace it" : "the lab report"}
                >
                  <input
                    ref={fileRef}
                    type="file"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    className="block w-full text-[12.5px] text-grey file:mr-3 file:rounded-lg file:border-0 file:bg-page file:px-3 file:py-1.5 file:text-[12.5px] file:font-semibold file:text-navy hover:file:bg-line"
                  />
                </FieldLabel>
                {existing && <div className="text-[12px] text-grey-2">Current file: {existing}</div>}
                <FieldLabel label="Result handed over to" required hint="pick a person, or type a name not in the list">
                  <Combobox
                    value={pick}
                    onChange={setPick}
                    options={options}
                    placeholder="Select or type a name"
                    searchable
                    onCreate={(name) => {
                      const v = `free:${name}`;
                      setPick(v);
                      return v;
                    }}
                    createLabel={(q) => `Hand to “${q}”`}
                  />
                </FieldLabel>
              </>
            )}
          </>
        )}

        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Modal>
  );
}
