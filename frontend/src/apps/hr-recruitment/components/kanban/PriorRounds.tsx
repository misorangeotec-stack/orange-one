import { useMemo } from "react";
import { useHrStore } from "../../store";
import { hrDocUrl } from "../../data/hrWrites";
import { panelNames } from "../../lib/interviewers";
import { formatDateDMY } from "@/shared/lib/date";
import type { Interview } from "../../types";

/**
 * What every EARLIER round decided about this candidate.
 *
 * Recording Round 2 without Round 1's feedback in front of you is how a panel asks
 * the same question twice and misses the one thing the last interviewer flagged.
 * The remarks are the point — everything else here is context for them.
 *
 * Only rounds that were actually HELD appear. A booked-but-not-yet-conducted round
 * has no result to carry forward, and showing it as a blank card would read as
 * "they were interviewed and nobody wrote anything down", which is a different and
 * much worse claim.
 */
export default function PriorRounds({
  candidateId,
  before,
}: {
  candidateId: string;
  /** Show rounds strictly before this one (0 = telephonic, 1–3 = the rounds). */
  before: number;
}) {
  const s = useHrStore();

  const rounds = useMemo(
    () =>
      s
        .interviewsFor(candidateId)
        .filter((iv) => iv.round < before && iv.heldAt)
        .sort((a, b) => a.round - b.round),
    [s, candidateId, before],
  );

  const openDoc = async (path: string) => {
    const url = await hrDocUrl(path);
    if (url) window.open(url, "_blank", "noopener");
  };

  if (rounds.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line px-4 py-6 text-center">
        <p className="text-[12.5px] text-grey-2">
          {before === 0
            ? "This is the first conversation with them."
            : "No earlier round has been recorded yet — this is the first result on this candidate."}
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-2.5">
      {rounds.map((iv) => (
        <RoundCard key={iv.id} iv={iv} nameOf={s.personNameOrNull} onOpenDoc={openDoc} />
      ))}
    </ul>
  );
}

function RoundCard({
  iv,
  nameOf,
  onOpenDoc,
}: {
  iv: Interview;
  nameOf: (id: string) => string | undefined;
  onOpenDoc: (path: string) => void;
}) {
  const panel = panelNames(iv.interviewerIds, iv.interviewerName, nameOf);
  const tone =
    iv.status === "selected"
      ? "text-ryg-green"
      : iv.status === "rejected"
        ? "text-ryg-red"
        : "text-grey-2";

  return (
    <li className="rounded-xl border border-line bg-page/40 px-3.5 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold text-navy">
          {iv.round === 0 ? "Telephonic screen" : `Round ${iv.round}`}
        </span>
        <span className={`text-[12px] font-semibold uppercase tracking-wide ${tone}`}>
          {iv.status.replace(/_/g, " ")}
        </span>
      </div>

      <div className="mt-0.5 text-[12px] text-grey-2">
        {panel || "Interviewer not recorded"}
        {iv.scheduledOn && ` · ${formatDateDMY(iv.scheduledOn)}`}
      </div>

      {/* The remarks are why this panel exists, so they get the readable treatment
          rather than being another grey line among the metadata. */}
      {iv.remarks ? (
        <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-navy">{iv.remarks}</p>
      ) : (
        <p className="mt-2 text-[12.5px] italic text-grey-2">No remarks were written for this round.</p>
      )}

      {(iv.videoUrl || iv.documentPath) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          {iv.videoUrl && (
            <a
              href={iv.videoUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[12px] font-semibold text-orange hover:underline"
            >
              Video link →
            </a>
          )}
          {iv.documentPath && (
            <button
              type="button"
              onClick={() => onOpenDoc(iv.documentPath!)}
              className="text-[12px] font-semibold text-orange hover:underline"
            >
              {iv.documentName ?? "Feedback form"} →
            </button>
          )}
        </div>
      )}
    </li>
  );
}
