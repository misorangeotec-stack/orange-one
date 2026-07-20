import { useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import { formatDate, formatDateTime } from "@/shared/lib/time";
import { useEffectiveIdentity } from "@/shared/sandbox/useEffectiveIdentity";
import StageTabs from "@/shared/components/ui/StageTabs";
import { useStageMode } from "@/shared/lib/useStageMode";
import { useImportStore } from "../../store";
import { inr, fxMoney, sumQty } from "../../lib/format";
import ApprovalModal from "../../components/ApprovalModal";
import QtyTotal from "../../components/QtyTotal";
import StageRowAction from "@/shared/components/ui/StageRowAction";
import { useEntryModal } from "@/shared/lib/useEntryModal";
import DueCell, { overdueRowClass } from "@/shared/components/ui/DueCell";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import type { StageEntry } from "../../lib/queues";
import type { PurchaseRequest, RequestItem } from "../../types";

/**
 * Approvals Stage — REQUISITIONS routed to me, plus the decisions already made.
 * One row per requisition: the band is picked on the requisition total, so the
 * whole thing is approved or rejected together. Open a row to see every item.
 */
export default function ApprovalsQueue() {
  const s = useImportStore();
  const { user } = useEffectiveIdentity();
  const [approving, setApproving] = useState<PurchaseRequest | null>(null);
  const editRequest = useEntryModal<PurchaseRequest>();
  const stage = useStageMode(s.completedApprovalRequestEntries, user.id);

  const companyName = (id: string) => s.companyById(id)?.name ?? "—";
  /** Admin-configured: anchor step's completion + N working days (Setup → Due Dates). */
  const dueIso = (r: PurchaseRequest) => s.dueIsoForApprovalRequest(r);

  /** Import has no vendor shortlist — the vendor rides on the line (finalVendorId). */
  const vendorOf = (r: PurchaseRequest) => {
    const vid = s.itemsForRequest(r.id).find((l) => l.finalVendorId)?.finalVendorId ?? null;
    return s.vendorById(vid)?.name ?? "—";
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

  /**
   * The requisition's total — qty × rate, no GST on an import line. Pending rows
   * band on the lines under decision; completed rows on all of them, so a row can
   * never disagree with the money that decided it.
   */
  const totalOf = (lines: RequestItem[]) =>
    Math.round(lines.reduce((sum, l) => sum + (l.lineValue ?? 0), 0) * 100) / 100;
  const totalFxOf = (lines: RequestItem[]) =>
    Math.round(lines.reduce((sum, l) => sum + (l.lineValueFx ?? 0), 0) * 100) / 100;
  const underDecision = (r: PurchaseRequest) =>
    s.itemsForRequest(r.id).filter((l) => l.status === "approval" || l.status === "on_hold");
  const pendingTotal = (r: PurchaseRequest) => totalOf(underDecision(r));
  const doneTotal = (r: PurchaseRequest) => totalOf(s.itemsForRequest(r.id));
  const pendingTotalFx = (r: PurchaseRequest) => totalFxOf(underDecision(r));
  const doneTotalFx = (r: PurchaseRequest) => totalFxOf(s.itemsForRequest(r.id));
  // Single currency per requisition (the vendor's).
  const currencyOf = (r: PurchaseRequest) => s.itemsForRequest(r.id).find((l) => l.currency)?.currency ?? null;
  // INR total on top (the approval basis), the vendor-currency total below it.
  const totalCell = (inrValue: number, fxValue: number, code: string | null) => (
    <div className="whitespace-nowrap">
      <div className="font-semibold text-navy">{inr(inrValue)}</div>
      <div className="text-[11.5px] text-grey-2">{fxMoney(fxValue, code)}</div>
    </div>
  );

  /**
   * How much is being bought. Quantity SUMS across items, carrying a unit only
   * when every item shares one; folding KGS and PCS into one number would be a
   * lie, so a mixed requisition says so and lists its units on hover (shared
   * `sumQty`/`QtyTotal`). Scoped to the same lines the money columns sum.
   */
  const qtyEntries = (lines: RequestItem[]) => lines.map((l) => ({ qty: l.finalQty ?? l.quantity, unit: l.unit }));
  const pendingQty = (r: PurchaseRequest) => sumQty(qtyEntries(underDecision(r)));
  const doneQty = (r: PurchaseRequest) => sumQty(qtyEntries(s.itemsForRequest(r.id)));

  const requestLink = (r: PurchaseRequest) => (
    <Link to={`/import/requests/${r.id}`} className="font-semibold text-navy hover:text-orange">
      {r.requestNo}
    </Link>
  );
  // Just the count — the item NAMES are deliberately not shown here. A
  // requisition can carry ten lines, and listing them clutters the row; open the
  // requisition (or Review) to see them. Search still matches names via itemsText.
  const itemsCell = (r: PurchaseRequest) => {
    const n = s.itemsForRequest(r.id).length;
    return <span className="font-medium text-navy">{n} item{n === 1 ? "" : "s"}</span>;
  };
  const itemsText = (r: PurchaseRequest) => s.itemsForRequest(r.id).map((l) => s.itemById(l.itemId)?.name ?? "").join(", ");

  const columns: QueueColumn<PurchaseRequest>[] = [
    { key: "request", header: "Request", cell: (r) => requestLink(r), sortValue: (r) => r.requestNo, filter: { kind: "text", get: (r) => r.requestNo }, tdClassName: "whitespace-nowrap" },
    { key: "items", header: "Items", cell: (r) => itemsCell(r), sortValue: (r) => s.itemsForRequest(r.id).length, filter: { kind: "text", get: (r) => itemsText(r) } },
    { key: "qty", header: "Total Qty", cell: (r) => <QtyTotal entries={qtyEntries(underDecision(r))} />, sortValue: (r) => pendingQty(r).total, filter: { kind: "number", get: (r) => pendingQty(r).total }, tdClassName: "whitespace-nowrap" },
    { key: "vendor", header: "Recommended Vendor", cell: (r) => vendorOf(r), sortValue: (r) => vendorOf(r), filter: { kind: "select", get: (r) => vendorOf(r) }, tdClassName: "whitespace-nowrap" },
    { key: "value", header: "Total", cell: (r) => totalCell(pendingTotal(r), pendingTotalFx(r), currencyOf(r)), sortValue: (r) => pendingTotal(r), filter: { kind: "number", get: (r) => pendingTotal(r) }, tdClassName: "whitespace-nowrap" },
    { key: "status", header: "Status", cell: (r) => <span className="text-[12.5px] text-grey">{statusText(r)}</span>, sortValue: (r) => statusText(r), filter: { kind: "select", get: (r) => statusText(r) }, tdClassName: "whitespace-nowrap" },
    { key: "created", header: "Created", cell: (r) => formatDate(r.createdAt), sortValue: (r) => r.createdAt, filter: { kind: "date", get: (r) => r.createdAt }, tdClassName: "whitespace-nowrap" },
    { key: "due", header: "Due", cell: (r) => <DueCell dueIso={dueIso(r)} />, sortValue: (r) => dueIso(r), filter: { kind: "date", get: (r) => dueIso(r) }, tdClassName: "whitespace-nowrap" },
  ];

  // A rejection is a completed decision too — exactly the kind of thing an
  // approver looks back at — so it appears here, locked (there is no un-reject).
  const completedColumns: QueueColumn<StageEntry<PurchaseRequest>>[] = [
    { key: "request", header: "Request", cell: (e) => requestLink(e.row), sortValue: (e) => e.ref, filter: { kind: "text", get: (e) => e.ref }, tdClassName: "whitespace-nowrap" },
    { key: "items", header: "Items", cell: (e) => itemsCell(e.row), sortValue: (e) => s.itemsForRequest(e.row.id).length, filter: { kind: "text", get: (e) => itemsText(e.row) } },
    { key: "qty", header: "Total Qty", cell: (e) => <QtyTotal entries={qtyEntries(s.itemsForRequest(e.row.id))} />, sortValue: (e) => doneQty(e.row).total, filter: { kind: "number", get: (e) => doneQty(e.row).total }, tdClassName: "whitespace-nowrap" },
    { key: "vendor", header: "Vendor", cell: (e) => vendorOf(e.row), sortValue: (e) => vendorOf(e.row), filter: { kind: "select", get: (e) => vendorOf(e.row) }, tdClassName: "whitespace-nowrap" },
    { key: "value", header: "Total", cell: (e) => totalCell(doneTotal(e.row), doneTotalFx(e.row), currencyOf(e.row)), sortValue: (e) => doneTotal(e.row), filter: { kind: "number", get: (e) => doneTotal(e.row) }, tdClassName: "whitespace-nowrap" },
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
            : "Requisitions awaiting your purchase approval — banded on the requisition total."}
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
            actions={(e) => (
              <StageRowAction
                lockReason={e.lockReason}
                canEdit={s.canApproveRequest(e.row)}
                permissionReason="Only this requisition's approver can revise the decision."
                onEdit={() => editRequest.openEdit(e.row)}
                onView={() => editRequest.openView(e.row)}
              />
            )}
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

      <ApprovalModal request={approving} open={approving !== null} onClose={() => setApproving(null)} />
      <ApprovalModal
        request={editRequest.row}
        open={editRequest.row !== null}
        editing
        readOnly={editRequest.isView}
        onClose={editRequest.close}
      />
    </div>
  );
}
