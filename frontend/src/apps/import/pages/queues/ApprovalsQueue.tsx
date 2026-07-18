import { useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import { formatDate, formatDateTime } from "@/shared/lib/time";
import { useEffectiveIdentity } from "@/shared/sandbox/useEffectiveIdentity";
import StageTabs from "@/shared/components/ui/StageTabs";
import { useStageMode } from "@/shared/lib/useStageMode";
import { useImportStore } from "../../store";
import { inr, lineBadge, LINE_STATUS_LABEL } from "../../lib/format";
import ApprovalModal from "../../components/ApprovalModal";
import StageRowAction from "@/shared/components/ui/StageRowAction";
import { useEntryModal } from "@/shared/lib/useEntryModal";
import DueCell, { overdueRowClass } from "@/shared/components/ui/DueCell";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import type { StageEntry } from "../../lib/queues";
import type { RequestItem } from "../../types";

/** Approvals Stage — lines routed to me, plus the decisions already made. */
export default function ApprovalsQueue() {
  const s = useImportStore();
  const { user } = useEffectiveIdentity();
  const [approving, setApproving] = useState<RequestItem | null>(null);
  const editLine = useEntryModal<RequestItem>();
  const stage = useStageMode(s.completedApprovalEntries, user.id);

  const requestNo = (l: RequestItem) => s.requestById(l.requestId)?.requestNo ?? "—";
  /**
   * How much is being bought — the Line Value column only shows the money side.
   * This queue is LINE-scoped, so there is nothing to sum and no mixed-unit
   * problem: it is simply the sourced qty (falling back to what was asked).
   */
  const qtyCell = (l: RequestItem) => (
    <span>
      {l.finalQty ?? l.quantity}
      {l.unit && <span className="ml-1 text-[11.5px] text-grey-2">{l.unit}</span>}
    </span>
  );
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
    { key: "qty", header: "Qty", cell: (l) => qtyCell(l), sortValue: (l) => l.finalQty ?? l.quantity, filter: { kind: "number", get: (l) => l.finalQty ?? l.quantity }, tdClassName: "whitespace-nowrap" },
    { key: "vendor", header: "Recommended Vendor", cell: (l) => vendorName(l), sortValue: (l) => vendorName(l), filter: { kind: "select", get: (l) => vendorName(l) }, tdClassName: "whitespace-nowrap" },
    { key: "value", header: "Line Value", cell: (l) => <span className="font-semibold text-navy">{inr(l.lineValue)}</span>, sortValue: (l) => l.lineValue ?? 0, filter: { kind: "number", get: (l) => l.lineValue ?? 0 }, tdClassName: "whitespace-nowrap" },
    { key: "status", header: "Status", cell: (l) => <span className={lineBadge(l.status)}>{LINE_STATUS_LABEL[l.status]}</span>, sortValue: (l) => LINE_STATUS_LABEL[l.status], filter: { kind: "select", get: (l) => LINE_STATUS_LABEL[l.status] } },
    { key: "created", header: "Created", cell: (l) => formatDate(l.createdAt), sortValue: (l) => l.createdAt, filter: { kind: "date", get: (l) => l.createdAt }, tdClassName: "whitespace-nowrap" },
    { key: "due", header: "Due", cell: (l) => <DueCell dueIso={dueIso(l)} />, sortValue: (l) => dueIso(l), filter: { kind: "date", get: (l) => dueIso(l) }, tdClassName: "whitespace-nowrap" },
  ];

  // A rejection is a completed decision too — exactly the kind of thing an
  // approver looks back at — so it appears here, locked (there is no un-reject).
  const completedColumns: QueueColumn<StageEntry<RequestItem>>[] = [
    { key: "request", header: "Request", cell: (e) => <Link to={`/import/requests/${e.row.requestId}`} className="font-semibold text-navy hover:text-orange">{e.ref}</Link>, sortValue: (e) => e.ref, filter: { kind: "text", get: (e) => e.ref }, tdClassName: "whitespace-nowrap" },
    { key: "item", header: "Item", cell: (e) => <span className="font-medium text-navy">{s.itemLabel(e.row.itemId)}</span>, sortValue: (e) => s.itemLabel(e.row.itemId), filter: { kind: "text", get: (e) => s.itemLabel(e.row.itemId) } },
    { key: "qty", header: "Qty", cell: (e) => qtyCell(e.row), sortValue: (e) => e.row.finalQty ?? e.row.quantity, filter: { kind: "number", get: (e) => e.row.finalQty ?? e.row.quantity }, tdClassName: "whitespace-nowrap" },
    { key: "vendor", header: "Vendor", cell: (e) => vendorName(e.row), sortValue: (e) => vendorName(e.row), filter: { kind: "select", get: (e) => vendorName(e.row) }, tdClassName: "whitespace-nowrap" },
    { key: "value", header: "Line Value", cell: (e) => <span className="font-semibold text-navy">{inr(e.row.lineValue)}</span>, sortValue: (e) => e.row.lineValue ?? 0, filter: { kind: "number", get: (e) => e.row.lineValue ?? 0 }, tdClassName: "whitespace-nowrap" },
    { key: "decision", header: "Decision", cell: (e) => <span className={lineBadge(e.row.status)}>{LINE_STATUS_LABEL[e.row.status]}</span>, sortValue: (e) => LINE_STATUS_LABEL[e.row.status], filter: { kind: "select", get: (e) => LINE_STATUS_LABEL[e.row.status] } },
    { key: "tier", header: "Tier", cell: (e) => e.row.approvalTier ?? "—", sortValue: (e) => e.row.approvalTier ?? "", filter: { kind: "select", get: (e) => e.row.approvalTier ?? "—" }, tdClassName: "whitespace-nowrap" },
    { key: "decidedAt", header: "Decided On", cell: (e) => formatDateTime(e.atIso), sortValue: (e) => e.atIso, filter: { kind: "date", get: (e) => e.atIso.slice(0, 10) }, tdClassName: "whitespace-nowrap" },
    {
      key: "decidedBy", header: "By",
      cell: (e) => (e.actorId ? s.personName(e.actorId) : <span className="text-grey-2">Not recorded</span>),
      sortValue: (e) => s.personName(e.actorId),
      filter: { kind: "select", get: (e) => (e.actorId ? s.personName(e.actorId) : "Not recorded") },
      tdClassName: "whitespace-nowrap",
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Approvals Stage</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          {stage.showingCompleted
            ? "Decisions already made. Each stays revisable until the PO is generated."
            : "Lines awaiting your purchase approval."}
        </p>
      </div>

      <StageTabs
        mode={stage.mode}
        onMode={stage.setMode}
        pendingCount={s.approvalQueue.length}
        completedCount={s.completedApprovalEntries.length}
        scope={stage.scope}
        onScope={stage.setScope}
        scopeNote={`Showing ${user.name}'s entries`}
      />

      <Card className="p-4">
        {stage.showingCompleted ? (
          <QueueTable
            rows={stage.rows}
            rowKey={(e) => e.id}
            columns={completedColumns}
            groupBy={{ idOf: (e) => e.companyId, nameOf: companyName, allLabel: "All companies" }}
            rowsLabel="lines"
            emptyTitle="Nothing here yet"
            emptyMessage="Decisions you make will appear here, and stay revisable until the PO is generated."
            actions={(e) => (
              <StageRowAction
                lockReason={e.lockReason}
                canEdit={s.canApproveLine(e.row)}
                permissionReason="Only this line's approver can revise the decision."
                onEdit={() => editLine.openEdit(e.row)}
                onView={() => editLine.openView(e.row)}
              />
            )}
          />
        ) : (
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
        )}
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
      <ApprovalModal
        line={editLine.row}
        open={editLine.row !== null}
        editing
        readOnly={editLine.isView}
        onClose={editLine.close}
      />
    </div>
  );
}
