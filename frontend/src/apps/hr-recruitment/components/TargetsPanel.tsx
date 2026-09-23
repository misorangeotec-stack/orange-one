import { useState } from "react";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import Modal from "@/shared/components/ui/Modal";
import { SectionHeading } from "@/shared/components/ui/Readout";
import { formatDateDMY } from "@/shared/lib/date";
import { todayIso } from "@/shared/lib/time";
import { useHrStore } from "../store";
import { CLOCK_LABEL, outOf, targetProgress, type TargetProgress } from "../lib/targets";
import { TargetsFields, draftComplete, draftFrom, numberOf, type TargetsDraft } from "./TargetsFields";
import type { Requisition } from "../types";

/** One bar: what was asked for, what happened, and whether that is enough. */
function Line({
  label,
  value,
  met,
  note,
}: {
  label: string;
  value: string;
  /** null = no target was set, which is neither pass nor fail. */
  met: boolean | null;
  note?: string;
}) {
  const tone =
    met === null ? "text-grey-2" : met ? "text-ryg-green" : "text-ryg-red";
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-[13px] text-grey-2 shrink-0">{label}</span>
      <span className="flex items-baseline gap-2 min-w-0 text-right">
        {note && <span className="text-[11.5px] text-grey-2 truncate">{note}</span>}
        <span className={`text-[13.5px] font-semibold tabular-nums ${tone}`}>{value}</span>
      </span>
    </div>
  );
}

/**
 * NR-7 — the four numbers on one position, and how the hunt is doing against
 * them.
 *
 * Shown from the moment a requisition is approved. When nobody has set the
 * numbers it says so plainly and offers the button: "not set" is a real state,
 * and the 24 positions that were open before NR-7 all start there.
 */
export function TargetsCard({ requisition }: { requisition: Requisition }) {
  const s = useHrStore();
  const [open, setOpen] = useState(false);

  const candidates = s.candidatesFor(requisition.id);
  const onboardings = candidates
    .map((c) => s.onboardingForCandidate(c.id))
    .filter((o): o is NonNullable<typeof o> => !!o);

  const p: TargetProgress = targetProgress(
    requisition,
    candidates,
    s.interviews,
    onboardings,
    todayIso(),
  );

  const clockValue =
    p.clock === "not-set"
      ? "—"
      : p.clock === "not-started"
        ? `${requisition.targetCloseDays} days, once posted`
        : p.stopIso
          ? `${p.daysUsed} of ${requisition.targetCloseDays} days`
          : `${p.daysUsed} of ${requisition.targetCloseDays} days used`;

  // ⚠ Keyed on whether the clock actually STOPPED, not on the state: a position
  // whose period ran out while it is still hunting is "missed" with no stop date,
  // and reading the state first printed "offer accepted —" on a vacancy where no
  // offer exists.
  const clockNote = p.stopIso
    ? `offer accepted ${formatDateDMY(p.stopIso)}`
    : p.dueIso && p.daysLeft != null
      ? p.daysLeft >= 0
        ? `${p.daysLeft} left · due ${formatDateDMY(p.dueIso)}`
        : `${Math.abs(p.daysLeft)} over · was due ${formatDateDMY(p.dueIso)}`
      : undefined;

  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <SectionHeading>Targets</SectionHeading>
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
          {p.hasTargets ? "Edit" : "Set targets"}
        </Button>
      </div>

      {!p.hasTargets && (
        <p className="text-[12.5px] text-grey-2 leading-relaxed">
          Nobody has set the numbers for this position yet. The two bars below still apply — they
          default to 3 — but there is no closure period and no CV target to measure against.
        </p>
      )}

      <div className="divide-y divide-line">
        <Line
          label={CLOCK_LABEL[p.clock]}
          value={clockValue}
          met={p.closedInTime ?? (p.clock === "missed" ? false : null)}
          note={clockNote}
        />
        <Line
          label="New CVs"
          value={outOf(p.newCvs, p.cvTarget)}
          met={p.cvMet}
          note={
            p.repeatCvs > 0
              ? `${p.repeatCvs} repeat${p.repeatCvs === 1 ? "" : "s"} not counted`
              : undefined
          }
        />
        <Line
          label="Shortlisted to the HOD"
          value={outOf(p.shortlisted, p.shortlistTarget)}
          met={p.shortlistMet}
        />
        <Line
          label="Reached the directors"
          value={outOf(p.director, p.directorTarget)}
          met={p.directorMet}
        />
      </div>

      {p.startIso && (
        <p className="text-[11.5px] text-grey-2">
          Counting from {formatDateDMY(p.startIso)}, the day the job was posted.
        </p>
      )}

      <TargetsModal requisition={requisition} open={open} onClose={() => setOpen(false)} />
    </Card>
  );
}

/**
 * Set the numbers on a position that is already approved.
 *
 * The approval dialog asks for them once; this is the way back in — and the only
 * way for the positions that were already open when NR-7 shipped.
 */
export function TargetsModal({
  requisition,
  open,
  onClose,
}: {
  requisition: Requisition;
  open: boolean;
  onClose: () => void;
}) {
  const s = useHrStore();
  const [draft, setDraft] = useState<TargetsDraft>(() => draftFrom(requisition));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await s.setRequisitionTargets(requisition.id, {
        targetCloseDays: numberOf(draft.days),
        cvTarget: numberOf(draft.cvs),
        shortlistTarget: numberOf(draft.shortlist),
        directorCvTarget: numberOf(draft.director),
      });
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
      title={`Targets — ${requisition.mrfNo}`}
      subtitle={requisition.jobTitle}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={busy || !draftComplete(draft)}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <TargetsFields draft={draft} onChange={setDraft} heading={null} />
        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Modal>
  );
}
