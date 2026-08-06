import { useEffect, useRef, useState } from "react";
import Avatar from "@/shared/components/ui/Avatar";
import DueCell from "@/shared/components/ui/DueCell";
import { FIELD_LABEL_CLASS } from "@/shared/components/ui/Readout";
import { cn } from "@/shared/lib/cn";
import { dueState } from "@/shared/lib/workingDays";
import { formatDateDMY } from "@/shared/lib/date";
import { useHrStore } from "../../store";
import { STAGE_LABEL, legalTargets, roundOf } from "../../lib/board";
import { fitFill } from "../../lib/fit";
import { panelNames } from "../../lib/interviewers";
import { tintFor } from "../../lib/tint";
import type { Candidate, CandidateStage } from "../../types";

/**
 * One candidate. The highlights are the ones you actually need at a glance: who
 * they are, where they are coming from, which round they're in, **how long they've
 * sat there**, and whether they're overdue.
 *
 * The `⋮ → Move to` menu is not a nicety — HTML5 drag-and-drop does not work on
 * touch, and this is how a phone or a keyboard moves a card. It opens the identical
 * modal the drag does.
 */
export default function CandidateCard({
  candidate: c,
  selectable,
  selected,
  onToggleSelect,
  onMoveTo,
  onRecordResult,
  onSchedule,
  onOpen,
  onOpenOnboarding,
  onDragStart,
  onDragEnd,
  dragging,
}: {
  candidate: Candidate;
  selectable: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onMoveTo: (c: Candidate, to: CandidateStage) => void;
  onRecordResult: (c: Candidate, round: 0 | 1 | 2 | 3) => void;
  onSchedule: (c: Candidate, round: 0 | 1 | 2 | 3) => void;
  onOpen: (c: Candidate) => void;
  onOpenOnboarding: (c: Candidate) => void;
  onDragStart: (e: React.DragEvent, id: string, from: CandidateStage) => void;
  onDragEnd: () => void;
  dragging: boolean;
}) {
  const s = useHrStore();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const fit = s.fitFor(c.id);

  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menu]);

  const mine = s.canActOnCandidate(c);
  const due = s.candidateDueIso(c);
  const overdue = due ? dueState(new Date(due)).overdue : false;
  const days = s.daysInStage(c);

  const round = roundOf(c.stage);
  const iv = round !== null ? s.interviewRound(c.id, round) : undefined;
  // A round the candidate was auto-advanced into has no interviewer yet.
  const needsScheduling = round !== null && !iv?.interviewerIds.length && !iv?.interviewerName;
  const panel = iv ? panelNames(iv.interviewerIds, iv.interviewerName, (id) => s.profileById(id)?.name) : "";
  const conducted = !!iv?.heldAt;

  const targets = legalTargets(c.stage);
  const subtitle = c.currentCompany ?? c.email ?? c.phone;

  /**
   * The onboarding is where the joining details live, and Made Offer is the column
   * you are sitting in while you collect them — so the way through to it belongs on
   * the card, not three screens away in the Onboarding queue.
   */
  const onboarding = c.stage === "finalized" || c.stage === "hired" ? s.onboardingForCandidate(c.id) : undefined;
  const checks = onboarding ? s.checksFor(onboarding.id) : [];
  const ticked = checks.filter((k) => k.done).length;

  /**
   * An offered candidate whose onboarding has completed HAS joined — the seat is
   * filled, the probation clock is running. All that is left is the acknowledgement
   * on the board, so say so rather than letting the card look untouched for weeks.
   */
  const readyToHire = c.stage === "finalized" && !!onboarding?.completedAt;

  /**
   * MAKING AN OFFER IS NOT THE SAME AS IT BEING ACCEPTED. The card asks, rather than
   * assuming — the assumption is what made the acceptance rate meaningless.
   *
   * Both answers live here so one question has one place. "They declined" hands off
   * to the ordinary disqualify move, which already asks declined-vs-no-show and takes
   * the card off the pipeline; recording the status alone would leave them sitting in
   * Made Offer having said no.
   */
  const awaitingAnswer = c.stage === "finalized" && onboarding?.offerStatus === "pending";
  const [answering, setAnswering] = useState(false);
  const [answerErr, setAnswerErr] = useState<string | null>(null);

  const accept = async () => {
    if (!onboarding || answering) return;
    setAnswering(true);
    setAnswerErr(null);
    try {
      await s.setOfferStatus(onboarding.id, "accepted");
    } catch (e) {
      setAnswerErr(e instanceof Error ? e.message : "Could not record that");
    } finally {
      setAnswering(false);
    }
  };

  return (
    <div
      draggable={mine}
      onDragStart={(e) => onDragStart(e, c.id, c.stage)}
      onDragEnd={onDragEnd}
      className={`group relative rounded-xl border bg-white p-2.5 transition ${
        dragging ? "opacity-40" : ""
      } ${overdue ? "border-ryg-red/40 bg-[#FDECEC]/30" : "border-line"} ${
        mine ? "cursor-grab hover:border-orange/50 hover:shadow-sm active:cursor-grabbing" : "cursor-default"
      } ${selected ? "ring-2 ring-orange/40" : ""}`}
    >
      <div className="flex items-start gap-2">
        {selectable && mine && (
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(c.id)}
            onClick={(e) => e.stopPropagation()}
            className="mt-2 h-3.5 w-3.5 shrink-0 cursor-pointer accent-orange"
            aria-label={`Select ${c.name}`}
          />
        )}

        <Avatar name={c.name} color={tintFor(c.id)} size={30} className="mt-0.5" />

        <button onClick={() => onOpen(c)} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-1">
            <span className="truncate text-[13px] font-semibold text-navy">{c.name}</span>
            {/* The HOD has it — the reason this card does not need its own column. */}
            {c.stage === "shared_with_hod" && (
              <svg
                viewBox="0 0 24 24"
                className="h-3.5 w-3.5 shrink-0 text-ryg-green"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-label="Sent to the HOD"
              >
                <title>Sent to the HOD</title>
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </div>
          {subtitle && <div className="truncate text-[11.5px] text-grey-2">{subtitle}</div>}
        </button>

        {mine && targets.length > 0 && (
          <div ref={menuRef} className="relative shrink-0">
            <button
              onClick={() => setMenu((m) => !m)}
              aria-label="Move this candidate"
              className="rounded-md px-1 py-0.5 text-grey-2 hover:bg-page hover:text-navy"
            >
              ⋮
            </button>
            {menu && (
              <div className="absolute right-0 top-6 z-20 w-52 rounded-xl border border-line bg-white py-1 shadow-lg">
                <div className={cn("px-3 py-1", FIELD_LABEL_CLASS)}>
                  Move to
                </div>
                {targets.map((t) => (
                  <button
                    key={t}
                    onClick={() => {
                      setMenu(false);
                      onMoveTo(c, t);
                    }}
                    className="block w-full px-3 py-1.5 text-left text-[12.5px] text-navy hover:bg-page"
                  >
                    {STAGE_LABEL[t]}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Interview state: booked vs conducted are different facts. */}
      {round !== null && !conducted && (
        <div className="mt-2 rounded-lg bg-page px-2 py-1.5">
          {needsScheduling ? (
            <span className="text-[11.5px] font-medium text-yellow">To be scheduled</span>
          ) : (
            <span className="text-[11.5px] text-grey">
              Booked
              {iv?.scheduledOn && ` · ${iv.scheduledOn.split("-").reverse().join("-")}`}
              {panel && ` · ${panel}`}
            </span>
          )}
          {mine &&
            // A round the system auto-advanced into has no interviewer yet. Book it first —
            // recording a result on a round nobody was ever assigned to is meaningless.
            (needsScheduling ? (
              <button
                onClick={() => onSchedule(c, round)}
                className="mt-1 block text-[11.5px] font-semibold text-orange hover:underline"
              >
                Book it →
              </button>
            ) : (
              <button
                onClick={() => onRecordResult(c, round)}
                className="mt-1 block text-[11.5px] font-semibold text-orange hover:underline"
              >
                Record result →
              </button>
            ))}
        </div>
      )}

      {awaitingAnswer && (
        <div className="mt-2 rounded-lg border border-orange/30 bg-orange/[0.06] px-2 py-1.5">
          <div className="text-[11.5px] font-semibold text-navy">Offer sent — did they accept?</div>
          {mine ? (
            <>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <button
                  onClick={accept}
                  disabled={answering}
                  className="rounded-pill border border-ryg-green/40 bg-white px-2 py-0.5 text-[11.5px] font-semibold text-ryg-green transition hover:bg-[#E9F8EF] disabled:opacity-50"
                >
                  {answering ? "Saving…" : "They accepted"}
                </button>
                <button
                  onClick={() => onMoveTo(c, "disqualified")}
                  disabled={answering}
                  className="rounded-pill border border-line bg-white px-2 py-0.5 text-[11.5px] font-semibold text-ryg-red transition hover:border-ryg-red/40 disabled:opacity-50"
                >
                  They declined
                </button>
              </div>
              {answerErr && <div className="mt-1 text-[11px] text-ryg-red">{answerErr}</div>}
            </>
          ) : (
            <div className="mt-0.5 text-[11px] text-grey-2">Awaiting the answer.</div>
          )}
        </div>
      )}

      {readyToHire && (
        <div className="mt-2 rounded-lg bg-[#E9F8EF] px-2 py-1 text-[11.5px] font-medium text-ryg-green">
          Joined — move to Hired
        </div>
      )}

      {onboarding && (
        <button
          onClick={() => onOpenOnboarding(c)}
          className="mt-2 flex w-full items-center justify-between gap-2 rounded-lg bg-page px-2 py-1.5 text-[11.5px] transition hover:bg-orange/[0.06]"
        >
          <span className="font-semibold text-orange">Onboarding →</span>
          <span className="text-grey-2">
            {onboarding.completedAt
              ? "complete"
              : checks.length > 0
                ? `${ticked}/${checks.length}`
                : "no checklist"}
          </span>
        </button>
      )}

      {/* `flex-wrap` is load-bearing, not tidiness: the card is 260px inside, and
          clock (~68px) + fit pill (~44px) + an OVERDUE DueCell (~160px) is 288px.
          Only that intersection wraps, and it costs ~18px of card height. */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="inline-flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-[11px] text-grey-2">
            <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            {days === 0 ? "today" : `${days}d here`}
          </span>

          {/* The AI fit score. This pill is what makes the score comparative — a
              number you must open a page to read cannot be weighed against the
              fourteen other people in the column. Deliberately no separate
              "stale" styling: at 11px a second signal just reads as broken, so
              the caveat rides in the tooltip. */}
          {fit && (
            <span
              title={`AI fit ${fit.overall} out of 10 — scored ${formatDateDMY(fit.scoredAt)}`}
              className="inline-flex shrink-0 items-center gap-1 rounded-pill bg-page px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-navy"
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: fitFill(fit.overall) }}
                aria-hidden="true"
              />
              <span className="sr-only">AI fit </span>
              {fit.overall}
            </span>
          )}
        </span>
        {due && <DueCell dueIso={due} />}
      </div>

      {s.canViewSalary && (c.stage === "finalized" || c.stage === "hired") && c.offeredCtc !== null && (
        <div className="mt-1.5 text-[11.5px] font-medium text-ryg-green">
          ₹{c.offeredCtc.toLocaleString("en-IN")}/mo
        </div>
      )}
      {c.stage === "disqualified" && (
        <div className="mt-1.5 truncate text-[11.5px] text-grey-2">
          {s.disqualificationReasons.find((r) => r.id === c.disqualificationReasonId)?.name ??
            c.disqualificationNote ??
            "Dropped"}
        </div>
      )}
    </div>
  );
}
