import { useMemo } from "react";
import { dueState } from "@/shared/lib/workingDays";
import { useHrStore } from "../../store";
import type { Candidate, CandidateStage } from "../../types";

/**
 * Where this position's people actually are, in one strip.
 *
 * ONE POSITION ONLY. An earlier version of this lived on the Positions list, summing
 * every vacancy together, and it was right to cut: "17 people are interviewing" across
 * unrelated jobs answers nothing anyone asks. Against a single opening the same shape
 * answers the question you open the board with — is this pipeline top-heavy, or is
 * there anything near an offer?
 *
 * THE BAR IS THE PEOPLE STILL IN PLAY, and nothing else. Hired and dropped are shown
 * beside it as plain counts rather than segments: a bar is read as progress, and a
 * disqualified candidate is not progress toward filling the seat. Mixing them in makes
 * a pipeline of rejects look busy.
 *
 * COLOUR IS ONE HUE, LIGHT TO DARK — a sequential ramp, because the phases are ordered
 * and the encoding should say so. Distinct hues would imply these are unrelated
 * categories, and would need a legend to decode; lightness alone reads as "further
 * along" and stays legible to a colour-blind reader without one.
 */

/** Phase → the stages it covers. EXHAUSTIVE over CandidateStage on purpose. */
const PHASE_OF: Record<CandidateStage, "screening" | "interviewing" | "offer" | "hired" | "dropped"> = {
  resume_uploaded: "screening",
  hr_shortlisted: "screening",
  shared_with_hod: "screening",
  hod_shortlisted: "screening",
  telephonic: "interviewing",
  interview_1: "interviewing",
  interview_2: "interviewing",
  interview_3: "interviewing",
  final_decision: "interviewing",
  finalized: "offer",
  hired: "hired",
  disqualified: "dropped",
};

const BARS = [
  { key: "screening", label: "Screening", fill: "#FFD8C2" },
  { key: "interviewing", label: "Interviewing", fill: "#FF9C63" },
  { key: "offer", label: "Offer out", fill: "#FF6A1F" },
] as const;

export default function PipelineSummary({ candidates }: { candidates: Candidate[] }) {
  const s = useHrStore();

  const stat = useMemo(() => {
    const n = { screening: 0, interviewing: 0, offer: 0, hired: 0, dropped: 0 };
    for (const c of candidates) n[PHASE_OF[c.stage]] += 1;
    const inPlay = n.screening + n.interviewing + n.offer;
    const overdue = candidates.filter((c) => {
      if (PHASE_OF[c.stage] === "hired" || PHASE_OF[c.stage] === "dropped") return false;
      const d = s.candidateDueIso(c);
      return d ? dueState(new Date(d)).overdue : false;
    }).length;
    return { ...n, inPlay, overdue };
  }, [candidates, s]);

  // Nothing to summarise yet — the board's own empty state says it better.
  if (candidates.length === 0) return null;

  return (
    <div className="rounded-xl border border-line bg-white px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
          {BARS.map((b) => {
            const v = stat[b.key];
            return (
              <span key={b.key} className="inline-flex items-baseline gap-1.5">
                <span
                  className="inline-block h-2 w-2 shrink-0 translate-y-[-1px] rounded-full"
                  style={{ background: b.fill }}
                  aria-hidden="true"
                />
                <span className="text-[15px] font-bold tabular-nums text-navy">{v}</span>
                <span className="text-[12.5px] text-grey-2">{b.label}</span>
              </span>
            );
          })}

          {/* Outcomes sit apart from the in-play phases — they are results, not stages. */}
          {(stat.hired > 0 || stat.dropped > 0) && (
            <span className="inline-flex items-baseline gap-3 border-l border-line pl-5 text-[12.5px] text-grey-2">
              {stat.hired > 0 && (
                <span>
                  <span className="font-semibold text-ryg-green">{stat.hired}</span> hired
                </span>
              )}
              {stat.dropped > 0 && (
                <span>
                  <span className="font-semibold text-grey">{stat.dropped}</span> dropped
                </span>
              )}
            </span>
          )}
        </div>

        {stat.overdue > 0 && (
          <span className="rounded-full bg-[#FDECEC] px-2.5 py-1 text-[11.5px] font-semibold text-ryg-red">
            {stat.overdue} overdue
          </span>
        )}
      </div>

      {/* The strip itself. 2px gaps so neighbouring segments stay countable rather
          than melting into one band. */}
      {stat.inPlay > 0 ? (
        <div className="mt-2.5 flex h-2 gap-[2px] overflow-hidden">
          {BARS.map((b) => {
            const v = stat[b.key];
            if (v === 0) return null;
            return (
              <span
                key={b.key}
                className="h-full rounded-full first:rounded-l-full last:rounded-r-full"
                style={{ width: `${(v / stat.inPlay) * 100}%`, background: b.fill }}
                title={`${v} ${b.label.toLowerCase()}`}
              />
            );
          })}
        </div>
      ) : (
        <p className="mt-2.5 text-[12px] text-grey-2">
          Nobody is in play — every candidate on this position has been hired or dropped.
        </p>
      )}
    </div>
  );
}
