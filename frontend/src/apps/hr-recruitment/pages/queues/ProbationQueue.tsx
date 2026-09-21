import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import DueCell, { overdueRowClass } from "@/shared/components/ui/DueCell";
import StageTabs from "@/shared/components/ui/StageTabs";
import { useStageMode } from "@/shared/lib/useStageMode";
import { formatDateDMY } from "@/shared/lib/date";
import ProbationPanel from "../../components/probation/ProbationPanel";
import GrievancesPanel from "../../components/probation/GrievancesPanel";
import { CHECKIN_DAYS } from "../../types";
import CompletedTable from "../../components/CompletedTable";
import AccessDenied from "../system/AccessDenied";
import { useHrStore } from "../../store";
import { stepByKey } from "../../lib/steps";
import type { Probation } from "../../types";

/**
 * Everyone who has actually JOINED and is still on probation.
 *
 * Rows come from `store.queueEntries` — the SAME entries lib/queues.ts feeds the
 * Kanban and the Control Center, so this page's overdue count and theirs cannot
 * drift: there is only one due date per check-in, stamped in SQL as CALENDAR days
 * from the joining date.
 *
 * Probations are gathered across ALL the probation steps rather than one: a
 * probation sits at exactly one of them at a time (its earliest incomplete
 * check-in, or the decision), so collecting them all yields each person once.
 *
 * ⚠ This list is load-bearing and easy to miss. NR-10 re-cadenced the reviews to
 * Day 7/15/30/60/90, and until these keys were changed with it the queue silently
 * showed NOBODY — every probation sat at a step this array did not name, so it
 * was filtered out with no error anywhere. The retired monthly keys stay listed
 * so a row left at one of them is still visible rather than lost.
 */
const PROBATION_STEPS = [
  "probation_d7",
  "probation_d15",
  "probation_d30",
  "probation_d60",
  "probation_d90",
  "probation_final",
  "probation_extension",
  // retired by NR-10, kept so nothing sitting at one disappears
  "probation_m1",
  "probation_m2",
  "probation_m3",
] as const;

export default function ProbationQueue() {
  const s = useHrStore();
  const [open, setOpen] = useState<Probation | null>(null);

  const rows = useMemo(() => {
    const seen = new Set<string>();
    const out: Probation[] = [];
    for (const step of PROBATION_STEPS) {
      for (const e of s.myQueue(step)) {
        if (seen.has(e.entityId)) continue;
        const p = s.probationById(e.entityId);
        if (!p) continue;
        seen.add(e.entityId);
        out.push(p);
      }
    }
    return out;
  }, [s]);

  const completed = useMemo(() => PROBATION_STEPS.flatMap((step) => s.completedFor(step)), [s]);
  const stage = useStageMode(completed, s.userId);

  // Coordinators chase everything, and fms_hr_can_act already lets them act — so the
  // page must not lock out someone whose own queue has rows in it.
  const owns = PROBATION_STEPS.some((k) => s.isStepOwner(k));
  if (!owns && !s.isProcessCoordinator) return <AccessDenied />;

  const dueOf = (p: Probation) => s.probationDueIso(p);
  const deptName = (id: string) => s.departments.find((d) => d.id === id)?.name ?? "—";
  const candOf = (p: Probation) => s.candidateById(p.candidateId);
  const reqOf = (p: Probation) => s.requisitionById(p.requisitionId);
  const stageOf = (p: Probation) => {
    const step = s.probationPendingStep(p);
    return step ? (stepByKey(step)?.short ?? step) : "—";
  };

  const columns: QueueColumn<Probation>[] = [
    {
      key: "name",
      header: "On probation",
      cell: (p) => {
        const c = candOf(p);
        const o = s.onboardingById(p.onboardingId);
        return (
          <div>
            <div className="font-medium text-navy">{c?.name ?? "Unknown"}</div>
            <div className="text-[12px] text-grey-2">
              {reqOf(p)?.jobTitle ?? "—"}
              {o?.employeeCode && ` · ${o.employeeCode}`}
            </div>
          </div>
        );
      },
      sortValue: (p) => candOf(p)?.name ?? "",
      filter: { kind: "text", get: (p) => candOf(p)?.name ?? "" },
      exportValue: (p) => candOf(p)?.name ?? "Unknown",
    },
    {
      key: "department",
      header: "Department",
      cell: (p) => <span className="text-grey">{deptName(reqOf(p)?.departmentId ?? "")}</span>,
      sortValue: (p) => deptName(reqOf(p)?.departmentId ?? ""),
      filter: { kind: "select", get: (p) => deptName(reqOf(p)?.departmentId ?? "") },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "position",
      header: "Position",
      cell: (p) => <span className="text-grey">{reqOf(p)?.jobTitle ?? "—"}</span>,
      sortValue: (p) => reqOf(p)?.jobTitle ?? "",
      filter: { kind: "text", get: (p) => reqOf(p)?.jobTitle ?? "" },
    },
    {
      key: "mrf",
      header: "Vacancy",
      cell: (p) => {
        const r = reqOf(p);
        if (!r) return <span className="text-grey-2">—</span>;
        return (
          <Link
            to={`/hr-recruitment/requisitions/${r.id}`}
            className="font-semibold text-orange hover:underline"
          >
            {r.mrfNo}
          </Link>
        );
      },
      sortValue: (p) => reqOf(p)?.mrfNo ?? "",
      filter: { kind: "text", get: (p) => reqOf(p)?.mrfNo ?? "" },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "joined",
      header: "Joined",
      cell: (p) => <span className="text-grey">{formatDateDMY(p.joiningDate)}</span>,
      sortValue: (p) => p.joiningDate,
      exportValue: (p) => formatDateDMY(p.joiningDate),
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "stage",
      header: "Waiting on",
      cell: (p) => <span className="text-navy">{stageOf(p)}</span>,
      sortValue: (p) => stageOf(p),
      filter: { kind: "select", get: (p) => stageOf(p) },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "checkins",
      header: "Check-ins",
      // NR-10: done means BOTH sides are in, which is why it counts completedAt
      // rather than either timestamp. A check-in with only the HOD's half is
      // outstanding work, and showing it as done would hide exactly the gap this
      // whole cadence exists to surface.
      cell: (p) => {
        const list = s.checkinsFor(p.id);
        const done = list.filter((c) => c.completedAt).length;
        const half = list.filter((c) => !c.completedAt && (c.hodAt || c.joinerAt)).length;
        return (
          <span className={done === CHECKIN_DAYS.length ? "text-ryg-green font-medium" : "text-grey"}>
            {done} / {CHECKIN_DAYS.length}
            {half > 0 && <span className="ml-1.5 text-[11.5px] text-grey-2">{half} half-done</span>}
          </span>
        );
      },
      sortValue: (p) => s.checkinsFor(p.id).filter((c) => c.completedAt).length,
      exportValue: (p) =>
        `${s.checkinsFor(p.id).filter((c) => c.completedAt).length} of ${CHECKIN_DAYS.length} complete`,
    },
    {
      key: "due",
      header: "Due",
      cell: (p) => <DueCell dueIso={dueOf(p)} />,
      sortValue: (p) => dueOf(p) ?? "9999",
      exportValue: (p) => formatDateDMY(dueOf(p)),
      tdClassName: "whitespace-nowrap",
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Probation Reviews</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          {stage.showingCompleted
            ? "Reviews and decisions you have recorded. A recorded review stays editable until the decision closes the probation; the decision itself is taken from the panel."
            : "Everyone who has joined and is still on probation. Check in on Day 7, 15, 30, 60 and 90 — calendar days after they joined — then confirm, reject, or extend. Each check-in is written twice: by the head of department, and by the new joiner from their own account. It is not done until both are in."}
        </p>
      </div>

      {/* KPI 1C.6 — HR's own 24-hour clock. Renders nothing for anyone else, and
          the table's policy would return them nothing anyway. */}
      <GrievancesPanel />

      <StageTabs
        mode={stage.mode}
        onMode={stage.setMode}
        pendingCount={rows.length}
        completedCount={completed.length}
        scope={stage.scope}
        onScope={stage.setScope}
        scopeNote={s.stageScopeNote}
      />

      {stage.showingCompleted ? (
        <CompletedTable
          rows={stage.rows}
          subjectHeader="On probation"
          subject={(e) => <span className="font-medium text-navy">{e.ref}</span>}
          subjectText={(e) => e.ref}
          exportName="HR_Probation_Completed"
          emptyMessage="Reviews and decisions you record will appear here."
          onEdit={(e) => setOpen(e.row as Probation)}
          onView={(e) => setOpen(e.row as Probation)}
        />
      ) : (
        <QueueTable<Probation>
          rows={rows}
          rowKey={(p) => p.id}
          columns={columns}
          rowsLabel="people on probation"
          rowClassName={(p) => overdueRowClass(dueOf(p))}
          emptyTitle="Nobody on probation"
          emptyMessage="Once a new hire's onboarding is complete — they actually joined — their three monthly reviews open here."
          initialSort={{ key: "due", dir: "asc" }}
          exportName="HR_Probation"
          exportTitle="Probation reviews"
          exportNotes={[
            "People who have JOINED and are still on probation. A probation with a final verdict is history, not a work item, so it drops off this list.",
            "Each review is due one CALENDAR month after the joining date, not N working days — a 31-Jan joiner's Month-1 review is due 28-Feb.",
            "'Waiting on' is the single next thing owed: the earliest unwritten review, or the decision once all three are in.",
            "Contains employee names — treat the file as personal data.",
          ]}
          actions={(p) => (
            <Button size="sm" onClick={() => setOpen(p)}>
              Open
            </Button>
          )}
        />
      )}

      {open && <ProbationPanel probation={open} open={!!open} onClose={() => setOpen(null)} />}
    </div>
  );
}
