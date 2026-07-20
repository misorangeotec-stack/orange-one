import { Link } from "react-router-dom";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { formatDate } from "@/shared/lib/time";
import StatusPill from "../../components/StatusPill";
import { directionLabel, receiveViaLabel, requestSubject } from "../../lib/format";
import { useSamplingStore } from "../../store";
import type { SamplingRequest } from "../../types";

/**
 * Every request RLS lets this user see (the app is per-user granted, so that is
 * the whole sampling team). Grouped by company.
 */
export default function RequestsList() {
  const s = useSamplingStore();

  const columns: QueueColumn<SamplingRequest>[] = [
    {
      key: "reqNo",
      header: "Request",
      cell: (r) => (
        <Link to={`/sampling/requests/${r.id}`} className="font-semibold text-navy hover:text-orange">
          {r.reqNo}
        </Link>
      ),
      sortValue: (r) => r.reqNo,
      filter: { kind: "text", get: (r) => r.reqNo },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "subject",
      header: "Product / Party",
      cell: (r) => <span className="text-navy">{requestSubject(r)}</span>,
      filter: { kind: "text", get: (r) => requestSubject(r) },
    },
    {
      key: "direction",
      header: "Direction",
      cell: (r) => <span className="text-grey-2">{directionLabel(r.direction)}</span>,
      filter: { kind: "select", get: (r) => directionLabel(r.direction) },
    },
    {
      key: "source",
      header: "Source",
      cell: (r) => <span className="text-grey-2">{receiveViaLabel(r.receiveVia)}</span>,
      filter: { kind: "select", get: (r) => receiveViaLabel(r.receiveVia) },
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
        <p className="text-[13.5px] text-grey-2 mt-1">Every sampling request you're allowed to see, newest first.</p>
      </div>
      <QueueTable<SamplingRequest>
        rows={s.requests}
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
        emptyTitle="No requests yet"
        emptyMessage="Requests you raise or are involved with will appear here."
      />
    </div>
  );
}
