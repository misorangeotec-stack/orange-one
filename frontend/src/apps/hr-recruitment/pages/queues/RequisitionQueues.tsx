import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import DueCell, { overdueRowClass } from "@/shared/components/ui/DueCell";
import StageTabs from "@/shared/components/ui/StageTabs";
import { useStageMode } from "@/shared/lib/useStageMode";
import { formatDateDMY } from "@/shared/lib/date";
import { JobPostingModal, MrfDecisionModal } from "../../components/MrfModals";
import CompletedTable from "../../components/CompletedTable";
import StatusPill from "../../components/StatusPill";
import AccessDenied from "../system/AccessDenied";
import { useHrStore } from "../../store";
import { salaryLabel } from "../../lib/format";
import type { StepKey } from "../../lib/steps";
import type { StageEntry, CompletedRow } from "../../lib/queues";
import type { Requisition } from "../../types";

/** The MRF-link cell + its plain text, shared by every requisition Completed tab. */
const mrfSubject = (e: StageEntry<CompletedRow>) => (
  <Link to={`/hr-recruitment/requisitions/${e.entityId}`} className="font-semibold text-orange hover:underline">
    {e.ref}
  </Link>
);

/**
 * One generic requisition-queue page, parameterised per step — the HR twin of
 * procurement's `StepQueuePage`.
 *
 * Rows come from `store.myQueue(step)`, which is `lib/queues.ts` narrowed to what
 * this user may action. That means the queue, the Control Center's count and (from
 * Phase 4) a Kanban card's overdue chip are all reading the same due date. They
 * cannot disagree, because there is only one of them.
 */
function StepQueuePage({
  step,
  title,
  subtitle,
  exportName,
  renderAction,
  onEditCompleted,
}: {
  step: StepKey;
  title: string;
  subtitle: string;
  /** File-name stem for the Excel export. */
  exportName: string;
  renderAction: (r: Requisition) => React.ReactNode;
  /** Open a completed entry's edit surface. Omit ⇒ the Completed tab is view-only. */
  onEditCompleted?: (r: Requisition) => void;
}) {
  const s = useHrStore();
  const navigate = useNavigate();

  const rows = useMemo(
    () =>
      s
        .myQueue(step)
        .map((e) => s.requisitionById(e.entityId))
        .filter((r): r is Requisition => !!r),
    [s, step],
  );

  const completed = useMemo(() => s.completedFor(step), [s, step]);
  const stage = useStageMode(completed, s.userId);

  const dueOf = (r: Requisition) => s.dueIsoFor(r, step);
  const deptName = (id: string) => s.departments.find((d) => d.id === id)?.name ?? "—";
  const person = (id: string | null) => (id ? (s.profileById(id)?.name ?? "Unknown") : "—");

  const columns: QueueColumn<Requisition>[] = [
    {
      key: "mrfNo",
      header: "MRF",
      cell: (r) => (
        <Link to={`/hr-recruitment/requisitions/${r.id}`} className="font-semibold text-orange hover:underline">
          {r.mrfNo}
        </Link>
      ),
      sortValue: (r) => r.mrfNo,
      filter: { kind: "text", get: (r) => r.mrfNo },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "jobTitle",
      header: "Position",
      cell: (r) => (
        <div>
          <div className="font-medium text-navy">{r.jobTitle}</div>
          <div className="text-[12px] text-grey-2">
            {r.positionsRequired} {r.positionsRequired === 1 ? "seat" : "seats"}
            {r.positionKind === "replacement" && " · replacement"}
          </div>
        </div>
      ),
      sortValue: (r) => r.jobTitle,
      filter: { kind: "text", get: (r) => r.jobTitle },
    },
    {
      key: "raisedBy",
      header: "Raised by",
      cell: (r) => <span className="text-grey">{person(r.requesterId)}</span>,
      filter: { kind: "text", get: (r) => person(r.requesterId) },
    },
    {
      key: "salary",
      header: "Salary",
      cell: (r) => <span className="text-grey">{salaryLabel(r.salaryMin, r.salaryMax, r.salaryNote)}</span>,
      exportValue: (r) => salaryLabel(r.salaryMin, r.salaryMax, r.salaryNote),
    },
    {
      key: "raised",
      header: "Raised on",
      cell: (r) => <span className="text-grey">{formatDateDMY(r.requestDate)}</span>,
      sortValue: (r) => r.requestDate,
      exportValue: (r) => formatDateDMY(r.requestDate),
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "due",
      header: "Due",
      cell: (r) => <DueCell dueIso={dueOf(r)} />,
      sortValue: (r) => dueOf(r) ?? "9999",
      exportValue: (r) => formatDateDMY(dueOf(r)),
      tdClassName: "whitespace-nowrap",
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">{title}</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          {stage.showingCompleted ? "What you did here — revisable until the next step is done." : subtitle}
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
        <CompletedTable
          rows={stage.rows}
          subjectHeader="MRF"
          subject={mrfSubject}
          subjectText={(e) => e.ref}
          exportName={`${exportName}_Completed`}
          emptyMessage="Steps you complete here will appear here, editable until the next step is done."
          onEdit={(e) => onEditCompleted?.(e.row as Requisition)}
          onView={(e) => navigate(`/hr-recruitment/requisitions/${e.entityId}`)}
        />
      ) : (
        <QueueTable<Requisition>
          rows={rows}
          rowKey={(r) => r.id}
          columns={columns}
          groupBy={{ idOf: (r) => r.departmentId, nameOf: deptName, allLabel: "All departments", label: "Department" }}
          rowsLabel="requisitions"
          rowClassName={(r) => overdueRowClass(dueOf(r))}
          emptyTitle="Nothing waiting on you"
          emptyMessage="When a requisition reaches this step, it will appear here."
          initialSort={{ key: "due", dir: "asc" }}
          exportName={exportName}
          exportTitle={title}
          exportNotes={[
            "Only the requisitions waiting on YOU at this step — not every requisition in the system.",
            "The due date comes from this step's rule in Setup → Due Dates, counted in working days (Mon–Sat; only Sunday is skipped).",
          ]}
          actions={renderAction}
        />
      )}
    </div>
  );
}

/** HR Head + Management approvals. One page, because a person may own either gate. */
export function MrfApprovalsQueue() {
  const s = useHrStore();
  const navigate = useNavigate();
  const [decide, setDecide] = useState<{ r: Requisition; stage: "hr" | "mgmt"; editing: boolean } | null>(null);

  // Coordinators chase everything, and fms_hr_can_act() already lets them act — so
  // gating on step ownership alone would lock them out of a page holding their own work.
  const canHr = s.isStepOwner("hr_head_approval") || s.isProcessCoordinator;
  const canMgmt = s.isStepOwner("mgmt_approval") || s.isProcessCoordinator;

  const rows = useMemo(() => {
    const hr = canHr ? s.myQueue("hr_head_approval") : [];
    const mgmt = canMgmt ? s.myQueue("mgmt_approval") : [];
    return [...hr, ...mgmt]
      .map((e) => s.requisitionById(e.entityId))
      .filter((r): r is Requisition => !!r);
  }, [s, canHr, canMgmt]);

  // The Completed tab spans both gates a person might own.
  const completed = useMemo(
    () => [...s.completedFor("hr_head_approval"), ...s.completedFor("mgmt_approval")],
    [s],
  );
  const stage = useStageMode(completed, s.userId);

  const onEditCompleted = (e: StageEntry<CompletedRow>) =>
    setDecide({ r: e.row as Requisition, stage: e.stepKey === "hr_head_approval" ? "hr" : "mgmt", editing: true });

  if (!canHr && !canMgmt) return <AccessDenied />;

  const stageOf = (r: Requisition): "hr" | "mgmt" => (r.status === "hr_review" ? "hr" : "mgmt");
  const stepOf = (r: Requisition): StepKey =>
    r.status === "hr_review" ? "hr_head_approval" : "mgmt_approval";
  const dueOf = (r: Requisition) => s.dueIsoFor(r, stepOf(r));
  const deptName = (id: string) => s.departments.find((d) => d.id === id)?.name ?? "—";
  const person = (id: string | null) => (id ? (s.profileById(id)?.name ?? "Unknown") : "—");

  const columns: QueueColumn<Requisition>[] = [
    {
      key: "mrfNo",
      header: "MRF",
      cell: (r) => (
        <Link to={`/hr-recruitment/requisitions/${r.id}`} className="font-semibold text-orange hover:underline">
          {r.mrfNo}
        </Link>
      ),
      sortValue: (r) => r.mrfNo,
      filter: { kind: "text", get: (r) => r.mrfNo },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "jobTitle",
      header: "Position",
      cell: (r) => (
        <div>
          <div className="font-medium text-navy">{r.jobTitle}</div>
          <div className="text-[12px] text-grey-2">
            {r.positionsRequired} {r.positionsRequired === 1 ? "seat" : "seats"}
          </div>
        </div>
      ),
      sortValue: (r) => r.jobTitle,
      filter: { kind: "text", get: (r) => r.jobTitle },
    },
    {
      key: "raisedBy",
      header: "Raised by",
      cell: (r) => <span className="text-grey">{person(r.requesterId)}</span>,
      filter: { kind: "text", get: (r) => person(r.requesterId) },
    },
    {
      key: "salary",
      header: "Salary",
      cell: (r) => <span className="text-grey">{salaryLabel(r.salaryMin, r.salaryMax, r.salaryNote)}</span>,
      exportValue: (r) => salaryLabel(r.salaryMin, r.salaryMax, r.salaryNote),
    },
    {
      key: "stage",
      header: "Waiting on",
      cell: (r) => <StatusPill status={r.status} />,
      filter: { kind: "select", get: (r) => (r.status === "hr_review" ? "HR Head" : "Management") },
    },
    {
      key: "due",
      header: "Due",
      cell: (r) => <DueCell dueIso={dueOf(r)} />,
      sortValue: (r) => dueOf(r) ?? "9999",
      exportValue: (r) => formatDateDMY(dueOf(r)),
      tdClassName: "whitespace-nowrap",
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">MRF Approvals</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          {stage.showingCompleted
            ? "Decisions you have made — revisable until the next gate acts."
            : "Requisitions waiting on your decision. Approve, send back for a fix, or reject."}
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
        <CompletedTable
          rows={stage.rows}
          subjectHeader="MRF"
          subject={mrfSubject}
          subjectText={(e) => e.ref}
          exportName="HR_MRF_Approvals_Completed"
          emptyMessage="Decisions you make here will appear here, revisable until the next gate acts."
          onEdit={onEditCompleted}
          onView={(e) => navigate(`/hr-recruitment/requisitions/${e.entityId}`)}
        />
      ) : (
        <QueueTable<Requisition>
          rows={rows}
          rowKey={(r) => r.id}
          columns={columns}
          groupBy={{ idOf: (r) => r.departmentId, nameOf: deptName, allLabel: "All departments", label: "Department" }}
          rowsLabel="requisitions"
          rowClassName={(r) => overdueRowClass(dueOf(r))}
          emptyTitle="Nothing waiting on you"
          emptyMessage="Requisitions needing your approval will appear here."
          initialSort={{ key: "due", dir: "asc" }}
          exportName="HR_MRF_Approvals"
          exportTitle="MRF approvals"
          exportNotes={[
            "Only the requisitions waiting on YOUR decision — the HR Head gate, the Management gate, or both if you own both.",
            "'Waiting on' says which of the two gates it currently sits at. Each gate has its own due date (Setup → Due Dates).",
          ]}
          actions={(r) => (
            <Button size="sm" onClick={() => setDecide({ r, stage: stageOf(r), editing: false })}>
              Decide
            </Button>
          )}
        />
      )}

      {decide && (
        <MrfDecisionModal
          requisition={decide.r}
          stage={decide.stage}
          open={!!decide}
          onClose={() => setDecide(null)}
          editing={decide.editing}
        />
      )}
    </div>
  );
}

/** Approved and waiting for HR to advertise it. */
export function JobPostingQueue() {
  const s = useHrStore();
  const [posting, setPosting] = useState<{ r: Requisition; editing: boolean } | null>(null);

  if (!s.isStepOwner("job_posting") && !s.isProcessCoordinator) return <AccessDenied />;

  return (
    <>
      <StepQueuePage
        step="job_posting"
        title="Job Posting"
        subtitle="Approved requisitions waiting to be advertised. Tick every platform you posted on."
        exportName="HR_Job_Posting_Queue"
        renderAction={(r) => (
          <Button size="sm" onClick={() => setPosting({ r, editing: false })}>
            Post
          </Button>
        )}
        onEditCompleted={(r) => setPosting({ r, editing: true })}
      />
      {posting && (
        <JobPostingModal
          requisition={posting.r}
          open={!!posting}
          onClose={() => setPosting(null)}
          editing={posting.editing}
        />
      )}
    </>
  );
}
