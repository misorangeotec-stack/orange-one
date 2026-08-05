import { useMemo, useState } from "react";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { todayIso } from "@/shared/lib/time";
import { formatDateDMY } from "@/shared/lib/date";
import { interviewerPool, interviewerOptions } from "../../lib/interviewers";
import RequestMasterModal from "../RequestMasterModal";
import { useHrStore } from "../../store";
import { STAGE_LABEL, roundOf } from "../../lib/board";
import { inr, salaryLabel } from "../../lib/format";
import PriorRounds from "./PriorRounds";
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
  const isHired = toStage === "hired";
  /** Dropping someone who already had an offer out — the outcome has to be recorded. */
  const leavingOffer = isDisqualify && candidate.stage === "finalized";
  const isBackward = false; // the caller only offers legal targets; the RPC re-checks

  /**
   * Marking someone hired is an ACKNOWLEDGEMENT, not a new fact. Joining was
   * recorded when their onboarding completed — that is what stamped `joined_at`,
   * opened the probation and filled the seat. So this move writes nothing but the
   * stage, and it is refused until that has actually happened.
   */
  const onboarding = s.onboardingForCandidate(candidate.id);
  const checks = onboarding ? s.checksFor(onboarding.id) : [];
  const checksDone = checks.filter((k) => k.done).length;
  const hasJoined = !!onboarding?.completedAt;

  const [interviewerIds, setInterviewerIds] = useState<string[]>([]);
  const [interviewerName, setInterviewerName] = useState("");
  const [scheduledOn, setScheduledOn] = useState(todayIso());
  const [reasonId, setReasonId] = useState("");
  /** Only meaningful when disqualifying someone who already had an offer out. */
  const [offerOutcome, setOfferOutcome] = useState<"declined" | "no_show">("declined");
  /** Reason not in the master? Raise it for review without losing this form. */
  const [raiseReason, setRaiseReason] = useState<string | null>(null);
  const [requested, setRequested] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [ctc, setCtc] = useState("");
  /** Agreed joining date. Blank is fine — Onboarding can still set it later. */
  const [joiningDate, setJoiningDate] = useState("");
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
  const people: MultiOption[] = useMemo(() => (pool ? interviewerOptions(pool.people) : []), [pool]);
  const reasons: ComboOption[] = useMemo(
    () => s.disqualificationReasons.filter((r) => r.active).map((r) => ({ value: r.id, label: r.name })),
    [s.disqualificationReasons],
  );

  /**
   * Go landscape only when there is a result to put in the second column. Booking
   * Round 1 on a candidate who skipped the telephonic has nothing to show, and a
   * wide dialog with an empty half is worse than the narrow one.
   */
  const showsHistory = useMemo(() => {
    if (!isInterview && !isFinalize) return false;
    const before = isFinalize ? 4 : (round ?? 0);
    return s.interviewsFor(candidate.id).some((iv) => iv.round < before && iv.heldAt);
  }, [s, candidate.id, isInterview, isFinalize, round]);

  // Seats already taken on this requisition — you cannot hire more than were asked
  // for. `hired` counts: acknowledging a hire on the board does not free their seat.
  const taken = s
    .candidatesFor(candidate.requisitionId)
    .filter((c) => c.stage === "finalized" || c.stage === "hired").length;
  const seats = req?.positionsRequired ?? 1;
  const seatsFull = isFinalize && taken >= seats;

  // The offered salary against the range on the MRF. A warning, not a block —
  // going over the band is a real decision, it just shouldn't be an invisible one.
  //
  // The field below is explicitly "Agreed salary (₹/month)", but a requisition can
  // now be banded per ANNUM. Both sides are converted to a monthly figure before
  // comparing: without it a ₹6,00,000/year band would flag every sane ₹50,000/month
  // offer as below the minimum, out by exactly 12×.
  const ctcNum = ctc.trim() === "" ? null : Number(ctc.replace(/[^\d.]/g, ""));
  const perMonth = (v: number | null | undefined): number | null =>
    v === null || v === undefined ? null : req?.salaryPeriod === "annum" ? v / 12 : v;
  const bandMin = perMonth(req?.salaryMin);
  const bandMax = perMonth(req?.salaryMax);
  const overRange = isFinalize && ctcNum !== null && bandMax !== null && ctcNum > bandMax;
  const underRange = isFinalize && ctcNum !== null && bandMin !== null && ctcNum < bandMin;

  const invalid =
    (isInterview && interviewerIds.length === 0 && !interviewerName.trim()) ||
    // An un-dated booking is not a booking: with no date the round falls into "no date"
    // and quietly leaves every overdue count while still being someone's work.
    (isInterview && !scheduledOn) ||
    (isDisqualify && !reasonId) ||
    (isHired && !hasJoined) ||
    seatsFull;

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const payload: MovePayload = {};
      if (isInterview) {
        payload.interviewerIds = interviewerIds;
        payload.interviewerName = interviewerName.trim() || null;
        payload.scheduledOn = scheduledOn || null;
      }
      if (isDisqualify) {
        payload.disqualificationReasonId = reasonId || null;
        payload.disqualificationNote = note.trim() || null;
        if (leavingOffer) payload.offerOutcome = offerOutcome;
      }
      if (isFinalize) {
        payload.offeredCtc = ctcNum;
        payload.joiningDate = joiningDate || null;
      }
      if (isFinalize) payload.decisionRemarks = decisionRemarks.trim() || null;

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
      ? "The offer goes out and their onboarding starts next. The seat is only truly filled once they actually join."
      : isDisqualify
        ? "They drop out of the pipeline. The reason is what tells you where the pipeline leaks."
        : isHired
          ? "Confirming what the onboarding already recorded. Nothing new is written — the joining date, the seat and the probation clock are already set."
          : `${candidate.name} moves to ${STAGE_LABEL[toStage]}.`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${candidate.name} → ${STAGE_LABEL[toStage]}`}
      subtitle={subtitle}
      size={showsHistory ? "3xl" : "md"}
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
      <div className={showsHistory ? "grid gap-5 md:grid-cols-2 md:gap-6" : undefined}>
        {/* History first in the DOM so the stacked (mobile) layout reads it first;
            md:order flips it to the right-hand column on a real screen. */}
        {showsHistory && (
          <section className="md:order-2 md:border-l md:border-line md:pl-6">
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-grey-2">
              {isFinalize ? "How they did" : "What happened before"}
            </h3>
            <div className="mt-2.5">
              <PriorRounds candidateId={candidate.id} before={isFinalize ? 4 : (round ?? 0)} />
            </div>
          </section>
        )}

        <div className="space-y-3.5 md:order-1">
        {isInterview && (
          <>
            <FieldLabel label={`Who is taking ${roundLabel}?`} required hint="one or more">
              <MultiSelect
                values={interviewerIds}
                onChange={setInterviewerIds}
                options={people}
                placeholder="Pick the panel"
              />
              {pool &&
                (pool.restricted ? (
                  <span className="mt-1.5 block text-[11.5px] leading-snug text-grey-2">{pool.hint}</span>
                ) : (
                  <span className="mt-1.5 block text-[11.5px] leading-snug text-grey">{pool.fallbackNote}</span>
                ))}
              {/* Additive, not exclusive: a panel is often two portal users PLUS an
                  external consultant, and forcing a choice would lose one of them. */}
              <TextInput
                className="mt-2"
                value={interviewerName}
                onChange={(e) => setInterviewerName(e.target.value)}
                placeholder="And / or type names not in the portal — an external consultant, say"
              />
            </FieldLabel>
            <FieldLabel label="Interview date" required>
              <TextInput type="date" value={scheduledOn} onChange={(e) => setScheduledOn(e.target.value)} />
            </FieldLabel>
          </>
        )}

        {isDisqualify && (
          <>
            {/* Only asked when an offer was actually out. It is the single input to
                the offer-acceptance rate — "of the people we offered, how many took
                the job?" — which has no other way to ever see a decline. */}
            {leavingOffer && (
              <FieldLabel label="What happened to the offer?" required>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(
                    [
                      { key: "declined", label: "They declined", hint: "Turned the offer down" },
                      { key: "no_show", label: "Didn't turn up", hint: "Accepted, then never joined" },
                    ] as const
                  ).map((o) => (
                    <button
                      key={o.key}
                      type="button"
                      onClick={() => setOfferOutcome(o.key)}
                      className={`rounded-xl border px-3.5 py-2.5 text-left transition ${
                        offerOutcome === o.key ? "border-orange bg-orange/5" : "border-line hover:border-grey-2/40"
                      }`}
                    >
                      <div className="text-[13px] font-semibold text-navy">{o.label}</div>
                      <div className="text-[11.5px] text-grey-2">{o.hint}</div>
                    </button>
                  ))}
                </div>
                <span className="mt-1.5 block text-[11px] leading-snug text-grey-2">
                  Their seat goes straight back to {req?.mrfNo ?? "the requisition"} either way. The record is kept so
                  the offer-acceptance rate stays honest.
                </span>
              </FieldLabel>
            )}
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
                out of Made Offer first.
              </p>
            ) : (
              <p className="text-[12.5px] text-grey-2">
                {taken} of {seats} {seats === 1 ? "seat" : "seats"} filled.
              </p>
            )}
            <FieldLabel label="Agreed salary (₹/month)" hint="optional but recommended">
              <TextInput inputMode="decimal" value={ctc} onChange={(e) => setCtc(e.target.value)} placeholder="18000" />
              {req && (req.salaryMin !== null || req.salaryMax !== null) && (
                <span className="mt-1 block text-[11px] leading-snug text-grey-2">
                  The requisition asked for: {salaryLabel(req.salaryMin, req.salaryMax, req.salaryStructure, req.salaryPeriod)}
                  {req.salaryPeriod === "annum" && " — compared here as a monthly figure"}
                </span>
              )}
            </FieldLabel>
            {overRange && (
              <p className="rounded-xl border border-yellow/40 bg-[#FFF7E6] px-3.5 py-2.5 text-[12.5px] text-navy">
                That's above the range on the requisition (max {inr(bandMax!)}/month). You can still go ahead — it just
                won't be a surprise later.
              </p>
            )}
            {underRange && (
              <p className="text-[12px] text-grey-2">
                That's below the minimum on the requisition ({inr(bandMin!)}/month).
              </p>
            )}
            <FieldLabel label="Date of joining" hint="optional — set it if agreed">
              <TextInput type="date" value={joiningDate} onChange={(e) => setJoiningDate(e.target.value)} />
              <span className="mt-1 block text-[11px] leading-snug text-grey-2">
                {joiningDate
                  ? "Their onboarding opens with this date and the checklist ready to work."
                  : "Leave it blank if the date isn't agreed yet — Onboarding will ask for it, and the checklist stays locked until then."}
              </span>
            </FieldLabel>
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

        {isHired &&
          (hasJoined ? (
            <div className="space-y-2.5">
              <p className="rounded-xl border border-ryg-green/30 bg-[#E9F8EF] px-4 py-3 text-[13px] text-navy">
                {candidate.name} joined on {formatDateDMY(onboarding?.joiningDate ?? onboarding?.completedAt)} — their
                onboarding is complete and their probation has started.
              </p>
              <p className="text-[12.5px] text-grey-2">
                Confirming only moves the card. It writes no new dates, so the board can never disagree with the
                onboarding about whether someone turned up.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              <p className="rounded-xl border border-yellow/40 bg-[#FFF7E6] px-4 py-3 text-[13px] text-navy">
                {candidate.name} has not joined yet, so they cannot be marked hired.
              </p>
              <ul className="ml-4 list-disc space-y-1 text-[12.5px] text-grey-2">
                {!onboarding && <li>Their onboarding has not been opened.</li>}
                {/* An onboarding is born accepted (finalizing IS the acceptance), so
                    this only ever fires on a historical drop-out. */}
                {onboarding && (onboarding.offerStatus === "declined" || onboarding.offerStatus === "no_show") && (
                  <li>
                    They were recorded as{" "}
                    {onboarding.offerStatus === "declined" ? "having declined the offer" : "not having turned up"}.
                    Disqualify them instead, with the reason.
                  </li>
                )}
                {onboarding && !onboarding.joiningDate && (
                  <li>No joining date is set — the checklist stays locked until it is.</li>
                )}
                {onboarding && checks.length > 0 && checksDone < checks.length && (
                  <li>
                    {checks.length - checksDone} of {checks.length} checklist{" "}
                    {checks.length - checksDone === 1 ? "item is" : "items are"} still outstanding.
                  </li>
                )}
              </ul>
              <p className="text-[12.5px] text-grey-2">
                Finish their onboarding and this card moves itself into reach — the badge on it will say so.
              </p>
            </div>
          ))}

        {!isInterview && !isDisqualify && !isFinalize && !isHired && !isBackward && (
          <p className="text-[13px] text-grey-2">Nothing else to capture — confirm to move the card.</p>
        )}

        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
        </div>
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
