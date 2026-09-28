import { useMemo } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { useSession } from "@/core/platform/session";
import { useLdStore } from "../store";
import { B, QUEUE_PATH } from "../nav";
import { dmy } from "../lib/format";
import StatusPill from "../components/StatusPill";
import { REQUEST_STEPS, stepByKey } from "../lib/steps";
import { isOpen } from "../lib/queues";

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card className="p-4">
      <div className="text-[12px] uppercase tracking-wide text-grey-2">{label}</div>
      <div className="mt-1 text-[24px] font-bold text-navy">{value}</div>
      {hint && <div className="mt-0.5 text-[12px] text-grey-2">{hint}</div>}
    </Card>
  );
}

/**
 * The L&D dashboard.
 *
 * ⚠ IT OPENS DIFFERENTLY FOR DIFFERENT PEOPLE, deliberately. This module is
 *   universal, so most of its readers are participants, not HR — and a wall of
 *   approval queues is meaningless to them. Everyone gets the upcoming sessions;
 *   the pipeline strip appears only for people who own a step.
 */
export default function Dashboard() {
  const s = useLdStore();
  const { user } = useSession();

  const todayIso = new Date().toISOString().slice(0, 10);

  const upcoming = useMemo(
    () =>
      [...s.sessions]
        .filter((x) => x.sessionDate >= todayIso && !["cancelled"].includes(x.status))
        .sort((a, b) => a.sessionDate.localeCompare(b.sessionDate))
        .slice(0, 6),
    [s.sessions, todayIso],
  );

  const mine = useMemo(
    () => s.requests.filter((r) => r.requestedBy === user?.id),
    [s.requests, user?.id],
  );

  const myOpen = mine.filter(isOpen);

  /*
   * ⚠ A HOD HAS TO BE ABLE TO FIND THEIR 30-DAY REVIEW. RLS only shows a HOD
   *   their own rows, so this list is theirs by construction. Without it the only
   *   route to the form is the notification, and a notification read on a phone
   *   three weeks ago is not a route.
   */
  const myReviews = (s.data?.effectiveness ?? []).filter(
    (e) => e.hodId === user?.id && !e.submittedAt,
  );
  const overdueCount = s.queueEntries.filter(
    (e) => s.canSeeQueue(e.stepKey) && e.dueIso && e.dueIso < todayIso,
  ).length;
  const mineCount = s.queueEntries.filter((e) => s.canSeeQueue(e.stepKey)).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-navy">Learning &amp; Development</h1>
          <p className="text-[13.5px] text-grey-2 mt-1">
            Training from the need through to the record that it worked.
          </p>
        </div>
        {s.canRaise && (
          <Link to={`${B}/requests/new`}>
            <Button>Raise a training need</Button>
          </Link>
        )}
      </div>

      {myReviews.length > 0 && (
        <Card className="border-orange/40 bg-[#FFF8F4] p-5">
          <h2 className="text-[15px] font-semibold text-navy">Your team was trained — did it help?</h2>
          <p className="text-[13px] text-grey-2 mt-0.5">
            You are asked 30 days after the session. It takes a rating and a sentence.
          </p>
          <div className="mt-3 space-y-1.5">
            {myReviews.map((e) => {
              const x = s.sessions.find((v) => v.id === e.sessionId);
              if (!x) return null;
              return (
                <Link
                  key={e.id}
                  to={`${B}/sessions/${x.id}`}
                  className="flex items-baseline justify-between gap-3 rounded-lg bg-white px-3 py-2 hover:text-orange"
                >
                  <span className="text-[13.5px] text-navy">{x.title}</span>
                  <span className="text-[12.5px] text-grey-2">due {dmy(e.dueOn)}</span>
                </Link>
              );
            })}
          </div>
        </Card>
      )}

      {s.isPipelineStaff && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="On your desk" value={mineCount} hint="Across every step you own" />
          <Stat label="Overdue" value={overdueCount} hint={overdueCount ? "Past the configured SLA" : "Nothing late"} />
          <Stat label="Open requests" value={s.requests.filter(isOpen).length} />
          <Stat label="Sessions ahead" value={upcoming.length} />
        </div>
      )}

      {s.isPipelineStaff && (
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold text-navy mb-3">Where the pipeline is</h2>
          <div className="flex flex-wrap gap-2">
            {REQUEST_STEPS.filter((k) => s.offersQueue(k)).map((key) => {
              const n = s.entriesForStep(key).length;
              return (
                <Link
                  key={key}
                  to={`${B}/queues/${QUEUE_PATH[key]}`}
                  className="rounded-xl border border-line bg-white px-4 py-3 transition hover:border-orange"
                >
                  <div className="text-[12px] text-grey-2">{stepByKey(key)?.short ?? key}</div>
                  <div className="text-[18px] font-bold text-navy">{n}</div>
                </Link>
              );
            })}
          </div>
          {REQUEST_STEPS.filter((k) => s.offersQueue(k)).length === 0 && (
            <p className="text-[13px] text-grey-2">
              You don't own any step yet. An admin assigns those in Setup → Step Owners.
            </p>
          )}
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-navy">Coming up</h2>
            <Link to={`${B}/calendar`} className="text-[13px] font-medium text-orange hover:underline">
              Full calendar
            </Link>
          </div>
          {upcoming.length === 0 ? (
            <p className="mt-2 text-[13px] text-grey-2">Nothing scheduled yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {upcoming.map((x) => (
                <li key={x.id} className="flex items-baseline justify-between gap-3">
                  <span className="text-[13.5px] text-navy">{x.title}</span>
                  <span className="shrink-0 text-[12.5px] text-grey-2">{dmy(x.sessionDate)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-navy">What you asked for</h2>
            <Link to={`${B}/my-requests`} className="text-[13px] font-medium text-orange hover:underline">
              All of mine
            </Link>
          </div>
          {myOpen.length === 0 ? (
            <p className="mt-2 text-[13px] text-grey-2">
              You have nothing open. Spotted a gap in your team? Raise it.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {myOpen.slice(0, 6).map((r) => (
                <li key={r.id} className="flex items-baseline justify-between gap-3">
                  <Link to={`${B}/requests/${r.id}`} className="text-[13.5px] text-navy hover:text-orange">
                    {r.title}
                  </Link>
                  <StatusPill status={r.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
