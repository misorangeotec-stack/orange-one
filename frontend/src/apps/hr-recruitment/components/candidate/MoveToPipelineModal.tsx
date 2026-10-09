import { useMemo, useState } from "react";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import { useHrStore } from "../../store";
import { STAGE_LABEL } from "../../lib/board";
import type { Candidate } from "../../types";

/**
 * Take a candidate out of the Future Reference bucket and put them on a pipeline.
 *
 * Their OWN vacancy (while it is still open) → back to the stage they were parked at.
 * Any other POSTED vacancy → the same candidate moves there and starts at Resumes
 * Uploaded. Same rules as fms_hr_move_to_pipeline; the server re-checks every one.
 *
 * Someone with interview history can only go back to their own vacancy: interviews
 * hang off the candidate, and would follow them onto a new board as if held there.
 */
export default function MoveToPipelineModal({
  candidate: c,
  open,
  onClose,
  onDone,
}: {
  candidate: Candidate;
  open: boolean;
  onClose: () => void;
  onDone?: (requisitionId: string) => void;
}) {
  const s = useHrStore();
  const own = s.requisitionById(c.requisitionId);
  const ownOpen = !!own && !["closed", "cancelled", "rejected"].includes(own.status);
  const hasInterviews = s.interviewsFor(c.id).length > 0;

  const departmentName = (id: string | null | undefined) =>
    s.departments.find((d) => d.id === id)?.name ?? undefined;

  const options: ComboOption[] = useMemo(() => {
    const out: ComboOption[] = [];
    if (own && ownOpen) {
      out.push({
        value: own.id,
        label: `${own.jobTitle} · ${own.mrfNo}`,
        sublabel: `Their vacancy — back to ${STAGE_LABEL[c.stage]}`,
        group: "Their own vacancy",
      });
    }
    if (!hasInterviews) {
      for (const r of s.requisitions) {
        if (r.id === c.requisitionId || r.status !== "sourcing") continue;
        out.push({
          value: r.id,
          label: `${r.jobTitle} · ${r.mrfNo}`,
          sublabel: departmentName(r.departmentId),
          group: "Other open vacancies",
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, c, own, ownOpen, hasInterviews]);

  const [target, setTarget] = useState<string>(ownOpen && own ? own.id : "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const sameVacancy = target === c.requisitionId;

  const submit = async () => {
    if (!target) return;
    setBusy(true);
    setErr(null);
    try {
      await s.moveToPipeline(c.id, target, note.trim() || undefined);
      onClose();
      onDone?.(target);
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
      size="md"
      title="Move to pipeline"
      subtitle={c.name}
      footer={
        <div className="flex items-center justify-end gap-2">
          {err && <span className="mr-auto text-[12.5px] text-ryg-red">{err}</span>}
          <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={busy || !target}>
            {busy ? "Moving…" : "Move to pipeline"}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <FieldLabel label="Which vacancy?" required>
          <Combobox value={target} onChange={setTarget} options={options} placeholder="Pick a vacancy" />
        </FieldLabel>

        {options.length === 0 && (
          <p className="rounded-lg bg-orange-soft px-3 py-2 text-[12px] leading-snug text-navy">
            No vacancy can take them right now. Their own vacancy is {own?.status ?? "missing"}, and{" "}
            {hasInterviews
              ? "because they have interview history there, they cannot be moved to a different one."
              : "no other vacancy is posted yet."}
          </p>
        )}

        {target && (
          <p className="text-[12.5px] leading-snug text-grey-2">
            {sameVacancy ? (
              <>
                They go back onto this vacancy's board at{" "}
                <strong className="font-semibold text-navy">{STAGE_LABEL[c.stage]}</strong>, where they were when they
                were moved out.
              </>
            ) : (
              <>
                They move to the new vacancy and start at{" "}
                <strong className="font-semibold text-navy">Resumes Uploaded</strong>. Their CV, details and discussion
                come with them.
              </>
            )}
          </p>
        )}

        {hasInterviews && ownOpen && (
          <p className="text-[11.5px] leading-snug text-grey-2">
            Only their own vacancy is offered: they have interview history on it.
          </p>
        )}

        <FieldLabel label="Note (optional)">
          <TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </FieldLabel>
      </div>
    </Modal>
  );
}
