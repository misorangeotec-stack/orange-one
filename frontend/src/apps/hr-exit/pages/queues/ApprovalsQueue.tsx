import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import DueCell, { overdueRowClass } from "@/shared/components/ui/DueCell";
import { formatDateDMY } from "@/shared/lib/date";
import { HeadDecisionModal, HrVerifyModal, ManagerReviewModal } from "../../components/ExitModals";
import StatusPill from "../../components/StatusPill";
import AccessDenied from "../system/AccessDenied";
import { useExitStore } from "../../store";
import { CASE_TYPE_LABEL } from "../../lib/format";
import type { QueueEntry } from "../../lib/queues";
import type { StepKey } from "../../lib/steps";
import type { ExitCase } from "../../types";

/**
 * The approval chain — manager review, HR verification, HR Head approval — on ONE
 * page, because a person may own more than one of the three gates (and a coordinator
 * owns all of them).
 *
 * ⚠ THE ROW KEY IS COMPOSITE. This is the FIRST table in the app that mixes steps,
 * and an exit case can legitimately sit at several steps at once (the whole reason
 * this app's queue aggregator clones Purchase's rather than HR's). `entityId` alone is
 * therefore NOT unique across a mixed-step table, and React would silently drop rows.
 * `checkId` is in the key too, ready for Phase 3's per-clearance-row entries.
 *
 * Rows come from `store.myQueue(step)`, which is `lib/queues.ts` narrowed to what THIS
 * user may action. The queue, the Control Center's count and the SLA clock therefore
 * read the same due date — they cannot disagree, because there is only one of them.
 */
type Row = QueueEntry & { case: ExitCase };

export default function ApprovalsQueue() {
  const s = useExitStore();
  const [reviewing, setReviewing] = useState<ExitCase | null>(null);
  const [verifying, setVerifying] = useState<ExitCase | null>(null);
  const [deciding, setDeciding] = useState<ExitCase | null>(null);

  // A coordinator chases everything and fms_exit_can_act() already lets them act, so
  // gating on step ownership alone would lock them out of a page holding their own
  // work. A reporting manager owns `manager_review` PER CASE, never in the owners
  // table — so anyone with a manager-review row in their queue belongs here too.
  const managerRows = s.myQueue("manager_review");
  const canSeePage =
    s.isProcessCoordinator ||
    s.isStepOwner("hr_verification") ||
    s.isStepOwner("hr_head_approval") ||
    managerRows.length > 0;

  const rows: Row[] = useMemo(() => {
    const steps: StepKey[] = ["manager_review", "hr_verification", "hr_head_approval"];
    return steps
      .flatMap((step) => s.myQueue(step))
      .map((e) => {
        const c = s.caseById(e.caseId);
        return c ? { ...e, case: c } : null;
      })
      .filter((r): r is Row => !!r);
  }, [s]);

  if (!canSeePage) return <AccessDenied />;

  const deptName = (id: string) => s.departments.find((d) => d.id === id)?.name ?? "—";
  const person = (id: string | null) => (id ? (s.profileById(id)?.name ?? "Unknown") : "—");
  const STEP_LABEL: Partial<Record<StepKey, string>> = {
    manager_review: "Reporting manager",
    hr_verification: "HR",
    hr_head_approval: "HR Head",
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
      key: "raised",
      header: "Raised on",
      cell: (r) => <span className="text-grey">{formatDateDMY(r.case.submittedAt)}</span>,
      sortValue: (r) => r.case.submittedAt,
      exportValue: (r) => formatDateDMY(r.case.submittedAt),
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

  const act = (r: Row) => {
    if (r.stepKey === "manager_review") setReviewing(r.case);
    else if (r.stepKey === "hr_verification") setVerifying(r.case);
    else setDeciding(r.case);
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Approvals</h1>
        <p className="mt-1 text-[13.5px] text-grey-2">
          Exits waiting on you. The reporting manager's answer is a recommendation — only the HR Head can stop one.
        </p>
      </div>

      <QueueTable<Row>
        rows={rows}
        // Composite, not `r.caseId` — see the header. One case can be owed at two
        // steps at once, and a duplicate key silently loses a row.
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
          "Only the exits waiting on YOU — the reporting-manager gate, the HR verification gate, the HR Head gate, or whichever of them you own.",
          "The due date comes from this step's rule in Setup → Due Dates, counted in working days (Mon–Sat; only Sunday is skipped).",
          "One case can appear at more than one step across the app. Here it cannot — the approval chain is strictly sequential.",
        ]}
        actions={(r) => (
          <Button size="sm" onClick={() => act(r)}>
            {r.stepKey === "manager_review" ? "Review" : r.stepKey === "hr_verification" ? "Verify" : "Decide"}
          </Button>
        )}
      />

      {reviewing && (
        <ManagerReviewModal case={reviewing} open={!!reviewing} onClose={() => setReviewing(null)} />
      )}
      {verifying && <HrVerifyModal case={verifying} open={!!verifying} onClose={() => setVerifying(null)} />}
      {deciding && <HeadDecisionModal case={deciding} open={!!deciding} onClose={() => setDeciding(null)} />}
    </div>
  );
}
