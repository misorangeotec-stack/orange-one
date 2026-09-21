import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { useLdStore } from "../../store";
import { B } from "../../nav";
import { dmy } from "../../lib/format";
import type { TrainingSession } from "../../types";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Cancelled reads differently from conducted, and both differ from "not yet". */
const TONE: Record<string, string> = {
  cancelled: "bg-[#FDECEC] text-ryg-red line-through",
  rescheduled: "bg-[#FFF7E6] text-yellow",
  conducted: "bg-[#E8F7EE] text-ryg-green",
  attendance_closed: "bg-[#E8F7EE] text-ryg-green",
  closed: "bg-[#F1F4F9] text-grey-2",
};
const toneFor = (s: TrainingSession) => TONE[s.status] ?? "bg-[#FFF1E8] text-orange";

/**
 * The training calendar — the one screen in this module everybody sees.
 *
 * The client asked for it directly: "I want to show a proper calendar overview to
 * the HR executive as well as to all the people who will be involved." So it is
 * NOT gated: `fms_ld_sessions` is readable by every signed-in user, and the
 * budget lives on the request, which is not.
 *
 * ⚠ CANCELLED AND RESCHEDULED SESSIONS STAY ON THE GRID rather than disappearing.
 *   §6 of the source document keeps the old session in the audit trail, and a
 *   calendar that silently drops a cancelled session is how two people turn up to
 *   an empty room. They are struck through, not removed.
 *
 * Month grid borrowed from the Asset Maintenance calendar — Monday-first with
 * lead padding, which is the shape that already works in this hub.
 */
export default function TrainingCalendar() {
  const s = useLdStore();
  const today = new Date();
  const [y, setY] = useState(today.getFullYear());
  const [m, setM] = useState(today.getMonth());

  const byDate = useMemo(() => {
    const map = new Map<string, TrainingSession[]>();
    for (const x of s.sessions) {
      const list = map.get(x.sessionDate);
      if (list) list.push(x);
      else map.set(x.sessionDate, [x]);
    }
    return map;
  }, [s.sessions]);

  const first = new Date(y, m, 1);
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  // JS getDay() is Sunday-0; shift so the week starts on Monday.
  const lead = (first.getDay() + 6) % 7;
  const cells: (number | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const monthCount = useMemo(
    () =>
      s.sessions.filter((x) => {
        const d = new Date(x.sessionDate);
        return d.getFullYear() === y && d.getMonth() === m;
      }).length,
    [s.sessions, y, m],
  );

  const step = (delta: number) => {
    const d = new Date(y, m + delta, 1);
    setY(d.getFullYear());
    setM(d.getMonth());
  };

  const todayIso = iso(today.getFullYear(), today.getMonth(), today.getDate());

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-navy">Training calendar</h1>
          <p className="text-[13.5px] text-grey-2 mt-1">
            Every scheduled session. {monthCount === 0 ? "Nothing this month." : `${monthCount} this month.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => step(-1)}>←</Button>
          <span className="min-w-[10rem] text-center text-[14px] font-semibold text-navy">
            {MONTHS[m]} {y}
          </span>
          <Button variant="ghost" size="sm" onClick={() => step(1)}>→</Button>
        </div>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-7 gap-px rounded-lg bg-line text-center text-[11px] font-semibold uppercase tracking-wide text-grey-2">
          {DOW.map((d) => (
            <div key={d} className="bg-white py-2">{d}</div>
          ))}
        </div>
        <div className="mt-px grid grid-cols-7 gap-px bg-line">
          {cells.map((day, i) => {
            const dIso = day ? iso(y, m, day) : null;
            const list = dIso ? byDate.get(dIso) ?? [] : [];
            return (
              <div
                key={i}
                className={
                  "min-h-[92px] bg-white p-1.5 align-top " +
                  (dIso === todayIso ? "ring-1 ring-inset ring-orange" : "")
                }
              >
                {day && (
                  <div className={"text-[12px] " + (dIso === todayIso ? "font-bold text-orange" : "text-grey-2")}>
                    {day}
                  </div>
                )}
                <div className="mt-1 space-y-1">
                  {list.map((x) => (
                    <Link
                      key={x.id}
                      to={x.requestId ? `${B}/requests/${x.requestId}` : `${B}/calendar`}
                      className={`block truncate rounded px-1.5 py-0.5 text-[11px] font-medium ${toneFor(x)}`}
                      title={`${x.title} · ${dmy(x.sessionDate)}`}
                    >
                      {x.title}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <p className="text-[12px] text-grey-2">
        Nominations, invitations and attendance arrive with the next phase — for now this shows what is
        scheduled and when.
      </p>
    </div>
  );
}
