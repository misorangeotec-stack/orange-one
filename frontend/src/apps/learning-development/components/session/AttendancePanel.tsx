import { useMemo, useState } from "react";
import Button from "@/shared/components/ui/Button";
import { useLdStore } from "../../store";
import { dmy } from "../../lib/format";
import { Panel, NotYours, useRun } from "./panelKit";
import type { AttendanceStatus, Nomination, TrainingSession } from "../../types";

const CHOICES: { value: AttendanceStatus; label: string; tone: string }[] = [
  { value: "present", label: "Present", tone: "border-ryg-green text-ryg-green" },
  { value: "partial", label: "Partial", tone: "border-yellow text-yellow" },
  { value: "absent", label: "Absent", tone: "border-ryg-red text-ryg-red" },
  { value: "approved_exception", label: "Excused", tone: "border-blue text-blue" },
];

/**
 * Step 14 — who actually came.
 *
 * ⚠ CLOSING IS BLOCKED UNTIL EVERY NOMINEE HAS A STATUS (§3 step 11, §13), and
 *   closing ALSO creates the 30-day HOD reviews. The two are one action so the
 *   reviews cannot be forgotten, and so "attendance closed" and "reviews
 *   outstanding" can never disagree.
 *
 * ⚠ THE "NO REVIEWER" COUNT IS SHOWN, NOT SWALLOWED. Some attendees resolve to
 *   no HOD at all (19 of 67 people on 21-09-2026) and no review can be created
 *   for them. Reporting the reviews as complete would certify a control that does
 *   not exist.
 */
export default function AttendancePanel({
  session: x,
  nominations,
  onError,
}: {
  session: TrainingSession;
  nominations: Nomination[];
  onError: (m: string | null) => void;
}) {
  const s = useLdStore();
  const { busy, run } = useRun(onError);
  const [draft, setDraft] = useState<Record<string, AttendanceStatus>>({});
  const [closed, setClosed] = useState<{ hod_tasks: number; no_reviewer: number } | null>(null);

  const mayAct = s.canActOnSession("attendance", x.id);
  const rows = (s.data?.attendance ?? []).filter((a) => a.sessionId === x.id);
  const byEmp = useMemo(() => new Map(rows.map((a) => [a.employeeId, a] as const)), [rows]);
  const approved = nominations.filter((n) => n.status === "approved");

  const statusOf = (empId: string): AttendanceStatus | undefined =>
    draft[empId] ?? byEmp.get(empId)?.status;

  const unmarked = approved.filter((n) => !statusOf(n.employeeId)).length;
  const present = approved.filter((n) => ["present", "partial"].includes(statusOf(n.employeeId) ?? "")).length;
  const pct = approved.length ? Math.round((present / approved.length) * 100) : 0;

  const save = () =>
    run(
      () =>
        s.writes.markAttendance(
          x.id,
          Object.entries(draft).map(([employeeId, status]) => ({ employeeId, status })),
        ),
      () => setDraft({}),
    );

  return (
    <Panel
      title="Attendance"
      hint={
        x.attendanceClosedAt
          ? `Closed ${dmy(x.attendanceClosedAt)} · ${present} of ${approved.length} attended (${pct}%)`
          : `${present} of ${approved.length} marked as attending${unmarked ? ` · ${unmarked} still unmarked` : ""}`
      }
      right={
        mayAct && !x.attendanceClosedAt ? (
          <div className="flex gap-2">
            {Object.keys(draft).length > 0 && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save()}>
                Save marks
              </Button>
            )}
            <Button
              size="sm"
              disabled={busy || unmarked > 0}
              onClick={() =>
                void run(async () => {
                  if (Object.keys(draft).length > 0) {
                    await s.writes.markAttendance(
                      x.id,
                      Object.entries(draft).map(([employeeId, status]) => ({ employeeId, status })),
                    );
                  }
                  setClosed(await s.writes.closeAttendance(x.id));
                })
              }
            >
              Close attendance
            </Button>
          </div>
        ) : undefined
      }
    >
      {approved.length === 0 ? (
        <p className="text-[13px] text-grey-2">Nobody was nominated, so there is nothing to mark.</p>
      ) : (
        <div className="space-y-1.5">
          {approved.map((n) => {
            const cur = statusOf(n.employeeId);
            const rec = byEmp.get(n.employeeId);
            return (
              <div
                key={n.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2"
              >
                <div className="min-w-0">
                  <span className="text-[13.5px] text-navy">{s.personName(n.employeeId)}</span>
                  {n.rsvp === "declined" && (
                    <span className="ml-2 text-[12px] text-grey-2">had declined</span>
                  )}
                  {rec?.status === "absent" && !rec.followedUpAt && mayAct && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-2"
                      disabled={busy}
                      onClick={() => void run(() => s.writes.followUpAbsentee(rec.id))}
                    >
                      Mark followed up
                    </Button>
                  )}
                  {rec?.followedUpAt && (
                    <span className="ml-2 text-[12px] text-ryg-green">followed up</span>
                  )}
                </div>
                <div className="flex gap-1">
                  {CHOICES.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      disabled={!mayAct || !!x.attendanceClosedAt || busy}
                      onClick={() => setDraft((d) => ({ ...d, [n.employeeId]: c.value }))}
                      className={
                        "rounded-lg border px-2.5 py-1 text-[12px] font-medium transition disabled:opacity-60 " +
                        (cur === c.value ? `${c.tone} bg-white` : "border-line text-grey-2 hover:border-orange")
                      }
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {closed && (
        <div className="rounded-lg bg-[#F8FAFD] px-3 py-2 text-[13px] text-navy">
          Attendance closed. <strong>{closed.hod_tasks}</strong> HOD review
          {closed.hod_tasks === 1 ? "" : "s"} created, due 30 days after the session.
          {closed.no_reviewer > 0 && (
            <span className="text-ryg-red">
              {" "}
              ⚠ {closed.no_reviewer} attendee{closed.no_reviewer === 1 ? " has" : "s have"} no HOD recorded, so
              nobody can be asked about them. Their reporting line needs setting up.
            </span>
          )}
        </div>
      )}

      {!mayAct && !x.attendanceClosedAt && <NotYours stepKey="attendance" what="Marking attendance" />}
      {mayAct && unmarked > 0 && !x.attendanceClosedAt && (
        <p className="text-[12px] text-grey-2">
          Everybody needs a mark before attendance can close — {unmarked} to go.
        </p>
      )}
    </Panel>
  );
}
