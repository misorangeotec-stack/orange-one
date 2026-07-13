import { useMemo } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { formatDate } from "@/shared/lib/time";
import { useProcurementStore } from "../../store";
import { lineBadge, LINE_STATUS_LABEL } from "../../lib/format";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import type { LineStatus, PurchaseRequest, RequestItem } from "../../types";

/**
 * A request rolls up to one representative status = its least-advanced / most
 * attention-needing line (the bottleneck). For the common single-line request
 * this is just that line's status.
 */
const STATUS_PRIORITY: LineStatus[] = ["sourcing", "on_hold", "approval", "approved_pending_po", "po", "rejected", "cancelled"];
const rollupStatus = (lines: RequestItem[]): LineStatus | null => {
  for (const st of STATUS_PRIORITY) if (lines.some((l) => l.status === st)) return st;
  return null;
};

/** Purchase Requests list — same queue-style per-column filters, grouped by company. */
export default function RequestsList() {
  const s = useProcurementStore();

  const rows = useMemo(() => [...s.requests].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [s.requests]);

  const companyName = (id: string) => {
    const co = s.companyById(id);
    return co ? (co.location ? `${co.name} — ${co.location}` : co.name) : "—";
  };
  const categoryName = (r: PurchaseRequest) => s.categoryById(r.categoryId)?.name ?? "—";
  const requesterName = (r: PurchaseRequest) => s.profileById(r.requesterId)?.name ?? "—";
  const statusOf = (r: PurchaseRequest) => rollupStatus(s.itemsForRequest(r.id));
  const statusLabel = (r: PurchaseRequest) => { const st = statusOf(r); return st ? LINE_STATUS_LABEL[st] : "—"; };

  /** Per-stage breakdown, shown as the Status badge tooltip (useful for multi-line requests). */
  const lineSummary = (requestId: string) => {
    const lines = s.itemsForRequest(requestId);
    const n = (st: string) => lines.filter((l) => l.status === st).length;
    const parts: string[] = [];
    if (n("sourcing")) parts.push(`${n("sourcing")} sourcing`);
    if (n("approval") + n("on_hold")) parts.push(`${n("approval") + n("on_hold")} approval`);
    if (n("approved_pending_po")) parts.push(`${n("approved_pending_po")} pool`);
    if (n("po")) parts.push(`${n("po")} on PO`);
    if (n("rejected")) parts.push(`${n("rejected")} rejected`);
    if (n("cancelled")) parts.push(`${n("cancelled")} cancelled`);
    return parts.join(" · ") || "—";
  };

  const columns: QueueColumn<PurchaseRequest>[] = [
    { key: "request", header: "Request No.", cell: (r) => <span className="font-semibold text-navy">{r.requestNo}</span>, sortValue: (r) => r.requestNo, filter: { kind: "text", get: (r) => r.requestNo }, tdClassName: "whitespace-nowrap" },
    { key: "category", header: "Category", cell: (r) => categoryName(r), sortValue: (r) => categoryName(r), filter: { kind: "select", get: (r) => categoryName(r) }, tdClassName: "whitespace-nowrap" },
    { key: "items", header: "Items", cell: (r) => s.itemsForRequest(r.id).length, sortValue: (r) => s.itemsForRequest(r.id).length, filter: { kind: "number", get: (r) => s.itemsForRequest(r.id).length } },
    { key: "requester", header: "Requester", cell: (r) => requesterName(r), sortValue: (r) => requesterName(r), filter: { kind: "select", get: (r) => requesterName(r) }, tdClassName: "whitespace-nowrap" },
    { key: "created", header: "Created", cell: (r) => formatDate(r.createdAt), sortValue: (r) => r.createdAt, filter: { kind: "date", get: (r) => r.createdAt.slice(0, 10) }, tdClassName: "whitespace-nowrap" },
    {
      key: "status",
      header: "Status",
      cell: (r) => {
        const st = statusOf(r);
        return (
          <span title={lineSummary(r.id)}>
            {st ? <span className={lineBadge(st)}>{LINE_STATUS_LABEL[st]}</span> : <span className="text-grey-2">—</span>}
          </span>
        );
      },
      sortValue: (r) => statusLabel(r),
      filter: { kind: "select", get: (r) => statusLabel(r), options: STATUS_PRIORITY.map((st) => LINE_STATUS_LABEL[st]) },
      tdClassName: "whitespace-nowrap",
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[22px] font-bold text-navy">Purchase Requests</h1>
          <p className="text-[13.5px] text-grey-2 mt-1">Every request and where its items are in the pipeline.</p>
        </div>
        <Link to="/procurement/requests/new">
          <Button size="sm">+ New Request</Button>
        </Link>
      </div>

      <Card className="p-4">
        <QueueTable
          rows={rows}
          rowKey={(r) => r.id}
          columns={columns}
          groupBy={{ idOf: (r) => r.companyId, nameOf: companyName, allLabel: "All companies" }}
          rowsLabel="requests"
          emptyTitle="No requests"
          emptyMessage="Raise a purchase request to get started."
          actions={(r) => (
            <Link to={`/procurement/requests/${r.id}`} className="text-[12.5px] font-semibold text-orange hover:underline">View</Link>
          )}
        />
      </Card>
    </div>
  );
}
