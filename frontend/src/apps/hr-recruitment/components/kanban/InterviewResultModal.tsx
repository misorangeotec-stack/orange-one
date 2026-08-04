import { useMemo, useState } from "react";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { useHrStore } from "../../store";
import { uploadInterviewDoc } from "../../data/hrWrites";
import { BOARD_STAGES, STAGE_LABEL, STAGE_RANK } from "../../lib/board";
import PriorRounds from "./PriorRounds";
import type { Candidate, CandidateStage } from "../../types";

type Result = "selected" | "rejected" | "on_hold" | "no_show";

/** The stages a "selected" candidate may advance to — later interview rounds, or a decision. */
const ADVANCE_STAGES: CandidateStage[] = ["interview_1", "interview_2", "interview_3", "final_decision"];

/**
 * Record what actually HAPPENED in a round (0 = telephonic screen, 1–3 = interviews).
 * This is what closes it — booking the interview didn't.
 *
 * Because the rounds are optional, "Selected" no longer means "the very next round":
 * the recorder chooses where the card goes — a later round, or straight to Awaiting
 * Decision. Round 2 (online interviews) may also carry a meeting / recording link.
 *
 * LANDSCAPE, two columns, because every earlier round's result sits alongside the
 * form. Judging this round without seeing what the last interviewer wrote is how a
 * panel asks the same questions twice and misses the thing that was flagged. On a
 * narrow screen the columns stack, history first — it is context you read BEFORE
 * you decide, not a footnote.
 */
export default function InterviewResultModal({
  candidate,
  round,
  open,
  onClose,
}: {
  candidate: Candidate;
  round: 0 | 1 | 2 | 3;
  open: boolean;
  onClose: () => void;
}) {
  const s = useHrStore();
  const [result, setResult] = useState<Result>("selected");
  const [remarks, setRemarks] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Where a "selected" candidate can go: any interview stage still ahead, or the decision.
  const advanceOptions = useMemo<ComboOption[]>(
    () =>
      BOARD_STAGES.filter(
        (st) => ADVANCE_STAGES.includes(st) && STAGE_RANK[st] > STAGE_RANK[candidate.stage],
      ).map((st) => ({ value: st, label: STAGE_LABEL[st] })),
    [candidate.stage],
  );
  const [nextStage, setNextStage] = useState<CandidateStage>(
    (advanceOptions[0]?.value as CandidateStage) ?? "final_decision",
  );

  const roundLabel = round === 0 ? "Telephonic screen" : `Round ${round}`;

  /**
   * Landscape only when an earlier round was actually held. The telephonic screen
   * never has one, and a wide dialog with an empty second column reads as broken.
   */
  const showsHistory = useMemo(
    () => s.interviewsFor(candidate.id).some((iv) => iv.round < round && iv.heldAt),
    [s, candidate.id, round],
  );

  const choices: Array<{ key: Result; label: string; hint: string }> = [
    { key: "selected", label: "Selected", hint: "Advance them to the stage you pick below" },
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
      await s.recordInterviewResult(
        candidate,
        round,
        result,
        remarks.trim(),
        path,
        name,
        videoUrl.trim() || null,
        result === "selected" ? nextStage : null,
      );
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
      title={`${roundLabel} result — ${candidate.name}`}
      subtitle="What happened in the interview?"
      size={showsHistory ? "3xl" : "md"}
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
      {/* History first in the DOM so a stacked (mobile) layout reads it first; the
          md: order flips it to the right-hand column on a real screen. */}
      <div className={showsHistory ? "grid gap-5 md:grid-cols-2 md:gap-6" : undefined}>
        {showsHistory && (
          <section className="md:order-2 md:border-l md:border-line md:pl-6">
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-grey-2">What happened before</h3>
            <div className="mt-2.5">
              <PriorRounds candidateId={candidate.id} before={round} />
            </div>
          </section>
        )}

        <section className="space-y-3.5 md:order-1">
        <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-1">
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

        {result === "selected" && (
          <FieldLabel label="Move them to" hint="skip ahead if you like">
            <Combobox
              value={nextStage}
              onChange={(v) => setNextStage(v as CandidateStage)}
              options={advanceOptions}
              placeholder="Pick the next stage"
            />
          </FieldLabel>
        )}

        <FieldLabel label="Remarks" hint={result === "rejected" ? "shown as the reason they dropped" : "optional"}>
          <TextArea rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </FieldLabel>

        {/* Online interviews (most often Round 2) — a meeting or recording link. */}
        <FieldLabel label="Video link" hint="optional — for an online interview">
          <TextInput
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            placeholder="https://… (meeting or recording link)"
          />
        </FieldLabel>

        <FieldLabel label="Feedback form" hint="optional">
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-[13px] text-grey file:mr-3 file:rounded-lg file:border-0 file:bg-page file:px-3 file:py-2 file:text-[12.5px] file:font-semibold file:text-navy hover:file:bg-line/50"
          />
        </FieldLabel>

        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
        </section>
      </div>
    </Modal>
  );
}
