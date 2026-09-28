import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import DueCell from "@/shared/components/ui/DueCell";
import { useHelpStore } from "../store";
import StatusPill from "../components/StatusPill";
import { stepByKey } from "../lib/steps";
import { B } from "../nav";

/**
 * The Help Desk landing screen.
 *
 * ⚠ IT OPENS ON THE READER'S OWN WORK, NOT ON THE DESK'S. Most people who land
 *   here have one ticket and one question — "where has mine got to?" — and
 *   greeting them with the department's throughput answers somebody else's
 *   question. The desk's own tiles appear underneath, and only for the desk.
 */
export default function Dashboard() {
  const s = useHelpStore();

  const myOpen = s.myTickets.filter((t) => t.status !== "closed" && t.status !== "cancelled");
  const owedByMe = s.myQueueEntries;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-bold text-navy">Help Desk</h1>
          <p className="mt-1 text-[13.5px] text-grey-2">
            Ask HR anything — attendance, payroll, leave, travel, admin. What you pick decides who
            answers it and by when.
          </p>
        </div>
        {s.canRaise && (
          <Link to={`${B}/new`}>
            <Button>Raise a ticket</Button>
          </Link>
        )}
      </div>

      {/* ── what is owed TO me ──────────────────────────────────────────── */}
      <Card className="mt-4 p-5">
        <h2 className="text-[15px] font-bold text-navy">My open tickets</h2>
        {myOpen.length === 0 ? (
          <p className="mt-2 text-[13px] text-grey-2">
            You have nothing open. {s.myTickets.length > 0 && "Everything you have asked is closed."}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {myOpen.slice(0, 6).map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link
                  to={`${B}/tickets/${t.id}`}
                  className="text-[13.5px] font-semibold text-navy hover:text-orange"
                >
                  {t.ticketNo} · {t.subject}
                </Link>
                <span className="flex items-center gap-3">
                  <StatusPill status={t.status} />
                  {t.currentStep && <DueCell dueIso={s.dueIsoFor(t, t.currentStep)} />}
                </span>
              </li>
            ))}
          </ul>
        )}
        {s.myTickets.length > 6 && (
          <Link to={`${B}/mine`} className="mt-3 inline-block text-[12.5px] font-semibold text-orange hover:underline">
            See all {s.myTickets.length}
          </Link>
        )}
      </Card>

      {/* ── what is owed BY me ──────────────────────────────────────────── */}
      {owedByMe.length > 0 && (
        <Card className="mt-4 p-5">
          <h2 className="text-[15px] font-bold text-navy">Waiting on you</h2>
          <p className="mt-1 text-[13px] text-grey-2">
            {/* This section is how an ORDINARY employee discovers they are holding
                something up — the two steps the desk does not own (answer a
                question, confirm a resolution) both land here. */}
            These are sitting with you. Until you answer, the ticket cannot move.
          </p>
          <ul className="mt-3 divide-y divide-line">
            {owedByMe.slice(0, 8).map((e) => (
              <li key={`${e.ticketId}-${e.stepKey}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link
                  to={`${B}/tickets/${e.ticketId}`}
                  className="text-[13.5px] font-semibold text-navy hover:text-orange"
                >
                  {e.ticketNo} · {e.subject}
                </Link>
                <span className="flex items-center gap-3 text-[12.5px] text-grey-2">
                  <span>{stepByKey(e.stepKey)?.title ?? e.stepKey}</span>
                  {e.dueIso ? (
                    <DueCell dueIso={e.dueIso} />
                  ) : (
                    <span title="Governed by policy, not by a fixed number of working days">
                      {e.tatText ?? "—"}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ── the desk's own view ─────────────────────────────────────────── */}
      {s.isDeskStaff && (
        <Card className="mt-4 p-5">
          <h2 className="text-[15px] font-bold text-navy">The desk</h2>
          <p className="mt-1 text-[13px] text-grey-2">
            {/* ⚠ "Open" here is open TO THIS READER. Confidential tickets are
                withheld by RLS, so this is not a departmental total and must not
                be presented as one. */}
            {s.queueEntries.length} open ticket{s.queueEntries.length === 1 ? "" : "s"} you can see.
            Grievance, POSH and disciplinary tickets are counted only by their own owner.
          </p>
          <Link
            to={`${B}/tickets`}
            className="mt-3 inline-block text-[12.5px] font-semibold text-orange hover:underline"
          >
            Open the ticket list
          </Link>
        </Card>
      )}
    </div>
  );
}
