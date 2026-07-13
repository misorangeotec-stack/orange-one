import { useState } from "react";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import { useHrStore } from "../../store";
import { uploadInterviewDoc } from "../../data/hrWrites";
import type { Candidate } from "../../types";

type Result = "selected" | "rejected" | "on_hold" | "no_show";

/**
 * Record what actually HAPPENED in a round. This is what closes it — booking the
 * interview didn't.
 *
 * Keeping "scheduled" and "conducted" apart is the whole point: in the sheet they
 * were one column, so a candidate could sit "in Round 2" for three weeks and still
 * look on track. Now the round has a due date the moment it's booked, and only a
 * result clears it.
 */
export default function InterviewResultModal({
  candidate,
  round,
  open,
  onClose,
}: {
  candidate: Candidate;
  round: 1 | 2 | 3;
  open: boolean;
  onClose: () => void;
}) {
  const s = useHrStore();
  const [result, setResult] = useState<Result>("selected");
  const [remarks, setRemarks] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const choices: Array<{ key: Result; label: string; hint: string }> = [
    {
      key: "selected",
      label: "Selected",
      hint: round < 3 ? `Moves them straight to Round ${round + 1}` : "Moves them to Awaiting Decision",
    },
    { key: "rejected", label: "Rejected", hint: "They drop out of the pipeline" },
    { key: "on_hold", label: "On hold", hint: "Undecided — the card stays here" },
    { key: "no_show", label: "Didn't turn up", hint: "The card stays here" },
  ];

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      let path: string | null = null;
      let name: string | null = null;
      if (file) {
        const up = await uploadInterviewDoc(candidate.id, round, file);
        path = up.path;
        name = up.name;
      }
      await s.recordInterviewResult(candidate, round, result, remarks.trim(), path, name);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Round ${round} result — ${candidate.name}`}
      subtitle="What happened in the interview?"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={busy}>
            {busy ? "Saving…" : "Record result"}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <div className="grid gap-2">
          {choices.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setResult(c.key)}
              className={`rounded-xl border px-3.5 py-2.5 text-left transition ${
                result === c.key ? "border-orange bg-orange/5" : "border-line hover:border-grey-2/40"
              }`}
            >
              <div className="text-[13.5px] font-semibold text-navy">{c.label}</div>
              <div className="text-[12px] text-grey-2">{c.hint}</div>
            </button>
          ))}
        </div>

        <FieldLabel label="Remarks" hint={result === "rejected" ? "shown as the reason they dropped" : "optional"}>
          <TextArea rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </FieldLabel>

        <FieldLabel label="Feedback form" hint="optional">
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-[13px] text-grey file:mr-3 file:rounded-lg file:border-0 file:bg-page file:px-3 file:py-2 file:text-[12.5px] file:font-semibold file:text-navy hover:file:bg-line/50"
          />
        </FieldLabel>

        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Modal>
  );
}
