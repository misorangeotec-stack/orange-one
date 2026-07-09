import { useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import { formatDate } from "@/shared/lib/time";
import { useProcurementStore } from "../../store";
import SourcingModal from "../../components/SourcingModal";
import DueCell, { overdueRowClass } from "../../components/DueCell";
import QueueTable, { type QueueColumn } from "../../components/QueueTable";
import type { RequestItem } from "../../types";

/** Sourcing Queue — lines awaiting quotations (Stage 2). */
export default function SourcingQueue() {
  const s = useProcurementStore();
  const [sourcing, setSourcing] = useState<RequestItem | null>(null);

  const requestNo = (l: RequestItem) => s.requestById(l.requestId)?.requestNo ?? "—";
  const companyName = (id: string) => s.companyById(id)?.name ?? "—";
  const companyOf = (l: RequestItem) => s.requestById(l.requestId)?.companyId ?? null;
  /** Admin-configured: anchor step's completion + N working days (Setup → Due Dates). */
  const dueIso = (l: RequestItem) => s.dueIsoForLine(l, "sourcing");

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
        <h1 className="text-[22px] font-bold text-navy">Sourcing Queue</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">Lines awaiting quotations and a vendor recommendation.</p>
      </div>

      <Card className="p-4">
        <QueueTable
          rows={s.sourcingQueue}
          rowKey={(l) => l.id}
          columns={columns}
          companyIdOf={companyOf}
          companyNameOf={companyName}
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
      </Card>

      <SourcingModal line={sourcing} open={sourcing !== null} onClose={() => setSourcing(null)} />
    </div>
  );
}
