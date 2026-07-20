import { Link } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { formatDate } from "@/shared/lib/time";
import StatusPill from "../../components/StatusPill";
import { requestTypeLabel } from "../../lib/format";
import { useSuppliesStore } from "../../store";
import type { SupplyRequest } from "../../types";

/** The requests I raised or am the beneficiary of. */
export default function MyRequests() {
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
      filter: { kind: "date", get: (r) => r.submittedAt },
      tdClassName: "whitespace-nowrap",
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold text-navy">My Requests</h1>
          <p className="text-[13.5px] text-grey-2 mt-1">Requests you raised, or that were raised for you.</p>
        </div>
        <Link to="/office-supplies/requests/new">
          <Button size="sm">Raise a request</Button>
        </Link>
      </div>

      <QueueTable<SupplyRequest>
        rows={s.myRequests}
        rowKey={(r) => r.id}
        columns={columns}
        groupBy={{
          idOf: (r) => r.companyId,
          nameOf: (id) => s.companyById(id)?.name ?? "—",
          allLabel: "All companies",
          label: "Company",
        }}
        initialSort={{ key: "submitted", dir: "desc" }}
        rowsLabel="requests"
        exportName="My_Supply_Requests"
        emptyTitle="No requests yet"
        emptyMessage="You haven't raised any supply requests."
        actions={(r) => (
          <>
            <Link to={`/office-supplies/requests/${r.id}`} className="text-[12.5px] font-semibold text-orange hover:underline">Open</Link>
            {s.requestEditable(r) && (
              <Link to={`/office-supplies/requests/${r.id}/edit`} className="text-[12.5px] font-semibold text-grey hover:text-navy ml-3">Edit</Link>
            )}
          </>
        )}
      />
    </div>
  );
}
