import { useMemo } from "react";
import { Link } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import DueCell from "@/shared/components/ui/DueCell";
import { formatDateDMY } from "@/shared/lib/date";
import StatusPill from "../../components/StatusPill";
import { useExitStore } from "../../store";
import { CASE_STATUS_LABEL, CASE_TYPE_LABEL } from "../../lib/format";
import type { ExitCase } from "../../types";

/**
 * Every exit case the signed-in user is allowed to see.
 *
 * **RLS decides that, not this screen** — `fms_exit_can_read_case()` is admin ∨
 * coordinator ∨ exit staff ∨ (the employee, the raiser, or one of the case's
 * reporting managers). An ordinary employee therefore reads exactly one row: their
 * own. There is no client-side filter here, and there must not be one: a filter in
 * the UI is a suggestion, and this data is people's private business.
 *
 * Grouped by department — the same dimension the exit queues group by.
 */
export default function ExitList() {
  const s = useExitStore();

  const deptName = (id: string) => s.departments.find((d) => d.id === id)?.name ?? "—";
  const personName = (id: string | null) => (id ? (s.profileById(id)?.name ?? "Unknown") : "—");

  const columns: QueueColumn<ExitCase>[] = useMemo(
    () => [
      {
        key: "exitNo",
        header: "Exit",
        cell: (c) => (
          <Link to={`/hr-exit/exits/${c.id}`} className="font-semibold text-orange hover:underline">
            {c.exitNo}
          </Link>
        ),
        sortValue: (c) => c.exitNo,
        filter: { kind: "text", get: (c) => c.exitNo },
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "employee",
        header: "Employee",
        cell: (c) => (
          <div>
            <div className="font-medium text-navy">{c.employeeName}</div>
            <div className="text-[12px] text-grey-2">
              {c.employeeCode}
              {c.designation && ` · ${c.designation}`}
            </div>
          </div>
        ),
        sortValue: (c) => c.employeeName,
        filter: { kind: "text", get: (c) => `${c.employeeName} ${c.employeeCode}` },
        exportValue: (c) => `${c.employeeName} (${c.employeeCode})`,
      },
      {
        key: "type",
        header: "Type",
        cell: (c) => <span className="text-grey">{CASE_TYPE_LABEL[c.caseType]}</span>,
        filter: { kind: "select", get: (c) => CASE_TYPE_LABEL[c.caseType] },
      },
      {
        key: "manager",
        header: "Reporting manager",
        cell: (c) => (
          <span className="text-grey">
            {c.reportingManagerIds.map(personName).join(", ") || c.reportingManagerNote || "—"}
          </span>
        ),
        filter: { kind: "text", get: (c) => c.reportingManagerIds.map(personName).join(", ") },
        exportValue: (c) => c.reportingManagerIds.map(personName).join(", "),
      },
      {
        key: "raised",
        header: "Raised on",
        cell: (c) => <span className="text-grey">{formatDateDMY(c.submittedAt)}</span>,
        sortValue: (c) => c.submittedAt,
        filter: { kind: "date", get: (c) => c.submittedAt.slice(0, 10) },
        exportValue: (c) => formatDateDMY(c.submittedAt),
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "lwd",
        header: "Last working day",
        // The confirmed LWD once it exists; the proposal, clearly marked, until then.
        cell: (c) =>
          c.lwd ? (
            <DueCell dueIso={c.lwd} />
          ) : c.proposedLwd ? (
            <span className="text-grey-2">{formatDateDMY(c.proposedLwd)} · proposed</span>
          ) : (
            <span className="text-grey-2">—</span>
          ),
        sortValue: (c) => c.lwd ?? c.proposedLwd ?? "9999",
        exportValue: (c) => (c.lwd ? formatDateDMY(c.lwd) : c.proposedLwd ? `${formatDateDMY(c.proposedLwd)} (proposed)` : "—"),
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "status",
        header: "Status",
        cell: (c) => <StatusPill status={c.status} />,
        sortValue: (c) => CASE_STATUS_LABEL[c.status],
        filter: { kind: "select", get: (c) => CASE_STATUS_LABEL[c.status] },
      },
    ],
    // The whole store: the manager column reads live profile names, so a refetch has
    // to rebuild these columns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s],
  );

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold text-navy">Exit Cases</h1>
          <p className="mt-1 text-[13.5px] text-grey-2">
            Every exit you can see, and where each one has got to.
          </p>
        </div>
        <Link to="/hr-exit/exits/new">
          <Button size="sm">Raise an exit</Button>
        </Link>
      </div>

      <QueueTable<ExitCase>
        rows={s.cases}
        rowKey={(c) => c.id}
        columns={columns}
        groupBy={{
          idOf: (c) => c.departmentId,
          nameOf: deptName,
          allLabel: "All departments",
          label: "Department",
        }}
        rowsLabel="exit cases"
        emptyTitle="No exit cases"
        emptyMessage="Cases you are allowed to see will appear here."
        initialSort={{ key: "raised", dir: "desc" }}
        exportName="HR_Exit_Cases"
        exportTitle="Exit cases"
        exportNotes={[
          "Only the cases you are permitted to see. An ordinary employee sees their own; a manager sees their team's; HR and coordinators see all of them.",
          "Last working day is the CONFIRMED one where it exists. Until the HR Head has approved the case and the date has been confirmed, what you see is HR's proposal — and it is labelled as such.",
          "Withdrawn, rejected and archived cases are kept deliberately: that is where attrition reasons and time-to-settle live.",
        ]}
        actions={(c) => (
          <Link to={`/hr-exit/exits/${c.id}`} className="text-[12.5px] font-semibold text-orange hover:underline">
            Open
          </Link>
        )}
      />
    </div>
  );
}
