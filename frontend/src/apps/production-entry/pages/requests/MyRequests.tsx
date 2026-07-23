import { Link } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { formatDate } from "@/shared/lib/time";
import StatusPill from "../../components/StatusPill";
import { STATUS_LABEL } from "../../lib/format";
import { useProductionStore } from "../../store";
import type { ProductionRequest, ProductionStatus } from "../../types";

/** The job cards I raised. */
export default function MyRequests() {
  const s = useProductionStore();

  const columns: QueueColumn<ProductionRequest>[] = [
    {
      key: "reqNo",
      header: "Job Card",
      cell: (r) => (
        <Link to={`/production-entry/requests/${r.id}`} className="font-semibold text-navy hover:text-orange">{r.reqNo}</Link>
      ),
      sortValue: (r) => r.reqNo,
      filter: { kind: "text", get: (r) => `${r.reqNo} ${r.jobcardNo}` },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "jobcard",
      header: "Lot/Batch Card No.",
      cell: (r) => <span className="text-navy">{r.jobcardNo}</span>,
      filter: { kind: "text", get: (r) => r.jobcardNo },
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => <StatusPill status={r.status} />,
      filter: { kind: "select", get: (r) => r.status },
    },
    {
      key: "submitted",
      header: "Raised",
      cell: (r) => <span className="text-grey-2">{formatDate(r.submittedAt)}</span>,
      sortValue: (r) => r.submittedAt,
      filter: { kind: "date", get: (r) => r.submittedAt },
      tdClassName: "whitespace-nowrap",
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold text-navy">My Job Cards</h1>
          <p className="text-[13.5px] text-grey-2 mt-1">Production job cards you raised.</p>
        </div>
        {s.canRaise && (
          <Link to="/production-entry/requests/new">
            <Button size="sm">Raise a job card</Button>
          </Link>
        )}
      </div>

      <QueueTable<ProductionRequest>
        rows={s.myRequests}
        rowKey={(r) => r.id}
        columns={columns}
        groupBy={{ idOf: (r) => r.status, nameOf: (id) => STATUS_LABEL[id as ProductionStatus] ?? id, allLabel: "All statuses", label: "Status" }}
        initialSort={{ key: "submitted", dir: "desc" }}
        rowsLabel="job cards"
        exportName="My_Production_Job_Cards"
        emptyTitle="No job cards yet"
        emptyMessage="You haven't raised any production job cards."
        actions={(r) => (
          <Link to={`/production-entry/requests/${r.id}`} className="text-[12.5px] font-semibold text-orange hover:underline">Open</Link>
        )}
      />
    </div>
  );
}
