import { Link, useSearchParams } from "react-router-dom";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { formatDateTime } from "@/shared/lib/time";
import StatusPill from "../../components/StatusPill";
import { CARD_TYPE_LABEL, dmy, numOrDash, STATUS_LABEL } from "../../lib/format";
import CardTypePill from "../../components/CardTypePill";
import { buildIssueSlipExport } from "../../lib/issueSlipVm";
import { printIssueSlip } from "../../lib/printIssueSlip";
import { useProductionStore } from "../../store";
import type { ProductionRequest, ProductionStatus } from "../../types";

/** Every job card RLS lets this user see (the app is per-user granted). */
export default function RequestsList() {
  const s = useProductionStore();
  const [params] = useSearchParams();
  /**
   * Dashboard tiles / status bars deep-link here as `?status=<key>`; honour it only
   * if it's a real status, else show everything.
   *
   * ⚠ This seeds the Status COLUMN's filter. It used to seed the table's group
   *   dropdown, but the list is flat now, so the column is the only thing left that
   *   can carry it — and the filter matches on the LABEL, hence the lookup here
   *   rather than passing the raw key straight through.
   */
  const statusParam = params.get("status");
  const initialStatusLabel =
    statusParam && statusParam in STATUS_LABEL
      ? STATUS_LABEL[statusParam as ProductionStatus]
      : undefined;

  const slLookups = {
    fgItemName: (id: string | null) => s.fgItemById(id)?.name ?? "",
    rawMaterialName: (id: string | null) => s.rawMaterialById(id)?.name ?? "",
  };

  const columns: QueueColumn<ProductionRequest>[] = [
    {
      key: "jobcard",
      header: "Lot/Batch Card No.",
      // The Lot/Batch Card number is the primary identifier (the internal Job Card
      // no. is hidden); it links to the card detail. Search still matches both.
      cell: (r) => (
        <Link to={`/production-entry/requests/${r.id}`} className="font-semibold text-navy hover:text-orange">{r.jobcardNo || r.reqNo}</Link>
      ),
      sortValue: (r) => r.jobcardNo || r.reqNo,
      filter: { kind: "text", get: (r) => `${r.jobcardNo} ${r.reqNo}` },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "cardType",
      header: "Type",
      cell: (r) => <CardTypePill cardType={r.cardType} />,
      sortValue: (r) => CARD_TYPE_LABEL[r.cardType],
      filter: { kind: "select", get: (r) => CARD_TYPE_LABEL[r.cardType] },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "fg",
      header: "FG Item",
      cell: (r) => <span className="text-navy">{s.fgItemById(r.fgItemId)?.name ?? "—"}</span>,
      filter: { kind: "select", get: (r) => s.fgItemById(r.fgItemId)?.name ?? "—" },
    },
    {
      key: "fgQty",
      header: "FG Qty",
      align: "right",
      cell: (r) => {
        const unit = s.unitById(s.fgItemById(r.fgItemId)?.unitId ?? null)?.name;
        return (
          <span className="text-navy tabular-nums">
            {numOrDash(r.fgQty)}
            {unit && r.fgQty != null && <span className="text-grey-2 font-normal"> {unit}</span>}
          </span>
        );
      },
      sortValue: (r) => r.fgQty ?? 0,
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => <StatusPill status={r.status} />,
      // Multiselect rather than select for two reasons: it is the only filter kind
      // that carries `initial` (which the `?status=` deep link above needs), and it
      // lets someone watch several statuses at once — something the single group
      // dropdown this replaced could never do. Matching on the LABEL, not the raw
      // key, so the options read the way the pill does.
      filter: {
        kind: "multiselect",
        get: (r) => STATUS_LABEL[r.status] ?? r.status,
        initial: initialStatusLabel ? [initialStatusLabel] : undefined,
      },
    },
    // The date the job belongs to (back-datable), beside the date it was keyed in.
    {
      key: "jobDate",
      header: "Job Date",
      cell: (r) => <span className="text-navy">{dmy(r.issueDate ?? r.submittedAt)}</span>,
      sortValue: (r) => r.issueDate ?? r.submittedAt.slice(0, 10),
      filter: { kind: "date", get: (r) => r.issueDate ?? r.submittedAt.slice(0, 10) },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "submitted",
      header: "Raised",
      cell: (r) => <span className="text-grey-2">{formatDateTime(r.submittedAt)}</span>,
      sortValue: (r) => r.submittedAt,
      filter: { kind: "date", get: (r) => r.submittedAt },
      tdClassName: "whitespace-nowrap",
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">All Issue Slips</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">Every production job card you're allowed to see, newest first.</p>
      </div>
      <QueueTable<ProductionRequest>
        rows={s.requests}
        rowKey={(r) => r.id}
        columns={columns}
        initialSort={{ key: "submitted", dir: "desc" }}
        rowsLabel="job cards"
        exportName="Production_Job_Cards"
        emptyTitle="No job cards yet"
        emptyMessage="Job cards raised on the floor will appear here."
        actions={(r) => (
          <div className="flex items-center gap-3">
            <Link to={`/production-entry/requests/${r.id}`} className="text-[12.5px] font-semibold text-orange hover:underline">Open</Link>
            {s.canEditRequest(r) && (
              <Link to={`/production-entry/requests/${r.id}/edit`} className="text-[12.5px] font-semibold text-orange hover:underline">Edit</Link>
            )}
            <button type="button" onClick={() => printIssueSlip(buildIssueSlipExport(r, slLookups))} className="text-[12.5px] font-semibold text-orange hover:underline">Print</button>
          </div>
        )}
      />
    </div>
  );
}
