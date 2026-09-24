import { useEffect, useState } from "react";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import Tabs from "@/shared/components/ui/Tabs";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import { useLdStore } from "../../store";
import { dmy, inr } from "../../lib/format";
import {
  learningHours,
  mandatoryStatus,
  periodSummary,
  type LearningHoursRow,
  type MandatoryStatus,
  type PeriodSummary,
} from "../../data/ldWrites";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const todayIso = () => iso(new Date());

/** Monday of the current ISO week — the weekly review form's own period. */
function weekStart(d = new Date()): string {
  const x = new Date(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return iso(x);
}
const monthStart = () => {
  const d = new Date();
  return iso(new Date(d.getFullYear(), d.getMonth(), 1));
};

/**
 * ⚠ THE DEFAULT IS THIS MONTH, NOT THIS WEEK.
 *
 * The weekly review form runs Monday to Sunday, so "this week" looks like the
 * obvious default — and it was, until the walkthrough opened this page on a
 * Tuesday. The window covered two days, a training run the previous Saturday
 * fell outside it, and every figure read zero for a session that had plainly
 * happened. A report that opens empty gets read as broken, not as "nothing
 * this week". The weekly window is one click away instead.
 */
const PRESETS: { key: string; label: string; from: () => string }[] = [
  { key: "month", label: "This month", from: monthStart },
  { key: "week", label: "This week", from: weekStart },
  { key: "30", label: "Last 30 days", from: () => iso(new Date(Date.now() - 30 * 864e5)) },
  { key: "year", label: "This year", from: () => `${new Date().getFullYear()}-01-01` },
];

function Box({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-grey-2">{label}</div>
      <div className="text-[18px] font-bold text-navy">{value}</div>
      {note && <div className="text-[11.5px] text-grey-2">{note}</div>}
    </div>
  );
}

const pct = (n: number, d: number) => (d === 0 ? "—" : `${Math.round((100 * n) / d)}%`);

/**
 * The reports HR reads, and the feed behind Section C of the weekly review.
 *
 * ⚠ EVERY FIGURE IS COMPUTED SERVER-SIDE (`fms_ld_period_summary` and friends),
 *   not from the rows this page happens to hold. The browser only ever has what
 *   RLS let it read, so a percentage worked out here would be a percentage of
 *   what this reader can see — and the nightly KPI run has no browser at all.
 *   One definition, two consumers.
 *
 * ⚠ A TARGET WITH NOBODY BEHIND IT IS STILL SHOWN. The weekly form carries its
 *   own targets (minimum 3 external, 2 technical, 5 total a month; 85%
 *   attendance; 80% assignments). They are printed beside the actuals even when
 *   the actual is zero, because the gap is the finding.
 */
export default function Reports() {
  const s = useLdStore();
  const [tab, setTab] = useState("weekly");
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayIso());
  const [sum, setSum] = useState<PeriodSummary | null>(null);
  const [hours, setHours] = useState<LearningHoursRow[]>([]);
  const [mand, setMand] = useState<MandatoryStatus[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setErr(null);
    void periodSummary(from, to)
      .then((r) => live && setSum(r))
      .catch((e) => live && setErr((e as Error).message));
    return () => {
      live = false;
    };
  }, [from, to, s.data]);

  useEffect(() => {
    void learningHours().then(setHours).catch(() => setHours([]));
    void mandatoryStatus().then(setMand).catch(() => setMand([]));
  }, [s.data]);

  const hoursColumns: QueueColumn<LearningHoursRow>[] = [
    { key: "name", header: "Employee", cell: (r) => r.employee, filter: { kind: "text", get: (r) => r.employee } },
    {
      key: "hours",
      header: "Hours this year",
      align: "right",
      cell: (r) => r.hours.toFixed(1),
      sortValue: (r) => r.hours,
      exportValue: (r) => r.hours,
      filter: { kind: "number", get: (r) => r.hours },
    },
    {
      key: "sessions",
      header: "Sessions",
      align: "right",
      cell: (r) => r.sessions,
      sortValue: (r) => r.sessions,
    },
    {
      key: "target",
      header: "Against 10",
      cell: (r) =>
        r.hours >= 10 ? (
          <span className="text-ryg-green">Met</span>
        ) : (
          <span className="text-grey-2">{(10 - r.hours).toFixed(1)} short</span>
        ),
      sortValue: (r) => (r.hours >= 10 ? 1 : 0),
      filter: { kind: "select", get: (r) => (r.hours >= 10 ? "Met" : "Short") },
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Reports</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          The figures behind the weekly review and the L&amp;D scorecard.
        </p>
      </div>

      <Tabs
        tabs={[
          { key: "weekly", label: "Weekly review (Section C)" },
          { key: "hours", label: "Learning hours" },
          { key: "compliance", label: "POSH & Safety" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {err && <p className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-[13px] text-[#B42318]">{err}</p>}

      {tab === "weekly" && (
        <>
          <Card className="p-5">
            <div className="flex flex-wrap items-end gap-3">
              <FieldLabel label="From">
                <TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </FieldLabel>
              <FieldLabel label="To">
                <TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </FieldLabel>
              <div className="flex flex-wrap items-center gap-2 pb-1">
                {PRESETS.map((p) => (
                  <Button
                    key={p.key}
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setFrom(p.from());
                      setTo(todayIso());
                    }}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            </div>
          </Card>

          {/* An empty window says so rather than printing a wall of zeros:
              "nothing happened here" and "this screen is broken" produce the
              same noughts, and only one of them is worth acting on. */}
          {sum && sum.sessions_scheduled === 0 && (
            <Card className="p-6 text-center">
              <p className="text-[14px] font-semibold text-navy">No training in this period</p>
              <p className="mt-1 text-[13px] text-grey-2">
                Nothing was scheduled between these two dates, so every figure below would read zero.
                Widen the period or pick one of the buttons above.
              </p>
            </Card>
          )}

          {sum && sum.sessions_scheduled > 0 && (
            <>
              <Card className="p-5">
                <h2 className="text-[15px] font-semibold text-navy mb-3">C1 · Snapshot</h2>
                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  <Box label="Sessions held" value={sum.sessions_held} />
                  <Box label="Total hours" value={Number(sum.total_hours).toFixed(1)} />
                  <Box label="Participants" value={sum.participants} />
                  <Box
                    label="Attendance"
                    value={sum.attendance_pct === null ? "—" : `${sum.attendance_pct}%`}
                    note="target 85%"
                  />
                  <Box
                    label="Avg feedback"
                    value={sum.feedback_avg === null ? "—" : `${sum.feedback_avg} / 5`}
                    note="target 4 / 5"
                  />
                </div>
              </Card>

              <Card className="p-5">
                <h2 className="text-[15px] font-semibold text-navy mb-1">C2 · Training mix</h2>
                {/* The form's own footnote: a technical session run by an external
                    agency counts under BOTH lines and once in the total. */}
                <p className="text-[12px] text-grey-2 mb-3">
                  A session can count under more than one line — an external agency running a technical
                  session is both, and once in the total.
                </p>
                <div className="grid gap-3 sm:grid-cols-4">
                  <Box label="External agency" value={sum.external} note="minimum 3 a month" />
                  <Box label="Technical" value={sum.technical} note="minimum 2 a month" />
                  <Box label="Other internal" value={sum.internal} note="—" />
                  <Box label="Total" value={sum.sessions_held} note="minimum 5 a month" />
                </div>
              </Card>

              <Card className="p-5">
                <h2 className="text-[15px] font-semibold text-navy mb-3">C4 · Attendance &amp; assignments</h2>
                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  <Box label="Nominated" value={sum.participants} />
                  <Box label="Attended" value={sum.attended} />
                  <Box
                    label="Absentees followed up"
                    value={`${sum.absentees_followed_up} of ${sum.absentees}`}
                    note="within 24 hrs"
                  />
                  <Box
                    label="Assignments in 24h"
                    value={`${sum.assignments_within_24h} of ${sum.assignments_issued}`}
                  />
                  <Box
                    label="Submitted"
                    value={`${sum.submissions_made} of ${sum.submissions_due}`}
                    note={`${pct(sum.submissions_made, sum.submissions_due)} · target 80%`}
                  />
                  <Box
                    label="On time"
                    value={`${sum.submissions_on_time} of ${sum.submissions_due}`}
                  />
                  <Box
                    label="Reviewed"
                    value={`${sum.submissions_reviewed} of ${sum.submissions_made}`}
                  />
                  <Box
                    label="30-day reviews"
                    value={`${sum.effectiveness_done} of ${sum.effectiveness_due}`}
                  />
                </div>
              </Card>

              <Card className="p-5">
                <h2 className="text-[15px] font-semibold text-navy mb-3">Cost</h2>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Box label="Spent in the period" value={inr(sum.cost)} />
                  <Box
                    label="Per person who attended"
                    value={sum.attended > 0 ? inr(sum.cost / sum.attended) : "—"}
                  />
                  <Box label="Feedback responses" value={`${sum.feedback_responses} of ${sum.attended}`} />
                </div>
              </Card>
            </>
          )}
        </>
      )}

      {tab === "hours" && (
        <>
          <p className="text-[12.5px] text-grey-2">
            Counted from ATTENDANCE, not from who was invited — present earns the session&rsquo;s hours,
            partial earns the minutes actually recorded.
          </p>
          <QueueTable
            rows={hours}
            rowKey={(r) => r.employee_id}
            columns={hoursColumns}
            rowsLabel="employees"
            initialSort={{ key: "hours", dir: "desc" }}
            exportName="ld-learning-hours"
            exportTitle="Learning hours per employee"
            emptyTitle="No learning hours yet"
            emptyMessage="Hours appear once attendance has been marked on a session."
          />
        </>
      )}

      {tab === "compliance" && (
        <div className="space-y-4">
          <p className="text-[12.5px] text-grey-2">
            Everyone in the company, once a year. Completion counts people who ATTENDED — a name on a
            nomination list is not training.
          </p>
          {mand.map((m) => (
            <Card key={m.program_id} className="p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-[15px] font-semibold text-navy">{m.program}</h2>
                <span className="text-[13px] text-grey-2">
                  {m.completed} of {m.applicable} · <strong className="text-navy">{m.pct}%</strong>
                </span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[#F1F4F9]">
                <div
                  className={"h-full rounded-full " + (m.pct >= 100 ? "bg-ryg-green" : "bg-orange")}
                  style={{ width: `${Math.min(100, m.pct)}%` }}
                />
              </div>
              {/* ⚠ NAMED, not just a percentage. "84% complete" is not something
                  anybody can act on; a list of who is missing is. */}
              {m.outstanding.length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-[13px] font-medium text-orange">
                    {m.outstanding.length} still to do
                  </summary>
                  <p className="mt-2 text-[13px] text-grey">
                    {m.outstanding.map((o) => o.name).join(", ")}
                  </p>
                </details>
              )}
            </Card>
          ))}
          {mand.length === 0 && (
            <Card className="p-5">
              <p className="text-[13px] text-grey-2">
                No mandatory programmes configured. POSH and Safety are seeded by default.
              </p>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
