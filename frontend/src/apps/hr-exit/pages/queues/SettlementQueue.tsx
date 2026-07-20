import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import DueCell, { overdueRowClass } from "@/shared/components/ui/DueCell";
import StageTabs from "@/shared/components/ui/StageTabs";
import { useStageMode } from "@/shared/lib/useStageMode";
import { formatDateDMY } from "@/shared/lib/date";
import SettlementPanel from "../../components/settlement/SettlementPanel";
import CompletedExitTable from "../../components/CompletedExitTable";
import AccessDenied from "../system/AccessDenied";
import { useExitStore } from "../../store";
import type { QueueEntry, StageEntry } from "../../lib/queues";
import type { StepKey } from "../../lib/steps";
import type { ExitCase } from "../../types";

/**
 * The settlement queue — the five money steps in one table.
 *
 * ⚠ **THE PAGE IS FOR FINANCE, AND FOR NOBODY ELSE.** Gated on `isFinanceStaff ∨
 *   isProcessCoordinator` — the same predicate as the RLS policy on
 *   `fms_exit_settlements` (minus the leaver's own after-approval clause, which is a
 *   read of ONE case on My Resignation, not a work queue). It is deliberately NOT gated
 *   on "do I have rows" the way Approvals and Clearance are: those let a reporting manager
 *   in because a manager owns their steps PER CASE — and the reporting manager is exactly
 *   who must never reach this one.
 *
 * ⚠ **FIVE STEPS, ONE TABLE ⇒ THE COMPOSITE ROW KEY IS MANDATORY.** A case is legitimately
 *   owed at several of these at once (leave verification and payroll inputs run in
 *   PARALLEL), so `entityId` alone is not unique and React would silently drop rows.
 *
 * ⚠ **THE TABLE CARRIES NO MONEY.** Not a rupee: no amount column, and nothing in the
 *   export. The numbers live in the panel, behind the same gate again. A queue exists to
 *   say what is owed and when — it does not need to say how much, and a settlement figure
 *   in an exported spreadsheet is a settlement figure loose in the building.
 */
type Row = QueueEntry & { case: ExitCase };

const STEPS_HERE: StepKey[] = [
  "leave_verification",
  "payroll_inputs",
  "fnf_generate",
  "fnf_approve",
  "fnf_payment",
];

/** How each step reads in the Work column. */
const WORK_LABEL: Partial<Record<StepKey, string>> = {
  leave_verification: "Leave verification",
  payroll_inputs: "Payroll inputs",
  fnf_generate: "Generate F&F",
  fnf_approve: "Approve F&F",
  fnf_payment: "Release payment",
};

export default function SettlementQueue() {
  const s = useExitStore();
  const [working, setWorking] = useState<ExitCase | null>(null);

  const rows: Row[] = useMemo(() => {
    const entries = STEPS_HERE.flatMap((k) => s.myQueue(k));
    return entries
      .map((e) => {
        const c = s.caseById(e.caseId);
        return c ? { ...e, case: c } : null;
      })
      .filter((r): r is Row => !!r);
  }, [s]);

  const completed = useMemo(() => STEPS_HERE.flatMap((k) => s.completedFor(k)), [s]);
  const stage = useStageMode(completed, s.userId);
  const openEntry = (e: StageEntry<ExitCase>) => setWorking(e.row);

  // See the header: the finance gate, not "do I have rows".
  if (!(s.isFinanceStaff || s.isProcessCoordinator)) return <AccessDenied />;

  const deptName = (id: string) => s.departments.find((d) => d.id === id)?.name ?? "—";

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
      key: "work",
      header: "Work",
      cell: (r) => (
        <span
          className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
            r.stepKey.startsWith("fnf") ? "bg-orange/10 text-orange" : "bg-page text-grey"
          }`}
        >
          {WORK_LABEL[r.stepKey] ?? r.stepKey}
        </span>
      ),
      filter: { kind: "select", get: (r) => WORK_LABEL[r.stepKey] ?? r.stepKey },
      exportValue: (r) => WORK_LABEL[r.stepKey] ?? r.stepKey,
      tdClassName: "whitespace-nowrap",
    },
    {
      // What is still missing, in one line — read from the HEADER stamps, never from the
      // satellite (which is empty for anyone RLS excludes, and this page is not).
      key: "state",
      header: "Where it has got to",
      cell: (r) => {
        const c = r.case;
        const bits: string[] = [];
        if (c.leaveVerifiedAt) bits.push("leave ✓");
        if (c.payrollDoneAt) bits.push("payroll ✓");
        if (c.fnfGeneratedAt) bits.push("F&F prepared ✓");
        if (c.fnfApprovedAt) bits.push("approved ✓");
        return <span className="text-[12.5px] text-grey">{bits.join(" · ") || "Nothing recorded yet"}</span>;
      },
      exportValue: (r) =>
        [
          r.case.leaveVerifiedAt && "leave",
          r.case.payrollDoneAt && "payroll",
          r.case.fnfGeneratedAt && "F&F prepared",
          r.case.fnfApprovedAt && "approved",
        ]
          .filter(Boolean)
          .join(" / ") || "nothing recorded yet",
    },
    {
      key: "lwd",
      header: "Last working day",
      cell: (r) => <span className="text-grey">{formatDateDMY(r.case.lwd)}</span>,
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
          <h1 className="text-[22px] font-bold text-navy">Settlement</h1>
          <span className="rounded-full bg-navy/10 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-navy">
            Finance confidential
          </span>
        </div>
        <p className="mt-1 text-[13.5px] text-grey-2">
          The leave balance and the payroll inputs run <span className="font-semibold text-navy">in
          parallel</span> — neither waits on the other. The F&amp;F then runs strictly in order:{" "}
          <span className="font-semibold text-navy">it cannot be prepared</span> before its inputs exist,{" "}
          <span className="font-semibold text-navy">approved</span> before it is prepared, or{" "}
          <span className="font-semibold text-navy">paid</span> before it is approved. The database refuses,
          not just this screen.
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
          exportName="HR_Exit_Settlement_Completed"
          emptyMessage="Leave checks, payroll inputs, F&F work and payments you record appear here — no amounts, just the step, who and when."
          onEdit={openEntry}
          onView={openEntry}
        />
      ) : (
        <QueueTable<Row>
          rows={rows}
          // COMPOSITE. A case is legitimately owed at several of these steps at once.
          rowKey={(e) => `${e.stepKey}:${e.entityId}:${e.checkId ?? ""}`}
          columns={columns}
          groupBy={{
            idOf: (r) => r.departmentId,
            nameOf: deptName,
            allLabel: "All departments",
            label: "Department",
          }}
          rowsLabel="items"
          rowClassName={(r) => overdueRowClass(r.dueIso)}
          emptyTitle="Nothing waiting on you"
          emptyMessage="Exits needing a leave check, payroll inputs, an F&F, an approval or a payment appear here once their last working day is confirmed."
          initialSort={{ key: "due", dir: "asc" }}
          exportName="HR_Exit_Settlement"
          exportTitle="Exit settlements due"
          exportNotes={[
            "One row per OPEN settlement step — a case owing both the leave check and the payroll inputs appears twice. That is correct: they are two different people's work.",
            "Leave verification is due BEFORE the last working day (a leave balance is only final once they stop accruing). Payroll inputs are due at the payroll CUT-OFF of the month the last working day falls in — and if the last working day is after that cut-off, it rolls to the next month's, because you cannot key someone's final payroll before their last day.",
            "THIS EXPORT DELIBERATELY CARRIES NO AMOUNTS. Not the F&F, not a deduction, not a recovery. A settlement figure in a spreadsheet is a settlement figure loose in the building; the numbers stay behind the panel's read gate.",
            "Working days are Mon–Sat; only Sunday is skipped.",
          ]}
          actions={(r) => (
            <Button size="sm" onClick={() => setWorking(r.case)}>
              Open
            </Button>
          )}
        />
      )}

      {/* The panel in place, so payroll never has to go hunting for the case page. Same
          component the detail page renders, behind the same gate. */}
      {working && (
        <Modal
          open={!!working}
          onClose={() => setWorking(null)}
          size="xl"
          title={`Settlement — ${working.exitNo}`}
          subtitle={`${working.employeeName} · last working day ${formatDateDMY(working.lwd)}`}
          footer={
            <Button variant="ghost" size="sm" onClick={() => setWorking(null)}>
              Close
            </Button>
          }
        >
          {/* Re-read from the store so the panel re-renders on its own writes. */}
          <SettlementPanel case={s.caseById(working.id) ?? working} />
        </Modal>
      )}
    </div>
  );
}
