import { Link } from "react-router-dom";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import StageRowAction from "@/shared/components/ui/StageRowAction";
import { formatDate, formatDateTime } from "@/shared/lib/time";
import { useExitStore } from "../store";
import { stepByKey } from "../lib/steps";
import type { StageEntry } from "../lib/queues";
import type { ExitCase } from "../types";

/**
 * The Completed tab's table — "what I did at this step", shared by all five exit
 * queue pages. Actions FIRST (the standing FMS rule), then the case, what step it
 * was, when, by whom, and whether it has since been corrected.
 *
 * `formatDateTime` for the actor stamps, `formatDate` for the plain outcome date:
 * these are timestamptz, and slicing the raw UTC string would render an 02:00 IST
 * entry as the previous day — the wrong thing to tell someone checking their work.
 */
export default function CompletedExitTable({
  rows,
  exportName,
  emptyMessage,
  onEdit,
  onView,
}: {
  rows: StageEntry<ExitCase>[];
  exportName: string;
  emptyMessage: string;
  /** Open this entry's edit surface (a modal, or the detail page). */
  onEdit: (e: StageEntry<ExitCase>) => void;
  /** Open this entry read-only — always the detail page. */
  onView: (e: StageEntry<ExitCase>) => void;
}) {
  const s = useExitStore();
  const deptName = (id: string | null) => (id ? (s.departments.find((d) => d.id === id)?.name ?? "—") : "—");

  const columns: QueueColumn<StageEntry<ExitCase>>[] = [
    {
      key: "exitNo",
      header: "Exit",
      cell: (e) => (
        <Link to={`/hr-exit/exits/${e.caseId}`} className="font-semibold text-orange hover:underline">
          {e.ref}
        </Link>
      ),
      sortValue: (e) => e.ref,
      filter: { kind: "text", get: (e) => e.ref },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "employee",
      header: "Employee",
      cell: (e) => (
        <div>
          <div className="font-medium text-navy">{e.row.employeeName}</div>
          <div className="text-[12px] text-grey-2">{e.row.employeeCode}</div>
        </div>
      ),
      sortValue: (e) => e.row.employeeName,
      filter: { kind: "text", get: (e) => `${e.row.employeeName} ${e.row.employeeCode}` },
      exportValue: (e) => `${e.row.employeeName} (${e.row.employeeCode})`,
    },
    {
      key: "step",
      header: "Step",
      cell: (e) => <span className="text-grey">{stepByKey(e.stepKey)?.short ?? e.stepKey}</span>,
      filter: { kind: "select", get: (e) => stepByKey(e.stepKey)?.short ?? e.stepKey },
    },
    {
      key: "doneAt",
      header: "Done on",
      cell: (e) => <span className="text-grey">{formatDate(e.atIso)}</span>,
      sortValue: (e) => e.atIso,
      exportValue: (e) => formatDate(e.atIso),
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "by",
      header: "By",
      cell: (e) =>
        e.actorId ? (
          <span className="text-navy">{s.personName(e.actorId)}</span>
        ) : (
          <span className="text-grey-2" title="Recorded before the app captured who did this step.">
            Not recorded
          </span>
        ),
      sortValue: (e) => s.personName(e.actorId),
      filter: { kind: "select", get: (e) => (e.actorId ? s.personName(e.actorId) : "Not recorded") },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "edited",
      header: "Edited",
      cell: (e) =>
        e.editedAtIso ? (
          <span className="text-[12px] text-grey-2" title={`Last edited by ${s.personName(e.editedById)}`}>
            {formatDateTime(e.editedAtIso)}
          </span>
        ) : (
          <span className="text-grey-2">—</span>
        ),
      sortValue: (e) => e.editedAtIso ?? "",
      tdClassName: "whitespace-nowrap",
    },
  ];

  return (
    <QueueTable<StageEntry<ExitCase>>
      rows={rows}
      rowKey={(e) => e.id}
      columns={columns}
      groupBy={{ idOf: (e) => e.departmentId, nameOf: deptName, allLabel: "All departments", label: "Department" }}
      rowsLabel="exits"
      emptyTitle="Nothing here yet"
      emptyMessage={emptyMessage}
      initialSort={{ key: "doneAt", dir: "desc" }}
      exportName={exportName}
      actions={(e) => (
        <StageRowAction
          lockReason={e.lockReason}
          canEdit={s.canActOn(e.stepKey, e.row)}
          permissionReason="Only an owner of this step can edit the entry."
          onEdit={() => onEdit(e)}
          onView={() => onView(e)}
        />
      )}
    />
  );
}
