import { Link } from "react-router-dom";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import DueCell, { overdueRowClass } from "@/shared/components/ui/DueCell";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { useDispatchStore } from "../store";
import { openStep } from "../lib/queues";
import { stepByKey } from "../lib/steps";
import { DISPATCH_TYPE_LABEL, dmy, qtyTotals } from "../lib/format";
import StatusPill from "./StatusPill";
import type { DispatchOrder } from "../types";

/**
 * The all-orders table, shared by the full list and My Orders so the two cannot
 * drift. Every row's due date comes from the same `lib/queues.ts` the queues and
 * both Control Centers read.
 */
export default function OrdersTable({
  orders,
  exportName,
  emptyTitle,
  emptyMessage,
}: {
  orders: DispatchOrder[];
  exportName: string;
  emptyTitle: string;
  emptyMessage: string;
}) {
  const s = useDispatchStore();
  const today = todayLocalIso();
  const B = "/order-to-dispatch";

  const dueOf = (o: DispatchOrder): string | null => {
    const step = openStep(o);
    return step ? s.dueIsoFor(o, step) : null;
  };

  const stepLabel = (o: DispatchOrder): string => {
    if (o.status === "closed") return "Closed";
    if (o.status === "cancelled") return "Cancelled";
    if (o.status === "on_hold") return "On hold";
    return stepByKey(o.currentStep)?.short ?? "—";
  };

  const columns: QueueColumn<DispatchOrder>[] = [
    {
      key: "orderNo",
      header: "Order",
      cell: (o) => (
        <Link to={`${B}/orders/${o.id}`} className="font-semibold text-navy hover:text-orange">
          {o.orderNo}
        </Link>
      ),
      sortValue: (o) => o.orderNo,
      filter: { kind: "text", get: (o) => o.orderNo },
      exportValue: (o) => o.orderNo,
    },
    {
      key: "customer",
      header: "Customer",
      cell: (o) => <span className="text-navy">{s.customerName(o.customerId)}</span>,
      sortValue: (o) => s.customerName(o.customerId),
      filter: { kind: "select", get: (o) => s.customerName(o.customerId) },
    },
    {
      key: "type",
      header: "Type",
      cell: (o) => <span className="text-grey">{DISPATCH_TYPE_LABEL[o.dispatchType]}</span>,
      sortValue: (o) => o.dispatchType,
      filter: { kind: "select", get: (o) => DISPATCH_TYPE_LABEL[o.dispatchType] },
    },
    {
      key: "items",
      header: "Items",
      align: "right",
      cell: (o) => {
        const t = qtyTotals(o);
        return (
          <span className="text-grey whitespace-nowrap">
            {o.lines.length} · {t.pending || t.ordered}
          </span>
        );
      },
      sortValue: (o) => o.lines.length,
      exportValue: (o) => o.lines.length,
    },
    {
      key: "step",
      header: "Current step",
      cell: (o) => <span className="text-grey">{stepLabel(o)}</span>,
      sortValue: (o) => stepLabel(o),
      filter: { kind: "select", get: (o) => stepLabel(o) },
    },
    {
      key: "orderDate",
      header: "Order date",
      cell: (o) => <span className="text-grey whitespace-nowrap">{dmy(o.orderDate)}</span>,
      sortValue: (o) => o.orderDate,
      filter: { kind: "date", get: (o) => o.orderDate },
      exportValue: (o) => dmy(o.orderDate),
    },
    {
      // Replaces the old Promised / TAT column. A promised date is no longer
      // captured; what matters on a partial order is how much is still owed.
      key: "round",
      header: "Round",
      cell: (o) => (
        <span className="text-grey whitespace-nowrap">
          {o.rounds.length > 0 || o.roundNo > 1 ? `R${o.roundNo}` : "—"}
        </span>
      ),
      sortValue: (o) => o.roundNo,
      exportValue: (o) => o.roundNo,
    },
    {
      key: "pendingQty",
      header: "Pending",
      align: "right",
      cell: (o) => {
        const t = qtyTotals(o);
        return (
          <span className={t.pending > 0 ? "text-navy font-semibold tabular-nums" : "text-grey-2"}>
            {t.pending > 0 ? t.pending : "—"}
          </span>
        );
      },
      sortValue: (o) => qtyTotals(o).pending,
      exportValue: (o) => qtyTotals(o).pending,
    },
    {
      key: "due",
      header: "Step due",
      cell: (o) => <DueCell dueIso={dueOf(o)} />,
      sortValue: (o) => dueOf(o) ?? "9999-12-31",
      exportValue: (o) => { const d = dueOf(o); return d ? dmy(d) : ""; },
    },
    {
      key: "status",
      header: "Status",
      cell: (o) => <StatusPill status={o.status} />,
      sortValue: (o) => o.status,
      filter: { kind: "select", get: (o) => o.status },
    },
  ];

  return (
    <QueueTable<DispatchOrder>
      rows={orders}
      rowKey={(o) => o.id}
      columns={columns}
      groupBy={{
        idOf: (o) => o.customerId,
        nameOf: (id) => s.customerName(id),
        allLabel: "All customers",
        label: "Customer",
      }}
      actions={(o) => (
        <Link to={`${B}/orders/${o.id}`} className="text-[13px] font-semibold text-orange hover:underline">
          Open
        </Link>
      )}
      rowClassName={(o) => overdueRowClass(dueOf(o))}
      rowsLabel="orders"
      initialSort={{ key: "orderNo", dir: "desc" }}
      emptyTitle={emptyTitle}
      emptyMessage={emptyMessage}
      exportName={exportName}
    />
  );
}
