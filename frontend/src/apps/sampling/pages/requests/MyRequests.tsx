import { Link } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { formatDate } from "@/shared/lib/time";
import StatusPill from "../../components/StatusPill";
import { directionLabel, labTestingLabel, requestSubject } from "../../lib/format";
import { useSamplingStore } from "../../store";
import type { SamplingRequest } from "../../types";

/** The requests I raised. */
export default function MyRequests() {
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
      key: "labTesting",
      header: "Lab testing",
      cell: (r) => <span className="text-grey-2">{labTestingLabel(r.labTestingRequired)}</span>,
      filter: { kind: "select", get: (r) => labTestingLabel(r.labTestingRequired) },
      tdClassName: "whitespace-nowrap",
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
          <p className="text-[13.5px] text-grey-2 mt-1">Sampling requests you raised.</p>
        </div>
        <Link to="/sampling/requests/new">
          <Button size="sm">Raise a request</Button>
        </Link>
      </div>

      <QueueTable<SamplingRequest>
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
        exportName="My_Sampling_Requests"
        emptyTitle="No requests yet"
        emptyMessage="You haven't raised any sampling requests."
        actions={(r) => (
          <Link to={`/sampling/requests/${r.id}`} className="text-[12.5px] font-semibold text-orange hover:underline">
            Open
          </Link>
        )}
      />
    </div>
  );
}
