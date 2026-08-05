import { useMemo } from "react";
import EmptyState from "@/shared/components/ui/EmptyState";
import { formatDateDMY } from "@/shared/lib/date";
import { useHrStore } from "../../store";
import { hrDocUrl } from "../../data/hrWrites";
import { panelNames } from "../../lib/interviewers";
import type { Candidate, Interview } from "../../types";

/**
 * Every conversation booked with this person.
 *
 * SPLIT BY WHETHER IT HAS HAPPENED, not by round number. A booked round is a
 * commitment someone has to turn up to; a held round is evidence. Sorting them into
 * one list by round buries tomorrow's interview under three old ones, which is the
 * opposite of what you open this tab for.
 */
export default function CandidateMeetings({ candidate: c }: { candidate: Candidate }) {
  const s = useHrStore();

  const openDoc = async (path: string) => {
    const url = await hrDocUrl(path);
    if (url) window.open(url, "_blank", "noopener");
  };

  const { upcoming, held } = useMemo(() => {
    const all = [...s.interviewsFor(c.id)].sort((a, b) => a.round - b.round);
    return { upcoming: all.filter((iv) => !iv.heldAt), held: all.filter((iv) => !!iv.heldAt) };
  }, [s, c.id]);

  if (upcoming.length === 0 && held.length === 0) {
    return (
      <EmptyState
        title="No interviews yet"
        message="Once a round is booked from the board it appears here, with its panel, result and any recording."
      />
    );
  }

  const Round = ({ iv }: { iv: Interview }) => {
    const panel = panelNames(iv.interviewerIds, iv.interviewerName, (id) => s.profileById(id)?.name);
    return (
      <li className="rounded-xl border border-line px-3.5 py-3 text-[13px]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold text-navy">
            {iv.round === 0 ? "Telephonic screen" : `Round ${iv.round}`}
          </span>
          <span
            className={
              iv.status === "selected"
                ? "font-semibold text-ryg-green"
                : iv.status === "rejected"
                  ? "font-semibold text-ryg-red"
                  : "text-grey"
            }
          >
            {iv.heldAt ? iv.status.replace(/_/g, " ") : "not yet held"}
          </span>
        </div>
        <div className="mt-0.5 font-medium text-navy">
          {panel || <span className="font-normal text-grey">Interviewer not set</span>}
          {iv.scheduledOn && <span className="text-grey"> · {formatDateDMY(iv.scheduledOn)}</span>}
        </div>
        {iv.remarks && <p className="mt-1 whitespace-pre-wrap text-navy">{iv.remarks}</p>}
        {(iv.videoUrl || iv.documentPath) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            {iv.videoUrl && (
              <a
                href={iv.videoUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[12px] font-semibold text-orange hover:underline"
              >
                Watch the interview →
              </a>
            )}
            {iv.documentPath && (
              <button
                type="button"
                onClick={() => void openDoc(iv.documentPath!)}
                className="text-[12px] font-semibold text-orange hover:underline"
              >
                {iv.documentName ?? "Feedback form"} →
              </button>
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="space-y-4">
      {upcoming.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-grey">Coming up</div>
          <ul className="mt-2 space-y-2">
            {upcoming.map((iv) => (
              <Round key={iv.id} iv={iv} />
            ))}
          </ul>
        </div>
      )}
      {held.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-grey">Already held</div>
          <ul className="mt-2 space-y-2">
            {held.map((iv) => (
              <Round key={iv.id} iv={iv} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
