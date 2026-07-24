import { useMemo } from "react";
import { Link } from "react-router-dom";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { formatDate } from "@/shared/lib/time";
import StatusPill from "../../components/StatusPill";
import { directionLabel, labTestingLabel, receiveViaLabel, requestSubject } from "../../lib/format";
import { requestBranch } from "../../lib/queues";
import type { StepBranch } from "../../lib/steps";
import { useSamplingStore } from "../../store";
import type { SamplingRequest } from "../../types";

const COPY: Record<StepBranch, { title: string; blurb: string; empty: string }> = {
  no_lab: {
    title: "No-Lab Requests",
    blurb: "Samples that skip the lab — collected, handed over and closed on receipt.",
    empty: "Requests raised with lab testing NOT required will appear here.",
  },
  lab: {
    title: "Lab Requests",
    blurb: "Inward samples that go to the lab — collected, sent to the lab, tested, then the result handed over.",
    empty: "Inward requests raised with lab testing required will appear here.",
  },
  outward: {
    title: "Outward Requests",
    blurb: "Samples we send out for the other party to test.",
    empty: "Outward requests will appear here.",
  },
};

/**
 * Every request RLS lets this user see (the app is per-user granted, so that is
 * the whole sampling team). Grouped by company.
 *
 * ONE component, three routes: unscoped at /requests, and scoped to a branch at
 * /lab-requests and /no-lab-requests — the sidebar's two branch blocks. Scoping
 * runs through `requestBranch`, the same predicate the rest of the app splits on.
 * The "Lab testing" column only earns its width on the unscoped list; on a scoped
 * one every row would read the same.
 */
export default function RequestsList({ branch }: { branch?: StepBranch }) {
  const s = useSamplingStore();
  const copy = branch ? COPY[branch] : null;

  const rows = useMemo(
    () => (branch ? s.requests.filter((r) => requestBranch(r) === branch) : s.requests),
    [s.requests, branch],
  );

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
    ...(branch
      ? []
      : [
          {
            key: "labTesting",
            header: "Lab testing",
            cell: (r: SamplingRequest) => <span className="text-grey-2">{labTestingLabel(r.labTestingRequired)}</span>,
            filter: { kind: "select" as const, get: (r: SamplingRequest) => labTestingLabel(r.labTestingRequired) },
            tdClassName: "whitespace-nowrap",
          },
        ]),
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
        <h1 className="text-[22px] font-bold text-navy">{copy?.title ?? "All Requests"}</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          {copy?.blurb ?? "Every sampling request you're allowed to see, newest first."}
        </p>
      </div>
      <QueueTable<SamplingRequest>
        rows={rows}
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
        emptyMessage={copy?.empty ?? "Requests you raise or are involved with will appear here."}
      />
    </div>
  );
}
