import { useMemo } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import { useSession } from "@/core/platform/session";
import { useLdStore } from "../store";
import { B } from "../nav";
import { dmy } from "../lib/format";

/**
 * My Learning — the screen almost everybody in the company opens, and for most
 * of them the only one.
 *
 * It answers four questions and nothing else: what am I invited to, what do I
 * owe, what did I learn, and how many hours have I done this year. The pipeline,
 * the budgets and the queues are HR's and are nowhere near this page.
 *
 * ⚠ LEARNING HOURS COUNT ATTENDANCE, NOT NOMINATION. Present earns the session's
 *   full hours; `partial` earns its recorded minutes. Counting a nomination would
 *   credit somebody for a session they skipped, which is exactly the number
 *   `SK-3` (10 hours per employee per year) is meant to catch.
 */
export default function MyLearning() {
  const s = useLdStore();
  const { user } = useSession();
  const me = user?.id ?? "";
  const d = s.data;
  const todayIso = new Date().toISOString().slice(0, 10);
  const yearStart = `${new Date().getFullYear()}-01-01`;

  const myNoms = useMemo(
    () => (d?.nominations ?? []).filter((n) => n.employeeId === me && n.status === "approved"),
    [d?.nominations, me],
  );
  const sessionOf = (id: string) => s.sessions.find((x) => x.id === id);

  const toAnswer = myNoms.filter((n) => n.invitedAt && n.rsvp === "pending");
  const upcoming = myNoms
    .map((n) => sessionOf(n.sessionId))
    .filter((x): x is NonNullable<typeof x> => !!x && x.sessionDate >= todayIso && x.status !== "cancelled")
    .sort((a, b) => a.sessionDate.localeCompare(b.sessionDate));

  const myAttendance = (d?.attendance ?? []).filter((a) => a.employeeId === me);
  const hours = myAttendance.reduce((n, a) => {
    const x = sessionOf(a.sessionId);
    if (!x || x.sessionDate < yearStart) return n;
    if (a.status === "present") return n + (x.hours ?? 0);
    if (a.status === "partial") return n + (a.minutes ?? 0) / 60;
    return n;
  }, 0);

  const mySubs = (d?.submissions ?? []).filter((v) => v.employeeId === me);
  const owed = mySubs.filter((v) => !v.submittedAt);
  const myFeedbackFor = new Set((d?.feedback ?? []).filter((f) => f.employeeId === me).map((f) => f.sessionId));
  const feedbackOwed = myAttendance
    .filter((a) => ["present", "partial"].includes(a.status) && !myFeedbackFor.has(a.sessionId))
    .map((a) => sessionOf(a.sessionId))
    .filter((x): x is NonNullable<typeof x> => !!x);

  const attended = myAttendance.filter((a) => ["present", "partial"].includes(a.status));

  const Empty = ({ children }: { children: React.ReactNode }) => (
    <p className="text-[13px] text-grey-2">{children}</p>
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">My learning</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          What you are invited to, what you owe, and what you have done this year.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <div className="text-[12px] uppercase tracking-wide text-grey-2">Hours this year</div>
          <div className="mt-1 text-[24px] font-bold text-navy">{hours.toFixed(1)}</div>
          <div className="text-[12px] text-grey-2">Target 10</div>
        </Card>
        <Card className="p-4">
          <div className="text-[12px] uppercase tracking-wide text-grey-2">Sessions attended</div>
          <div className="mt-1 text-[24px] font-bold text-navy">{attended.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[12px] uppercase tracking-wide text-grey-2">Things you owe</div>
          <div className="mt-1 text-[24px] font-bold text-navy">{owed.length + feedbackOwed.length}</div>
          <div className="text-[12px] text-grey-2">
            {owed.length} assignment{owed.length === 1 ? "" : "s"} · {feedbackOwed.length} feedback
          </div>
        </Card>
      </div>

      {toAnswer.length > 0 && (
        <Card className="border-orange/40 bg-[#FFF8F4] p-5">
          <h2 className="text-[15px] font-semibold text-navy">Please answer</h2>
          <div className="mt-2 space-y-1.5">
            {toAnswer.map((n) => {
              const x = sessionOf(n.sessionId);
              if (!x) return null;
              return (
                <Link
                  key={n.id}
                  to={`${B}/sessions/${x.id}`}
                  className="flex items-baseline justify-between gap-3 rounded-lg bg-white px-3 py-2 hover:text-orange"
                >
                  <span className="text-[13.5px] text-navy">{x.title}</span>
                  <span className="text-[12.5px] text-grey-2">{dmy(x.sessionDate)}</span>
                </Link>
              );
            })}
          </div>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold text-navy">Coming up for you</h2>
          {upcoming.length === 0 ? (
            <div className="mt-2">
              <Empty>Nothing booked. The training calendar shows what is planned for everybody.</Empty>
            </div>
          ) : (
            <ul className="mt-3 space-y-2">
              {upcoming.map((x) => (
                <li key={x.id} className="flex items-baseline justify-between gap-3">
                  <Link to={`${B}/sessions/${x.id}`} className="text-[13.5px] text-navy hover:text-orange">
                    {x.title}
                  </Link>
                  <span className="shrink-0 text-[12.5px] text-grey-2">{dmy(x.sessionDate)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="text-[15px] font-semibold text-navy">Still to do</h2>
          {owed.length === 0 && feedbackOwed.length === 0 ? (
            <div className="mt-2"><Empty>Nothing outstanding.</Empty></div>
          ) : (
            <ul className="mt-3 space-y-2">
              {owed.map((v) => {
                const a = (d?.assignments ?? []).find((z) => z.id === v.assignmentId);
                const x = a ? sessionOf(a.sessionId) : undefined;
                if (!a || !x) return null;
                return (
                  <li key={v.id} className="flex items-baseline justify-between gap-3">
                    <Link to={`${B}/sessions/${x.id}`} className="text-[13.5px] text-navy hover:text-orange">
                      Assignment: {a.title}
                    </Link>
                    <span className="shrink-0 text-[12.5px] text-grey-2">due {dmy(a.dueAt)}</span>
                  </li>
                );
              })}
              {feedbackOwed.map((x) => (
                <li key={`fb-${x.id}`} className="flex items-baseline justify-between gap-3">
                  <Link to={`${B}/sessions/${x.id}`} className="text-[13.5px] text-navy hover:text-orange">
                    Feedback: {x.title}
                  </Link>
                  <span className="shrink-0 text-[12.5px] text-grey-2">{dmy(x.sessionDate)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="text-[15px] font-semibold text-navy">What you have done</h2>
        {attended.length === 0 ? (
          <div className="mt-2"><Empty>No training recorded yet.</Empty></div>
        ) : (
          <div className="mt-3 space-y-1.5">
            {attended.map((a) => {
              const x = sessionOf(a.sessionId);
              if (!x) return null;
              return (
                <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                  <Link to={`${B}/sessions/${x.id}`} className="text-[13.5px] text-navy hover:text-orange">
                    {x.title}
                  </Link>
                  <span className="text-[12.5px] text-grey-2">
                    {dmy(x.sessionDate)} · {a.status === "partial" ? `${((a.minutes ?? 0) / 60).toFixed(1)} h (partial)` : `${x.hours ?? 0} h`}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
