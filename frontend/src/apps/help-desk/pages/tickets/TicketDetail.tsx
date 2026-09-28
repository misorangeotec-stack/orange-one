import { Link, useParams, useSearchParams } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import DueCell from "@/shared/components/ui/DueCell";
import { formatDateDMY, formatDateTimeDMY } from "@/shared/lib/date";
import { appName, appBasePath } from "@/apps/appInfo";
import { useHelpStore } from "../../store";
import StatusPill, { ConfidentialPill } from "../../components/StatusPill";
import TicketActions from "../../components/TicketActions";
import TicketThread from "../../components/TicketThread";
import HandoffPanel from "../../components/HandoffPanel";
import { firstResponseMinutes } from "../../lib/queues";
import { stepByKey } from "../../lib/steps";
import { B } from "../../nav";
import NotFound from "../system/NotFound";

/**
 * One ticket: what was asked, where it is, and the whole story in one list.
 *
 * ⚠ ONE LIST, NOT TWO TABS. Every workflow event and every comment interleaved,
 *   in order. "HR asked whether it was the August payslip" and "HR resolved it"
 *   are the same story, and splitting them makes the reader merge two lists by
 *   hand to follow it. Modelled on TripThread and CandidateTimeline.
 *
 * ⚠ THE ACTIONS ARE ONLY THE ONES THE SERVER WOULD ACCEPT. TicketActions
 *   renders nothing at all when the reader owes nothing on this ticket — no
 *   greyed-out "Resolve", because that reads as a permission problem, which is a
 *   different and much more alarming thing than "not your turn". The one
 *   exception is a HELD ticket, which keeps its buttons greyed WITH THE REASON.
 *
 * ⚠ STILL MISSING (HD-5): the employee confirming a resolution or reopening it.
 *   Until then a resolved ticket sits at `confirm` with nobody able to clear it,
 *   which is why HD-5 is the next phase rather than a later one.
 */
export default function TicketDetail() {
  const { id } = useParams();
  const s = useHelpStore();
  const [params] = useSearchParams();
  const attachFailed = params.get("attachFailed");

  const ticket = s.tickets.find((t) => t.id === id);
  const cat = s.categoryById(ticket?.categoryId ?? null);

  if (s.loading) {
    return <div className="rounded-xl border border-line bg-white p-6 text-[13.5px] text-grey-2">Loading…</div>;
  }
  // ⚠ "NOT FOUND" AND "NOT ALLOWED" ARE THE SAME SCREEN HERE, DELIBERATELY. A
  //   confidential ticket is withheld by RLS, so it simply is not in `tickets`.
  //   Saying "you are not allowed to see this" would confirm that a grievance
  //   with that id EXISTS, which is exactly what the gate is for.
  if (!ticket) return <NotFound />;

  const due = ticket.currentStep ? s.dueIsoFor(ticket, ticket.currentStep) : null;
  const frt = firstResponseMinutes(ticket);

  return (
    <div className="mx-auto max-w-4xl">
      <Link to={`${B}/mine`} className="text-[12.5px] font-semibold text-grey-2 hover:text-navy">
        ← Back to my tickets
      </Link>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[20px] font-bold text-navy">{ticket.subject}</h1>
            <StatusPill status={ticket.status} />
            {cat?.confidential && <ConfidentialPill />}
          </div>
          <p className="mt-1 text-[13px] text-grey-2">
            {ticket.ticketNo} · {cat?.name ?? "Unknown category"} · raised by{" "}
            {s.personName(ticket.raisedBy)} on {formatDateDMY(ticket.raisedAt)}
          </p>
        </div>
        <TicketActions ticket={ticket} />
      </div>

      {attachFailed && (
        <div className="mt-3 rounded-xl border border-[#FEDF89] bg-[#FFFAEB] px-4 py-3">
          <p className="text-[13px] font-semibold text-[#B54708]">
            Your ticket was raised, but {attachFailed} did not upload
          </p>
          <p className="mt-0.5 text-[12.5px] text-[#B54708]">
            Nothing is lost — the question has been sent and somebody owes you an answer. Attach it
            again from the box at the foot of this page.
          </p>
        </div>
      )}

      {/* ── where it is ─────────────────────────────────────────────────── */}
      <Card className="mt-4 p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Fact label="With">
            {ticket.currentStep ? whoWith(ticket, s) : "Nobody — it is finished"}
          </Fact>
          <Fact label="Step">
            {ticket.currentStep ? (stepByKey(ticket.currentStep)?.title ?? ticket.currentStep) : "—"}
          </Fact>
          <Fact label="Due">
            {due ? (
              <DueCell dueIso={due} />
            ) : (
              /* Five categories are governed by policy rather than a number of
                 working days. The honest answer is the policy's own words — an
                 invented date would put a POSH complaint on somebody's overdue
                 list on a schedule nobody agreed to. */
              <span title="Governed by policy, not by a fixed number of working days">
                {cat?.tatText ?? "—"}
              </span>
            )}
          </Fact>
        </div>

        {ticket.otherNote && (
          <div className="mt-4 border-t border-line pt-4">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-grey-2">
              What it is about
            </p>
            <p className="mt-1 whitespace-pre-wrap text-[13.5px] text-navy">{ticket.otherNote}</p>
          </div>
        )}

        {ticket.body && (
          <div className="mt-4 border-t border-line pt-4">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-grey-2">Details</p>
            <p className="mt-1 whitespace-pre-wrap text-[13.5px] text-navy">{ticket.body}</p>
          </div>
        )}

        {frt !== null && (
          <div className="mt-4 border-t border-line pt-4">
            <p className="text-[12.5px] text-grey-2">
              First answered in <span className="font-semibold text-navy">{humanMinutes(frt)}</span>.
            </p>
          </div>
        )}

        {ticket.resolution && (
          <div className="mt-4 rounded-lg border border-[#A6F4C5] bg-[#F6FEF9] px-4 py-3">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-[#027A48]">
              Resolution
            </p>
            <p className="mt-1 whitespace-pre-wrap text-[13.5px] text-navy">{ticket.resolution}</p>
          </div>
        )}

        {ticket.reopenCount > 0 && (
          <p className="mt-3 text-[12.5px] text-[#B54708]">
            Reopened {ticket.reopenCount} time{ticket.reopenCount === 1 ? "" : "s"}.
            {ticket.escalatedL1At && ` Escalated to ${cat?.escalationL1Label ?? "level 1"}.`}
            {ticket.escalatedL2At && ` Escalated to ${cat?.escalationL2Label ?? "level 2"}.`}
          </p>
        )}
      </Card>

      <HandoffPanel ticket={ticket} />

      <TicketThread ticket={ticket} />
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[12px] font-semibold uppercase tracking-wide text-grey-2">{label}</p>
      <p className="mt-0.5 text-[13.5px] font-medium text-navy">{children}</p>
    </div>
  );
}

function whoWith(t: { id: string }, s: ReturnType<typeof useHelpStore>): string {
  const e = s.queueEntries.find((q) => q.ticketId === t.id);
  const names = (e?.ownerIds ?? []).map((id) => s.personName(id)).filter((n) => n !== "—");
  return names.length ? names.join(", ") : "Nobody — this category has no owner set";
}

/** "18 minutes", "3 hours", "2 days" — never "1080 minutes". */
function humanMinutes(m: number): string {
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"}`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"}`;
}
