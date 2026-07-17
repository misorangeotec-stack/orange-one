import { useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import { formatDate } from "@/shared/lib/time";
import { useImportStore } from "../../store";
import { inr, lineBadge, LINE_STATUS_LABEL } from "../../lib/format";
import ApprovalModal from "../../components/ApprovalModal";
import DueCell, { overdueRowClass } from "@/shared/components/ui/DueCell";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import type { RequestItem } from "../../types";

/** Approvals Queue — lines routed to me (or, for admins, all lines awaiting approval). */
export default function ApprovalsQueue() {
  const s = useImportStore();
  const [approving, setApproving] = useState<RequestItem | null>(null);

  const requestNo = (l: RequestItem) => s.requestById(l.requestId)?.requestNo ?? "—";
  const vendorName = (l: RequestItem) => s.vendorById(l.finalVendorId)?.name ?? "—";
  const companyName = (id: string) => s.companyById(id)?.name ?? "—";
  const companyOf = (l: RequestItem) => s.requestById(l.requestId)?.companyId ?? null;
  /** Admin-configured: anchor step's completion + N working days (Setup → Due Dates). */
  const dueIso = (l: RequestItem) => s.dueIsoForLine(l, "approval");

  const columns: QueueColumn<RequestItem>[] = [
    {
      key: "request", header: "Request", sortValue: (l) => requestNo(l), filter: { kind: "text", get: (l) => requestNo(l) }, tdClassName: "whitespace-nowrap",
      cell: (l) => {
        const req = s.requestById(l.requestId);
        return req ? <Link to={`/import/requests/${req.id}`} className="font-semibold text-navy hover:text-orange">{req.requestNo}</Link> : "—";
      },
    },
    { key: "item", header: "Item", cell: (l) => <span className="font-medium text-navy">{s.itemLabel(l.itemId)}</span>, sortValue: (l) => s.itemLabel(l.itemId), filter: { kind: "text", get: (l) => s.itemLabel(l.itemId) } },
    { key: "vendor", header: "Recommended Vendor", cell: (l) => vendorName(l), sortValue: (l) => vendorName(l), filter: { kind: "select", get: (l) => vendorName(l) }, tdClassName: "whitespace-nowrap" },
    { key: "value", header: "Line Value", cell: (l) => <span className="font-semibold text-navy">{inr(l.lineValue)}</span>, sortValue: (l) => l.lineValue ?? 0, filter: { kind: "number", get: (l) => l.lineValue ?? 0 }, tdClassName: "whitespace-nowrap" },
    { key: "status", header: "Status", cell: (l) => <span className={lineBadge(l.status)}>{LINE_STATUS_LABEL[l.status]}</span>, sortValue: (l) => LINE_STATUS_LABEL[l.status], filter: { kind: "select", get: (l) => LINE_STATUS_LABEL[l.status] } },
    { key: "created", header: "Created", cell: (l) => formatDate(l.createdAt), sortValue: (l) => l.createdAt, filter: { kind: "date", get: (l) => l.createdAt }, tdClassName: "whitespace-nowrap" },
    { key: "due", header: "Due", cell: (l) => <DueCell dueIso={dueIso(l)} />, sortValue: (l) => dueIso(l), filter: { kind: "date", get: (l) => dueIso(l) }, tdClassName: "whitespace-nowrap" },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Approvals Queue</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">Sourced lines awaiting your vendor-price approval.</p>
      </div>

      <Card className="p-4">
        <QueueTable
          rows={s.approvalQueue}
          rowKey={(l) => l.id}
          columns={columns}
          groupBy={{ idOf: companyOf, nameOf: companyName, allLabel: "All companies" }}
          rowClassName={(l) => overdueRowClass(dueIso(l))}
          rowsLabel="lines"
          emptyTitle="Nothing to approve"
          emptyMessage="Lines routed to you will appear here."
          initialSort={{ key: "value", dir: "desc" }}
          actions={(l) => (
            <button onClick={() => setApproving(l)} className="text-[12.5px] font-semibold text-orange hover:underline">Review</button>
          )}
        />
      </Card>

      {s.pendingPoCancelRequests.length > 0 && (
        <div>
          <h2 className="text-[16px] font-bold text-navy">PO cancellation requests</h2>
          <p className="text-[13px] text-grey-2 mt-0.5 mb-2.5">Vendor-requested PO cancellations awaiting your decision.</p>
          <Card className="overflow-hidden">
            <table className="w-full text-[13.5px]">
              <thead><tr className="text-left text-grey-2 border-b border-line"><th className="font-medium px-4 py-3 w-px whitespace-nowrap">Actions</th><th className="font-medium px-4 py-3">PO</th><th className="font-medium px-4 py-3">Requested by</th><th className="font-medium px-4 py-3">Reason</th><th className="font-medium px-4 py-3">Requested</th></tr></thead>
              <tbody>
                {s.pendingPoCancelRequests.map((r) => {
                  const po = s.poById(r.poId);
                  return (
                    <tr key={r.id} className="border-b border-line/70 last:border-0 hover:bg-page/60">
                      <td className="px-4 py-3 whitespace-nowrap"><Link to={`/import/pos/${r.poId}`} className="text-[12.5px] font-semibold text-orange hover:underline">Review PO →</Link></td>
                      <td className="px-4 py-3 font-semibold text-navy whitespace-nowrap">{po?.poNo ?? "—"}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{r.requestedBy ? s.profileById(r.requestedBy)?.name ?? "—" : "—"}</td>
                      <td className="px-4 py-3 text-navy min-w-[180px] max-w-[360px]"><span title={r.reason}>{r.reason}</span>{r.vendorRef ? <span className="text-grey-2"> · {r.vendorRef}</span> : null}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{formatDate(r.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      <ApprovalModal line={approving} open={approving !== null} onClose={() => setApproving(null)} />
    </div>
  );
}
