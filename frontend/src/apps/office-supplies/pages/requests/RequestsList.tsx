import { Link } from "react-router-dom";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { formatDate } from "@/shared/lib/time";
import StatusPill from "../../components/StatusPill";
import { requestTypeLabel } from "../../lib/format";
import { useSuppliesStore } from "../../store";
import type { SupplyRequest } from "../../types";

/**
 * Every request RLS lets this user see. Grouped by department. The app never filters —
 * fms_supplies_can_read_request decides which rows come back.
 */
export default function RequestsList() {
  const s = useSuppliesStore();

  const columns: QueueColumn<SupplyRequest>[] = [
    {
      key: "reqNo",
      header: "Request",
      cell: (r) => (
        <Link to={`/office-supplies/requests/${r.id}`} className="font-semibold text-navy hover:text-orange">
          {r.reqNo}
        </Link>
      ),
      sortValue: (r) => r.reqNo,
      filter: { kind: "text", get: (r) => r.reqNo },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "item",
      header: "Item / Service",
      cell: (r) => <span className="text-navy">{r.itemName ?? "—"}</span>,
      filter: { kind: "text", get: (r) => r.itemName ?? "" },
    },
    {
      key: "type",
      header: "Type",
      cell: (r) => <span className="text-grey-2">{requestTypeLabel(r.requestType)}</span>,
      filter: { kind: "select", get: (r) => requestTypeLabel(r.requestType) },
    },
    {
      key: "for",
      header: "Requested for",
      cell: (r) => <span className="text-grey">{r.requestedForName}</span>,
      filter: { kind: "text", get: (r) => r.requestedForName },
    },
    {
      key: "qty",
      header: "Qty",
      cell: (r) => <span className="text-grey-2">{r.quantity}</span>,
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => <StatusPill status={r.status} />,
      filter: { kind: "select", get: (r) => r.status },
    },
    {
      key: "submitted",
      header: "Submitted",
      cell: (r) => <span className="text-grey-2">{formatDate(r.submittedAt)}</span>,
      sortValue: (r) => r.submittedAt,
      tdClassName: "whitespace-nowrap",
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">All Requests</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">Every supply request you're allowed to see, newest first.</p>
      </div>
      <QueueTable<SupplyRequest>
        rows={s.requests}
        rowKey={(r) => r.id}
        columns={columns}
        groupBy={{
          idOf: (r) => r.departmentId,
          nameOf: (id) => s.departmentById(id)?.name ?? "—",
          allLabel: "All departments",
          label: "Department",
        }}
        initialSort={{ key: "submitted", dir: "desc" }}
        rowsLabel="requests"
        emptyTitle="No requests yet"
        emptyMessage="Requests you raise or are involved with will appear here."
      />
    </div>
  );
}
