import { formatDateDMY, formatDateTimeDMY } from "@/shared/lib/date";
import { useHrStore } from "../store";
import type { Requisition } from "../types";

/**
 * Why a requisition stopped — the reason, who did it, and when.
 *
 * Every one of these facts was already being written and none of them was being read.
 * `cancel_reason` in particular had been stored since the module shipped and rendered on
 * NO screen: five live vacancies carried instructions meant for the person who raised them
 * ("Please Upload the JD and Location") that nobody could see. This is where they surface.
 *
 * One component for all five end-states so the wording cannot drift — MrfDetail used to
 * hand-roll three near-identical banners and simply had no fourth for `cancelled`.
 *
 * ⚠ THE ACTOR COLUMN IS NOT THE SAME ONE FOR EVERY STATE. `decided_by` is a single shared
 *   slot written by reject, send-back AND cancel, so it is only trustworthy read against
 *   the CURRENT status — each write coincides with the status it explains. A hold must
 *   read `held_by`; reading `decided_by` there would name whoever last sent the
 *   requisition back, which could be somebody else entirely.
 */

type Tone = "red" | "grey" | "green";

interface Note {
  heading: string;
  reason: string | null;
  atIso: string | null;
  actorId: string | null;
  /** False only for `closed`, which the system does — there is no person to name. */
  hasActor: boolean;
  tone: Tone;
}

function noteFor(r: Requisition): Note | null {
  switch (r.status) {
    case "sent_back":
      return { heading: "Sent back", reason: r.sentBackReason, atIso: r.sentBackAt, actorId: r.decidedBy, hasActor: true, tone: "red" };
    case "rejected":
      return { heading: "Rejected", reason: r.rejectReason, atIso: r.rejectedAt, actorId: r.decidedBy, hasActor: true, tone: "red" };
    case "on_hold":
      return { heading: "On hold", reason: r.holdReason, atIso: r.holdAt, actorId: r.heldBy, hasActor: true, tone: "grey" };
    case "cancelled":
      return { heading: "Cancelled", reason: r.cancelReason, atIso: r.closedAt, actorId: r.decidedBy, hasActor: true, tone: "red" };
    case "closed":
      return {
        heading: "Closed",
        reason: `All ${r.positionsRequired} ${r.positionsRequired === 1 ? "seat" : "seats"} filled.`,
        atIso: r.closedAt,
        actorId: null,
        hasActor: false,
        tone: "green",
      };
    default:
      return null;
  }
}

/** A reason is never hidden for being blank — a silent banner explains nothing. */
const reasonText = (n: Note) => n.reason?.trim() || "No reason recorded.";

/**
 * The same facts on one line, for a `title` tooltip on a status badge in a list.
 *
 * Shares `noteFor` with the banner deliberately: a grid and a detail page disagreeing
 * about why the same vacancy stopped is the bug this whole component exists to prevent.
 */
export function stateNoteText(r: Requisition, personName: (id: string | null) => string): string | null {
  const n = noteFor(r);
  if (!n) return null;
  const tail = [n.hasActor ? personName(n.actorId) : null, n.atIso ? formatDateDMY(n.atIso) : null].filter(Boolean);
  return tail.length ? `${reasonText(n)} — ${tail.join(" · ")}` : reasonText(n);
}

const TONE: Record<Tone, { box: string; heading: string }> = {
  red: { box: "border-ryg-red/30 bg-[#FDECEC]/50", heading: "text-ryg-red" },
  grey: { box: "border-line bg-page", heading: "text-grey" },
  green: { box: "border-ryg-green/30 bg-[#E9F7EF]/60", heading: "text-ryg-green" },
};

export default function StateNote({ requisition }: { requisition: Requisition }) {
  const s = useHrStore();
  const n = noteFor(requisition);
  if (!n) return null;

  const tone = TONE[n.tone];
  // `personName` and not `profileById`: the latter is scoped by RLS to the reader's own
  // department, so a coordinator in HR who cancelled a Sales vacancy would read as
  // "Unknown" to everyone in Sales — the exact people the note is written for.
  const byline = [
    n.hasActor ? s.personName(n.actorId) : null,
    n.atIso ? formatDateTimeDMY(n.atIso) : null,
  ].filter(Boolean);

  return (
    <div className={`rounded-xl border px-4 py-3 ${tone.box}`}>
      <div className={`text-[12px] font-semibold uppercase tracking-wide ${tone.heading}`}>{n.heading}</div>
      <p className="mt-1 text-[13px] text-navy">{reasonText(n)}</p>
      {byline.length > 0 && <p className="mt-1.5 text-[12px] text-grey-2">{byline.join(" · ")}</p>}
    </div>
  );
}
