import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { useLdStore } from "../../store";
import { dmy } from "../../lib/format";
import { CATEGORY_LABEL, CATEGORY_TONE, endsAt, hm, isCancelled, isCompleted, sessionHours, startsAt, trainerLabel } from "../../lib/training";
import TrainingFormModal from "./TrainingFormModal";
import CancelModal from "./CancelModal";
import CompleteModal from "./CompleteModal";
import type { TrainingSession } from "../../types";

const ATT_TONE: Record<string, string> = {
  present: "bg-[#E8F7EE] text-ryg-green",
  partial: "bg-[#FFF7E6] text-yellow",
  absent: "bg-[#FDECEC] text-ryg-red",
};

/**
 * The top of a training's page: the Teams link, who runs it, who is on it, and
 * the three actions HR asked for — Edit, Cancel, Complete.
 *
 * Shown for EVERY session, so a request-born one can also be cancelled with the
 * same rule; Edit is offered only on calendar trainings (a request-born session
 * keeps its own step-by-step panels below).
 */
export default function CalendarTrainingPanel({ session: x }: { session: TrainingSession }) {
  const s = useLdStore();
  const d = s.data;
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [completing, setCompleting] = useState(false);

  const attendees = useMemo(
    () =>
      (d?.nominations ?? [])
        .filter((n) => n.sessionId === x.id && n.status === "approved")
        .map((n) => ({
          n,
          name: s.personName(n.employeeId),
          att: (d?.attendance ?? []).find((a) => a.sessionId === x.id && a.employeeId === n.employeeId),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [d?.nominations, d?.attendance, x.id, s.personName],
  );

  const cancelled = isCancelled(x);
  const completed = isCompleted(x);
  const now = new Date();
  const started = now >= startsAt(x);
  const isCalendar = x.source === "calendar";

  const canEdit = isCalendar && s.canManageCalendar && !cancelled && !completed;
  const canCancel =
    !cancelled && !completed && !x.actualStart &&
    (s.canManageCalendar || s.canActOnSession("conducted", x.id));
  const canComplete = isCalendar && !cancelled && !completed && s.canCompleteSession(x.id);
  const present = attendees.filter((a) => a.att?.status === "present" || a.att?.status === "partial").length;
  const mailed = attendees.filter((a) => a.n.inviteMailedAt).length;

  const inviteDue = new Date(startsAt(x).getTime() - 3 * 86_400_000);

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {x.category && (
              <span className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${CATEGORY_TONE[x.category]}`}>
                {CATEGORY_LABEL[x.category]} training
              </span>
            )}
            {cancelled && (
              <span className="rounded-full bg-[#FDECEC] px-2.5 py-0.5 text-[11.5px] font-semibold text-ryg-red">Cancelled</span>
            )}
            {completed && !cancelled && (
              <span className="rounded-full bg-[#E8F7EE] px-2.5 py-0.5 text-[11.5px] font-semibold text-ryg-green">Completed</span>
            )}
          </div>
          <div className="text-[14px] text-navy">
            <b>{dmy(x.sessionDate)}</b> · {hm(x.startTime)}–{hm(x.endTime)} · {sessionHours(x)} h
            <span className="text-grey-2"> · Trainer: {trainerLabel(x, d?.trainers ?? [], s.personName)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {x.meetingLink && !cancelled && !completed && (
            <a href={x.meetingLink} target="_blank" rel="noreferrer">
              <Button className="!bg-[#5B5FC7] !bg-none">Join on Teams</Button>
            </a>
          )}
          {canComplete && (
            <Button
              variant="progress"
              disabled={!started}
              title={started ? undefined : "Available once the training has started"}
              onClick={() => setCompleting(true)}
            >
              Complete
            </Button>
          )}
          {canEdit && <Button variant="ghost" onClick={() => setEditing(true)}>Edit</Button>}
          {canCancel && <Button variant="ghost" onClick={() => setCancelling(true)}>Cancel training</Button>}
        </div>
      </div>

      {x.description && <p className="mt-3 whitespace-pre-line text-[13.5px] text-navy">{x.description}</p>}

      {cancelled && x.changeReason && (
        <p className="mt-3 rounded-lg bg-[#FDECEC] px-3 py-2 text-[13px] text-navy">
          <b>Cancelled{x.cancelledAt ? ` on ${dmy(x.cancelledAt)}` : ""}</b>
          {x.cancelledBy ? ` by ${s.personName(x.cancelledBy)}` : ""}: {x.changeReason}
          <span className="text-grey-2">
            {" "}· {x.cancelMailSentAt ? "cancellation mail sent" : "no cancellation mail (the invite had not gone out)"}
          </span>
        </p>
      )}

      {/* Mail status — so HR can see whether the 3-day invite has gone. */}
      {!cancelled && !completed && (
        <p className="mt-3 text-[12.5px] text-grey-2">
          {mailed > 0
            ? `Invitation mail sent to ${mailed} of ${attendees.length}.`
            : endsAt(x) < now
            ? "No invitation mail was sent."
            : `Invitation mail goes out on ${dmy(inviteDue.toISOString())} (3 days before).`}
        </p>
      )}

      <div className="mt-4 border-t border-line pt-3">
        <div className="mb-2 text-[12.5px] font-semibold text-navy">
          Attendees · {attendees.length}
          {completed && <span className="font-normal text-grey-2"> · {present} attended</span>}
        </div>
        {attendees.length === 0 ? (
          <p className="text-[13px] text-grey-2">Nobody on this training yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {attendees.map((a) => (
              <span
                key={a.n.id}
                className={
                  "rounded-full px-2.5 py-1 text-[12px] " +
                  (a.att ? ATT_TONE[a.att.status] ?? "bg-[#F1F4F9] text-grey-2" : "bg-[#F1F4F9] text-navy")
                }
                title={a.att ? a.att.status : a.n.inviteMailedAt ? "Invitation mailed" : undefined}
              >
                {a.name}
                {a.att && ` · ${a.att.status === "present" ? "Present" : a.att.status === "absent" ? "Absent" : a.att.status}`}
              </span>
            ))}
          </div>
        )}
      </div>

      {editing && <TrainingFormModal open={editing} onClose={() => setEditing(false)} session={x} />}
      {cancelling && <CancelModal open={cancelling} onClose={() => setCancelling(false)} session={x} />}
      {completing && <CompleteModal open={completing} onClose={() => setCompleting(false)} session={x} />}
    </Card>
  );
}
