import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import DueCell, { overdueRowClass } from "@/shared/components/ui/DueCell";
import StageTabs from "@/shared/components/ui/StageTabs";
import { useStageMode } from "@/shared/lib/useStageMode";
import { formatDateDMY } from "@/shared/lib/date";
import ExitInterviewPanel from "../../components/interview/ExitInterviewPanel";
import CompletedExitTable from "../../components/CompletedExitTable";
import AccessDenied from "../system/AccessDenied";
import { useExitStore } from "../../store";
import { CASE_TYPE_LABEL } from "../../lib/format";
import type { QueueEntry, StageEntry } from "../../lib/queues";
import type { ExitCase } from "../../types";

/**
 * The `exit_interview` step queue — the exits HR still has to sit down and talk about.
 *
 * ⚠ **ITS DUE DATE RUNS BACKWARDS.** `exit_interview` is a `before: true` trigger step
 *   (lib/sla.ts): it is due **LWD − N working days**, not LWD + N. You cannot hold an
 *   exit interview with someone who has already gone, so every row here is due BEFORE
 *   the last working day and a row whose Due equalled its Last working day would mean
 *   `addWorkingDaysSigned` was not wired. The store hands us `exitDueIso`, which has its
 *   own case for this step — a trigger step that fell through to the generic anchor path
 *   would be BORN OVERDUE.
 *
 * ⚠ **THE PAGE IS FOR THE INTERVIEWERS, AND FOR NOBODY ELSE.** Gated on
 *   `canReadConfidential` — admin ∨ coordinator ∨ HR-confidential — the same predicate
 *   as the RLS policy on `fms_exit_interviews`. It is deliberately NOT gated on
 *   `myQueue('exit_interview').length > 0` the way Approvals and Clearance are: those
 *   queues let a reporting manager in because a manager owns their steps per-case, and
 *   the reporting manager is precisely who must never reach this one.
 *
 * The table itself carries no interview CONTENT — only the case, the last working day
 * and the clock. The content lives in the panel, behind the same gate again.
 */
type Row = QueueEntry & { case: ExitCase };

export default function InterviewQueue() {
  const s = useExitStore();
  const [working, setWorking] = useState<ExitCase | null>(null);

  const rows: Row[] = useMemo(
    () =>
      s
        .myQueue("exit_interview")
        .map((e) => {
          const c = s.caseById(e.caseId);
          return c ? { ...e, case: c } : null;
        })
        .filter((r): r is Row => !!r),
    [s],
  );

  const completed = useMemo(() => s.completedFor("exit_interview"), [s]);
  const stage = useStageMode(completed, s.userId);
  const openEntry = (e: StageEntry<ExitCase>) => setWorking(e.row);

  // See the header: the confidential gate, not "do I have rows".
  if (!s.canReadConfidential) return <AccessDenied />;

  const deptName = (id: string) => s.departments.find((d) => d.id === id)?.name ?? "—";

  /** How far ahead of the last working day this interview is still owed. */
  const daysLeft = (r: Row): string => {
    const d = s.daysToLwd(r.case);
    if (d === null) return "—";
    if (d < 0) return `${-d}d after they left`;
    if (d === 0) return "Their last day";
    return `${d}d before they leave`;
  };

  const columns: QueueColumn<Row>[] = [
    {
      key: "exitNo",
      header: "Exit",
      cell: (r) => (
        <Link to={`/hr-exit/exits/${r.caseId}`} className="font-semibold text-orange hover:underline">
          {r.case.exitNo}
        </Link>
      ),
      sortValue: (r) => r.case.exitNo,
      filter: { kind: "text", get: (r) => r.case.exitNo },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "employee",
      header: "Employee",
      cell: (r) => (
        <div>
          <div className="font-medium text-navy">{r.case.employeeName}</div>
          <div className="text-[12px] text-grey-2">
            {r.case.employeeCode}
            {r.case.designation && ` · ${r.case.designation}`}
          </div>
        </div>
      ),
      sortValue: (r) => r.case.employeeName,
      filter: { kind: "text", get: (r) => `${r.case.employeeName} ${r.case.employeeCode}` },
      exportValue: (r) => `${r.case.employeeName} (${r.case.employeeCode})`,
    },
    {
      key: "type",
      header: "Type",
      cell: (r) => <span className="text-grey">{CASE_TYPE_LABEL[r.case.caseType]}</span>,
      filter: { kind: "select", get: (r) => CASE_TYPE_LABEL[r.case.caseType] },
    },
    {
      key: "manager",
      header: "Reporting manager",
      // Named on purpose: it is who the interview is most often ABOUT, and it is who
      // must not be in the room. The name is on the wide-read header — no leak here.
      cell: (r) => (
        <span className="text-grey">
          {r.case.reportingManagerIds.map((id) => s.profileById(id)?.name ?? "Unknown").join(", ") ||
            (r.case.reportingManagerNote ?? "—")}
        </span>
      ),
      filter: {
        kind: "text",
        get: (r) => r.case.reportingManagerIds.map((id) => s.profileById(id)?.name ?? "").join(" "),
      },
      exportValue: (r) =>
        r.case.reportingManagerIds.map((id) => s.profileById(id)?.name ?? "Unknown").join(", "),
    },
    {
      key: "lwd",
      header: "Last working day",
      cell: (r) => (
        <div>
          <div className="text-navy">{formatDateDMY(r.case.lwd)}</div>
          <div className="text-[12px] text-grey-2">{daysLeft(r)}</div>
        </div>
      ),
      sortValue: (r) => r.case.lwd ?? "9999",
      exportValue: (r) => formatDateDMY(r.case.lwd),
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "due",
      header: "Due",
      cell: (r) => <DueCell dueIso={r.dueIso} />,
      sortValue: (r) => r.dueIso ?? "9999",
      exportValue: (r) => formatDateDMY(r.dueIso),
      tdClassName: "whitespace-nowrap",
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[22px] font-bold text-navy">Exit interviews</h1>
          <span className="rounded-full bg-navy/10 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-navy">
            HR confidential
          </span>
        </div>
        <p className="mt-1 text-[13.5px] text-grey-2">
          Held <span className="font-semibold text-navy">before</span> the person's last working day — you
          cannot interview someone who has already gone. What is said is visible to HR, the HR Head and the
          process coordinators only; everyone else, including the reporting manager, sees that it happened
          and nothing more.
        </p>
      </div>

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
        <CompletedExitTable
          rows={stage.rows}
          exportName="HR_Exit_Interviews_Completed"
          emptyMessage="Interviews you record will appear here — revisable until the case is closed."
          onEdit={openEntry}
          onView={openEntry}
        />
      ) : (
        <QueueTable<Row>
          rows={rows}
          // Composite, like every other table in this app: a case can be owed at several
          // steps at once, and a duplicate React key silently drops a row.
          rowKey={(r) => `${r.stepKey}:${r.entityId}:${r.checkId ?? ""}`}
          columns={columns}
          groupBy={{
            idOf: (r) => r.departmentId,
            nameOf: deptName,
            allLabel: "All departments",
            label: "Department",
          }}
          rowsLabel="interviews"
          rowClassName={(r) => overdueRowClass(r.dueIso)}
          emptyTitle="Nothing waiting on you"
          emptyMessage="Exits needing an interview will appear here once their last working day is confirmed."
          initialSort={{ key: "due", dir: "asc" }}
          exportName="HR_Exit_Interviews"
          exportTitle="Exit interviews due"
          exportNotes={[
            "The exits still needing an interview. The due date runs BACKWARDS from the last working day — it is LWD minus the configured number of working days (Setup → Due Dates), because you cannot interview someone who has already left.",
            "This export carries NO interview content — only the case, the manager and the clock. What was said never leaves the panel.",
            "Working days are Mon–Sat; only Sunday is skipped.",
          ]}
          actions={(r) => (
            <Button size="sm" onClick={() => setWorking(r.case)}>
              Record
            </Button>
          )}
        />
      )}

      {/* The panel in place, so HR never has to go hunting for the case page. It is the
          same component the detail page renders, behind the same gate. */}
      {working && (
        <Modal
          open={!!working}
          onClose={() => setWorking(null)}
          size="xl"
          title={`Exit interview — ${working.exitNo}`}
          subtitle={`${working.employeeName} · last working day ${formatDateDMY(working.lwd)}`}
          footer={
            <Button variant="ghost" size="sm" onClick={() => setWorking(null)}>
              Close
            </Button>
          }
        >
          {/* Re-read from the store so the panel re-renders on its own writes. */}
          <ExitInterviewPanel case={s.caseById(working.id) ?? working} />
        </Modal>
      )}
    </div>
  );
}
