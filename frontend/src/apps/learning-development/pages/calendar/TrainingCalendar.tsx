import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Tabs from "@/shared/components/ui/Tabs";
import { useLdStore } from "../../store";
import { B } from "../../nav";
import { dmy } from "../../lib/format";
import {
  CATEGORY_LABEL,
  CATEGORY_TONE,
  hm,
  isCancelled,
  isCompleted,
  isoDate,
  trainerLabel,
} from "../../lib/training";
import TrainingFormModal from "../../components/calendar/TrainingFormModal";
import BulkUploadModal from "../../components/calendar/BulkUploadModal";
import type { TrainingCategory, TrainingSession } from "../../types";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * Chip colour: Internal blue, External purple (HR's change set of 14-10-2026);
 * older request-born sessions with no category keep the module's orange.
 * Cancelled is struck through, completed is green — both stay on the grid.
 */
function toneFor(s: TrainingSession): string {
  if (isCancelled(s)) return "bg-[#FDECEC] text-ryg-red line-through";
  if (isCompleted(s)) return "bg-[#E8F7EE] text-ryg-green";
  if (s.status === "rescheduled") return "bg-[#FFF7E6] text-yellow";
  if (s.category) return CATEGORY_TONE[s.category];
  return "bg-[#FFF1E8] text-orange";
}

type CatFilter = "all" | TrainingCategory;

/**
 * The training calendar — the one screen in this module everybody sees.
 *
 * The client asked for it directly: "I want to show a proper calendar overview to
 * the HR executive as well as to all the people who will be involved." So it is
 * NOT gated: `fms_ld_sessions` is readable by every signed-in user, and the
 * budget lives on the request, which is not.
 *
 * ⚠ CALENDAR MANAGERS ADD AND UPLOAD HERE (requirement 1). Add training = one at
 *   a time; Upload calendar = the year from Excel. Both are offered only to
 *   `canManageCalendar` — RLS and the RPC are the real gate.
 *
 * ⚠ CANCELLED AND RESCHEDULED SESSIONS STAY ON THE GRID rather than disappearing.
 *   §6 of the source document keeps the old session in the audit trail, and a
 *   calendar that silently drops a cancelled session is how two people turn up to
 *   an empty room. They are struck through, not removed, and listed again under
 *   the Cancelled tab with the reason.
 *
 * Month grid borrowed from the Asset Maintenance calendar — Monday-first with
 * lead padding, which is the shape that already works in this hub.
 */
export default function TrainingCalendar() {
  const s = useLdStore();
  const d = s.data;
  const today = new Date();
  const [y, setY] = useState(today.getFullYear());
  const [m, setM] = useState(today.getMonth());
  const [tab, setTab] = useState<"calendar" | "list" | "cancelled">("calendar");
  const [cat, setCat] = useState<CatFilter>("all");
  const [adding, setAdding] = useState<string | null | false>(false);
  const [uploading, setUploading] = useState(false);

  const visible = useMemo(
    () => s.sessions.filter((x) => cat === "all" || x.category === cat),
    [s.sessions, cat],
  );

  const attendeeCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of d?.nominations ?? []) {
      if (n.status === "approved") map.set(n.sessionId, (map.get(n.sessionId) ?? 0) + 1);
    }
    return map;
  }, [d?.nominations]);

  const byDate = useMemo(() => {
    const map = new Map<string, TrainingSession[]>();
    for (const x of visible) {
      const list = map.get(x.sessionDate);
      if (list) list.push(x);
      else map.set(x.sessionDate, [x]);
    }
    for (const list of map.values()) list.sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""));
    return map;
  }, [visible]);

  const first = new Date(y, m, 1);
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  // JS getDay() is Sunday-0; shift so the week starts on Monday.
  const lead = (first.getDay() + 6) % 7;
  const cells: (number | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const monthKey = `${y}-${String(m + 1).padStart(2, "0")}`;
  const monthRows = useMemo(
    () =>
      visible
        .filter((x) => x.sessionDate.startsWith(monthKey))
        .sort((a, b) => (a.sessionDate + (a.startTime ?? "")).localeCompare(b.sessionDate + (b.startTime ?? ""))),
    [visible, monthKey],
  );
  const cancelledRows = useMemo(
    () => visible.filter(isCancelled).sort((a, b) => b.sessionDate.localeCompare(a.sessionDate)),
    [visible],
  );

  const step = (delta: number) => {
    const nd = new Date(y, m + delta, 1);
    setY(nd.getFullYear());
    setM(nd.getMonth());
  };

  const todayIso = isoDate(today);
  const trainers = d?.trainers ?? [];
  const liveInMonth = monthRows.filter((x) => !isCancelled(x)).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-navy">Training calendar</h1>
          <p className="text-[13.5px] text-grey-2 mt-1">
            {liveInMonth === 0 ? `Nothing in ${MONTHS[m]}.` : `${liveInMonth} training${liveInMonth === 1 ? "" : "s"} in ${MONTHS[m]}.`}
          </p>
        </div>
        {s.canManageCalendar && (
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setUploading(true)}>Upload calendar</Button>
            <Button onClick={() => setAdding(null)}>Add training</Button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          tabs={[
            { key: "calendar", label: "Calendar" },
            { key: "list", label: "List", count: monthRows.length },
            { key: "cancelled", label: "Cancelled", count: cancelledRows.length },
          ]}
          active={tab}
          onChange={(k) => setTab(k as typeof tab)}
        />
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-xl border border-line bg-white p-1">
            {(["all", "internal", "external"] as CatFilter[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCat(c)}
                className={
                  "rounded-lg px-3 py-1 text-[12.5px] font-semibold transition " +
                  (cat === c
                    ? c === "all"
                      ? "bg-navy text-white"
                      : CATEGORY_TONE[c]
                    : "text-grey-2 hover:text-navy")
                }
              >
                {c === "all" ? "All" : CATEGORY_LABEL[c]}
              </button>
            ))}
          </div>
          {tab !== "cancelled" && (
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => step(-1)}>←</Button>
              <span className="min-w-[9.5rem] text-center text-[14px] font-semibold text-navy">
                {MONTHS[m]} {y}
              </span>
              <Button variant="ghost" size="sm" onClick={() => step(1)}>→</Button>
            </div>
          )}
        </div>
      </div>

      {tab === "calendar" && (
        <Card className="p-4">
          <div className="grid grid-cols-7 gap-px rounded-lg bg-line text-center text-[11px] font-semibold uppercase tracking-wide text-grey-2">
            {DOW.map((dw) => (
              <div key={dw} className="bg-white py-2">{dw}</div>
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
                    "group min-h-[96px] bg-white p-1.5 align-top " +
                    (dIso === todayIso ? "ring-1 ring-inset ring-orange" : "")
                  }
                >
                  {day && (
                    <div className="flex items-center justify-between">
                      <span className={"text-[12px] " + (dIso === todayIso ? "font-bold text-orange" : "text-grey-2")}>
                        {day}
                      </span>
                      {s.canManageCalendar && (
                        <button
                          type="button"
                          onClick={() => setAdding(dIso)}
                          className="hidden h-5 w-5 rounded text-[14px] leading-none text-grey-2 hover:bg-[#FFF1E8] hover:text-orange group-hover:block"
                          title="Add a training on this day"
                        >
                          +
                        </button>
                      )}
                    </div>
                  )}
                  <div className="mt-1 space-y-1">
                    {list.map((x) => (
                      <Link
                        key={x.id}
                        to={`${B}/sessions/${x.id}`}
                        className={`block truncate rounded px-1.5 py-0.5 text-[11px] font-medium ${toneFor(x)}`}
                        title={`${x.title} · ${dmy(x.sessionDate)} ${hm(x.startTime)}–${hm(x.endTime)}${
                          x.category ? ` · ${CATEGORY_LABEL[x.category]}` : ""
                        }${isCancelled(x) ? " · CANCELLED" : ""}`}
                      >
                        {x.startTime && <span className="opacity-70">{hm(x.startTime)} </span>}
                        {x.title}
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-[11.5px] text-grey-2">
            {[
              ["Internal", "#1D4ED8"],
              ["External", "#6D28D9"],
              ["Completed", "#16A34A"],
              ["Cancelled", "#DC2626"],
            ].map(([label, c]) => (
              <span key={label} className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c }} />
                {label}
              </span>
            ))}
          </div>
        </Card>
      )}

      {tab === "list" && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-[13px]">
            <thead className="bg-[#F6F9FD] text-left text-[12px] text-grey-2">
              <tr>
                <th className="px-3 py-2.5">Date</th>
                <th className="px-3 py-2.5">Time</th>
                <th className="px-3 py-2.5">Training</th>
                <th className="px-3 py-2.5">Category</th>
                <th className="px-3 py-2.5">Trainer</th>
                <th className="px-3 py-2.5 text-right">Attendees</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {monthRows.map((x) => (
                <tr key={x.id} className="border-t border-line">
                  <td className="px-3 py-2 whitespace-nowrap">{dmy(x.sessionDate)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{hm(x.startTime)}–{hm(x.endTime)}</td>
                  <td className="px-3 py-2">
                    <Link to={`${B}/sessions/${x.id}`} className="text-navy hover:text-orange">{x.title}</Link>
                  </td>
                  <td className="px-3 py-2">
                    {x.category ? (
                      <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${CATEGORY_TONE[x.category]}`}>
                        {CATEGORY_LABEL[x.category]}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-2">{trainerLabel(x, trainers, s.personName)}</td>
                  <td className="px-3 py-2 text-right">{attendeeCount.get(x.id) ?? 0}</td>
                  <td className="px-3 py-2">
                    {isCancelled(x) ? (
                      <span className="text-ryg-red">Cancelled</span>
                    ) : isCompleted(x) ? (
                      <span className="text-ryg-green">Completed</span>
                    ) : (
                      <span className="text-navy">Scheduled</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {x.meetingLink && !isCancelled(x) && !isCompleted(x) && (
                      <a href={x.meetingLink} target="_blank" rel="noreferrer" className="font-semibold text-[#5B5FC7] hover:underline">
                        Join on Teams
                      </a>
                    )}
                  </td>
                </tr>
              ))}
              {monthRows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-grey-2">No trainings in {MONTHS[m]} {y}.</td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      )}

      {tab === "cancelled" && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-[13px]">
            <thead className="bg-[#F6F9FD] text-left text-[12px] text-grey-2">
              <tr>
                <th className="px-3 py-2.5">Training date</th>
                <th className="px-3 py-2.5">Training</th>
                <th className="px-3 py-2.5">Category</th>
                <th className="px-3 py-2.5">Cancelled on</th>
                <th className="px-3 py-2.5">By</th>
                <th className="px-3 py-2.5">Reason</th>
                <th className="px-3 py-2.5">Cancellation mail</th>
              </tr>
            </thead>
            <tbody>
              {cancelledRows.map((x) => (
                <tr key={x.id} className="border-t border-line">
                  <td className="px-3 py-2 whitespace-nowrap">{dmy(x.sessionDate)}</td>
                  <td className="px-3 py-2">
                    <Link to={`${B}/sessions/${x.id}`} className="text-navy hover:text-orange">{x.title}</Link>
                  </td>
                  <td className="px-3 py-2">{x.category ? CATEGORY_LABEL[x.category] : "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{x.cancelledAt ? dmy(x.cancelledAt) : "—"}</td>
                  <td className="px-3 py-2">{x.cancelledBy ? s.personName(x.cancelledBy) : "—"}</td>
                  <td className="px-3 py-2">{x.changeReason ?? "—"}</td>
                  <td className="px-3 py-2">{x.cancelMailSentAt ? "Sent" : "Not needed (invite not sent)"}</td>
                </tr>
              ))}
              {cancelledRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-grey-2">No cancelled trainings.</td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      )}

      <p className="text-[12px] text-grey-2">
        Open a training to join it on Teams{s.canManageCalendar ? ", edit it, cancel it or mark it complete" : ""}.
      </p>

      {adding !== false && (
        <TrainingFormModal open onClose={() => setAdding(false)} defaultDate={adding} />
      )}
      {uploading && <BulkUploadModal open onClose={() => setUploading(false)} />}
    </div>
  );
}
