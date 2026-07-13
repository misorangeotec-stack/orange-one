import { useMemo } from "react";
import { Link } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { formatDateDMY } from "@/shared/lib/date";
import StatusPill from "../../components/StatusPill";
import { useHrStore } from "../../store";
import { REQ_STATUS_LABEL, salaryLabel } from "../../lib/format";
import type { Requisition } from "../../types";

/**
 * Every requisition the signed-in user is allowed to see (RLS decides that, not
 * this screen). Grouped by department — the HR equivalent of Purchase's company
 * grouping.
 */
export default function MrfList() {
  const s = useHrStore();

  const deptName = (id: string) => s.departments.find((d) => d.id === id)?.name ?? "—";
  const personName = (id: string | null) => (id ? (s.profileById(id)?.name ?? "Unknown") : "—");

  const columns: QueueColumn<Requisition>[] = useMemo(
    () => [
      {
        key: "mrfNo",
        header: "MRF",
        cell: (r) => (
          <Link to={`/hr-recruitment/requisitions/${r.id}`} className="font-semibold text-orange hover:underline">
            {r.mrfNo}
          </Link>
        ),
        sortValue: (r) => r.mrfNo,
        filter: { kind: "text", get: (r) => r.mrfNo },
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "jobTitle",
        header: "Position",
        cell: (r) => (
          <div>
            <div className="font-medium text-navy">{r.jobTitle}</div>
            <div className="text-[12px] text-grey-2">
              {r.positionsRequired} {r.positionsRequired === 1 ? "seat" : "seats"}
              {r.positionKind === "replacement" && " · replacement"}
            </div>
          </div>
        ),
        sortValue: (r) => r.jobTitle,
        filter: { kind: "text", get: (r) => r.jobTitle },
        exportValue: (r) => r.jobTitle,
      },
      {
        key: "seats",
        header: "Seats",
        cell: (r) => (
          <span className="text-grey">
            {s.seatsJoined(r.id)} / {r.positionsRequired}
          </span>
        ),
        sortValue: (r) => r.positionsRequired,
        exportValue: (r) => `${s.seatsJoined(r.id)} of ${r.positionsRequired} filled`,
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "raisedBy",
        header: "Raised by",
        cell: (r) => <span className="text-grey">{personName(r.requesterId)}</span>,
        sortValue: (r) => personName(r.requesterId),
        filter: { kind: "text", get: (r) => personName(r.requesterId) },
      },
      {
        key: "salary",
        header: "Salary",
        cell: (r) => <span className="text-grey">{salaryLabel(r.salaryMin, r.salaryMax, r.salaryNote)}</span>,
        exportValue: (r) => salaryLabel(r.salaryMin, r.salaryMax, r.salaryNote),
      },
      {
        key: "raised",
        header: "Raised on",
        cell: (r) => <span className="text-grey">{formatDateDMY(r.requestDate)}</span>,
        sortValue: (r) => r.requestDate,
        filter: { kind: "date", get: (r) => r.requestDate },
        exportValue: (r) => formatDateDMY(r.requestDate),
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "status",
        header: "Status",
        cell: (r) => <StatusPill status={r.status} />,
        sortValue: (r) => REQ_STATUS_LABEL[r.status],
        filter: { kind: "select", get: (r) => REQ_STATUS_LABEL[r.status] },
      },
    ],
    // The whole store: the Seats column reads live seat counts, so a refetch must
    // rebuild these columns — keying on s.profiles alone would freeze them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s],
  );

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold text-navy">Requisitions</h1>
          <p className="text-[13.5px] text-grey-2 mt-1">
            Every vacancy you can see, and where each one has got to.
          </p>
        </div>
        {s.isStepOwner("mrf") && (
          <Link to="/hr-recruitment/requisitions/new">
            <Button size="sm">Raise a requisition</Button>
          </Link>
        )}
      </div>

      <QueueTable<Requisition>
        rows={s.requisitions}
        rowKey={(r) => r.id}
        columns={columns}
        groupBy={{ idOf: (r) => r.departmentId, nameOf: deptName, allLabel: "All departments", label: "Department" }}
        rowsLabel="requisitions"
        emptyTitle="No requisitions yet"
        emptyMessage="Once a department head raises one, it will appear here."
        initialSort={{ key: "raised", dir: "desc" }}
        exportName="HR_Requisitions"
        exportTitle="Requisitions"
        exportNotes={[
          "Every requisition you can see — open, on hold, closed and cancelled. Closed ones are kept deliberately: that is where hires, time-to-hire and platform effectiveness live.",
          "Seats = people who have actually JOINED, out of the headcount the MRF asked for. A finalized candidate who has not turned up yet does not count as filled.",
          "Salary is the requester's own wording where they gave one; the min/max pair exists only to flag an over-range offer.",
        ]}
        actions={(r) => (
          <Link
            to={`/hr-recruitment/requisitions/${r.id}`}
            className="text-[12.5px] font-semibold text-orange hover:underline"
          >
            Open
          </Link>
        )}
      />
    </div>
  );
}
