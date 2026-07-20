import { Link } from "react-router-dom";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { formatDate } from "@/shared/lib/time";
import StatusPill from "../../components/StatusPill";
import { STATUS_LABEL } from "../../lib/format";
import { useProductionStore } from "../../store";
import type { ProductionRequest, ProductionStatus } from "../../types";

/** Every job card RLS lets this user see (the app is per-user granted). */
export default function RequestsList() {
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
      header: "Job Card No.",
      cell: (r) => <span className="text-navy">{r.jobcardNo}</span>,
      filter: { kind: "text", get: (r) => r.jobcardNo },
    },
    {
      key: "rm",
      header: "Raw Material",
      cell: (r) => <span className="text-grey-2">{s.rawMaterialById(r.rawMaterialId)?.name ?? "—"}</span>,
      filter: { kind: "select", get: (r) => s.rawMaterialById(r.rawMaterialId)?.name ?? "—" },
    },
    {
      key: "fg",
      header: "FG Item",
      cell: (r) => <span className="text-grey-2">{s.fgItemById(r.fgItemId)?.name ?? "—"}</span>,
      filter: { kind: "select", get: (r) => s.fgItemById(r.fgItemId)?.name ?? "—" },
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
      tdClassName: "whitespace-nowrap",
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">All Job Cards</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">Every production job card you're allowed to see, newest first.</p>
      </div>
      <QueueTable<ProductionRequest>
        rows={s.requests}
        rowKey={(r) => r.id}
        columns={columns}
        groupBy={{ idOf: (r) => r.status, nameOf: (id) => STATUS_LABEL[id as ProductionStatus] ?? id, allLabel: "All statuses", label: "Status" }}
        initialSort={{ key: "submitted", dir: "desc" }}
        rowsLabel="job cards"
        exportName="Production_Job_Cards"
        emptyTitle="No job cards yet"
        emptyMessage="Job cards raised on the floor will appear here."
      />
    </div>
  );
}
