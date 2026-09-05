import { useMemo, useState } from "react";
import Button from "@/shared/components/ui/Button";
import EmptyState from "@/shared/components/ui/EmptyState";
import Modal from "@/shared/components/ui/Modal";
import { formatDateDMY } from "@/shared/lib/date";
import { useHrStore } from "../../store";
import { hrDocUrl } from "../../data/hrWrites";
import ReassignInterviewModal from "../kanban/ReassignInterviewModal";
import { isBooked, panelNames } from "../../lib/interviewers";
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
  const [reassign, setReassign] = useState<Interview | null>(null);
  // Same gate the Interviews queue uses, so the two cannot disagree about who may
  // re-aim a round — and the RPC re-checks either way.
  const canAct = s.canEdit && s.canActOnCandidate(c);

  /**
   * (NR-5) Adding a recording link that was never captured.
   *
   * The Documents tab can edit and remove a link, but it only lists what EXISTS —
   * so a round nobody pasted a link for at the time had no way back. That is the
   * same hole NR-5 exists to close, one step earlier: the result form is sealed
   * once the candidate advances, and dragging the card back deletes later rounds.
   *
   * Only offered where there is NO link yet. Editing and removing an existing one
   * stay on Documents, so the destructive path keeps its single confirm.
   */
  const [addingTo, setAddingTo] = useState<Interview | null>(null);
  const [linkDraft, setLinkDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [linkErr, setLinkErr] = useState<string | null>(null);

  const saveLink = async () => {
    if (!addingTo || !linkDraft.trim()) return;
    setBusy(true);
    setLinkErr(null);
    try {
      await s.setAttachmentLink(
        { kind: "interviewVideo", candidateId: c.id, round: addingTo.round },
        linkDraft,
      );
      setAddingTo(null);
    } catch (e) {
      setLinkErr(e instanceof Error ? e.message : "Could not save that link");
    } finally {
      setBusy(false);
    }
  };

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

  const Round = ({ iv, onReassign }: { iv: Interview; onReassign?: (iv: Interview) => void }) => {
    const panel = panelNames(iv.interviewerIds, iv.interviewerName, s.personNameOrNull);
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
          {/* This tab was read-only until now. A booked round could not be re-aimed
              from anywhere, so a head on leave simply blocked the pipeline. */}
          {onReassign && (
            <button
              type="button"
              onClick={() => onReassign(iv)}
              className="ml-2 text-[12px] font-semibold text-orange hover:underline"
            >
              Change interviewer
            </button>
          )}
        </div>
        {iv.remarks && <p className="mt-1 whitespace-pre-wrap text-navy">{iv.remarks}</p>}
        {/* No link on this round, and this person may set one. Asked per ROUND —
            not per candidate — because ownership of Round 1 and of Round 3 are
            different questions, and the card has long since moved on. */}
        {!iv.videoUrl && s.canActOnInterviewRound(c, iv.round) && (
          <button
            type="button"
            onClick={() => {
              setLinkErr(null);
              setLinkDraft("");
              setAddingTo(iv);
            }}
            className="mt-1.5 text-[12px] font-semibold text-grey-2 hover:text-orange"
          >
            + Add a recording link
          </button>
        )}
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
              <Round key={iv.id} iv={iv} onReassign={canAct && isBooked(iv) ? setReassign : undefined} />
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
      {reassign && (
        <ReassignInterviewModal
          candidate={c}
          round={reassign.round as 0 | 1 | 2 | 3}
          open={!!reassign}
          onClose={() => setReassign(null)}
        />
      )}
      <Modal
        open={!!addingTo}
        onClose={() => !busy && setAddingTo(null)}
        title="Add the recording link"
        subtitle={
          addingTo ? (addingTo.round === 0 ? "Telephonic screen" : `Round ${addingTo.round}`) : undefined
        }
        size="md"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setAddingTo(null)} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void saveLink()} disabled={busy || !linkDraft.trim()}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          {linkErr && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
              {linkErr}
            </p>
          )}
          <input
            type="url"
            value={linkDraft}
            onChange={(e) => setLinkDraft(e.target.value)}
            placeholder="https://…"
            className="w-full rounded-lg border border-line px-3 py-2 text-[13px] text-navy outline-none focus:border-orange"
          />
          <p className="text-[12px] text-grey-2">
            The link to wherever the call was recorded. It can be added at any time, whatever stage the
            candidate has since reached. Changing or clearing it later is on the Documents tab.
          </p>
        </div>
      </Modal>
    </div>
  );
}
