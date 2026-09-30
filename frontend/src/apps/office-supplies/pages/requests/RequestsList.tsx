import { Link } from "react-router-dom";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { formatDate } from "@/shared/lib/time";
import StatusPill from "../../components/StatusPill";
import { STATUS_LABEL, requestTypeLabel } from "../../lib/format";
import { requestHref } from "../../lib/routes";
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
        <Link to={requestHref(r.id)} className="font-semibold text-navy hover:text-orange">
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
      sortValue: (r) => r.itemName ?? "",
      filter: { kind: "text", get: (r) => r.itemName ?? "" },
    },
    {
      key: "type",
      header: "Type",
      cell: (r) => <span className="text-grey-2">{requestTypeLabel(r.requestType)}</span>,
      sortValue: (r) => requestTypeLabel(r.requestType),
      filter: { kind: "select", get: (r) => requestTypeLabel(r.requestType) },
    },
    {
      key: "for",
      header: "Requested for",
      cell: (r) => <span className="text-grey">{r.requestedForName}</span>,
      sortValue: (r) => r.requestedForName,
      filter: { kind: "text", get: (r) => r.requestedForName },
    },
    {
      key: "department",
      header: "Department",
      cell: (r) => <span className="text-grey">{s.departmentById(r.departmentId)?.name ?? "—"}</span>,
      sortValue: (r) => s.departmentById(r.departmentId)?.name ?? "—",
      filter: { kind: "select", get: (r) => s.departmentById(r.departmentId)?.name ?? "—" },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "qty",
      header: "Qty",
      cell: (r) => <span className="text-grey-2">{r.quantity}</span>,
      sortValue: (r) => r.quantity,
      // Text, not number - see the same column on My Requests.
      filter: { kind: "text", get: (r) => r.quantity },
    },
    {
      // ⚠ The filter reads the LABEL, not `r.status`. It used to offer the raw column
      //   values — cancelled / on_hold / pending_second_approval — beside a table that
      //   says "Awaiting second approval", so a reader had to guess the database's
      //   spelling of the word in front of them.
      key: "status",
      header: "Status",
      cell: (r) => <StatusPill status={r.status} />,
      sortValue: (r) => STATUS_LABEL[r.status],
      filter: { kind: "select", get: (r) => STATUS_LABEL[r.status] },
    },
    {
      key: "submitted",
      header: "Submitted",
      cell: (r) => <span className="text-grey-2">{formatDate(r.submittedAt)}</span>,
      sortValue: (r) => r.submittedAt,
      filter: { kind: "date", get: (r) => r.submittedAt?.slice(0, 10) ?? "" },
      tdClassName: "whitespace-nowrap",
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">All Requests</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">Every purchase request you're allowed to see, newest first.</p>
      </div>
      <QueueTable<SupplyRequest>
        rows={s.requests}
        rowKey={(r) => r.id}
        columns={columns}
        initialSort={{ key: "submitted", dir: "desc" }}
        rowsLabel="requests"
        emptyTitle="No requests yet"
        emptyMessage="Requests you raise or are involved with will appear here."
      />
    </div>
  );
}
