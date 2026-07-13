import { useEffect, useRef, useState } from "react";
import DueCell from "@/shared/components/ui/DueCell";
import { FIELD_LABEL_CLASS } from "@/shared/components/ui/Readout";
import { cn } from "@/shared/lib/cn";
import { dueState } from "@/shared/lib/workingDays";
import { useHrStore } from "../../store";
import { STAGE_LABEL, legalTargets, roundOf } from "../../lib/board";
import type { Candidate, CandidateStage } from "../../types";

/**
 * One candidate. The highlights are the ones you actually need at a glance: who
 * they are, how to reach them, which round they're in, **how long they've sat
 * there**, and whether they're overdue.
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
  onDragStart,
  onDragEnd,
  dragging,
}: {
  candidate: Candidate;
  selectable: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onMoveTo: (c: Candidate, to: CandidateStage) => void;
  onRecordResult: (c: Candidate, round: 1 | 2 | 3) => void;
  onSchedule: (c: Candidate, round: 1 | 2 | 3) => void;
  onOpen: (c: Candidate) => void;
  onDragStart: (e: React.DragEvent, id: string, from: CandidateStage) => void;
  onDragEnd: () => void;
  dragging: boolean;
}) {
  const s = useHrStore();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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
  const iv = round ? s.interviewRound(c.id, round) : undefined;
  // A round the candidate was auto-advanced into has no interviewer yet.
  const needsScheduling = !!round && !iv?.interviewerId && !iv?.interviewerName;
  const conducted = !!iv?.heldAt;

  const targets = legalTargets(c.stage);

  return (
    <div
      draggable={mine}
      onDragStart={(e) => onDragStart(e, c.id, c.stage)}
      onDragEnd={onDragEnd}
      className={`group relative rounded-xl border bg-white p-3 transition ${
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
            className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-orange"
            aria-label={`Select ${c.name}`}
          />
        )}

        <button onClick={() => onOpen(c)} className="min-w-0 flex-1 text-left">
          <div className="truncate text-[13.5px] font-semibold text-navy">{c.name}</div>
          {c.phone && <div className="truncate text-[12px] text-grey-2">{c.phone}</div>}
          {c.currentCompany && <div className="truncate text-[11.5px] text-grey-2">{c.currentCompany}</div>}
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
      {round && !conducted && (
        <div className="mt-2 rounded-lg bg-page px-2 py-1.5">
          {needsScheduling ? (
            <span className="text-[11.5px] font-medium text-yellow">To be scheduled</span>
          ) : (
            <span className="text-[11.5px] text-grey">
              Booked
              {iv?.scheduledOn && ` · ${iv.scheduledOn.split("-").reverse().join("-")}`}
              {iv?.interviewerName && ` · ${iv.interviewerName}`}
              {iv?.interviewerId && ` · ${s.profileById(iv.interviewerId)?.name ?? ""}`}
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

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[11px] text-grey-2">
          {days === 0 ? "today" : `${days}d here`}
        </span>
        {due && <DueCell dueIso={due} />}
      </div>

      {c.stage === "finalized" && c.offeredCtc !== null && (
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
