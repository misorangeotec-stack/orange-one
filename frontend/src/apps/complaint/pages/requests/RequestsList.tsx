import { useMemo } from "react";
import { Link } from "react-router-dom";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { useSession } from "@/core/platform/session";
import StatusPill from "../../components/StatusPill";
import { useComplaintStore } from "../../store";
import { requestHref } from "../../lib/routes";
import { COMPLAINT_TYPE_TONE, STATUS_LABEL, ageDays, dmy } from "../../lib/format";
import { COMPLAINT_TYPE_LABEL, type ComplaintRequest } from "../../types";

/**
 * Every complaint RLS lets this user see — or, with `mine`, only the ones they
 * raised.
 *
 * ONE component, two routes: /requests and /my-requests. The difference is a
 * filter, not a second screen, so the columns and their sorting cannot drift
 * apart between the two.
 *
 * ⚠ FLAT, NEVER `groupBy`. RM/FG feels like a band and is not: banding makes the
 *   group name the PRIMARY sort, so a list ordered by age would only sort within
 *   each type and the oldest complaint would hide mid-page. It is an ordinary
 *   column with its own sort and filter.
 */
export default function RequestsList({ mine }: { mine?: boolean }) {
  const s = useComplaintStore();
  const { user } = useSession();

  const rows = useMemo(
    () => (mine ? s.requests.filter((r) => r.raisedBy === user.id) : s.requests),
    [s.requests, mine, user.id],
  );

  const columns: QueueColumn<ComplaintRequest>[] = [
    {
      key: "complaintNo",
      header: "Complaint",
      cell: (r) => (
        <Link to={requestHref(r.id)} className="font-semibold text-orange hover:underline">
          {r.complaintNo}
        </Link>
      ),
      sortValue: (r) => r.complaintNo,
      // No filter: every complaint number is unique, so the dropdown would
      // simply restate the table.
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "type",
      header: "Type",
      cell: (r) => (
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap ${COMPLAINT_TYPE_TONE[r.complaintType]}`}
        >
          {COMPLAINT_TYPE_LABEL[r.complaintType]}
        </span>
      ),
      sortValue: (r) => COMPLAINT_TYPE_LABEL[r.complaintType],
      filter: { kind: "select", get: (r) => COMPLAINT_TYPE_LABEL[r.complaintType] },
    },
    {
      key: "party",
      header: "Customer / Vendor",
      cell: (r) => r.partyName ?? "—",
      sortValue: (r) => r.partyName ?? "",
      filter: { kind: "select", get: (r) => r.partyName ?? "—" },
    },
    {
      key: "company",
      header: "Company",
      cell: (r) => s.companyName(r.companyId),
      sortValue: (r) => s.companyName(r.companyId),
      filter: { kind: "select", get: (r) => s.companyName(r.companyId) },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "lot",
      header: "LOT No.",
      cell: (r) => r.lotNo ?? "—",
      sortValue: (r) => r.lotNo ?? "",
      filter: { kind: "select", get: (r) => r.lotNo ?? "—" },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "item",
      header: "Item",
      cell: (r) => r.itemName ?? "—",
      sortValue: (r) => r.itemName ?? "",
      filter: { kind: "select", get: (r) => r.itemName ?? "—" },
    },
    {
      key: "invoice",
      header: "Invoice",
      cell: (r) => r.invoiceNo ?? "—",
      sortValue: (r) => r.invoiceNo ?? "",
      filter: { kind: "select", get: (r) => r.invoiceNo ?? "—" },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => <StatusPill status={r.status} />,
      sortValue: (r) => STATUS_LABEL[r.status],
      filter: { kind: "select", get: (r) => STATUS_LABEL[r.status] },
    },
    {
      key: "age",
      header: "Age",
      // From when the problem was NOTICED, not when it was raised — the gap is
      // often the whole story, which is why the form asks separately.
      cell: (r) => {
        const d = ageDays(r.issueIdentifiedAt);
        return d === null ? "—" : `${d}d`;
      },
      sortValue: (r) => ageDays(r.issueIdentifiedAt) ?? -1,
      // No filter: a continuous day count is a sort, not a vocabulary.
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "raised",
      header: "Raised",
      cell: (r) => dmy(r.submittedAt),
      sortValue: (r) => r.submittedAt,
      // No filter: a timestamp is a sort, not a vocabulary.
      tdClassName: "whitespace-nowrap",
    },
  ];

  return (
    <div className="space-y-5">
      <h1 className="text-[22px] font-bold text-navy">
        {mine ? "My Complaints" : "All Complaints"}
      </h1>

      <QueueTable<ComplaintRequest>
        rows={rows}
        rowKey={(r) => r.id}
        columns={columns}
        rowsLabel="complaints"
        initialSort={{ key: "raised", dir: "desc" }}
        exportName={mine ? "my-complaints" : "complaints"}
        exportTitle={mine ? "My Complaints" : "All Complaints"}
        emptyTitle={mine ? "You have not raised a complaint yet" : "No complaints yet"}
        emptyMessage={
          mine
            ? "Complaints you raise will appear here."
            : "Complaints raised by anyone with this module will appear here."
        }
        loading={s.loading}
      />
    </div>
  );
}
