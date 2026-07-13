import { useMemo } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import EmptyState from "@/shared/components/ui/EmptyState";
import DueCell from "@/shared/components/ui/DueCell";
import SharedKpi from "@/shared/components/ui/Kpi";
import { FIELD_LABEL_CLASS } from "@/shared/components/ui/Readout";
import { bucketOf, todayLocalIso } from "@/shared/lib/dueBuckets";
import { formatDateDMY } from "@/shared/lib/date";
import { useEffectiveIdentity } from "@/shared/sandbox/useEffectiveIdentity";
import StatusPill from "../components/StatusPill";
import ReportTable, { type ReportColumn } from "../components/ReportTable";
import {
  ChartCard,
  DonutChart,
  FunnelChart,
  HBarChart,
  NoData,
  OUTCOME_COLORS,
  OverdueByStepChart,
} from "../components/HrCharts";
import { useHrStore } from "../store";
import { STEPS, isHodStep, stepByKey, type StepKey } from "../lib/steps";
import { CANDIDATE_WINDOW_MONTHS } from "../data/hrFetch";
import {
  candidatesInWindow,
  offerAcceptance,
  overdueRollup,
  pipelineFunnel,
  platformEffectiveness,
  probationOutcomes,
  seatSummary,
  timeToHire,
  type FunnelStage,
  type OverdueByOwner,
  type PlatformRow,
  type TimeToHireByDept,
} from "../lib/analytics";

/**
 * The HR Recruitment dashboard — what is on YOU, and what recruitment is actually
 * doing.
 *
 * Every "what's late" count comes from `store.queueEntries`, i.e. the same
 * `lib/queues.ts` entries the queue pages and the cross-FMS scoreboard read. It
 * cannot claim a different number from the queue it links to, because there is only
 * one number.
 *
 * Every reporting figure comes from `lib/analytics.ts`, which reads authoritative
 * timestamp columns on domain rows — never the activity trail (see the header there
 * for why the trail cannot be trusted for this).
 *
 * PII: the reports are aggregates. No candidate name, phone or salary appears here,
 * so the dashboard shows nobody anything they could not already see — and the rows it
 * aggregates are the rows RLS handed this user, so the figures scope themselves.
 */

/** Where a queue step's work lives, for the "on you" tiles. */
const QUEUE_LINK: Partial<Record<StepKey, string>> = {
  hr_head_approval: "/hr-recruitment/queues/approvals",
  mgmt_approval: "/hr-recruitment/queues/approvals",
  job_posting: "/hr-recruitment/queues/posting",
  resume_upload: "/hr-recruitment/queues/pipeline",
  hr_shortlist: "/hr-recruitment/queues/pipeline",
  hod_share: "/hr-recruitment/queues/pipeline",
  hod_shortlist: "/hr-recruitment/queues/pipeline",
  interview_1: "/hr-recruitment/queues/interviews",
  interview_2: "/hr-recruitment/queues/interviews",
  interview_3: "/hr-recruitment/queues/interviews",
  final_decision: "/hr-recruitment/queues/pipeline",
  onboarding: "/hr-recruitment/queues/onboarding",
  probation_m1: "/hr-recruitment/queues/probation",
  probation_m2: "/hr-recruitment/queues/probation",
  probation_m3: "/hr-recruitment/queues/probation",
  probation_final: "/hr-recruitment/queues/probation",
  probation_extension: "/hr-recruitment/queues/probation",
};

export default function Dashboard() {
  const s = useHrStore();
  const { user, isAdmin } = useEffectiveIdentity();
  const today = todayLocalIso();

  const deptName = (id: string) => s.departments.find((d) => d.id === id)?.name ?? "Unknown";
  const personName = (id: string | null) => (id ? (s.profileById(id)?.name ?? "Unknown") : "Unassigned");

  /* --------------------------- the reporting model -------------------------- */
  const report = useMemo(() => {
    const windowCandidates = candidatesInWindow(s.candidates, s.candidateWindowStartIso);
    return {
      seats: seatSummary(s.requisitions, s.candidates, s.onboardings),
      overdue: overdueRollup(s.queueEntries, s.queueOwnerIds, today),
      hire: timeToHire(s.requisitions, s.onboardings),
      funnel: pipelineFunnel(windowCandidates),
      platforms: platformEffectiveness(windowCandidates, s.jobPlatforms),
      offers: offerAcceptance(s.onboardings),
      probation: probationOutcomes(s.probations),
      windowCandidates: windowCandidates.length,
    };
  }, [s, today]);

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
    return <p className="text-[13.5px] text-ryg-red">Couldn't load HR data: {(s.error as Error).message}</p>;
  }

  if (!isAdmin && !s.isAnyStepOwner && s.myRequisitions.length === 0) {
    return (
      <EmptyState
        title="Nothing assigned to you yet"
        message="You have access to HR Recruitment, but no workflow step is assigned to you. An administrator can assign one in Setup → Step Owners."
      />
    );
  }

  const myOverdue = myWork.reduce((n, w) => n + w.overdue, 0);

  // HOD steps need no owner — they follow whoever raised the MRF.
  const assignable = STEPS.filter((st) => !isHodStep(st.key));
  const unassigned = assignable.filter((st) => (s.stepOwnerFor(st.key)?.employeeIds.length ?? 0) === 0);

  const { seats, overdue, hire, funnel, platforms, offers, probation } = report;
  const nothingYet = s.requisitions.length === 0;

  const windowLabel = `CVs uploaded since ${formatDateDMY(s.candidateWindowStartIso)}`;

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

  const funnelCols: ReportColumn<FunnelStage>[] = [
    { key: "stage", header: "Stage", cell: (f) => <span className="font-medium text-navy">{f.label}</span>, value: (f) => f.label, width: 22 },
    { key: "count", header: "Candidates", align: "right", cell: (f) => <span className="text-navy">{f.count}</span>, value: (f) => f.count, width: 12 },
    {
      key: "prev",
      header: "Of the stage before",
      align: "right",
      cell: (f) => <span className="text-grey">{f.fromPrevious === null ? "—" : `${f.fromPrevious}%`}</span>,
      value: (f) => (f.fromPrevious === null ? "" : `${f.fromPrevious}%`),
      width: 18,
    },
    {
      key: "top",
      header: "Of all CVs",
      align: "right",
      cell: (f) => <span className="text-grey-2">{f.fromTop === null ? "—" : `${f.fromTop}%`}</span>,
      value: (f) => (f.fromTop === null ? "" : `${f.fromTop}%`),
      width: 12,
    },
  ];

  const deptCols: ReportColumn<TimeToHireByDept>[] = [
    { key: "dept", header: "Department", cell: (d) => <span className="font-medium text-navy">{deptName(d.departmentId)}</span>, value: (d) => deptName(d.departmentId), width: 26 },
    { key: "avg", header: "Avg days", align: "right", cell: (d) => <span className="font-semibold text-navy">{d.avgDays}</span>, value: (d) => d.avgDays, width: 10 },
    { key: "median", header: "Median", align: "right", cell: (d) => <span className="text-grey">{d.medianDays}</span>, value: (d) => d.medianDays, width: 10 },
    { key: "range", header: "Fastest – slowest", align: "right", cell: (d) => <span className="text-grey-2">{d.fastestDays} – {d.slowestDays}</span>, value: (d) => `${d.fastestDays} – ${d.slowestDays}`, width: 18 },
    { key: "hires", header: "Based on", align: "right", cell: (d) => <span className="text-grey-2">{d.hires} {d.hires === 1 ? "hire" : "hires"}</span>, value: (d) => d.hires, width: 12 },
  ];

  const platformCols: ReportColumn<PlatformRow>[] = [
    {
      key: "name",
      header: "Platform",
      cell: (p) => (
        <span className={p.platformId ? "font-medium text-navy" : "font-medium text-yellow"}>{p.name}</span>
      ),
      value: (p) => p.name,
      width: 24,
    },
    { key: "cvs", header: "CVs", align: "right", cell: (p) => <span className="text-grey">{p.cvs}</span>, value: (p) => p.cvs, width: 8 },
    { key: "interviewed", header: "Interviewed", align: "right", cell: (p) => <span className="text-grey">{p.interviewed}</span>, value: (p) => p.interviewed, width: 12 },
    { key: "hires", header: "Hires", align: "right", cell: (p) => <span className="font-semibold text-navy">{p.hires}</span>, value: (p) => p.hires, width: 8 },
    {
      key: "rate",
      header: "CV → hire",
      align: "right",
      cell: (p) => <span className={p.hires > 0 ? "font-medium text-ryg-green" : "text-grey-2"}>{p.hireRate === null ? "—" : `${p.hireRate}%`}</span>,
      value: (p) => (p.hireRate === null ? "" : `${p.hireRate}%`),
      width: 11,
    },
  ];

  /* --------------------------------- render -------------------------------- */

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">HR Recruitment</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
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

      {/* ---- On you right now ---- */}
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

      {/* ---- Sent back to me ---- */}
      {s.mySentBack.length > 0 && (
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold text-navy">Sent back to you</h2>
          <p className="mt-1 text-[13px] text-grey-2">Fix these and resubmit — the approval clock restarts.</p>
          <ul className="mt-3 space-y-2">
            {s.mySentBack.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                <Link to={`/hr-recruitment/requisitions/${r.id}`} className="font-semibold text-orange hover:underline">
                  {r.mrfNo}
                </Link>
                <span className="text-navy">{r.jobTitle}</span>
                {r.sentBackReason && <span className="text-grey-2">— {r.sentBackReason}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {nothingYet ? (
        /* Day one, and the honest state of the live database right now. A wall of
           zeros looks like a broken page; this looks like a page waiting for work. */
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold text-navy">Recruitment reporting</h2>
          <EmptyState
            title="No requisitions yet"
            message="Time to hire, where the pipeline leaks, which platform actually works, offer-acceptance and probation outcomes all appear here the moment the first requisition is raised."
            actionLabel={s.isStepOwner("mrf") ? "Raise a requisition" : undefined}
            actionTo={s.isStepOwner("mrf") ? "/hr-recruitment/requisitions/new" : undefined}
          />
        </Card>
      ) : (
        <>
          {/* ---- Headline numbers ---- */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi
              label="Open requisitions"
              value={seats.openRequisitions}
              hint={seats.onHold > 0 ? `+${seats.onHold} on hold` : "being worked now"}
            />
            <Kpi
              label="Seats unfilled"
              value={seats.seatsUnfilled}
              hero
              tone={seats.seatsUnfilled > 0 ? "red" : undefined}
              hint={`of ${seats.seatsRequired} asked for · ${seats.seatsOffered} offered, not joined`}
            />
            <Kpi
              label="Still to source"
              value={seats.seatsToSource}
              hint="nobody lined up yet"
            />
            <Kpi
              label="Overdue right now"
              value={overdue.totalOverdue}
              tone={overdue.totalOverdue > 0 ? "red" : undefined}
              hint={`${overdue.totalDueToday} due today`}
            />
            <Kpi
              label="Avg time to hire"
              value={hire.overall.hires ? `${hire.overall.avgDays}d` : "—"}
              hint={
                hire.overall.hires
                  ? `based on ${hire.overall.hires} ${hire.overall.hires === 1 ? "hire" : "hires"}`
                  : "no one has joined yet"
              }
            />
          </div>

          {/* ---- What's overdue ---- */}
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="What's overdue, by step"
              subtitle="Every open work-item, against the due date its step's rule gives it."
              action={
                s.isProcessCoordinator ? (
                  <Link to="/hr-recruitment/monitoring" className="text-[12px] font-semibold text-orange hover:underline whitespace-nowrap">
                    Control Center →
                  </Link>
                ) : undefined
              }
            >
              {overdue.byStep.length === 0 ? (
                <NoData message="Nothing is open at any step — every requisition, candidate and hire is either done or not started." />
              ) : (
                <OverdueByStepChart
                  data={overdue.byStep.map((st) => ({
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
                emptyMessage="Nobody has open recruitment work right now."
                exportName="HR_Overdue_By_Owner"
                exportTitle="Overdue by owner"
                exportNotes={[
                  "One row per person who owes open recruitment work.",
                  "Overdue = the step's due date is before today. Due today = it falls today.",
                  "HOD steps (HOD shortlist, Round 2, probation) are owned by whoever raised that requisition — not by a global owner list.",
                  "'Unassigned' means the step has no owner configured in Setup: that work is in nobody's queue.",
                ]}
              />
            </ChartCard>
          </div>

          {/* ---- Time to hire ---- */}
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Time to hire"
              subtitle="From the day the MRF was submitted to the day the person actually walked in. Counts only people who joined — an offer in flight is not a hire."
            >
              {hire.overall.hires === 0 ? (
                <NoData message="Nobody has joined yet. This fills in as soon as the first hire's onboarding completes." />
              ) : (
                <>
                  <div className="mb-4 flex flex-wrap items-baseline gap-x-5 gap-y-1">
                    <span className="text-[30px] font-bold text-navy leading-none">{hire.overall.avgDays}</span>
                    <span className="text-[13px] text-grey-2">
                      days on average · median {hire.overall.medianDays} · fastest {hire.overall.fastestDays},
                      slowest {hire.overall.slowestDays}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        hire.overall.hires < 5 ? "bg-[#FFF7E6] text-yellow" : "bg-page text-grey-2"
                      }`}
                    >
                      based on {hire.overall.hires} {hire.overall.hires === 1 ? "hire" : "hires"}
                      {hire.overall.hires < 5 ? " — too few to draw a conclusion" : ""}
                    </span>
                  </div>
                  <HBarChart
                    data={hire.byDepartment.map((d) => ({ name: deptName(d.departmentId), value: d.avgDays }))}
                    unit="days (avg)"
                  />
                </>
              )}
            </ChartCard>

            <ChartCard title="Time to hire, by department" subtitle="Each department's own average — and how many hires it rests on.">
              <ReportTable<TimeToHireByDept>
                rows={hire.byDepartment}
                rowKey={(d) => d.departmentId}
                columns={deptCols}
                rowsLabel="departments"
                emptyMessage="No department has completed a hire yet."
                exportName="HR_Time_To_Hire"
                exportTitle="Time to hire by department"
                exportNotes={[
                  "Time to hire = calendar days from the MRF's submitted_at to the person's joining date.",
                  "Counts ONLY people who accepted the offer AND completed onboarding — i.e. actually joined. Candidates who were finalized but never turned up are excluded.",
                  "The clock stops on the joining date, not on the day HR finished the checklist.",
                  "'Based on' is the denominator. An average over one or two hires is noise, not a trend.",
                ]}
              />
            </ChartCard>
          </div>

          {/* ---- Funnel + platforms ---- */}
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Where the pipeline leaks"
              subtitle={`Every CV counts at every stage it ever reached — so someone rejected at Round 2 still counts as interviewed. ${windowLabel}.`}
            >
              {report.windowCandidates === 0 ? (
                <NoData message={`No CVs have been uploaded in the last ${CANDIDATE_WINDOW_MONTHS} months. The funnel appears once HR adds candidates to a vacancy.`} />
              ) : (
                <>
                  <FunnelChart
                    data={funnel.map((f) => ({ name: f.label, value: f.count, drop: f.fromPrevious }))}
                  />
                  <div className="mt-3">
                    <ReportTable<FunnelStage>
                      rows={funnel}
                      rowKey={(f) => f.key}
                      columns={funnelCols}
                      rowsLabel="stages"
                      emptyMessage="No candidates in the reporting window."
                      exportName="HR_Pipeline_Funnel"
                      exportTitle="Pipeline funnel"
                      exportNotes={[
                        `Covers CVs uploaded on or after ${formatDateDMY(s.candidateWindowStartIso)} (a rolling ${CANDIDATE_WINDOW_MONTHS}-month window).`,
                        "Each stage counts candidates who EVER reached it, read from that stage's own timestamp column — not where cards are sitting today.",
                        "'Interviewed' means a round was actually held, not merely booked.",
                        "'Actually joined' means their onboarding completed — a finalized candidate who never turned up does not count.",
                      ]}
                    />
                  </div>
                </>
              )}
            </ChartCard>

            <ChartCard
              title="Which platform actually works"
              subtitle={`Hires per platform the CV came from — the thing the sheet could never answer. ${windowLabel}.`}
            >
              {platforms.length === 0 ? (
                <NoData message="No CVs yet, so no platform has produced anything to compare." />
              ) : (
                <>
                  <HBarChart
                    data={platforms
                      .filter((p) => p.cvs > 0)
                      .map((p) => ({
                        name: p.name,
                        value: p.hires,
                        color: p.platformId ? undefined : "#F8B62B",
                      }))}
                    unit="hires"
                  />
                  {platforms.some((p) => p.platformId === null) && (
                    <p className="mt-2 text-[11.5px] text-yellow">
                      Some CVs have no source platform recorded. Until HR tags the source on upload, those hires cannot be
                      credited to any platform — they are shown as "Not recorded" rather than silently dropped.
                    </p>
                  )}
                  <div className="mt-3">
                    <ReportTable<PlatformRow>
                      rows={platforms}
                      rowKey={(p) => p.platformId ?? "none"}
                      columns={platformCols}
                      rowsLabel="platforms"
                      emptyMessage="No CVs in the reporting window."
                      exportName="HR_Platform_Effectiveness"
                      exportTitle="Platform effectiveness"
                      exportNotes={[
                        `Covers CVs uploaded on or after ${formatDateDMY(s.candidateWindowStartIso)} (a rolling ${CANDIDATE_WINDOW_MONTHS}-month window).`,
                        "The platform is the one recorded on the CANDIDATE (where their CV came from) — not the platforms the job was advertised on. Advertising on five and hiring from one is exactly what this report exists to show.",
                        "'Not recorded' = HR did not tag a source when the CV was added. Those hires belong to no platform, and the row says so rather than dropping them.",
                        "CV → hire is hires ÷ CVs for that platform. On small numbers it is a ratio, not a verdict.",
                      ]}
                    />
                  </div>
                </>
              )}
            </ChartCard>
          </div>

          {/* ---- Offers + probation ---- */}
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Offer-acceptance rate"
              subtitle="Of the people we finalized, how many actually took the job. Offers still awaiting an answer are excluded — a pending offer is not a refusal."
            >
              {offers.decided === 0 ? (
                <NoData
                  message={
                    offers.pending > 0
                      ? `${offers.pending} offer${offers.pending === 1 ? " is" : "s are"} still awaiting an answer. The rate appears once the first one is decided.`
                      : "Nobody has been finalized yet, so there are no offers to measure."
                  }
                />
              ) : (
                <>
                  <div className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                    <span className="text-[30px] font-bold text-navy leading-none">{offers.rate}%</span>
                    <span className="text-[13px] text-grey-2">
                      accepted · based on {offers.decided} decided offer{offers.decided === 1 ? "" : "s"}
                      {offers.pending > 0 && ` · ${offers.pending} still pending (excluded)`}
                    </span>
                  </div>
                  <DonutChart
                    data={[
                      { name: "Accepted", value: offers.accepted, color: OUTCOME_COLORS.confirmed },
                      { name: "Declined", value: offers.declined, color: OUTCOME_COLORS.rejected },
                      { name: "Did not join", value: offers.noShow, color: OUTCOME_COLORS.extension },
                    ].filter((d) => d.value > 0)}
                  />
                  <p className="mt-2 text-[11.5px] text-grey-2">
                    {offers.joined} of the {offers.accepted} who accepted {offers.joined === 1 ? "has" : "have"} completed
                    onboarding and is on the payroll; the rest are mid-checklist.
                  </p>
                </>
              )}
            </ChartCard>

            <ChartCard
              title="Probation outcomes"
              subtitle="Everyone who joined and reached a verdict. Extended = still in the extra month; someone extended and then confirmed counts as a confirmation."
            >
              {probation.total === 0 ? (
                <NoData message="Nobody is on probation yet. A probation opens the moment a hire's onboarding completes." />
              ) : (
                <>
                  <DonutChart
                    data={[
                      { name: "Confirmed", value: probation.confirmed, color: OUTCOME_COLORS.confirmed },
                      { name: "Rejected", value: probation.rejected, color: OUTCOME_COLORS.rejected },
                      { name: "In extension", value: probation.inExtension, color: OUTCOME_COLORS.extension },
                      { name: "Still in probation", value: probation.inProgress, color: OUTCOME_COLORS.inProgress },
                    ].filter((d) => d.value > 0)}
                  />
                  <p className="mt-2 text-[11.5px] text-grey-2">
                    {probation.decided === 0
                      ? "Nobody has reached a final verdict yet."
                      : `${probation.confirmed} of ${probation.decided} decided probation${probation.decided === 1 ? "" : "s"} ended in confirmation.`}
                    {probation.everExtended > 0 &&
                      ` ${probation.everExtended} of them needed an extra month first.`}
                  </p>
                </>
              )}
            </ChartCard>
          </div>
        </>
      )}

      {/* ---- My requisitions ---- */}
      {s.myRequisitions.length > 0 && (
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold text-navy">Your requisitions</h2>
          <ul className="mt-3 space-y-2.5">
            {s.myRequisitions.slice(0, 8).map((r) => {
              const step = (r.currentStep as StepKey) ?? null;
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-2.5 text-[13px]">
                  <Link to={`/hr-recruitment/requisitions/${r.id}`} className="font-semibold text-orange hover:underline">
                    {r.mrfNo}
                  </Link>
                  <span className="text-navy">{r.jobTitle}</span>
                  <StatusPill status={r.status} />
                  <span className="ml-auto flex items-center gap-2 text-[12.5px] text-grey-2">
                    {stepByKey(step)?.short}
                    <DueCell dueIso={s.dueIsoFor(r, step)} />
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {/* ---- Setup gaps (admins) ---- */}
      {isAdmin && unassigned.length > 0 && (
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold text-navy">Setup still needed</h2>
          <p className="mt-2 text-[13.5px] text-grey">
            {unassigned.length} of {assignable.length} steps have no owner. Work cannot reach anybody's queue until they do.
          </p>
          <ul className="mt-3 space-y-1">
            {unassigned.map((st) => (
              <li key={st.key} className="text-[13px] text-grey-2">
                <span className="font-medium text-navy">{st.title}</span> — unassigned
              </li>
            ))}
          </ul>
          <Link to="/hr-recruitment/settings" className="mt-4 inline-block text-[12.5px] font-semibold text-orange hover:underline">
            Open Setup →
          </Link>
        </Card>
      )}
    </div>
  );
}

/**
 * The dashboard tile. A thin wrapper over the shared Kpi purely so the ~10 call sites
 * below keep their `hero` boolean — the shared component takes a size, because the
 * Control Center wants the same tile a size smaller.
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
