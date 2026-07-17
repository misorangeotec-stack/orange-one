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
import DueCell, { overdueRowClass } from "@/shared/components/ui/DueCell";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import type { StageEntry } from "../../lib/queues";
import type { RequestItem } from "../../types";

/** Sourcing Stage — lines awaiting quotations (Stage 2), plus what's been sourced. */
export default function SourcingQueue() {
  const s = useProcurementStore();
  const { user } = useEffectiveIdentity();
  const [sourcing, setSourcing] = useState<RequestItem | null>(null);
  const [editLine, setEditLine] = useState<RequestItem | null>(null);
  const stage = useStageMode(s.completedSourcingEntries, user.id);

  const requestNo = (l: RequestItem) => s.requestById(l.requestId)?.requestNo ?? "—";
  const companyName = (id: string) => s.companyById(id)?.name ?? "—";
  const companyOf = (l: RequestItem) => s.requestById(l.requestId)?.companyId ?? null;
  /** Admin-configured: anchor step's completion + N working days (Setup → Due Dates). */
  const dueIso = (l: RequestItem) => s.dueIsoForLine(l, "sourcing");

  const completedColumns: QueueColumn<StageEntry<RequestItem>>[] = [
    { key: "request", header: "Request", cell: (e) => <Link to={`/procurement/requests/${e.row.requestId}`} className="font-semibold text-navy hover:text-orange">{e.ref}</Link>, sortValue: (e) => e.ref, filter: { kind: "text", get: (e) => e.ref }, tdClassName: "whitespace-nowrap" },
    { key: "item", header: "Item", cell: (e) => <span className="font-medium text-navy">{s.itemLabel(e.row.itemId)}</span>, sortValue: (e) => s.itemLabel(e.row.itemId), filter: { kind: "text", get: (e) => s.itemLabel(e.row.itemId) } },
    { key: "vendor", header: "Vendor", cell: (e) => s.vendorById(e.row.finalVendorId)?.name ?? "—", sortValue: (e) => s.vendorById(e.row.finalVendorId)?.name ?? "", filter: { kind: "select", get: (e) => s.vendorById(e.row.finalVendorId)?.name ?? "—" }, tdClassName: "whitespace-nowrap" },
    { key: "qty", header: "Final Qty", cell: (e) => <>{e.row.finalQty ?? "—"} {e.row.unit}</>, sortValue: (e) => e.row.finalQty ?? 0, tdClassName: "whitespace-nowrap" },
    { key: "value", header: "Line Value", cell: (e) => (e.row.lineValue !== null ? inr(e.row.lineValue) : "—"), sortValue: (e) => e.row.lineValue ?? 0, filter: { kind: "number", get: (e) => e.row.lineValue ?? 0 }, tdClassName: "whitespace-nowrap" },
    { key: "sourcedAt", header: "Sourced On", cell: (e) => formatDateTime(e.atIso), sortValue: (e) => e.atIso, filter: { kind: "date", get: (e) => e.atIso.slice(0, 10) }, tdClassName: "whitespace-nowrap" },
    {
      key: "sourcedBy", header: "By",
      cell: (e) => (e.actorId ? s.personName(e.actorId) : <span className="text-grey-2" title="Sourced before the app recorded who did it.">Not recorded</span>),
      sortValue: (e) => s.personName(e.actorId),
      filter: { kind: "select", get: (e) => (e.actorId ? s.personName(e.actorId) : "Not recorded") },
      tdClassName: "whitespace-nowrap",
    },
  ];

  const columns: QueueColumn<RequestItem>[] = [
    {
      key: "request", header: "Request", sortValue: (l) => requestNo(l), filter: { kind: "text", get: (l) => requestNo(l) }, tdClassName: "whitespace-nowrap",
      cell: (l) => {
        const req = s.requestById(l.requestId);
        return req ? <Link to={`/procurement/requests/${req.id}`} className="font-semibold text-navy hover:text-orange">{req.requestNo}</Link> : "—";
      },
    },
    { key: "item", header: "Item", cell: (l) => <span className="font-medium text-navy">{s.itemLabel(l.itemId)}</span>, sortValue: (l) => s.itemLabel(l.itemId), filter: { kind: "text", get: (l) => s.itemLabel(l.itemId) } },
    { key: "qty", header: "Qty", cell: (l) => <>{l.quantity} {l.unit}</>, sortValue: (l) => l.quantity, filter: { kind: "number", get: (l) => l.quantity }, tdClassName: "whitespace-nowrap" },
    { key: "created", header: "Created", cell: (l) => formatDate(l.createdAt), sortValue: (l) => l.createdAt, filter: { kind: "date", get: (l) => l.createdAt }, tdClassName: "whitespace-nowrap" },
    { key: "due", header: "Due", cell: (l) => <DueCell dueIso={dueIso(l)} />, sortValue: (l) => dueIso(l), filter: { kind: "date", get: (l) => dueIso(l) }, tdClassName: "whitespace-nowrap" },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Sourcing Stage</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          {stage.showingCompleted
            ? "Lines already sourced. Each stays editable until the approver decides."
            : "Lines awaiting quotations and a vendor recommendation."}
        </p>
      </div>

      <StageTabs
        mode={stage.mode}
        onMode={stage.setMode}
        pendingCount={s.sourcingQueue.length}
        completedCount={s.completedSourcingEntries.length}
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
            emptyMessage="Lines you source will appear here, and stay editable until the approver decides."
            actions={(e) =>
              // Re-sourcing IS the edit: save_sourcing already accepts an
              // undecided line and refuses a decided one, so there is no separate
              // update RPC for this step.
              e.lockReason ? (
                <span className="text-[12.5px] font-semibold text-grey-2 cursor-not-allowed inline-flex items-center gap-1" title={e.lockReason}>
                  <Lock className="w-3 h-3" aria-hidden /> Locked
                </span>
              ) : s.canSource ? (
                <button onClick={() => setEditLine(e.row)} className="text-[12.5px] font-semibold text-orange hover:underline">Edit</button>
              ) : (
                <span className="text-[12.5px] font-semibold text-grey-2 cursor-not-allowed inline-flex items-center gap-1" title="Only a Sourcing step owner can edit this entry.">
                  <Lock className="w-3 h-3" aria-hidden /> Locked
                </span>
              )
            }
          />
        ) : (
          <QueueTable
            rows={s.sourcingQueue}
            rowKey={(l) => l.id}
            columns={columns}
            groupBy={{ idOf: companyOf, nameOf: companyName, allLabel: "All companies" }}
            rowClassName={(l) => overdueRowClass(dueIso(l))}
            rowsLabel="lines"
            emptyTitle="Nothing to source"
            emptyMessage="New request lines will appear here."
            actions={
              s.canSource
                ? (l) => <button onClick={() => setSourcing(l)} className="text-[12.5px] font-semibold text-orange hover:underline">Source</button>
                : () => <span className="text-[12px] text-grey-2">—</span>
            }
          />
        )}
      </Card>

      <SourcingModal line={sourcing} open={sourcing !== null} onClose={() => setSourcing(null)} />
      <SourcingModal line={editLine} open={editLine !== null} onClose={() => setEditLine(null)} />
    </div>
  );
}
