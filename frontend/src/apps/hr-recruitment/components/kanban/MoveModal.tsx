import { useMemo, useState } from "react";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { todayIso } from "@/shared/lib/time";
import { interviewerPool, interviewerOptions } from "../../lib/interviewers";
import RequestMasterModal from "../RequestMasterModal";
import { useHrStore } from "../../store";
import { STAGE_LABEL, roundOf } from "../../lib/board";
import type { MovePayload } from "../../data/hrWrites";
import type { Candidate, CandidateStage } from "../../types";

/**
 * Every board move opens this. That is deliberate: a move always MEANS something —
 * booking an interview needs an interviewer, disqualifying needs a reason,
 * finalising needs the agreed salary. Nothing about a card changes silently.
 *
 * It is also what lets the board work without a drag-and-drop library: the drag is
 * only a trigger for this dialog, never the commit.
 */
export default function MoveModal({
  candidate,
  toStage,
  open,
  onClose,
}: {
  candidate: Candidate;
  toStage: CandidateStage;
  open: boolean;
  onClose: () => void;
}) {
  const s = useHrStore();
  const req = s.requisitionById(candidate.requisitionId);

  const round = roundOf(toStage);
  const isInterview = round !== null;
  const isDisqualify = toStage === "disqualified";
  const isFinalize = toStage === "finalized";
  const isDecision = toStage === "final_decision";
  const isBackward = false; // the caller only offers legal targets; the RPC re-checks

  const [interviewerId, setInterviewerId] = useState("");
  const [interviewerName, setInterviewerName] = useState("");
  const [scheduledOn, setScheduledOn] = useState(todayIso());
  const [reasonId, setReasonId] = useState("");
  /** Reason not in the master? Raise it for review without losing this form. */
  const [raiseReason, setRaiseReason] = useState<string | null>(null);
  const [requested, setRequested] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [ctc, setCtc] = useState("");
  const [decisionRemarks, setDecisionRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // A telephonic screen is round 0, so test against null — `round ? …` would skip it.
  const roundLabel = round === 0 ? "the telephonic screen" : `Round ${round}`;
  // Each round is offered only the people who actually take it — see lib/interviewers.ts.
  const pool = useMemo(
    () => (round !== null ? interviewerPool(round, s.profiles, s.departments, req) : null),
    [round, s.profiles, s.departments, req],
  );
  const people: ComboOption[] = useMemo(() => (pool ? interviewerOptions(pool.people) : []), [pool]);
  const reasons: ComboOption[] = useMemo(
    () => s.disqualificationReasons.filter((r) => r.active).map((r) => ({ value: r.id, label: r.name })),
    [s.disqualificationReasons],
  );

  // Seats already taken on this requisition — you cannot hire more than were asked for.
  const taken = s.candidatesFor(candidate.requisitionId).filter((c) => c.stage === "finalized").length;
  const seats = req?.positionsRequired ?? 1;
  const seatsFull = isFinalize && taken >= seats;

  // The offered salary against the range on the MRF. A warning, not a block —
  // going over the band is a real decision, it just shouldn't be an invisible one.
  const ctcNum = ctc.trim() === "" ? null : Number(ctc.replace(/[^\d.]/g, ""));
  const overRange =
    isFinalize && ctcNum !== null && req?.salaryMax !== null && req?.salaryMax !== undefined && ctcNum > req.salaryMax;
  const underRange =
    isFinalize && ctcNum !== null && req?.salaryMin !== null && req?.salaryMin !== undefined && ctcNum < req.salaryMin;

  const invalid =
    (isInterview && !interviewerId && !interviewerName.trim()) ||
    // An un-dated booking is not a booking: with no date the round falls into "no date"
    // and quietly leaves every overdue count while still being someone's work.
    (isInterview && !scheduledOn) ||
    (isDisqualify && !reasonId) ||
    seatsFull;

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const payload: MovePayload = {};
      if (isInterview) {
        payload.interviewerId = interviewerId || null;
        payload.interviewerName = interviewerId ? null : interviewerName.trim() || null;
        payload.scheduledOn = scheduledOn || null;
      }
      if (isDisqualify) {
        payload.disqualificationReasonId = reasonId || null;
        payload.disqualificationNote = note.trim() || null;
      }
      if (isFinalize) payload.offeredCtc = ctcNum;
      if (isFinalize || isDecision) payload.decisionRemarks = decisionRemarks.trim() || null;

      await s.moveCandidate(candidate, toStage, payload);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const subtitle = isInterview
    ? "Booking the interview — not recording it. You'll record the result once it's actually happened."
    : isFinalize
      ? "This person is selected and their onboarding starts next. The seat is only truly filled once they actually join."
      : isDisqualify
        ? "They drop out of the pipeline. The reason is what tells you where the pipeline leaks."
        : `${candidate.name} moves to ${STAGE_LABEL[toStage]}.`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${candidate.name} → ${STAGE_LABEL[toStage]}`}
      subtitle={subtitle}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={busy || invalid}>
            {busy ? "Saving…" : "Confirm"}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {isInterview && (
          <>
            <FieldLabel
              label={`Who is taking ${roundLabel}?`}
              required
              hint={pool?.restricted ? pool.hint : undefined}
            >
              <Combobox
                value={interviewerId}
                onChange={(v) => {
                  setInterviewerId(v);
                  if (v) setInterviewerName("");
                }}
                options={people}
                placeholder="Pick a person"
                searchable
              />
              {pool && !pool.restricted && (
                <span className="mt-1.5 block text-[11.5px] leading-snug text-grey">{pool.fallbackNote}</span>
              )}
              <TextInput
                className="mt-2"
                value={interviewerName}
                onChange={(e) => {
                  setInterviewerName(e.target.value);
                  if (e.target.value) setInterviewerId("");
                }}
                placeholder="Or type a name — an external consultant, say"
              />
            </FieldLabel>
            <FieldLabel label="Interview date" required>
              <TextInput type="date" value={scheduledOn} onChange={(e) => setScheduledOn(e.target.value)} />
            </FieldLabel>
          </>
        )}

        {isDisqualify && (
          <>
            <FieldLabel label="Reason" required>
              <Combobox
                value={reasonId}
                onChange={setReasonId}
                options={reasons}
                placeholder="Why are they dropping out?"
                onCreate={(name) => setRaiseReason(name)}
                createLabel={(q) => `Request new reason “${q}”`}
              />
              <span className="mt-1 block text-[11px] leading-snug text-grey-2">
                {requested
                  ? `Requested reason “${requested}” — selectable once the master's owner approves it.`
                  : "Not listed? Type it to request it, or add it directly in Masters."}
              </span>
            </FieldLabel>
            <FieldLabel label="Note" hint="optional">
              <TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </FieldLabel>
          </>
        )}

        {isFinalize && (
          <>
            {seatsFull ? (
              <p className="rounded-xl border border-ryg-red/30 bg-[#FDECEC]/50 px-4 py-3 text-[13px] text-navy">
                All {seats} {seats === 1 ? "seat" : "seats"} on this requisition are already filled. Take someone else
                out of Selected first.
              </p>
            ) : (
              <p className="text-[12.5px] text-grey-2">
                {taken} of {seats} {seats === 1 ? "seat" : "seats"} filled.
              </p>
            )}
            <FieldLabel label="Agreed salary (₹/month)" hint="optional but recommended">
              <TextInput inputMode="decimal" value={ctc} onChange={(e) => setCtc(e.target.value)} placeholder="18000" />
              {req?.salaryNote && (
                <span className="mt-1 block text-[11px] leading-snug text-grey-2">
                  The requisition asked for: {req.salaryNote}
                </span>
              )}
            </FieldLabel>
            {overRange && (
              <p className="rounded-xl border border-yellow/40 bg-[#FFF7E6] px-3.5 py-2.5 text-[12.5px] text-navy">
                That's above the range on the requisition (max ₹{req?.salaryMax?.toLocaleString("en-IN")}). You can still
                go ahead — it just won't be a surprise later.
              </p>
            )}
            {underRange && (
              <p className="text-[12px] text-grey-2">
                That's below the minimum on the requisition (₹{req?.salaryMin?.toLocaleString("en-IN")}).
              </p>
            )}
            <FieldLabel label="Decision remark" hint="optional">
              <TextArea
                rows={2}
                value={decisionRemarks}
                onChange={(e) => setDecisionRemarks(e.target.value)}
                placeholder="Anything to note about this selection"
              />
            </FieldLabel>
          </>
        )}

        {isDecision && (
          <FieldLabel label="Decision remark" hint="optional — why this candidate is here / what's pending">
            <TextArea
              rows={2}
              value={decisionRemarks}
              onChange={(e) => setDecisionRemarks(e.target.value)}
              placeholder="e.g. strong on skills, checking references before we decide"
            />
          </FieldLabel>
        )}

        {!isInterview && !isDisqualify && !isFinalize && !isDecision && !isBackward && (
          <p className="text-[13px] text-grey-2">Nothing else to capture — confirm to move the card.</p>
        )}

        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>

      {/* Opens on top of this dialog — `stacked` keeps the move form intact underneath. */}
      <RequestMasterModal
        stacked
        open={raiseReason !== null}
        onClose={() => setRaiseReason(null)}
        masterType="disqualification_reason"
        lockType
        prefill={{ name: raiseReason ?? "" }}
        onRequested={(_id, _mt, name) => setRequested(name)}
      />
    </Modal>
  );
}
