import { useEffect, useMemo, useRef, useState } from "react";
import { FileText } from "lucide-react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { FieldRow, SectionHeading } from "@/shared/components/ui/Readout";
import { useSession } from "@/core/platform/session";
import { useSamplingStore } from "../store";
import { uploadMachineDocument } from "../data/samplingWrites";
import { stepDateDefault, todayIso, futureDateError } from "../lib/format";
import StepRecap from "./StepRecap";
import type { SamplingRequest } from "../types";

/** Opens the stored machine testing report via a fresh short-lived signed URL. */
function MachineDocLink({ path, name }: { path: string; name: string | null }) {
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
      <span className="truncate">{busy ? "Opening…" : name || "View machine report"}</span>
    </button>
  );
}

/**
 * machine_process — the TWIN of LabProcessModal: ONE step, TWO passes, so ONE
 * modal with two faces.
 *
 *   pass 1 (machineStartedAt is null): only the tentative result date. Saving it
 *     says "machine testing has the sample" and leaves the request where it is —
 *     it is still this step's work.
 *   pass 2: the tick is the completion switch. Left off, saving still only moves
 *     the tentative date. Turned on, comments become required — mirrored by the
 *     RPC — and the request advances to machine_result. The report is OPTIONAL.
 *
 * Whom the result goes to defaults to whoever the LAB result went to (on a
 * lab+machine request), else the hand-over recipient, with a free-text option for
 * someone off-system (a `free:` sentinel, exactly as LabProcessModal does it). A
 * free-text name leaves machine_result_to_id null, which routes machine_result to
 * that step's owners instead.
 */
export default function MachineProcessModal({
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
  const [note, setNote] = useState("");           // one remark, shared by both passes
  const [done, setDone] = useState(false);
  const [completedDate, setCompletedDate] = useState("");
  const [comment, setComment] = useState("");
  const [pick, setPick] = useState("");           // a userId, selfId, or `free:<name>`
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const started = !!request?.machineStartedAt;
  const completed = !!request?.machineCompletedAt;

  useEffect(() => {
    if (open && request) {
      setTentative(request.machineTentativeDate ?? "");
      setNote(request.machineNote ?? "");
      setDone(!!request.machineCompletedAt);
      setCompletedDate(stepDateDefault(request.machineCompletedDate));
      setComment(request.machineComment ?? "");
      setPick(
        request.machineResultToId ||
          (request.machineResultToName
            ? `free:${request.machineResultToName}`
            : request.labResultToId || request.handoverRecipientId || selfId),
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
    // The person the lab result went to need not be in the recipient master.
    if (pick && !pick.startsWith("free:") && !opts.some((o) => o.value === pick)) {
      opts.push({ value: pick, label: s.personName(pick) });
    }
    return opts;
  }, [s, selfId, pick]);

  const existing = request?.machineDocPath ? (
    <MachineDocLink path={request.machineDocPath} name={request.machineDocName} />
  ) : null;

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
        const input = { machineTentativeDate: tentative, machineNote: note.trim() || null };
        if (started) await s.updateMachineStart(request, input);
        else await s.recordMachineStart(request, input);
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
      setErr("Test comments are required to complete machine testing.");
      return;
    }
    // The machine testing attachment is OPTIONAL, as the lab report is.
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
        const up = await uploadMachineDocument(request.id, file);
        attach = { docPath: up.path, docName: up.name };
      }

      let toId: string | null = null;
      let toName: string | null = null;
      if (pick.startsWith("free:")) {
        toName = pick.slice(5).trim() || null;
      } else {
        toId = pick;
        toName =
          pick === selfId
            ? session.user?.name ?? "Self"
            : s.activeRecipients.find((r) => r.userId === pick)?.name ?? s.personName(pick);
      }

      const base = {
        machineCompletedDate: completedDate || null,
        machineComment: comment.trim(),
        machineNote: note.trim() || null,
        machineResultToId: toId,
        machineResultToName: toName,
      };
      if (completed) {
        // Editing finished machine testing: also allow correcting the tentative date.
        await s.updateMachineComplete(request, { ...base, machineTentativeDate: tentative || null, ...attach });
      } else {
        await s.recordMachineComplete(request, {
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

  const heading =
    editing && !readOnly ? "Edit machine testing" : readOnly ? "Machine testing" : started ? "Machine testing" : "Sample for machine testing";
  const cta = busy ? "Saving…" : done ? (completed ? "Save" : "Complete machine testing") : started ? "Save" : "Save — sample with machine testing";

  return (
    <Modal
      open={open}
      onClose={onClose}
      readOnly={readOnly}
      readOnlyHeader={existing ?? undefined}
      size="xl"
      title={`${heading} — ${request?.reqNo ?? ""}`}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={busy}>{cta}</Button>
        </>
      }
    >
      <div className="space-y-4">
        {request && <StepRecap request={request} />}

        {/* What the lab already found, when this request came through the lab —
            machine testing reads it before it starts, so it belongs with the
            briefing rather than among this step's inputs. */}
        {request?.labComment && (
          <div className="rounded-xl bg-page px-4 py-3">
            <FieldRow label="Lab result" value={<span className="whitespace-pre-wrap">{request.labComment}</span>} />
          </div>
        )}

        <div>
          <SectionHeading>Machine testing</SectionHeading>
          <div className="mt-3 space-y-3.5">
            <FieldLabel
              label="Tentative result date"
              required
              hint={started ? "the date machine testing committed to" : "recording this confirms machine testing has the sample"}
            >
              {/* Deliberately NOT capped at today: this is a forecast. */}
              <TextInput type="date" value={tentative} onChange={(e) => setTentative(e.target.value)} />
            </FieldLabel>
            <FieldLabel label="Remarks" hint={done ? "optional — separate from the test comments below" : "optional"}>
              <TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything to note about the sample or the machine" />
            </FieldLabel>
          </div>
        </div>

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
              <div>
                <SectionHeading>Testing result</SectionHeading>
                <div className="mt-3 space-y-3.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-3.5">
                    <FieldLabel label="Testing completed on" hint="today by default — you can backdate, not post-date">
                      <TextInput type="date" max={todayIso()} value={completedDate} onChange={(e) => setCompletedDate(e.target.value)} />
                    </FieldLabel>
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
                  </div>
                  <FieldLabel label="Test comments" required>
                    <TextArea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="The outcome of the machine testing" />
                  </FieldLabel>
                  <FieldLabel
                    label="Machine testing attachment"
                    hint={request?.machineDocPath ? "optional — choose a file to replace it" : "optional — the machine testing report"}
                  >
                    <input
                      ref={fileRef}
                      type="file"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                      className="block w-full text-[12.5px] text-grey file:mr-3 file:rounded-lg file:border-0 file:bg-page file:px-3 file:py-1.5 file:text-[12.5px] file:font-semibold file:text-navy hover:file:bg-line"
                    />
                  </FieldLabel>
                  {existing && <div className="text-[12px] text-grey-2">Current file: {existing}</div>}
                </div>
              </div>
            )}
          </>
        )}

        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Modal>
  );
}
