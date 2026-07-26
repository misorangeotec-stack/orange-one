import { Link, useSearchParams } from "react-router-dom";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { formatDateTime } from "@/shared/lib/time";
import StatusPill from "../../components/StatusPill";
import { numOrDash, STATUS_LABEL } from "../../lib/format";
import { buildIssueSlipExport } from "../../lib/issueSlipVm";
import { printIssueSlip } from "../../lib/printIssueSlip";
import { useProductionStore } from "../../store";
import type { ProductionRequest, ProductionStatus } from "../../types";

/** Every job card RLS lets this user see (the app is per-user granted). */
export default function RequestsList() {
  const s = useProductionStore();
  const [params] = useSearchParams();
  // Dashboard tiles / status bars deep-link here as `?status=<key>`; honour it only
  // if it's a real status, else fall through to "all".
  const statusParam = params.get("status");
  const initialGroup = statusParam && statusParam in STATUS_LABEL ? statusParam : undefined;

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
      filter: { kind: "select", get: (r) => r.status },
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
        groupBy={{ idOf: (r) => r.status, nameOf: (id) => STATUS_LABEL[id as ProductionStatus] ?? id, allLabel: "All statuses", label: "Status" }}
        initialGroup={initialGroup}
        hideGroupHeaders
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
