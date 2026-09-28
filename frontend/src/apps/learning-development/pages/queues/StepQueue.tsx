import { useMemo } from "react";
import { Link } from "react-router-dom";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import DueCell, { overdueRowClass } from "@/shared/components/ui/DueCell";
import { useLdStore } from "../../store";
import { B } from "../../nav";
import { dmy, inr } from "../../lib/format";
import { PriorityPill } from "../../components/StatusPill";
import { stepByKey, type StepKey } from "../../lib/steps";
import type { Priority, QueueEntry } from "../../types";

const PRIORITY_RANK: Record<Priority, number> = { high: 1, medium: 2, low: 3 };

/**
 * One step's queue — everything sitting on this reader's desk at that step.
 *
 * ONE COMPONENT FOR ALL SEVEN request-scoped queues. They differ by which step
 * they filter on and by their heading; the columns, the sorting, the filters and
 * the export are identical, and seven copies would drift the first time a column
 * was added to one of them.
 *
 * ⚠ FLAT, WITH NO `groupBy`. Banding by department would make the department the
 *   PRIMARY sort, so a queue ordered by due date would only be ordered *within*
 *   each band and the most overdue row would hide mid-page. Department is an
 *   ordinary column with its own sort and filter instead.
 */
export default function StepQueue({ step }: { step: StepKey }) {
  const s = useLdStore();
  const def = stepByKey(step);

  const rows = useMemo(() => s.entriesForStep(step), [s, step]);

  const columns: QueueColumn<QueueEntry>[] = [
    {
      key: "ref",
      header: "Request",
      cell: (e) => (
        <Link to={`${B}/requests/${e.entityId}`} className="font-semibold text-navy hover:text-orange">
          {e.ref}
        </Link>
      ),
      sortValue: (e) => e.ref,
    },
    {
      key: "title",
      header: "Training",
      cell: (e) => <span className="text-navy">{e.title}</span>,
      filter: { kind: "text", get: (e) => e.title },
    },
    {
      key: "dept",
      header: "Department",
      cell: (e) => s.departmentName(e.departmentId),
      filter: { kind: "select", get: (e) => s.departmentName(e.departmentId) },
    },
    {
      key: "raiser",
      header: "Raised by",
      cell: (e) => s.personName(e.requestedBy),
      filter: { kind: "select", get: (e) => s.personName(e.requestedBy) },
    },
    {
      key: "priority",
      header: "Priority",
      cell: (e) => <PriorityPill priority={e.priority} />,
      sortValue: (e) => PRIORITY_RANK[e.priority ?? "low"],
      filter: { kind: "select", get: (e) => e.priority ?? "Not set" },
    },
    {
      key: "cost",
      header: "Proposed",
      align: "right",
      cell: (e) => inr(s.requestById(e.entityId)?.proposedCost ?? null),
      sortValue: (e) => s.requestById(e.entityId)?.proposedCost ?? -1,
      exportValue: (e) => s.requestById(e.entityId)?.proposedCost ?? "",
      filter: { kind: "number", get: (e) => s.requestById(e.entityId)?.proposedCost ?? 0 },
    },
    {
      key: "needed",
      header: "Needed by",
      cell: (e) => dmy(s.requestById(e.entityId)?.requiredBy ?? null),
      sortValue: (e) => s.requestById(e.entityId)?.requiredBy ?? "9999",
      filter: { kind: "date", get: (e) => s.requestById(e.entityId)?.requiredBy ?? "" },
    },
    {
      key: "due",
      header: "Due",
      cell: (e) => <DueCell dueIso={e.dueIso} />,
      sortValue: (e) => e.dueIso ?? "9999",
      filter: { kind: "date", get: (e) => e.dueIso ?? "" },
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">{def?.title ?? step}</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Everything waiting on you at this step. Open a request to act on it.
        </p>
      </div>

      <QueueTable
        rows={rows}
        rowKey={(e) => e.entityId}
        columns={columns}
        loading={s.loading}
        rowsLabel="requests"
        initialSort={{ key: "due", dir: "asc" }}
        rowClassName={(e) => overdueRowClass(e.dueIso)}
        exportName={`ld-${step}`}
        exportTitle={def?.title ?? step}
        emptyTitle="Nothing waiting here"
        emptyMessage="When a request reaches this step it appears here, and you'll get a notification."
      />
    </div>
  );
}
