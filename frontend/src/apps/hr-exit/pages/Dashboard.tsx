import { useMemo } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import EmptyState from "@/shared/components/ui/EmptyState";
import DueCell from "@/shared/components/ui/DueCell";
import SharedKpi from "@/shared/components/ui/Kpi";
import { FIELD_LABEL_CLASS } from "@/shared/components/ui/Readout";
import { bucketOf, todayLocalIso } from "@/shared/lib/dueBuckets";
import { formatDate } from "@/shared/lib/time";
import { useEffectiveIdentity } from "@/shared/sandbox/useEffectiveIdentity";
import StatusPill from "../components/StatusPill";
import ReportTable, { type ReportColumn } from "../components/ReportTable";
import { ChartCard, DonutChart, HBarChart, MonthBarChart, NoData, StuckByStageChart } from "../components/ExitCharts";
import { useExitStore } from "../store";
import { STAGES, STEPS, stepByKey, type StepKey } from "../lib/steps";
import {
  attritionMtd,
  caseSummary,
  exitsByDepartment,
  exitsByMonth,
  exitsByReason,
  overdueRollup,
  settlementSpeed,
  type CountRow,
  type OverdueByOwner,
} from "../lib/analytics";

/**
 * The HR Exit dashboard — what is on YOU, and what the exit process is actually doing.
 *
 * ── THE THREE RULES THIS PAGE IS BUILT ON ────────────────────────────────────
 *
 * 1. **"Open exits" counts DISTINCT CASES, never queue entries.** A queue entry is a
 *    (step, case) work-item, and one case in the parallel block owes six of them at once —
 *    clearance AND assets AND handover AND the interview AND leave AND payroll — plus one
 *    per outstanding clearance check. Count entries here and the board reports six exits
 *    where one person is leaving. (The Control Center's per-step counts DO exceed the
 *    open-case count, and that is correct: it is asking a different question — units of
 *    work due, not people leaving.)
 *
 * 2. **Every "what's late" figure comes from `store.queueEntries`** — the same
 *    `buildQueueEntries(exitSnapshotFrom(…))` output the queue pages narrow, the Exit
 *    Control Center strips, and the cross-FMS scoreboard counts. It cannot claim a
 *    different number from the page it links to, because there is only one number.
 *
 * 3. **⚠ NOTHING ON THIS PAGE AGGREGATES AN RLS-GATED SATELLITE — and that omission is the
 *    single most important thing about it.** The F&F figures (`fms_exit_settlements`) and
 *    the exit-interview content (`fms_exit_interviews`) return **ZERO ROWS** to a viewer who
 *    may not read them: a reporting manager, an IT clearance owner, the employee before
 *    approval. Zero rows means **"not visible"**. It does NOT mean "zero rupees" and it does
 *    NOT mean "nobody was interviewed". A "Total F&F paid this month" tile summed over the
 *    rows RLS happened to hand you is a number that CHANGES DEPENDING ON WHO IS LOOKING AT
 *    IT, and prints itself as a fact — so it is not built. Every figure below is derived
 *    from the WIDE-READ case header, whose rows are already exactly the ones this viewer is
 *    entitled to. The header carries the FACT of an F&F payment (`fnfPaidAt`) with no amount
 *    attached, and that is all the settlement-speed tile needs.
 *
 * The page must also not crash — and must say something sensible — for an ordinary employee
 * with no cases and no step ownership. That person is the MAJORITY of users (`hr-exit` is a
 * universal module) and they are the first to land here, because they have come to resign.
 * For them it renders the PROCESS, not somebody else's data.
 */

/** Where each step's work lives, for the "on you" tiles. */
const QUEUE_LINK: Partial<Record<StepKey, string>> = {
  manager_review: "/hr-exit/queues/approvals",
  hr_verification: "/hr-exit/queues/approvals",
  hr_head_approval: "/hr-exit/queues/approvals",
  lwd_confirm: "/hr-exit/queues/approvals",
  clearance: "/hr-exit/queues/clearance",
  asset_return: "/hr-exit/queues/clearance",
  handover: "/hr-exit/queues/clearance",
  exit_interview: "/hr-exit/queues/interview",
  leave_verification: "/hr-exit/queues/settlement",
  payroll_inputs: "/hr-exit/queues/settlement",
  fnf_generate: "/hr-exit/queues/settlement",
  fnf_approve: "/hr-exit/queues/settlement",
  fnf_payment: "/hr-exit/queues/settlement",
  documents: "/hr-exit/queues/closure",
  archive: "/hr-exit/queues/closure",
};

export default function Dashboard() {
  const s = useExitStore();
  const { user, isAdmin } = useEffectiveIdentity();
  const today = todayLocalIso();

  const deptName = (id: string) => s.departments.find((d) => d.id === id)?.name ?? "Unknown";
  const personName = (id: string | null) => (id ? (s.profileById(id)?.name ?? "Unknown") : "Unassigned");

  /* --------------------------- the reporting model -------------------------- */
  const report = useMemo(
    () => ({
      summary: caseSummary(s.cases, today),
      overdue: overdueRollup(s.queueEntries, s.queueOwnerIds, today),
      speed: settlementSpeed(s.cases),
      attrition: attritionMtd(s.cases, today),
      byMonth: exitsByMonth(s.cases, 12, today),
      byDept: exitsByDepartment(s.cases, deptName),
      byReason: exitsByReason(s.cases, s.reasons),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s, today],
  );

  /* ------------------------------- my own work ------------------------------ */
  const myWork = useMemo(
    () =>
      STEPS.filter((st) => QUEUE_LINK[st.key])
        .map((st) => {
          const entries = s.myQueue(st.key);
          return {
            step: st,
            count: entries.length,
            overdue: entries.filter((e) => bucketOf(e.dueIso, today) === "delayed").length,
            to: QUEUE_LINK[st.key]!,
          };
        })
        .filter((w) => w.count > 0),
    [s, today],
  );

  if (s.isLoading) return <p className="text-[13.5px] text-grey-2">Loading…</p>;
  if (s.error) {
    return <p className="text-[13.5px] text-ryg-red">Couldn't load the exit data: {(s.error as Error).message}</p>;
  }

  const myOverdue = myWork.reduce((n, w) => n + w.overdue, 0);

  /**
   * Who gets the REPORTING half of this page.
   *
   * Not "who has rows": an ordinary employee who has raised their own resignation has
   * exactly one case, and rendering "Attrition this month: 1" over their own departure is
   * both useless and slightly grim. The aggregates are for the people who run the process
   * — exit staff, coordinators, admins. Everyone else gets the process itself.
   */
  const canSeeReporting = isAdmin || s.isProcessCoordinator || s.isExitStaff || s.ownsClearanceItem;

  const { summary, overdue, speed, attrition, byMonth, byDept, byReason } = report;

  /* --------------------------------- tables -------------------------------- */

  const ownerCols: ReportColumn<OverdueByOwner>[] = [
    {
      key: "owner",
      header: "Owner",
      cell: (o) =>
        o.ownerId ? (
          <span className="font-medium text-navy">{personName(o.ownerId)}</span>
        ) : (
          <span className="font-medium text-yellow">Nobody — step has no owner</span>
        ),
      value: (o) => (o.ownerId ? personName(o.ownerId) : "Unassigned"),
      width: 28,
    },
    {
      key: "overdue",
      header: "Overdue",
      align: "right",
      cell: (o) => <span className={o.overdue ? "font-semibold text-ryg-red" : "text-grey-2"}>{o.overdue}</span>,
      value: (o) => o.overdue,
      width: 10,
    },
    {
      key: "today",
      header: "Due today",
      align: "right",
      cell: (o) => <span className={o.dueToday ? "font-medium text-yellow" : "text-grey-2"}>{o.dueToday}</span>,
      value: (o) => o.dueToday,
      width: 11,
    },
    {
      key: "total",
      header: "Open items",
      align: "right",
      cell: (o) => <span className="text-grey">{o.total}</span>,
      value: (o) => o.total,
      width: 12,
    },
  ];

  const reasonCols: ReportColumn<CountRow>[] = [
    {
      key: "reason",
      header: "Reason given on the resignation",
      cell: (r) => (
        <span className={r.id ? "font-medium text-navy" : "font-medium text-yellow"}>{r.name}</span>
      ),
      value: (r) => r.name,
      width: 34,
    },
    {
      key: "count",
      header: "People",
      align: "right",
      cell: (r) => <span className="font-semibold text-navy">{r.count}</span>,
      value: (r) => r.count,
      width: 10,
    },
  ];

  /* --------------------------------- render -------------------------------- */

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">HR Exit</h1>
        <p className="mt-1 text-[13.5px] text-grey-2">
          Welcome, {user.name.split(" ")[0]}.
          {myOverdue > 0 && (
            <>
              {" "}
              <span className="font-semibold text-ryg-red">
                {myOverdue} item{myOverdue === 1 ? " is" : "s are"} overdue on you.
              </span>
            </>
          )}
        </p>
      </div>

      {/* ---- On you right now. Empty for most people, and it says so plainly. ---- */}
      <Card className="p-5">
        <h2 className="text-[15px] font-semibold text-navy">On you right now</h2>
        {myWork.length === 0 ? (
          <p className="mt-2 text-[13.5px] text-grey-2">Nothing is waiting on you.</p>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {myWork.map((w) => (
              <Link
                key={w.step.key}
                to={w.to}
                className="rounded-xl border border-line p-4 transition hover:border-orange/50 hover:bg-page/50"
              >
                <div className={FIELD_LABEL_CLASS}>{w.step.short}</div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-[24px] font-bold text-navy">{w.count}</span>
                  {w.overdue > 0 && (
                    <span className="rounded-full bg-[#FDECEC] px-1.5 py-0.5 text-[11px] font-semibold text-ryg-red">
                      {w.overdue} overdue
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-[12.5px] text-grey-2">{w.step.title}</div>
              </Link>
            ))}
          </div>
        )}
      </Card>

      {/* ---- My own resignation, if I have one. Nobody else's business, and mine matters. ---- */}
      {s.myCase && (
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold text-navy">Your resignation</h2>
          <div className="mt-3 flex flex-wrap items-center gap-2.5 text-[13px]">
            <Link to={`/hr-exit/my-exit`} className="font-semibold text-orange hover:underline">
              {s.myCase.exitNo}
            </Link>
            <StatusPill status={s.myCase.status} />
            <span className="text-grey-2">
              {s.myCase.lwd
                ? `Last working day ${formatDate(s.myCase.lwd)}`
                : "Last working day not confirmed yet"}
            </span>
            <Link to="/hr-exit/my-exit" className="ml-auto text-[12.5px] font-semibold text-orange hover:underline">
              Open →
            </Link>
          </div>
        </Card>
      )}

      {!canSeeReporting ? (
        /* ─────────────────────────────────────────────────────────────────────────
           THE MAJORITY CASE. An ordinary employee: no cases, no step, nobody's manager.
           They are here to resign, or to find out what happens if they do. Showing them a
           wall of zeroed KPI tiles would look broken AND would look like data they are not
           allowed to have. So: the process, and the door.
           ───────────────────────────────────────────────────────────────────────── */
        <>
          <Card className="p-5">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-navy">The process</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {STAGES.map((stage) => (
                <div key={stage.label}>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-grey">{stage.label}</p>
                  <ul className="mt-2 space-y-1.5">
                    {stage.keys.map((key) => {
                      const step = stepByKey(key);
                      if (!step) return null;
                      return (
                        <li key={key} className="flex gap-2 text-[13px] text-navy">
                          <span className="tabular-nums text-grey-2">{step.index}.</span>
                          <span>{step.title}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <p className="text-[13.5px] font-semibold text-navy">Raising your own exit</p>
            <p className="mt-1 text-[13px] text-grey-2">
              {s.policy.allowSelfService
                ? `Anyone can raise their own resignation here — the standard notice period is ${s.policy.defaultNoticeDays} days. It routes to your reporting manager, then to HR.`
                : "Self-service resignations are switched off. HR or your reporting manager raises the case on your behalf."}
            </p>
            {s.policy.allowSelfService && !s.myCase && (
              <Link
                to="/hr-exit/exits/new"
                className="mt-4 inline-block text-[12.5px] font-semibold text-orange hover:underline"
              >
                Raise an exit →
              </Link>
            )}
          </Card>
        </>
      ) : s.cases.length === 0 ? (
        /* Day one, and the honest state of the database. A wall of zeros looks like a
           broken page; this looks like a page waiting for work. */
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold text-navy">Exit reporting</h2>
          <EmptyState
            title="No exits yet"
            message="Attrition by month, by department and by reason, where cases get stuck, and how long the full & final actually takes all appear here the moment the first exit is raised."
          />
        </Card>
      ) : (
        <>
          {/* ---- Headline numbers ---- */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi
              label="Open exits"
              value={summary.openExits}
              hero
              // ⭐ DISTINCT CASES. One case owes up to six steps at once plus one entry per
              // outstanding clearance item — counting entries here would report six exits
              // where one person is leaving.
              hint={
                summary.onHold > 0
                  ? `people leaving · +${summary.onHold} on hold`
                  : "people leaving · not queue items"
              }
            />
            <Kpi
              label="Overdue right now"
              value={overdue.totalOverdue}
              tone={overdue.totalOverdue > 0 ? "red" : undefined}
              hint={`${overdue.totalDueToday} due today · of ${overdue.totalOpen} open items`}
            />
            <Kpi
              label="Leaving this month"
              value={summary.dueThisMonth}
              hint={summary.noLwd > 0 ? `${summary.noLwd} with no last working day yet` : "last working day this month"}
            />
            <Kpi
              label="Avg days to settle"
              value={speed.settled ? `${speed.avgDays}d` : "—"}
              hint={
                speed.settled
                  ? `last working day → F&F paid · ${speed.settled} settled`
                  : "nobody's F&F has been paid yet"
              }
            />
            <Kpi
              label="Attrition this month"
              value={attrition}
              hint="people whose last working day has passed"
            />
          </div>

          {/* ---- Where it's stuck ---- */}
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Where exits are stuck"
              subtitle="Every open work-item, against the due date its step's rule gives it. Held exits are excluded — a parked case is not late work."
              action={
                s.isProcessCoordinator ? (
                  <Link
                    to="/hr-exit/monitoring"
                    className="whitespace-nowrap text-[12px] font-semibold text-orange hover:underline"
                  >
                    Control Center →
                  </Link>
                ) : undefined
              }
            >
              {overdue.totalOpen === 0 ? (
                <NoData message="Nothing is open at any step — every exit is either finished or not started." />
              ) : (
                <StuckByStageChart
                  data={overdue.byStage.map((st) => ({
                    name: st.label,
                    overdue: st.overdue,
                    onTime: st.total - st.overdue,
                  }))}
                />
              )}
            </ChartCard>

            <ChartCard
              title="What's overdue, by owner"
              subtitle="Who to call. A step with no owner shows as unassigned — that is work nobody has been told about."
            >
              <ReportTable<OverdueByOwner>
                rows={overdue.byOwner}
                rowKey={(o) => o.ownerId ?? "unassigned"}
                columns={ownerCols}
                rowsLabel="owners"
                emptyMessage="Nobody has open exit work right now."
                exportName="HR_Exit_Overdue_By_Owner"
                exportTitle="Exit work by owner"
                exportNotes={[
                  "One row per person who owes open exit work. An exit owed at three steps counts three items, to (usually) three different people.",
                  "Overdue = the step's due date is before today. Due today = it falls today.",
                  "A clearance row belongs to whoever owes that row — the IT, Admin or Travel-Desk person, who owns no workflow step at all. The manager steps belong to the exiting employee's own reporting manager AND to the step's configured owners.",
                  "'Unassigned' means the step has no owner configured in Setup: that work is in nobody's queue.",
                ]}
              />
            </ChartCard>
          </div>

          {/* ---- Attrition ---- */}
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Exits by month"
              subtitle="Counted on the CONFIRMED last working day — the month someone actually left, not the month they resigned. Withdrawn and rejected cases are people who stayed, and are not counted."
            >
              {byMonth.every((m) => m.count === 0) ? (
                <NoData message="Nobody has left yet. This fills in as soon as the first exit's last working day passes." />
              ) : (
                <MonthBarChart data={byMonth.map((m) => ({ name: m.label, value: m.count }))} />
              )}
            </ChartCard>

            <ChartCard
              title="Exits by department"
              subtitle="Where the people are actually going from. Same basis as the month chart — confirmed departures only."
            >
              {byDept.length === 0 ? (
                <NoData message="No confirmed departures yet." />
              ) : (
                <HBarChart data={byDept.map((d) => ({ name: d.name, value: d.count }))} unit="people" />
              )}
            </ChartCard>
          </div>

          {/* ---- Why ---- */}
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Why people are leaving"
              subtitle="The reason given ON THE RESIGNATION — not the one given in the exit interview, which is confidential to HR and very often a different answer."
            >
              {byReason.length === 0 ? (
                <NoData message="No confirmed departures yet, so no reason has been recorded." />
              ) : (
                <>
                  <DonutChart data={byReason.map((r) => ({ name: r.name, value: r.count }))} />
                  {byReason.some((r) => r.id === null) && (
                    <p className="mt-2 text-[11.5px] text-yellow">
                      Some exits have no reason recorded. Until HR picks one when the case is raised, those departures
                      belong to no reason — they are shown as "Not recorded" rather than silently dropped.
                    </p>
                  )}
                </>
              )}
            </ChartCard>

            <ChartCard
              title="Reasons in full"
              subtitle="The same figures, with their denominators — and the gap the exit interview exists to find."
            >
              <ReportTable<CountRow>
                rows={byReason}
                rowKey={(r) => r.id ?? "none"}
                columns={reasonCols}
                rowsLabel="reasons"
                emptyMessage="No confirmed departures yet."
                exportName="HR_Exit_By_Reason"
                exportTitle="Exits by reason"
                exportNotes={[
                  "Counts CONFIRMED DEPARTURES — cases with a confirmed last working day, excluding the withdrawn and the rejected (those people stayed).",
                  "The reason is the one recorded ON THE RESIGNATION (fms_exit_reasons, on the case header). It is deliberately NOT the primary reason captured in the EXIT INTERVIEW, which lives in an RLS-protected table readable only by HR and the coordinators — and which is very often a different answer. That gap is a finding for HR, not a figure for a dashboard everyone can see.",
                  "'Not recorded' = no reason was picked when the case was raised. Those departures belong to no reason, and the row says so rather than dropping them.",
                ]}
              />
            </ChartCard>
          </div>

          {/* ---- Still owed money ---- */}
          {speed.awaitingPayment > 0 && (
            <Card className="p-5">
              <h2 className="text-[15px] font-semibold text-navy">Settlements still open</h2>
              <p className="mt-1 text-[13px] text-grey">
                <span className="font-semibold text-ryg-red">{speed.awaitingPayment}</span>{" "}
                {speed.awaitingPayment === 1 ? "person has" : "people have"} already left and{" "}
                {speed.awaitingPayment === 1 ? "has" : "have"} not been paid their full &amp; final.
                {speed.settled > 0 && (
                  <>
                    {" "}
                    Of the {speed.settled} already settled, the median was {speed.medianDays} days from the last working
                    day (fastest {speed.fastestDays}, slowest {speed.slowestDays}).
                  </>
                )}
              </p>
              <p className="mt-2 text-[11.5px] text-grey-2">
                Counted from the case header — the FACT that an F&amp;F was paid, with no amount attached. The figures
                themselves live in a table only payroll, accounts and the coordinators can read, and this page never sums
                a number it might only be seeing half of.
              </p>
            </Card>
          )}

          {/* ---- Recent exits ---- */}
          {s.cases.length > 0 && (
            <Card className="p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-[15px] font-semibold text-navy">Latest exits</h2>
                <Link to="/hr-exit/exits" className="text-[12.5px] font-semibold text-orange hover:underline">
                  All exits →
                </Link>
              </div>
              <ul className="mt-3 space-y-2.5">
                {[...s.cases]
                  .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
                  .slice(0, 8)
                  .map((c) => {
                    const step = (c.currentStep as StepKey) ?? null;
                    return (
                      <li key={c.id} className="flex flex-wrap items-center gap-2.5 text-[13px]">
                        <Link to={`/hr-exit/exits/${c.id}`} className="font-semibold text-orange hover:underline">
                          {c.exitNo}
                        </Link>
                        <span className="text-navy">{c.employeeName}</span>
                        <span className="text-grey-2">{deptName(c.departmentId)}</span>
                        <StatusPill status={c.status} />
                        <span className="ml-auto flex items-center gap-2 text-[12.5px] text-grey-2">
                          {stepByKey(step)?.short}
                          <DueCell dueIso={step ? s.dueIsoFor(c, step) : null} />
                        </span>
                      </li>
                    );
                  })}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The dashboard tile. A thin wrapper over the shared Kpi purely so the call sites keep
 * their `hero` boolean — the shared component takes a size, because the Control Center
 * wants the same tile a size smaller.
 */
function Kpi({
  label,
  value,
  hint,
  tone,
  hero,
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: "red";
  hero?: boolean;
}) {
  return <SharedKpi label={label} value={value} hint={hint} tone={tone} size={hero ? "hero" : "lg"} />;
}
