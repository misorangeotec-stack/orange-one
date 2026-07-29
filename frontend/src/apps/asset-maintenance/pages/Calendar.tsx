import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { SectionHeading } from "@/shared/components/ui/Readout";
import { useAssetStore } from "../store";
import { liveTracks } from "../lib/schedules";
import { dmy } from "../lib/format";

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * What is coming, month by month.
 *
 * Reads the TRACKS, not the job queue. A track whose reminder window has not opened
 * yet has no job — and those are precisely the ones worth seeing in advance. A
 * calendar built off the queue would only ever show the next few weeks, which is
 * the one horizon nobody needs help with.
 */
export default function Calendar() {
  const s = useAssetStore();
  const [y, setY] = useState(() => Number(s.todayIso.slice(0, 4)));
  const [m, setM] = useState(() => Number(s.todayIso.slice(5, 7)) - 1);

  const byDate = useMemo(() => {
    const map = new Map<string, { assetId: string; label: string; type: string; overdue: boolean }[]>();
    for (const a of s.assets) {
      if (!a.active) continue;
      for (const t of liveTracks(a.schedules)) {
        const d = t.nextDueDate as string;
        const row = {
          assetId: a.id,
          label: `${a.assetNo} ${a.name}`,
          type: s.scheduleTypeName(t.scheduleTypeId),
          overdue: d < s.todayIso,
        };
        const list = map.get(d);
        if (list) list.push(row);
        else map.set(d, [row]);
      }
    }
    return map;
  }, [s]);

  const first = new Date(y, m, 1);
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  // Monday-first grid: JS getDay() is Sunday-0, so shift.
  const lead = (first.getDay() + 6) % 7;
  const cells: (number | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const monthTotal = useMemo(() => {
    let n = 0;
    for (let d = 1; d <= daysInMonth; d += 1) n += byDate.get(iso(y, m, d))?.length ?? 0;
    return n;
  }, [byDate, y, m, daysInMonth]);

  /** Anything already past due, regardless of which month is on screen. */
  const overdue = useMemo(() => {
    const out: { date: string; assetId: string; label: string; type: string }[] = [];
    byDate.forEach((rows, date) => {
      if (date < s.todayIso) rows.forEach((r) => out.push({ date, ...r }));
    });
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }, [byDate, s.todayIso]);

  const step = (delta: number) => {
    const next = new Date(y, m + delta, 1);
    setY(next.getFullYear());
    setM(next.getMonth());
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-navy">What is coming</h1>
          <p className="mt-1 text-[13.5px] text-grey-2">
            Every dated track across the register — services, renewals, inspections.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => step(-1)}>Previous</Button>
          <span className="min-w-[140px] text-center text-[14px] font-semibold text-navy">
            {MONTHS[m]} {y}
          </span>
          <Button variant="ghost" size="sm" onClick={() => step(1)}>Next</Button>
        </div>
      </div>

      {overdue.length > 0 && (
        <Card className="p-5">
          <SectionHeading>Already overdue ({overdue.length})</SectionHeading>
          <ul className="mt-3 space-y-1.5 text-[13px]">
            {overdue.slice(0, 15).map((o) => (
              <li key={`${o.assetId}-${o.type}-${o.date}`} className="flex flex-wrap items-baseline gap-2">
                <span className="w-24 shrink-0 font-semibold text-ryg-red">{dmy(o.date)}</span>
                <Link to={`/asset-maintenance/assets/${o.assetId}`} className="text-navy hover:text-orange">
                  {o.label}
                </Link>
                <span className="text-grey-2">· {o.type}</span>
              </li>
            ))}
          </ul>
          {overdue.length > 15 && (
            <p className="mt-2 text-[12.5px] text-grey-2">and {overdue.length - 15} more.</p>
          )}
        </Card>
      )}

      <Card className="p-4">
        <div className="flex items-baseline justify-between gap-3 border-b border-line pb-2">
          <SectionHeading>{MONTHS[m]} {y}</SectionHeading>
          <span className="text-[12px] text-grey-2">
            {monthTotal} due this month
          </span>
        </div>

        <div className="mt-3 grid grid-cols-7 gap-px overflow-hidden rounded-lg bg-line text-[12px]">
          {DOW.map((d) => (
            <div key={d} className="bg-page px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-grey">
              {d}
            </div>
          ))}
          {cells.map((day, i) => {
            if (day === null) return <div key={`e${i}`} className="min-h-[92px] bg-white/60" />;
            const date = iso(y, m, day);
            const rows = byDate.get(date) ?? [];
            const isToday = date === s.todayIso;
            return (
              <div key={date} className={`min-h-[92px] bg-white p-1.5 ${isToday ? "ring-1 ring-inset ring-orange" : ""}`}>
                <div className={`mb-1 text-[11px] font-semibold ${isToday ? "text-orange" : "text-grey-2"}`}>
                  {day}
                </div>
                <div className="space-y-1">
                  {rows.slice(0, 3).map((r, j) => (
                    <Link
                      key={`${r.assetId}-${j}`}
                      to={`/asset-maintenance/assets/${r.assetId}`}
                      title={`${r.label} — ${r.type}`}
                      className={`block truncate rounded px-1 py-0.5 text-[11px] font-medium ${
                        r.overdue ? "bg-[#FDECEC] text-ryg-red" : "bg-[#EEF3FF] text-[#1A56DB]"
                      } hover:underline`}
                    >
                      {r.type} · {r.label}
                    </Link>
                  ))}
                  {rows.length > 3 && (
                    <div className="px-1 text-[11px] text-grey-2">+{rows.length - 3} more</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
