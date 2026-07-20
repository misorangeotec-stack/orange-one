import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import DueCell, { overdueRowClass } from "@/shared/components/ui/DueCell";
import StageTabs from "@/shared/components/ui/StageTabs";
import { useStageMode } from "@/shared/lib/useStageMode";
import { formatDateDMY } from "@/shared/lib/date";
import {
  ConfirmLwdModal,
  HeadDecisionModal,
  HrVerifyModal,
  ManagerReviewModal,
} from "../../components/ExitModals";
import CompletedExitTable from "../../components/CompletedExitTable";
import StatusPill from "../../components/StatusPill";
import AccessDenied from "../system/AccessDenied";
import { useExitStore } from "../../store";
import { CASE_TYPE_LABEL } from "../../lib/format";
import type { QueueEntry, StageEntry } from "../../lib/queues";
import type { StepKey } from "../../lib/steps";
import type { ExitCase } from "../../types";

/**
 * The approval chain — manager review, HR verification, HR Head approval — plus
 * Confirm LWD, on ONE page, because a person may own more than one of these gates
 * (and a coordinator owns all of them). Confirm LWD lives here rather than only on
 * the detail page so it too gets a stage view.
 *
 * ⚠ THE ROW KEY IS COMPOSITE. `entityId` alone is not unique across a mixed-step
 * table, and React would silently drop rows.
 */
type Row = QueueEntry & { case: ExitCase };

const STEPS_HERE: StepKey[] = ["manager_review", "hr_verification", "hr_head_approval", "lwd_confirm"];

export default function ApprovalsQueue() {
  const s = useExitStore();
  const navigate = useNavigate();
  const [reviewing, setReviewing] = useState<ExitCase | null>(null);
  const [verifying, setVerifying] = useState<ExitCase | null>(null);
  const [deciding, setDeciding] = useState<ExitCase | null>(null);
  const [confirmingLwd, setConfirmingLwd] = useState<ExitCase | null>(null);

  // A coordinator chases everything; a reporting manager owns `manager_review` per
  // case, never in the owners table — so anyone with a manager-review row belongs here.
  const managerRows = s.myQueue("manager_review");
  const canSeePage =
    s.isProcessCoordinator ||
    s.isStepOwner("hr_verification") ||
    s.isStepOwner("hr_head_approval") ||
    s.isStepOwner("lwd_confirm") ||
    managerRows.length > 0;

  const rows: Row[] = useMemo(() => {
    return STEPS_HERE.flatMap((step) => s.myQueue(step))
      .map((e) => {
        const c = s.caseById(e.caseId);
        return c ? { ...e, case: c } : null;
      })
      .filter((r): r is Row => !!r);
  }, [s]);

  // The Completed tab spans the same four steps. Owner-agnostic entries; useStageMode
  // narrows to Mine on the effective identity.
  const completed = useMemo(() => STEPS_HERE.flatMap((step) => s.completedFor(step)), [s]);
  const stage = useStageMode(completed, s.userId);

  if (!canSeePage) return <AccessDenied />;

  const deptName = (id: string | null) => (id ? (s.departments.find((d) => d.id === id)?.name ?? "—") : "—");
  const person = (id: string | null) => (id ? (s.profileById(id)?.name ?? "Unknown") : "—");
  const STEP_LABEL: Partial<Record<StepKey, string>> = {
    manager_review: "Reporting manager",
    hr_verification: "HR",
    hr_head_approval: "HR Head",
    lwd_confirm: "Confirm LWD",
  };

  const columns: QueueColumn<Row>[] = [
    {
      key: "exitNo",
      header: "Exit",
      cell: (r) => (
        <Link to={`/hr-exit/exits/${r.caseId}`} className="font-semibold text-orange hover:underline">
          {r.ref}
        </Link>
      ),
      sortValue: (r) => r.ref,
      filter: { kind: "text", get: (r) => r.ref },
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
      key: "raisedBy",
      header: "Raised by",
      cell: (r) => <span className="text-grey">{person(r.case.raisedBy)}</span>,
      filter: { kind: "text", get: (r) => person(r.case.raisedBy) },
    },
    {
      key: "step",
      header: "Waiting on",
      cell: (r) => <StatusPill status={r.case.status} />,
      filter: { kind: "select", get: (r) => STEP_LABEL[r.stepKey] ?? r.stepKey },
      exportValue: (r) => STEP_LABEL[r.stepKey] ?? r.stepKey,
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

  const act = (r: Row) => openFor(r.stepKey, r.case);

  const openFor = (stepKey: StepKey, c: ExitCase) => {
    if (stepKey === "manager_review") setReviewing(c);
    else if (stepKey === "hr_verification") setVerifying(c);
    else if (stepKey === "hr_head_approval") setDeciding(c);
    else setConfirmingLwd(c);
  };

  const onEdit = (e: StageEntry<ExitCase>) => openFor(e.stepKey, e.row);
  const onView = (e: StageEntry<ExitCase>) => navigate(`/hr-exit/exits/${e.caseId}`);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Approvals</h1>
        <p className="mt-1 text-[13.5px] text-grey-2">
          {stage.showingCompleted
            ? "Decisions you have made here — revisable until the next step is done."
            : "Exits waiting on you. The reporting manager's answer is a recommendation — only the HR Head can stop one."}
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
          exportName="HR_Exit_Approvals_Completed"
          emptyMessage="Decisions you make here will appear here, and stay revisable until the next step is done."
          onEdit={onEdit}
          onView={onView}
        />
      ) : (
        <QueueTable<Row>
          rows={rows}
          rowKey={(r) => `${r.stepKey}:${r.entityId}:${r.checkId ?? ""}`}
          columns={columns}
          groupBy={{
            idOf: (r) => r.departmentId,
            nameOf: deptName,
            allLabel: "All departments",
            label: "Department",
          }}
          rowsLabel="exits"
          rowClassName={(r) => overdueRowClass(r.dueIso)}
          emptyTitle="Nothing waiting on you"
          emptyMessage="Exits needing your decision will appear here."
          initialSort={{ key: "due", dir: "asc" }}
          exportName="HR_Exit_Approvals"
          exportTitle="Exit approvals"
          exportNotes={[
            "Only the exits waiting on YOU — the reporting-manager gate, HR verification, the HR Head gate, or the LWD confirmation.",
            "The due date comes from this step's rule in Setup → Due Dates, counted in working days (Mon–Sat; only Sunday is skipped).",
          ]}
          actions={(r) => (
            <Button size="sm" onClick={() => act(r)}>
              {r.stepKey === "manager_review"
                ? "Review"
                : r.stepKey === "hr_verification"
                  ? "Verify"
                  : r.stepKey === "hr_head_approval"
                    ? "Decide"
                    : "Confirm LWD"}
            </Button>
          )}
        />
      )}

      {reviewing && (
        <ManagerReviewModal
          case={reviewing}
          open={!!reviewing}
          onClose={() => setReviewing(null)}
          editing={!!reviewing.managerReviewedAt}
        />
      )}
      {verifying && (
        <HrVerifyModal
          case={verifying}
          open={!!verifying}
          onClose={() => setVerifying(null)}
          editing={!!verifying.hrVerifiedAt}
        />
      )}
      {deciding && (
        <HeadDecisionModal
          case={deciding}
          open={!!deciding}
          onClose={() => setDeciding(null)}
          editing={!!deciding.approvedAt}
        />
      )}
      {confirmingLwd && (
        <ConfirmLwdModal case={confirmingLwd} open={!!confirmingLwd} onClose={() => setConfirmingLwd(null)} />
      )}
    </div>
  );
}
