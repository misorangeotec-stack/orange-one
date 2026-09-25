import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import DueCell from "@/shared/components/ui/DueCell";
import Button from "@/shared/components/ui/Button";
import { useSession } from "@/core/platform/session";
import { useLdStore } from "../../store";
import { B } from "../../nav";
import { STATUS_LABEL, dmy, inr } from "../../lib/format";
import StatusPill, { PriorityPill } from "../../components/StatusPill";
import { stepByKey } from "../../lib/steps";
import { stepOf } from "../../lib/queues";
import type { Priority, TrainingRequest } from "../../types";

/** High first — the point of sorting by priority is to see the urgent ones. */
const PRIORITY_RANK: Record<Priority, number> = { high: 1, medium: 2, low: 3 };

/**
 * Every training request this person may read — or, with `mine`, only their own.
 *
 * One component serves both because they differ by a filter and a heading and
 * nothing else; two copies would drift the moment a column is added.
 *
 * ⚠ AN EMPTY LIST HERE IS USUALLY CORRECT, NOT BROKEN. Requests are RLS-scoped
 *   (`fms_ld_can_read_request`), so a colleague who has never raised one and owns
 *   no step legitimately sees nothing. The empty message says so rather than
 *   implying something failed.
 */
export default function RequestsList({ mine = false }: { mine?: boolean }) {
  const s = useLdStore();
  const nav = useNavigate();
  const { user } = useSession();

  const rows = useMemo(() => {
    const all = s.requests;
    return mine ? all.filter((r) => r.requestedBy === user?.id) : all;
  }, [s.requests, mine, user?.id]);

  const columns: QueueColumn<TrainingRequest>[] = [
    {
      key: "code",
      header: "Request",
      cell: (r) => (
        <Link to={`${B}/requests/${r.id}`} className="font-semibold text-navy hover:text-orange">
          {r.code ?? "Draft"}
        </Link>
      ),
      sortValue: (r) => r.code ?? "zzz",
      // No filter declared on purpose: every code is unique, so the dropdown would
      // only restate the table. (QueueTable takes an optional filter — omitting it
      // is how a column opts out; `filter: false` is MasterCrud's spelling.)
    },
    {
      key: "title",
      header: "Training",
      cell: (r) => <span className="text-navy">{r.title}</span>,
      filter: { kind: "text", get: (r) => r.title },
    },
    {
      key: "dept",
      header: "Department",
      cell: (r) => s.departmentName(r.departmentId),
      filter: { kind: "select", get: (r) => s.departmentName(r.departmentId) },
    },
    {
      key: "raiser",
      header: "Raised by",
      cell: (r) => s.personName(r.requestedBy),
      filter: { kind: "select", get: (r) => s.personName(r.requestedBy) },
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => <StatusPill status={r.status} />,
      // The pill renders a coloured chip, so the text to order and filter by has
      // to be named explicitly — `nodeText` would read the label but not its rank.
      sortValue: (r) => STATUS_LABEL[r.status],
      filter: { kind: "select", get: (r) => STATUS_LABEL[r.status] },
    },
    {
      key: "step",
      header: "Waiting on",
      cell: (r) => {
        const step = stepOf(r);
        return step ? stepByKey(step)?.short ?? step : <span className="text-grey-2">—</span>;
      },
      sortValue: (r) => {
        const step = stepOf(r);
        return step ? stepByKey(step)?.index ?? 99 : 99;
      },
      filter: {
        kind: "select",
        get: (r) => {
          const step = stepOf(r);
          return step ? stepByKey(step)?.short ?? step : "Nothing pending";
        },
      },
    },
    {
      key: "priority",
      header: "Priority",
      cell: (r) => <PriorityPill priority={r.priority} />,
      sortValue: (r) => PRIORITY_RANK[r.priority ?? "low"],
      filter: { kind: "select", get: (r) => (r.priority ? r.priority : "Not set") },
    },
    {
      key: "due",
      header: "Step due",
      cell: (r) => <DueCell dueIso={s.dueIsoOf(r)} />,
      sortValue: (r) => s.dueIsoOf(r) ?? "9999",
      filter: { kind: "date", get: (r) => s.dueIsoOf(r) ?? "" },
    },
    {
      key: "requiredBy",
      header: "Needed by",
      cell: (r) => dmy(r.requiredBy),
      sortValue: (r) => r.requiredBy ?? "9999",
      filter: { kind: "date", get: (r) => r.requiredBy ?? "" },
    },
    {
      key: "budget",
      header: "Budget",
      align: "right",
      // A formatted number sorts as text unless the raw value is named.
      cell: (r) => inr(r.approvedBudget ?? r.proposedCost),
      sortValue: (r) => r.approvedBudget ?? r.proposedCost ?? -1,
      exportValue: (r) => r.approvedBudget ?? r.proposedCost ?? "",
      filter: { kind: "number", get: (r) => r.approvedBudget ?? r.proposedCost ?? 0 },
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-navy">
            {mine ? "My training requests" : "All training requests"}
          </h1>
          <p className="text-[13.5px] text-grey-2 mt-1">
            {mine
              ? "Everything you have raised, and where each one has got to."
              : "Every request you can see, and which step it is waiting at."}
          </p>
        </div>
        {s.canRaise && (
          <Button onClick={() => nav(`${B}/requests/new`)}>Raise a training need</Button>
        )}
      </div>

      <QueueTable
        rows={rows}
        rowKey={(r) => r.id}
        columns={columns}
        loading={s.loading}
        rowsLabel="requests"
        initialSort={{ key: "due", dir: "asc" }}
        exportName="training-requests"
        exportTitle={mine ? "My training requests" : "Training requests"}
        emptyTitle={mine ? "You haven't raised any training yet" : "No training requests yet"}
        emptyMessage={
          mine
            ? "Raise one when you spot a gap — it takes a title and a sentence about what should change."
            : "Requests appear here once they are raised. You see the ones you raised and the ones whose steps you own."
        }
      />
    </div>
  );
}
