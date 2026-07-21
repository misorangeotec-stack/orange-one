import { useState } from "react";
import { Link } from "react-router-dom";
import { Lock } from "lucide-react";
import Card from "@/shared/components/ui/Card";
import { formatDate, formatDateTime } from "@/shared/lib/time";
import { useEffectiveIdentity } from "@/shared/sandbox/useEffectiveIdentity";
import StageTabs from "@/shared/components/ui/StageTabs";
import { useStageMode } from "@/shared/lib/useStageMode";
import { useProcurementStore } from "../../store";
import { inr } from "../../lib/format";
import SourcingModal from "../../components/SourcingModal";
import StageRowAction from "@/shared/components/ui/StageRowAction";
import { useEntryModal } from "@/shared/lib/useEntryModal";
import DueCell, { overdueRowClass } from "@/shared/components/ui/DueCell";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import type { StageEntry } from "../../lib/queues";
import type { PurchaseRequest } from "../../types";

/**
 * Sourcing Stage — REQUISITIONS awaiting quotations (Stage 2), plus what's been
 * sourced. One row per requisition, not one per item: a 7-item requisition is a
 * single piece of work with a single vendor shortlist.
 */
export default function SourcingQueue() {
  const s = useProcurementStore();
  const { user } = useEffectiveIdentity();
  const [sourcing, setSourcing] = useState<PurchaseRequest | null>(null);
  const editRequest = useEntryModal<PurchaseRequest>();
  const stage = useStageMode(s.completedSourcingRequestEntries, user.id);

  const companyName = (id: string) => s.companyById(id)?.name ?? "—";
  /** Admin-configured: anchor step's completion + N working days (Setup → Due Dates). */
  const dueIso = (r: PurchaseRequest) => s.dueIsoForRequest(r, "sourcing");

  /** "3 items" plus the first couple of NAMES (no group — it only added noise). */
  const itemSummary = (r: PurchaseRequest) => {
    const lines = s.itemsForRequest(r.id);
    const names = lines.slice(0, 2).map((l) => s.itemById(l.itemId)?.name ?? "—");
    const rest = lines.length - names.length;
    return { count: lines.length, text: names.join(", ") + (rest > 0 ? ` +${rest} more` : "") };
  };
  const totalQty = (r: PurchaseRequest) =>
    s.itemsForRequest(r.id).reduce((sum, l) => sum + (l.finalQty ?? l.quantity), 0);
  /**
   * The quantity column SUMS across items, so it can only carry a unit when every
   * item shares one. Mixing KGS and PCS into "2500 KGS" would be a plain lie, so
   * a mixed requisition says so and lists the units on hover.
   */
  const qtyUnit = (r: PurchaseRequest) => {
    const units = [...new Set(s.itemsForRequest(r.id).map((l) => l.unit).filter(Boolean))];
    if (units.length === 1) return { label: units[0], title: undefined as string | undefined };
    if (units.length === 0) return { label: "", title: undefined };
    return { label: "mixed", title: `Different units on this requisition: ${units.join(", ")}` };
  };
  const sourcedValue = (r: PurchaseRequest) =>
    s.itemsForRequest(r.id).reduce((sum, l) => sum + (l.lineValue ?? 0), 0);
  const vendorOf = (r: PurchaseRequest) => {
    const rec = s.vendorsForRequest(r.id).find((v) => v.isRecommended)?.vendorId;
    const fallback = s.itemsForRequest(r.id).find((l) => l.finalVendorId)?.finalVendorId ?? null;
    return s.vendorById(rec ?? fallback)?.name ?? "—";
  };

  const requestLink = (r: PurchaseRequest) => (
    <Link to={`/procurement/requests/${r.id}`} className="font-semibold text-navy hover:text-orange">
      {r.requestNo}
    </Link>
  );

  const completedColumns: QueueColumn<StageEntry<PurchaseRequest>>[] = [
    { key: "request", header: "Request", cell: (e) => requestLink(e.row), sortValue: (e) => e.ref, filter: { kind: "text", get: (e) => e.ref }, tdClassName: "whitespace-nowrap" },
    {
      key: "items", header: "Items",
      cell: (e) => {
        const { count, text } = itemSummary(e.row);
        return (
          <div className="min-w-0">
            <span className="font-medium text-navy">{count} item{count === 1 ? "" : "s"}</span>
            <span className="ml-1.5 text-[11.5px] text-grey-2">{text}</span>
          </div>
        );
      },
      sortValue: (e) => itemSummary(e.row).count,
      filter: { kind: "text", get: (e) => itemSummary(e.row).text },
    },
    { key: "vendor", header: "Vendor", cell: (e) => vendorOf(e.row), sortValue: (e) => vendorOf(e.row), filter: { kind: "select", get: (e) => vendorOf(e.row) }, tdClassName: "whitespace-nowrap" },
    {
      key: "qty", header: "Total Qty",
      cell: (e) => {
        const u = qtyUnit(e.row);
        return (
          <span title={u.title}>
            {totalQty(e.row)}
            {u.label && <span className="ml-1 text-[11.5px] text-grey-2">{u.label}</span>}
          </span>
        );
      },
      sortValue: (e) => totalQty(e.row), filter: { kind: "number", get: (e) => totalQty(e.row) }, tdClassName: "whitespace-nowrap",
    },
    { key: "value", header: "Request Value", cell: (e) => inr(sourcedValue(e.row)), sortValue: (e) => sourcedValue(e.row), filter: { kind: "number", get: (e) => sourcedValue(e.row) }, tdClassName: "whitespace-nowrap" },
    { key: "sourcedAt", header: "Sourced On", cell: (e) => formatDateTime(e.atIso), sortValue: (e) => e.atIso, filter: { kind: "date", get: (e) => e.atIso.slice(0, 10) }, tdClassName: "whitespace-nowrap" },
    {
      key: "sourcedBy", header: "By",
      cell: (e) => (e.actorId ? s.personName(e.actorId) : <span className="text-grey-2" title="Sourced before the app recorded who did it.">Not recorded</span>),
      sortValue: (e) => s.personName(e.actorId),
      filter: { kind: "select", get: (e) => (e.actorId ? s.personName(e.actorId) : "Not recorded") },
      tdClassName: "whitespace-nowrap",
    },
  ];

  const columns: QueueColumn<PurchaseRequest>[] = [
    { key: "request", header: "Request", cell: (r) => requestLink(r), sortValue: (r) => r.requestNo, filter: { kind: "text", get: (r) => r.requestNo }, tdClassName: "whitespace-nowrap" },
    {
      key: "items", header: "Items",
      cell: (r) => {
        const { count, text } = itemSummary(r);
        return (
          <div className="min-w-0">
            <span className="font-medium text-navy">{count} item{count === 1 ? "" : "s"}</span>
            <span className="ml-1.5 text-[11.5px] text-grey-2">{text}</span>
          </div>
        );
      },
      sortValue: (r) => itemSummary(r).count,
      filter: { kind: "text", get: (r) => itemSummary(r).text },
    },
    {
      key: "qty", header: "Total Qty",
      cell: (r) => {
        const u = qtyUnit(r);
        return (
          <span title={u.title}>
            {totalQty(r)}
            {u.label && <span className="ml-1 text-[11.5px] text-grey-2">{u.label}</span>}
          </span>
        );
      },
      sortValue: (r) => totalQty(r), filter: { kind: "number", get: (r) => totalQty(r) }, tdClassName: "whitespace-nowrap",
    },
    { key: "created", header: "Created", cell: (r) => formatDate(r.createdAt), sortValue: (r) => r.createdAt, filter: { kind: "date", get: (r) => r.createdAt }, tdClassName: "whitespace-nowrap" },
    { key: "due", header: "Due", cell: (r) => <DueCell dueIso={dueIso(r)} />, sortValue: (r) => dueIso(r), filter: { kind: "date", get: (r) => dueIso(r) }, tdClassName: "whitespace-nowrap" },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Sourcing Stage</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          {stage.showingCompleted
            ? "Requisitions already sourced. Each stays editable until the approver decides."
            : "Requisitions awaiting a vendor shortlist and rates."}
        </p>
      </div>

      <StageTabs
        mode={stage.mode}
        onMode={stage.setMode}
        pendingCount={s.sourcingRequestQueue.length}
        completedCount={s.completedSourcingRequestEntries.length}
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
            emptyMessage="Requisitions you source will appear here, and stay editable until the approver decides."
            actions={(e) => (
              // Re-sourcing IS the edit: save_sourcing_request already accepts an
              // undecided requisition and refuses a decided one, so there is no
              // separate update RPC for this step.
              <StageRowAction
                lockReason={e.lockReason}
                canEdit={s.canSource}
                permissionReason="Only a Sourcing step owner can edit this entry."
                onEdit={() => editRequest.openEdit(e.row)}
                onView={() => editRequest.openView(e.row)}
              />
            )}
          />
        ) : (
          <QueueTable
            rows={s.sourcingRequestQueue}
            rowKey={(r) => r.id}
            columns={columns}
            groupBy={{ idOf: (r) => r.companyId, nameOf: companyName, allLabel: "All companies" }}
            rowClassName={(r) => overdueRowClass(dueIso(r))}
            rowsLabel="requests"
            emptyTitle="Nothing to source"
            emptyMessage="New requisitions will appear here."
            actions={
              s.canSource
                ? (r) => <button onClick={() => setSourcing(r)} className="text-[12.5px] font-semibold text-orange hover:underline">Source</button>
                : () => <span className="text-[12px] text-grey-2">—</span>
            }
          />
        )}
      </Card>

      <SourcingModal request={sourcing} open={sourcing !== null} onClose={() => setSourcing(null)} />
      <SourcingModal
        request={editRequest.row}
        open={editRequest.row !== null}
        readOnly={editRequest.isView}
        onClose={editRequest.close}
      />
    </div>
  );
}
