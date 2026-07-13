import { useMemo } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import { useProcurementStore } from "../../store";
import { inr, poStageBadge, PO_STAGE_LABEL } from "../../lib/format";
import { stepByKey } from "../../lib/steps";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import type { PurchaseOrder } from "../../types";

/** Purchase Orders list — same queue-style per-column filters, grouped by company. */
export default function PoList() {
  const s = useProcurementStore();

  const rows = useMemo(() => [...s.pos].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [s.pos]);

  const companyName = (id: string) => {
    const co = s.companyById(id);
    return co ? (co.location ? `${co.name} — ${co.location}` : co.name) : "—";
  };
  const vendorName = (p: PurchaseOrder) => s.vendorById(p.vendorId)?.name ?? "—";
  const stageLabel = (p: PurchaseOrder) => PO_STAGE_LABEL[p.currentStage] ?? stepByKey(p.currentStage)?.short ?? p.currentStage;

  const columns: QueueColumn<PurchaseOrder>[] = [
    { key: "po", header: "PO No.", cell: (p) => <span className="font-semibold text-navy">{p.poNo}</span>, sortValue: (p) => p.poNo, filter: { kind: "text", get: (p) => p.poNo }, tdClassName: "whitespace-nowrap" },
    { key: "vendor", header: "Vendor", cell: (p) => vendorName(p), sortValue: (p) => vendorName(p), filter: { kind: "select", get: (p) => vendorName(p) }, tdClassName: "whitespace-nowrap" },
    { key: "items", header: "Items", cell: (p) => s.poItemsForPo(p.id).length, sortValue: (p) => s.poItemsForPo(p.id).length, filter: { kind: "number", get: (p) => s.poItemsForPo(p.id).length } },
    { key: "value", header: "Value", cell: (p) => inr(p.totalValue), sortValue: (p) => p.totalValue, filter: { kind: "number", get: (p) => p.totalValue }, tdClassName: "whitespace-nowrap" },
    { key: "advance", header: "Advance", cell: (p) => inr(p.advancePaid), sortValue: (p) => p.advancePaid, filter: { kind: "number", get: (p) => p.advancePaid }, tdClassName: "whitespace-nowrap" },
    { key: "pending", header: "Pending", cell: (p) => inr(s.pendingAmount(p)), sortValue: (p) => s.pendingAmount(p), filter: { kind: "number", get: (p) => s.pendingAmount(p) }, tdClassName: "whitespace-nowrap" },
    { key: "stage", header: "Stage", cell: (p) => <span className={poStageBadge(p.currentStage)}>{stageLabel(p)}</span>, sortValue: (p) => stageLabel(p), filter: { kind: "select", get: (p) => stageLabel(p) }, tdClassName: "whitespace-nowrap" },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Purchase Orders</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">Vendor-wise POs and where each is in its lifecycle.</p>
      </div>

      <Card className="p-4">
        <QueueTable
          rows={rows}
          rowKey={(p) => p.id}
          columns={columns}
          groupBy={{ idOf: (p) => p.companyId, nameOf: companyName, allLabel: "All companies" }}
          rowsLabel="POs"
          emptyTitle="No purchase orders yet"
          emptyMessage="Generate POs from the PO Workbench."
          actions={(p) => (
            <Link to={`/procurement/pos/${p.id}`} className="text-[12.5px] font-semibold text-orange hover:underline">View</Link>
          )}
        />
      </Card>
    </div>
  );
}
