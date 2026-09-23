import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { useSession } from "@/core/platform/session";
import { useLdStore } from "../../store";
import { B } from "../../nav";
import { dmy, inr } from "../../lib/format";
import NotFound from "../system/NotFound";
import NominationsPanel from "../../components/session/NominationsPanel";
import MaterialPanel from "../../components/session/MaterialPanel";
import ConductPanel from "../../components/session/ConductPanel";
import AttendancePanel from "../../components/session/AttendancePanel";
import AssignmentPanel from "../../components/session/AssignmentPanel";
import FeedbackPanel from "../../components/session/FeedbackPanel";
import ReviewPanel from "../../components/session/ReviewPanel";
import EffectivenessPanel from "../../components/session/EffectivenessPanel";

const STATUS_LABEL: Record<string, string> = {
  scheduled: "Scheduled",
  nomination_open: "Nominations open",
  invited: "Invitations sent",
  ready: "Ready to run",
  conducted: "Conducted",
  attendance_closed: "Attendance closed",
  in_review: "Reviewed",
  closed: "Closed",
  rescheduled: "Rescheduled",
  cancelled: "Cancelled",
};

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11.5px] uppercase tracking-wide text-grey-2">{label}</div>
      <div className="text-[13.5px] text-navy">{children}</div>
    </div>
  );
}

/**
 * One training session, and every step that happens on it — nomination, RSVP,
 * material, conduct, attendance, the assignment, feedback, the HR review and the
 * 30-day effectiveness notes.
 *
 * ⚠ ONE PAGE, NOT NINE SCREENS. These steps all act on the same session and are
 *   worked in order over days; splitting them into separate routes would mean the
 *   person marking attendance cannot see who accepted, and the person reviewing
 *   cannot see what was marked. Each panel renders as a card and each decides for
 *   itself whether this reader can act on it.
 *
 * ⚠ PANELS APPEAR WHEN THEY BECOME RELEVANT, not all at once. Attendance before
 *   the session has run is a form nobody can honestly fill; showing it disabled
 *   teaches people to ignore greyed-out cards.
 */
export default function SessionDetail() {
  const { id = "" } = useParams();
  const s = useLdStore();
  const nav = useNavigate();
  const { user } = useSession();
  const [err, setErr] = useState<string | null>(null);

  const x = s.sessions.find((v) => v.id === id);
  const d = s.data;

  const noms = useMemo(
    () => (d?.nominations ?? []).filter((n) => n.sessionId === id),
    [d?.nominations, id],
  );

  if (!s.loading && !x) return <NotFound />;
  if (!x || !d) return <div className="p-6 text-[13.5px] text-grey-2">Loading…</div>;

  const trainer = d.trainers.find((t) => t.id === x.trainerId);
  const venue = d.venues.find((v) => v.id === x.venueId);
  const req = x.requestId ? s.requestById(x.requestId) : undefined;
  const types = d.sessionTypes.filter((t) => x.sessionTypeIds.includes(t.id)).map((t) => t.name);
  const approved = noms.filter((n) => n.status === "approved");
  const iAmOnIt = approved.some((n) => n.employeeId === user?.id);

  const conducted = !!x.actualStart || x.status === "conducted" || !!x.attendanceClosedAt;
  const attendanceClosed = !!x.attendanceClosedAt;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[22px] font-bold text-navy">{x.code ?? "Session"}</h1>
            <span className="rounded-full bg-[#EAF1FE] px-2.5 py-0.5 text-[11.5px] font-semibold text-blue">
              {STATUS_LABEL[x.status] ?? x.status}
            </span>
            {iAmOnIt && (
              <span className="rounded-full bg-[#FFF1E8] px-2.5 py-0.5 text-[11.5px] font-semibold text-orange">
                You are on this
              </span>
            )}
          </div>
          <p className="text-[14px] text-navy mt-1">{x.title}</p>
        </div>
        <div className="flex gap-2">
          {req && (
            <Link to={`${B}/requests/${req.id}`}>
              <Button variant="ghost">The request</Button>
            </Link>
          )}
          <Button variant="ghost" onClick={() => nav(`${B}/calendar`)}>Calendar</Button>
        </div>
      </div>

      <Card className="p-5">
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <Fact label="Date">{dmy(x.sessionDate)}</Fact>
          <Fact label="Time">
            {x.startTime ? `${x.startTime.slice(0, 5)}–${(x.endTime ?? "").slice(0, 5)}` : "—"}
          </Fact>
          <Fact label="Hours">{x.hours ?? "—"}</Fact>
          <Fact label="Trainer">
            {trainer ? `${trainer.name}${trainer.trainerType === "external" ? " (agency)" : ""}` : "—"}
          </Fact>
          {/* ⚠ THE LINK IS THE WHOLE POINT OF AN ONLINE SESSION. Showing the word
                "Online" and keeping the joining link in a column nobody renders
                is how a nominee arrives at the hour and cannot get in. */}
          <Fact label="Where">
            {x.meetingLink ? (
              <a
                href={x.meetingLink}
                target="_blank"
                rel="noreferrer"
                className="text-orange underline underline-offset-2"
              >
                {venue?.name ?? "Join online"}
              </a>
            ) : (
              venue?.name ?? "—"
            )}
          </Fact>
          <Fact label="Type">{types.length ? types.join(", ") : "—"}</Fact>
          <Fact label="Capacity">{x.capacity ?? "—"}</Fact>
          <Fact label="Nominated">{approved.length}</Fact>
          <Fact label="Accepted">{approved.filter((n) => n.rsvp === "accepted").length}</Fact>
          <Fact label="Cost">{inr(x.actualCost ?? req?.approvedBudget ?? null)}</Fact>
        </div>
        {x.changeReason && (
          <p className="mt-3 rounded-lg bg-[#FFF7E6] px-3 py-2 text-[13px] text-navy">
            <strong>{x.status === "cancelled" ? "Cancelled" : "Rescheduled"}:</strong> {x.changeReason}
          </p>
        )}
      </Card>

      {err && <p className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-[13px] text-[#B42318]">{err}</p>}

      <NominationsPanel session={x} nominations={noms} onError={setErr} />
      <MaterialPanel session={x} onError={setErr} />
      {(x.readinessConfirmedAt || conducted) && <ConductPanel session={x} onError={setErr} />}
      {conducted && <AttendancePanel session={x} nominations={noms} onError={setErr} />}
      {attendanceClosed && <AssignmentPanel session={x} onError={setErr} />}
      {conducted && <FeedbackPanel session={x} nominations={noms} onError={setErr} />}
      {attendanceClosed && <ReviewPanel session={x} onError={setErr} />}
      {attendanceClosed && <EffectivenessPanel session={x} onError={setErr} />}
    </div>
  );
}
