import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import FileCapture from "@/shared/components/ui/FileCapture";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { useSession } from "@/core/platform/session";
import { cn } from "@/shared/lib/cn";
import { deleteDoc, FLOW_QUERY, submitTest, type FlowData, type FlowTest, type LabResult } from "../lib/flow";
import { DocList, StatusPill, TestFacts, Trail } from "./FlowParts";

/**
 * STEP 2 · PLANT — open one test, record the lab's verdict and submit it.
 *
 * APPROVED closes the test on the spot; REJECTED goes to Management (20270113120000).
 *
 * Approve / Reject, the lab person and remarks are required; an attachment is optional.
 * The lab person pre-fills with whoever is logged in, but stays editable — the tech who ran
 * the test is often not the person entering it. The Plant can reopen and change a
 * submitted test until Management closes it; a closed test is read-only.
 */
export default function PlantTestModal({
  test, flow, canAct, onClose,
}: {
  test: FlowTest | null;
  flow: FlowData | undefined;
  canAct: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { user } = useSession();
  const [result, setResult] = useState<LabResult | null>(null);
  const [labPerson, setLabPerson] = useState("");
  const [remarks, setRemarks] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [picker, setPicker] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setResult(test?.record?.result ?? null);
    setLabPerson(test?.record?.labPerson ?? user.name ?? "");
    setRemarks(test?.record?.plantRemarks ?? "");
    setFiles([]);
    setPicker(null);
    setErr(null);
  }, [test?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // FileCapture holds ONE file; each pick is moved into the list so several can be attached.
  useEffect(() => {
    if (picker) {
      setFiles((f) => [...f, picker]);
      setPicker(null);
    }
  }, [picker]);

  if (!test) return null;
  const rec = test.record;
  const docs = rec ? flow?.docs.get(rec.id) ?? [] : [];
  const trail = rec ? flow?.activity.get(rec.id) ?? [] : [];
  const editable = canAct && test.status !== "closed";

  const submit = async () => {
    setErr(null);
    if (!result) return setErr("Choose Approve or Reject.");
    if (!labPerson.trim()) return setErr("Enter the lab person.");
    if (!remarks.trim()) return setErr("Write the remarks first.");
    setBusy(true);
    try {
      await submitTest(test, { result, labPerson: labPerson.trim(), remarks: remarks.trim() }, files);
      await qc.invalidateQueries({ queryKey: FLOW_QUERY });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
      await qc.invalidateQueries({ queryKey: FLOW_QUERY });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="2xl"
      title={`Test ${test.no} · ${test.lot.item}`}
      subtitle={`Lot ${test.lot.lot} — due ${test.due.split("-").reverse().join("-")}`}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <div className="text-[12.5px] text-ryg-red">{err}</div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            {editable && (
              <Button onClick={submit} disabled={busy}>
                {busy ? "Submitting…"
                  : result === "approved" ? "Submit & close"
                  : test.status === "submitted" ? "Update submission" : "Submit to Management"}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2"><StatusPill status={test.status} /></div>
        <TestFacts t={test} />

        {test.status === "returned" && rec?.reviewRemarks && (
          <div className="rounded-lg border border-ryg-red/30 bg-ryg-red/5 p-3 text-[13px]">
            <div className="font-semibold text-ryg-red">Sent back by Management</div>
            <div className="whitespace-pre-wrap text-ink">{rec.reviewRemarks}</div>
          </div>
        )}

        <div>
          <div className="mb-1.5 text-[12.5px] font-semibold text-ink">Lab result <span className="text-ryg-red">*</span></div>
          <div className="grid grid-cols-2 gap-3">
            {([
              ["approved", "Approve", "border-ryg-green bg-ryg-green/10 text-ryg-green"],
              ["rejected", "Reject", "border-ryg-red bg-ryg-red/10 text-ryg-red"],
            ] as const).map(([value, label, on]) => (
              <button
                key={value}
                type="button"
                disabled={!editable}
                onClick={() => setResult(value)}
                aria-pressed={result === value}
                className={cn(
                  "h-11 rounded-button border text-[14px] font-semibold transition disabled:cursor-default",
                  result === value ? on : "border-line text-grey hover:border-navy/40 hover:text-navy",
                )}
              >
                {value === "approved" ? "✓ " : "✕ "}{label}
              </button>
            ))}
          </div>
        </div>

        {editable && result && (
          <div className={cn("rounded-lg px-3 py-2 text-[12.5px]",
            result === "approved" ? "bg-ryg-green/10 text-ryg-green" : "bg-ryg-red/10 text-ryg-red")}>
            {result === "approved"
              ? "Approved tests close as soon as you submit — they do not go to Management."
              : "Rejected tests go to Management review, who close it or hand it to someone to audit."}
          </div>
        )}

        <FieldLabel label="Lab person" required hint="Who ran the test.">
          <TextInput value={labPerson} onChange={(e) => setLabPerson(e.target.value)} readOnly={!editable} placeholder="Name of the lab person" />
        </FieldLabel>

        <FieldLabel label="Remarks" required>
          <TextArea
            rows={4}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            readOnly={!editable}
            placeholder="Test observations — viscosity, pH, settling, print result, pass / fail…"
          />
        </FieldLabel>

        <div>
          <div className="mb-1.5 text-[12.5px] font-semibold text-ink">Attachments <span className="font-normal text-grey">(optional)</span></div>
          <DocList
            docs={docs}
            onDelete={editable ? async (d) => { await deleteDoc(d.id); await qc.invalidateQueries({ queryKey: FLOW_QUERY }); } : undefined}
          />
          {files.length > 0 && (
            <div className="mt-2 space-y-1">
              {files.map((f, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg border border-dashed border-orange/50 px-3 py-1.5 text-[12.5px]">
                  <span className="truncate">{f.name} <span className="text-grey">— will upload on submit</span></span>
                  <button className="text-grey hover:text-ryg-red" onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}>Remove</button>
                </div>
              ))}
            </div>
          )}
          {editable && <FileCapture value={picker} onChange={setPicker} className="mt-2" />}
        </div>

        {trail.length > 0 && (
          <div>
            <div className="mb-1.5 text-[12.5px] font-semibold text-ink">History</div>
            <Trail items={trail} />
          </div>
        )}
        {!canAct && (
          <div className="text-[12px] text-grey">You can view this test. Only the Plant step owners can submit it.</div>
        )}
      </div>
    </Modal>
  );
}
