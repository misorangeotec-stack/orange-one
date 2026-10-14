import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import { useLdStore } from "../../store";
import { B } from "../../nav";
import { dmy } from "../../lib/format";
import {
  CATEGORY_LABEL,
  CATEGORY_TONE,
  hm,
  isAttendancePending,
  isCancelled,
  isCompleted,
  sessionHours,
  trainerLabel,
} from "../../lib/training";
import type { TrainingSession } from "../../types";

/** What the dashboard is drilled into. */
export type DashDetail =
  | { kind: "trainings"; title: string; rows: TrainingSession[] }
  /** Everyone who attended — or exactly `ids` (an hours band, zero-hour people included). */
  | { kind: "people"; title?: string; ids?: string[] }
  | { kind: "person"; id: string };

export interface PersonHours {
  id: string;
  name: string;
  dept: string;
  hours: number;
  trainings: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The card the dashboard opens IN PLACE when a tile or a bar is clicked —
 * HR's ask of 14-10-2026: "click on it and the list comes on the same page".
 * Three shapes: a list of trainings, everyone who attended with their hours,
 * or one person's trainings.
 */
export default function DashboardDetail({
  detail,
  onChange,
  onClose,
  people,
  from,
  to,
  target,
}: {
  detail: DashDetail;
  onChange: (d: DashDetail) => void;
  onClose: () => void;
  /** Everyone, with hours in the period — already computed by the dashboard. */
  people: PersonHours[];
  from: string;
  to: string;
  target: number;
}) {
  const s = useLdStore();
  const d = s.data;
  const noms = d?.nominations ?? [];
  const att = d?.attendance ?? [];
  const attendeesOf = (id: string) => noms.filter((n) => n.sessionId === id && n.status === "approved").length;
  const presentOf = (id: string) =>
    att.filter((a) => a.sessionId === id && (a.status === "present" || a.status === "partial")).length;

  const status = (x: TrainingSession) =>
    isCancelled(x) ? (
      <span className="text-ryg-red">Cancelled</span>
    ) : isCompleted(x) ? (
      <span className="text-ryg-green">Completed</span>
    ) : isAttendancePending(x) ? (
      <span className="font-semibold text-[#B45309]">Attendance pending</span>
    ) : (
      <span className="text-navy">Scheduled</span>
    );

  let title = "";
  let body: React.ReactNode = null;

  if (detail.kind === "trainings") {
    title = `${detail.title} · ${detail.rows.length}`;
    body = (
      <table className="w-full text-[13px]">
        <thead className="sticky top-0 bg-[#F6F9FD] text-left text-[12px] text-grey-2">
          <tr>
            <th className="px-3 py-2">Date</th>
            <th className="px-3 py-2">Time</th>
            <th className="px-3 py-2">Training</th>
            <th className="px-3 py-2">Category</th>
            <th className="px-3 py-2">Trainer</th>
            <th className="px-3 py-2 text-right">Attended</th>
            <th className="px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {detail.rows.map((x) => (
            <tr key={x.id} className="border-t border-line">
              <td className="px-3 py-1.5 whitespace-nowrap">{dmy(x.sessionDate)}</td>
              <td className="px-3 py-1.5 whitespace-nowrap">{hm(x.startTime)}–{hm(x.endTime)}</td>
              <td className="px-3 py-1.5">
                <Link to={`${B}/sessions/${x.id}`} className="text-navy hover:text-orange">{x.title}</Link>
              </td>
              <td className="px-3 py-1.5">
                {x.category ? (
                  <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${CATEGORY_TONE[x.category]}`}>
                    {CATEGORY_LABEL[x.category]}
                  </span>
                ) : "—"}
              </td>
              <td className="px-3 py-1.5">{trainerLabel(x, d?.trainers ?? [], s.personName)}</td>
              <td className="px-3 py-1.5 text-right">
                {isCompleted(x) ? `${presentOf(x.id)} / ${attendeesOf(x.id)}` : `— / ${attendeesOf(x.id)}`}
              </td>
              <td className="px-3 py-1.5">{status(x)}</td>
            </tr>
          ))}
          {detail.rows.length === 0 && (
            <tr><td colSpan={7} className="px-3 py-5 text-center text-grey-2">None.</td></tr>
          )}
        </tbody>
      </table>
    );
  }

  if (detail.kind === "people") {
    const ids = detail.ids ? new Set(detail.ids) : null;
    const rows = people
      .filter((p) => (ids ? ids.has(p.id) : p.trainings > 0))
      .sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name));
    title = `${detail.title ?? "People attending"} · ${rows.length}`;
    body = (
      <table className="w-full text-[13px]">
        <thead className="sticky top-0 bg-[#F6F9FD] text-left text-[12px] text-grey-2">
          <tr>
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Department</th>
            <th className="px-3 py-2 text-right">Trainings attended</th>
            <th className="px-3 py-2 text-right">Hours</th>
            <th className="px-3 py-2">Against {target} h</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr
              key={p.id}
              onClick={() => onChange({ kind: "person", id: p.id })}
              className="cursor-pointer border-t border-line hover:bg-[#FFF8F4]"
              title="Show this person's trainings"
            >
              <td className="px-3 py-1.5 font-medium text-navy">{p.name}</td>
              <td className="px-3 py-1.5">{p.dept}</td>
              <td className="px-3 py-1.5 text-right">{p.trainings}</td>
              <td className="px-3 py-1.5 text-right font-semibold">{r1(p.hours)}</td>
              <td className="px-3 py-1.5">
                {p.hours >= target ? (
                  <span className="text-ryg-green">Reached</span>
                ) : (
                  <span className="text-grey-2">{r1(target - p.hours)} h to go</span>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={5} className="px-3 py-5 text-center text-grey-2">Nobody has attended a training in this period yet.</td></tr>
          )}
        </tbody>
      </table>
    );
  }

  if (detail.kind === "person") {
    const p = people.find((x) => x.id === detail.id);
    const mine = noms
      .filter((n) => n.employeeId === detail.id && n.status === "approved")
      .map((n) => s.sessions.find((x) => x.id === n.sessionId))
      .filter((x): x is TrainingSession => !!x && x.sessionDate >= from && x.sessionDate <= to)
      .sort((a, b) => b.sessionDate.localeCompare(a.sessionDate));
    title = `${p?.name ?? s.personName(detail.id)} · ${r1(p?.hours ?? 0)} of ${target} h`;
    body = (
      <table className="w-full text-[13px]">
        <thead className="sticky top-0 bg-[#F6F9FD] text-left text-[12px] text-grey-2">
          <tr>
            <th className="px-3 py-2">Date</th>
            <th className="px-3 py-2">Training</th>
            <th className="px-3 py-2">Category</th>
            <th className="px-3 py-2">Attendance</th>
            <th className="px-3 py-2 text-right">Hours earned</th>
          </tr>
        </thead>
        <tbody>
          {mine.map((x) => {
            const a = att.find((v) => v.sessionId === x.id && v.employeeId === detail.id);
            const earned =
              isCancelled(x) ? 0 : a?.status === "present" ? sessionHours(x) : a?.status === "partial" ? (a.minutes ?? 0) / 60 : 0;
            return (
              <tr key={x.id} className="border-t border-line">
                <td className="px-3 py-1.5 whitespace-nowrap">{dmy(x.sessionDate)}</td>
                <td className="px-3 py-1.5">
                  <Link to={`${B}/sessions/${x.id}`} className="text-navy hover:text-orange">{x.title}</Link>
                </td>
                <td className="px-3 py-1.5">{x.category ? CATEGORY_LABEL[x.category] : "—"}</td>
                <td className="px-3 py-1.5">
                  {isCancelled(x) ? (
                    <span className="text-grey-2">Cancelled</span>
                  ) : a?.status === "present" ? (
                    <span className="text-ryg-green">Present</span>
                  ) : a?.status === "partial" ? (
                    <span className="text-yellow">Partial</span>
                  ) : a ? (
                    <span className="text-ryg-red">Absent</span>
                  ) : (
                    <span className="text-grey-2">Not marked yet</span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right font-semibold">{r1(earned)}</td>
              </tr>
            );
          })}
          {mine.length === 0 && (
            <tr><td colSpan={5} className="px-3 py-5 text-center text-grey-2">Not on any training in this period.</td></tr>
          )}
        </tbody>
      </table>
    );
  }

  return (
    <Card className="border-orange/40 p-0">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <div className="flex items-center gap-3">
          {detail.kind === "person" && (
            <button type="button" onClick={() => onChange({ kind: "people" })} className="text-[13px] font-medium text-orange hover:underline">
              ← All people
            </button>
          )}
          <h3 className="text-[15px] font-semibold text-navy">{title}</h3>
        </div>
        <button type="button" onClick={onClose} className="text-[13px] font-medium text-grey-2 hover:text-navy">
          Close ✕
        </button>
      </div>
      <div className="max-h-[420px] overflow-auto">{body}</div>
    </Card>
  );
}
