import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { exportSheetsToXlsx } from "@/shared/lib/exportXlsx";
import { useSession } from "@/core/platform/session";
import { useLdStore } from "../../store";
import AttendancePendingBanner from "./AttendancePendingBanner";
import DashboardDetail, { type DashDetail, type PersonHours } from "./DashboardDetail";
import { B } from "../../nav";
import { dmy } from "../../lib/format";
import {
  CATEGORY_LABEL,
  CATEGORY_TONE,
  fyList,
  fyOf,
  hm,
  hoursByPerson,
  includedPeople,
  isCancelled,
  isCompleted,
  isoDate,
  sessionHours,
  startsAt,
  trainerLabel,
  type Fy,
} from "../../lib/training";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const MET = "#FF6A1F";
const SHORT = "#FFC7A8";
const AXIS = { fontSize: 11, fill: "#64748B" };

/** A clickable count — opens its list in a card on the same page. */
function Tile({
  label, value, hint, onClick, active,
}: { label: string; value: string | number; hint?: string; onClick?: () => void; active?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="h-full w-full text-left">
      <Card
        className={
          "h-full p-4 transition hover:border-orange/60 hover:shadow-md " +
          (active ? "border-orange ring-1 ring-orange/40 bg-[#FFF8F4]" : "")
        }
      >
        <div className="text-[11.5px] uppercase tracking-wide text-grey-2">{label}</div>
        <div className="mt-1 text-[26px] font-bold leading-tight text-navy">{value}</div>
        {hint && <div className="mt-0.5 text-[12px] text-grey-2">{hint}</div>}
        <div className="mt-1 text-[11.5px] font-medium text-orange">{active ? "Showing below ↓" : "Click to see the list"}</div>
      </Card>
    </button>
  );
}

/**
 * The training dashboard — requirement 6 of HR's change set (14-10-2026).
 *
 * Tiles: Internal, External, upcoming next month, completed, cancelled, people
 * attending, total hours; the next three trainings; and — for the people who run
 * L&D — who is NOT on any training, and everyone's hours against the yearly
 * target (24 h, Setup) as a bar chart.
 *
 * ⚠ THE PERIOD IS THE FINANCIAL YEAR (April–March, decision D8), because the
 *   24-hour target is yearly and the calendar is uploaded to March. Everything on
 *   this card reads the same FY so no two numbers disagree about "this year".
 *
 * ⚠ "EVERY ORANGE HUB USER" = staff logins only (`list_org_people` already leaves
 *   out customer portal logins). Counted from ATTENDANCE for hours and from
 *   ATTENDEE LISTS for "included" — being invited is enough to be included, but
 *   only attending earns hours.
 */
export default function TrainingDashboard() {
  const s = useLdStore();
  const { user } = useSession();
  const d = s.data;
  const sessions = s.sessions;
  const fys = useMemo(() => fyList(sessions), [sessions]);
  const [fyLabel, setFyLabel] = useState(fyOf().label);
  const fy: Fy = fys.find((f) => f.label === fyLabel) ?? fyOf();
  const [period, setPeriod] = useState<string>("fy"); // "fy" | "YYYY-MM"

  const oversees = s.canManageCalendar || s.isPipelineStaff;
  const target = s.hoursTarget;
  const now = new Date();
  const todayIso = isoDate(now);

  const inFy = useMemo(
    () => sessions.filter((x) => x.sessionDate >= fy.from && x.sessionDate <= fy.to),
    [sessions, fy.from, fy.to],
  );
  const live = inFy.filter((x) => !isCancelled(x));

  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nmKey = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}`;
  const upcomingNextMonth = sessions.filter((x) => !isCancelled(x) && x.sessionDate.startsWith(nmKey)).length;

  const next3 = useMemo(
    () =>
      sessions
        .filter((x) => !isCancelled(x) && !isCompleted(x) && startsAt(x) >= new Date(now.getTime() - 60 * 60_000))
        .sort((a, b) => startsAt(a).getTime() - startsAt(b).getTime())
        .slice(0, 3),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessions, todayIso],
  );

  const attendance = d?.attendance ?? [];
  const nominations = d?.nominations ?? [];
  const hours = useMemo(() => hoursByPerson(sessions, attendance, fy.from, fy.to), [sessions, attendance, fy.from, fy.to]);
  const totalHours = [...hours.values()].reduce((a, b) => a + b.hours, 0);
  const attendedPeople = [...hours.values()].filter((h) => h.trainings > 0).length;

  const people = s.orgPeople;

  // Months of the FY for the "not included" filter.
  const fyMonths = useMemo(() => {
    const out: { key: string; label: string; from: string; to: string }[] = [];
    const startY = Number(fy.from.slice(0, 4));
    for (let i = 0; i < 12; i++) {
      const dt = new Date(startY, 3 + i, 1);
      const last = new Date(dt.getFullYear(), dt.getMonth() + 1, 0);
      out.push({
        key: `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`,
        label: `${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`,
        from: isoDate(dt),
        to: isoDate(last),
      });
    }
    return out;
  }, [fy.from]);
  const range = period === "fy" ? { from: fy.from, to: fy.to, label: `FY ${fy.label}` } : (() => {
    const mm = fyMonths.find((x) => x.key === period) ?? fyMonths[0];
    return { from: mm.from, to: mm.to, label: mm.label };
  })();

  const included = useMemo(
    () => includedPeople(sessions, nominations, range.from, range.to),
    [sessions, nominations, range.from, range.to],
  );
  const notIncluded = useMemo(
    () =>
      people
        .filter((p) => !included.has(p.id))
        .map((p) => ({ id: p.id, name: p.name, designation: p.designation, dept: s.departmentName(p.departmentId) }))
        .sort((a, b) => a.dept.localeCompare(b.dept) || a.name.localeCompare(b.name)),
    [people, included, s.departmentName],
  );

  const chartRows = useMemo(
    () =>
      people
        .map((p) => {
          const h = hours.get(p.id);
          return { id: p.id, name: p.name, hours: Math.round((h?.hours ?? 0) * 10) / 10, trainings: h?.trainings ?? 0 };
        })
        .sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name)),
    [people, hours],
  );
  const metCount = chartRows.filter((r) => r.hours >= target).length;

  const myHours = user ? hours.get(user.id)?.hours ?? 0 : 0;

  /* ---- click-through: a tile or a bar opens its list in a card, same page ---- */
  // `at` = where the card opens: under the tiles, or under the chart that was clicked.
  const [detail, setDetail] = useState<(DashDetail & { key: string; at: "tiles" | "chart" }) | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const open = (key: string, dd: DashDetail, at: "tiles" | "chart" = "tiles") => {
    // A tile toggles its own list; a bar always shows that person.
    setDetail((cur) => (at === "tiles" && cur?.key === key ? null : { ...dd, key, at }));
    setTimeout(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 60);
  };
  const byDate = (rows: typeof sessions) =>
    [...rows].sort((a, b) => (a.sessionDate + (a.startTime ?? "")).localeCompare(b.sessionDate + (b.startTime ?? "")));
  const personHours: PersonHours[] = useMemo(
    () =>
      people.map((p) => ({
        id: p.id,
        name: p.name,
        dept: s.departmentName(p.departmentId),
        hours: hours.get(p.id)?.hours ?? 0,
        trainings: hours.get(p.id)?.trainings ?? 0,
      })),
    [people, hours, s.departmentName],
  );
  const detailCard = detail && (
    <div ref={detailRef} className="scroll-mt-4">
      <DashboardDetail
        detail={detail}
        onChange={(dd) => setDetail({ ...dd, key: dd.kind === "person" ? `person:${dd.id}` : "people", at: detail.at })}
        onClose={() => setDetail(null)}
        people={personHours}
        from={fy.from}
        to={fy.to}
        target={target}
      />
    </div>
  );

  const exportCoverage = () =>
    void exportSheetsToXlsx({
      fileName: "LD_Training_Coverage",
      title: `Training coverage — ${range.label}`,
      notes: [`Target: ${target} training hours per person per financial year.`],
      sheets: [
        {
          sheetName: "Not included",
          columns: [
            { header: "Name", width: 30, value: (r: (typeof notIncluded)[number]) => r.name },
            { header: "Designation", width: 26, value: (r: (typeof notIncluded)[number]) => r.designation ?? "" },
            { header: "Department", width: 24, value: (r: (typeof notIncluded)[number]) => r.dept },
          ],
          rows: notIncluded,
        },
        {
          sheetName: "Hours per person",
          columns: [
            { header: "Name", width: 30, value: (r: (typeof chartRows)[number]) => r.name },
            { header: "Trainings attended", width: 18, value: (r: (typeof chartRows)[number]) => r.trainings },
            { header: `Hours (FY ${fy.label})`, width: 16, value: (r: (typeof chartRows)[number]) => r.hours },
            { header: `Short of ${target} h`, width: 14, value: (r: (typeof chartRows)[number]) => Math.max(0, Math.round((target - r.hours) * 10) / 10) },
          ],
          rows: chartRows,
        },
      ],
    });

  return (
    <div className="space-y-5">
      <AttendancePendingBanner />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[16px] font-bold text-navy">Training overview</h2>
        <label className="flex items-center gap-2 text-[12.5px] text-grey-2">
          Financial year
          <select
            value={fyLabel}
            onChange={(e) => setFyLabel(e.target.value)}
            className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px] text-navy"
          >
            {fys.map((f) => (
              <option key={f.label} value={f.label}>{f.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <Tile label="Internal trainings" value={live.filter((x) => x.category === "internal").length} hint={`FY ${fy.label}`}
          active={detail?.key === "internal"}
          onClick={() => open("internal", { kind: "trainings", title: `Internal trainings · FY ${fy.label}`, rows: byDate(live.filter((x) => x.category === "internal")) })} />
        <Tile label="External trainings" value={live.filter((x) => x.category === "external").length} hint={`FY ${fy.label}`}
          active={detail?.key === "external"}
          onClick={() => open("external", { kind: "trainings", title: `External trainings · FY ${fy.label}`, rows: byDate(live.filter((x) => x.category === "external")) })} />
        <Tile label="Upcoming next month" value={upcomingNextMonth} hint={`${MONTHS[nextMonth.getMonth()]} ${nextMonth.getFullYear()}`}
          active={detail?.key === "next"}
          onClick={() => open("next", { kind: "trainings", title: `Upcoming · ${MONTHS[nextMonth.getMonth()]} ${nextMonth.getFullYear()}`, rows: byDate(sessions.filter((x) => !isCancelled(x) && x.sessionDate.startsWith(nmKey))) })} />
        <Tile label="Completed" value={inFy.filter((x) => isCompleted(x) && !isCancelled(x)).length} hint={`FY ${fy.label}`}
          active={detail?.key === "completed"}
          onClick={() => open("completed", { kind: "trainings", title: `Completed trainings · FY ${fy.label}`, rows: byDate(inFy.filter((x) => isCompleted(x) && !isCancelled(x))) })} />
        <Tile label="Cancelled" value={inFy.filter(isCancelled).length} hint={`FY ${fy.label}`}
          active={detail?.key === "cancelled"}
          onClick={() => open("cancelled", { kind: "trainings", title: `Cancelled trainings · FY ${fy.label}`, rows: byDate(inFy.filter(isCancelled)) })} />
        <Tile label="People attending" value={attendedPeople} hint={`of ${people.length} · attended at least one`}
          active={detail?.key === "people"}
          onClick={() => open("people", { kind: "people" })} />
        <Tile label="Training hours" value={Math.round(totalHours * 10) / 10} hint={`${metCount} reached ${target} h`}
          active={detail?.key === "hours"}
          onClick={() => open("hours", { kind: "people" })} />
      </div>

      {detail?.at === "tiles" && detailCard}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[15px] font-semibold text-navy">Next 3 trainings</h3>
            <Link to={`${B}/calendar`} className="text-[13px] font-medium text-orange hover:underline">Full calendar</Link>
          </div>
          {next3.length === 0 ? (
            <p className="mt-2 text-[13px] text-grey-2">Nothing scheduled yet.</p>
          ) : (
            <div className="mt-3 divide-y divide-line">
              {next3.map((x) => (
                <div key={x.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <Link to={`${B}/sessions/${x.id}`} className="text-[14px] font-semibold text-navy hover:text-orange">
                      {x.title}
                    </Link>
                    <div className="text-[12.5px] text-grey-2">
                      {dmy(x.sessionDate)} · {hm(x.startTime)}–{hm(x.endTime)} · {sessionHours(x)} h ·{" "}
                      {trainerLabel(x, d?.trainers ?? [], s.personName)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {x.category && (
                      <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${CATEGORY_TONE[x.category]}`}>
                        {CATEGORY_LABEL[x.category]}
                      </span>
                    )}
                    {x.meetingLink && (
                      <a href={x.meetingLink} target="_blank" rel="noreferrer" className="text-[12.5px] font-semibold text-[#5B5FC7] hover:underline">
                        Join on Teams
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="text-[15px] font-semibold text-navy">Your training hours</h3>
          <div className="mt-2 text-[28px] font-bold text-navy">
            {Math.round(myHours * 10) / 10} <span className="text-[15px] font-semibold text-grey-2">/ {target} h</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#F1F4F9]">
            <div className="h-full rounded-full bg-orange" style={{ width: `${Math.min(100, (myHours / target) * 100)}%` }} />
          </div>
          <p className="mt-2 text-[12.5px] text-grey-2">
            {myHours >= target ? "Target reached for this year." : `${Math.round((target - myHours) * 10) / 10} h to go in FY ${fy.label}.`}
          </p>
        </Card>
      </div>

      {oversees && (
        <>
          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-[15px] font-semibold text-navy">Hours per person · FY {fy.label}</h3>
                <p className="text-[12.5px] text-grey-2">
                  Target {target} h a year · {metCount} of {chartRows.length} reached it · counted from attendance (Present) · click a bar to see that person's trainings
                </p>
              </div>
              <div className="flex items-center gap-3 text-[12px] text-grey-2">
                <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: MET }} />Reached {target} h</span>
                <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: SHORT }} />Below {target} h</span>
              </div>
            </div>
            <div className="mt-3 overflow-x-auto">
              <div style={{ minWidth: Math.max(640, chartRows.length * 26), height: 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={chartRows}
                    margin={{ top: 10, right: 10, bottom: 70, left: 0 }}
                    // The WHOLE column is the target, not just the bar — a 0.1 h bar is a
                    // sliver nobody can hit.
                    style={{ cursor: "pointer" }}
                    onClick={(st: { activePayload?: { payload?: { id: string } }[] } | null) => {
                      const id = st?.activePayload?.[0]?.payload?.id;
                      if (id) open(`person:${id}`, { kind: "person", id }, "chart");
                    }}
                  >
                    <CartesianGrid stroke="#EEF2F8" vertical={false} />
                    <XAxis dataKey="name" tick={{ ...AXIS, fontSize: 10 }} angle={-55} textAnchor="end" interval={0} height={70} />
                    <YAxis tick={AXIS} width={36} allowDecimals={false} domain={[0, (max: number) => Math.max(target + 4, Math.ceil(max))]} />
                    <Tooltip
                      cursor={{ fill: "rgba(11,27,64,0.04)" }}
                      contentStyle={{ borderRadius: 10, border: "1px solid #EEF2F8", fontSize: 12 }}
                      formatter={(v: number, _n, item) => [`${v} h · ${(item?.payload as { trainings: number }).trainings} training(s)`, "Attended"]}
                    />
                    <ReferenceLine y={target} stroke="#0B1B40" strokeDasharray="4 4" label={{ value: `${target} h target`, position: "insideTopRight", fontSize: 11, fill: "#0B1B40" }} />
                    <Bar
                      dataKey="hours"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={18}
                    >
                      {chartRows.map((r) => (
                        <Cell key={r.id} fill={r.hours >= target ? MET : SHORT} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </Card>

          {/* A clicked bar opens the person right here, under the chart. */}
          {detail?.at === "chart" && detailCard}

          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-[15px] font-semibold text-navy">
                  Not included in any training · {range.label}
                  <span className="ml-2 rounded-full bg-[#FDECEC] px-2 py-0.5 text-[12px] text-ryg-red">{notIncluded.length}</span>
                </h3>
                <p className="text-[12.5px] text-grey-2">
                  Orange Hub users who are not an attendee of any training in this period ({included.size} of {people.length} are).
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                  className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px] text-navy"
                >
                  <option value="fy">Whole FY {fy.label}</option>
                  {fyMonths.map((mm) => (
                    <option key={mm.key} value={mm.key}>{mm.label}</option>
                  ))}
                </select>
                <Button size="sm" variant="ghost" onClick={exportCoverage}>Excel</Button>
              </div>
            </div>
            {notIncluded.length === 0 ? (
              <p className="mt-3 text-[13px] text-ryg-green">Everyone is on at least one training in this period.</p>
            ) : (
              <div className="mt-3 max-h-[320px] overflow-auto rounded-xl border border-line">
                <table className="w-full text-[13px]">
                  <thead className="sticky top-0 bg-[#F6F9FD] text-left text-[12px] text-grey-2">
                    <tr>
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Designation</th>
                      <th className="px-3 py-2">Department</th>
                      <th className="px-3 py-2 text-right">Hours this FY</th>
                    </tr>
                  </thead>
                  <tbody>
                    {notIncluded.map((p) => (
                      <tr key={p.id} className="border-t border-line">
                        <td className="px-3 py-1.5 text-navy">{p.name}</td>
                        <td className="px-3 py-1.5 text-grey-2">{p.designation ?? "—"}</td>
                        <td className="px-3 py-1.5">{p.dept}</td>
                        <td className="px-3 py-1.5 text-right">{Math.round((hours.get(p.id)?.hours ?? 0) * 10) / 10}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
