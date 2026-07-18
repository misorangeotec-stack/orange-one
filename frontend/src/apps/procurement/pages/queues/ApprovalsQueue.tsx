import { useState } from "react";
import { Link } from "react-router-dom";
import { Lock } from "lucide-react";
import Card from "@/shared/components/ui/Card";
import { formatDate, formatDateTime } from "@/shared/lib/time";
import { useEffectiveIdentity } from "@/shared/sandbox/useEffectiveIdentity";
import StageTabs from "@/shared/components/ui/StageTabs";
import { useStageMode } from "@/shared/lib/useStageMode";
import { useProcurementStore } from "../../store";
import { inr, lineBadge, LINE_STATUS_LABEL } from "../../lib/format";
import ApprovalModal from "../../components/ApprovalModal";
import DueCell, { overdueRowClass } from "@/shared/components/ui/DueCell";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import type { StageEntry } from "../../lib/queues";
import type { PurchaseRequest, RequestItem } from "../../types";

/**
 * Approvals Stage — REQUISITIONS routed to me, plus the decisions already made.
 * One row per requisition: the band is picked on the requisition total, so the
 * whole thing is approved or rejected together.
 */
export default function ApprovalsQueue() {
  const s = useProcurementStore();
  const { user } = useEffectiveIdentity();
  const [approving, setApproving] = useState<PurchaseRequest | null>(null);
  const [editRequest, setEditRequest] = useState<PurchaseRequest | null>(null);
  const stage = useStageMode(s.completedApprovalRequestEntries, user.id);

  const companyName = (id: string) => s.companyById(id)?.name ?? "—";
  /** Admin-configured: anchor step's completion + N working days (Setup → Due Dates). */
  const dueIso = (r: PurchaseRequest) => s.dueIsoForRequest(r, "approval");

  const vendorOf = (r: PurchaseRequest) => {
    const rec = s.vendorsForRequest(r.id).find((v) => v.isRecommended)?.vendorId;
    const fallback = s.itemsForRequest(r.id).find((l) => l.finalVendorId)?.finalVendorId ?? null;
    return s.vendorById(rec ?? fallback)?.name ?? "—";
  };
  const itemCount = (r: PurchaseRequest, match: (l: RequestItem) => boolean) =>
    s.itemsForRequest(r.id).filter(match).length;
  /** Lines on one requisition can differ, so the status cell is a rollup. */
  const statusText = (r: PurchaseRequest) => {
    const waiting = itemCount(r, (l) => l.status === "approval");
    const held = itemCount(r, (l) => l.status === "on_hold");
    return [waiting ? `${waiting} awaiting` : "", held ? `${held} on hold` : ""].filter(Boolean).join(" · ") || "—";
  };
  const decisionText = (r: PurchaseRequest) => {
    const approved = itemCount(r, (l) => l.status === "approved_pending_po" || l.status === "po");
    const rejected = itemCount(r, (l) => l.status === "rejected");
    return [approved ? `${approved} approved` : "", rejected ? `${rejected} rejected` : ""].filter(Boolean).join(" · ") || "—";
  };
  const tierOf = (r: PurchaseRequest) => s.itemsForRequest(r.id).find((l) => l.approvalTier)?.approvalTier ?? "—";
  const decidedValue = (r: PurchaseRequest) =>
    s.itemsForRequest(r.id).reduce((sum, l) => sum + (l.lineValue ?? 0), 0);

  /**
   * Base (qty × rate, pre-GST) and the GST on it. GST is derived from the total
   * rather than summed separately, so the three figures can never disagree.
   * `total` is the figure the approval band is picked on.
   */
  const money = (r: PurchaseRequest, lines: RequestItem[]) => {
    void r;
    const total = Math.round(lines.reduce((sum, l) => sum + (l.lineValue ?? 0), 0) * 100) / 100;
    const base = Math.round(lines.reduce((sum, l) => sum + (l.finalQty ?? 0) * (l.finalRate ?? 0), 0) * 100) / 100;
    return { base, gst: Math.round((total - base) * 100) / 100, total };
  };
  /** Pending rows band on the lines under decision; completed rows on all of them. */
  const pendingMoney = (r: PurchaseRequest) =>
    money(r, s.itemsForRequest(r.id).filter((l) => l.status === "approval" || l.status === "on_hold"));
  const doneMoney = (r: PurchaseRequest) => money(r, s.itemsForRequest(r.id));

  const requestLink = (r: PurchaseRequest) => (
    <Link to={`/procurement/requests/${r.id}`} className="font-semibold text-navy hover:text-orange">
      {r.requestNo}
    </Link>
  );
  const itemsCell = (r: PurchaseRequest) => {
    const lines = s.itemsForRequest(r.id);
    const names = lines.slice(0, 2).map((l) => s.itemById(l.itemId)?.name ?? "—");
    const rest = lines.length - names.length;
    return (
      <div className="min-w-0">
        <span className="font-medium text-navy">{lines.length} item{lines.length === 1 ? "" : "s"}</span>
        <span className="ml-1.5 text-[11.5px] text-grey-2">{names.join(", ")}{rest > 0 ? ` +${rest} more` : ""}</span>
      </div>
    );
  };
  const itemsText = (r: PurchaseRequest) => s.itemsForRequest(r.id).map((l) => s.itemById(l.itemId)?.name ?? "").join(", ");

  const columns: QueueColumn<PurchaseRequest>[] = [
    { key: "request", header: "Request", cell: (r) => requestLink(r), sortValue: (r) => r.requestNo, filter: { kind: "text", get: (r) => r.requestNo }, tdClassName: "whitespace-nowrap" },
    { key: "items", header: "Items", cell: (r) => itemsCell(r), sortValue: (r) => s.itemsForRequest(r.id).length, filter: { kind: "text", get: (r) => itemsText(r) } },
    { key: "vendor", header: "Recommended Vendor", cell: (r) => vendorOf(r), sortValue: (r) => vendorOf(r), filter: { kind: "select", get: (r) => vendorOf(r) }, tdClassName: "whitespace-nowrap" },
    { key: "base", header: "Base", cell: (r) => inr(pendingMoney(r).base), sortValue: (r) => pendingMoney(r).base, filter: { kind: "number", get: (r) => pendingMoney(r).base }, tdClassName: "whitespace-nowrap" },
    { key: "gst", header: "GST", cell: (r) => inr(pendingMoney(r).gst), sortValue: (r) => pendingMoney(r).gst, filter: { kind: "number", get: (r) => pendingMoney(r).gst }, tdClassName: "whitespace-nowrap" },
    { key: "value", header: "Total", cell: (r) => <span className="font-semibold text-navy">{inr(pendingMoney(r).total)}</span>, sortValue: (r) => pendingMoney(r).total, filter: { kind: "number", get: (r) => pendingMoney(r).total }, tdClassName: "whitespace-nowrap" },
    { key: "status", header: "Status", cell: (r) => <span className="text-[12.5px] text-grey">{statusText(r)}</span>, sortValue: (r) => statusText(r), filter: { kind: "select", get: (r) => statusText(r) }, tdClassName: "whitespace-nowrap" },
    { key: "created", header: "Created", cell: (r) => formatDate(r.createdAt), sortValue: (r) => r.createdAt, filter: { kind: "date", get: (r) => r.createdAt }, tdClassName: "whitespace-nowrap" },
    { key: "due", header: "Due", cell: (r) => <DueCell dueIso={dueIso(r)} />, sortValue: (r) => dueIso(r), filter: { kind: "date", get: (r) => dueIso(r) }, tdClassName: "whitespace-nowrap" },
  ];

  // A rejection is a completed decision too — exactly the kind of thing an
  // approver looks back at — so it appears here, locked (there is no un-reject).
  const completedColumns: QueueColumn<StageEntry<PurchaseRequest>>[] = [
    { key: "request", header: "Request", cell: (e) => requestLink(e.row), sortValue: (e) => e.ref, filter: { kind: "text", get: (e) => e.ref }, tdClassName: "whitespace-nowrap" },
    { key: "items", header: "Items", cell: (e) => itemsCell(e.row), sortValue: (e) => s.itemsForRequest(e.row.id).length, filter: { kind: "text", get: (e) => itemsText(e.row) } },
    { key: "vendor", header: "Vendor", cell: (e) => vendorOf(e.row), sortValue: (e) => vendorOf(e.row), filter: { kind: "select", get: (e) => vendorOf(e.row) }, tdClassName: "whitespace-nowrap" },
    { key: "base", header: "Base", cell: (e) => inr(doneMoney(e.row).base), sortValue: (e) => doneMoney(e.row).base, filter: { kind: "number", get: (e) => doneMoney(e.row).base }, tdClassName: "whitespace-nowrap" },
    { key: "gst", header: "GST", cell: (e) => inr(doneMoney(e.row).gst), sortValue: (e) => doneMoney(e.row).gst, filter: { kind: "number", get: (e) => doneMoney(e.row).gst }, tdClassName: "whitespace-nowrap" },
    { key: "value", header: "Total", cell: (e) => <span className="font-semibold text-navy">{inr(decidedValue(e.row))}</span>, sortValue: (e) => decidedValue(e.row), filter: { kind: "number", get: (e) => decidedValue(e.row) }, tdClassName: "whitespace-nowrap" },
    { key: "decision", header: "Decision", cell: (e) => <span className="text-[12.5px] text-grey">{decisionText(e.row)}</span>, sortValue: (e) => decisionText(e.row), filter: { kind: "select", get: (e) => decisionText(e.row) }, tdClassName: "whitespace-nowrap" },
    { key: "tier", header: "Tier", cell: (e) => tierOf(e.row), sortValue: (e) => tierOf(e.row), filter: { kind: "select", get: (e) => tierOf(e.row) }, tdClassName: "whitespace-nowrap" },
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
            : "Sourced requisitions awaiting your vendor-price approval — banded on the requisition total."}
        </p>
      </div>

      <StageTabs
        mode={stage.mode}
        onMode={stage.setMode}
        pendingCount={s.approvalRequestQueue.length}
        completedCount={s.completedApprovalRequestEntries.length}
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
            rowsLabel="requests"
            emptyTitle="Nothing here yet"
            emptyMessage="Decisions you make will appear here, and stay revisable until the PO is generated."
            actions={(e) =>
              e.lockReason ? (
                <span className="text-[12.5px] font-semibold text-grey-2 cursor-not-allowed inline-flex items-center gap-1" title={e.lockReason}>
                  <Lock className="w-3 h-3" aria-hidden /> Locked
                </span>
              ) : s.canApproveRequest(e.row) ? (
                <button onClick={() => setEditRequest(e.row)} className="text-[12.5px] font-semibold text-orange hover:underline">Edit</button>
              ) : (
                <span className="text-[12.5px] font-semibold text-grey-2 cursor-not-allowed inline-flex items-center gap-1" title="Only this requisition's approver can revise the decision.">
                  <Lock className="w-3 h-3" aria-hidden /> Locked
                </span>
              )
            }
          />
        ) : (
          <QueueTable
            rows={s.approvalRequestQueue}
            rowKey={(r) => r.id}
            columns={columns}
            groupBy={{ idOf: (r) => r.companyId, nameOf: companyName, allLabel: "All companies" }}
            rowClassName={(r) => overdueRowClass(dueIso(r))}
            rowsLabel="requests"
            emptyTitle="Nothing to approve"
            emptyMessage="Requisitions routed to you will appear here."
            initialSort={{ key: "value", dir: "desc" }}
            actions={(r) => (
              <button onClick={() => setApproving(r)} className="text-[12.5px] font-semibold text-orange hover:underline">Review</button>
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
                      <td className="px-4 py-3 whitespace-nowrap"><Link to={`/procurement/pos/${r.poId}`} className="text-[12.5px] font-semibold text-orange hover:underline">Review PO →</Link></td>
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

      <ApprovalModal request={approving} open={approving !== null} onClose={() => setApproving(null)} />
      <ApprovalModal request={editRequest} open={editRequest !== null} editing onClose={() => setEditRequest(null)} />
    </div>
  );
}
