import { Link } from "react-router-dom";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { useDispatchStore } from "../store";
import { stepByKey } from "../lib/steps";
import { dmy, qtyTotals } from "../lib/format";
import StatusPill from "./StatusPill";
import type { DispatchOrder } from "../types";

/**
 * The all-orders table, shared by the full list and My Orders so the two cannot
 * drift.
 *
 * The shape follows the purchase-request lists: identity · counterparty · items ·
 * when · where it is · status. Type, Round, Pending and Step due stay OUT — each
 * repeated something already on the row (Items already carries the pending
 * quantity) or belonged on a screen built to chase lateness: the step queues and
 * the Control Center, which read the very same `lib/queues.ts`.
 *
 * Location, Company and PO no. are in, and they are the exception that proves the
 * rule: an order register is read to FIND an order, and those are three of the
 * things someone actually arrives holding — "the Surat one", "the one we billed
 * from the other entity", "their PO 4471".
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
  const B = "/order-to-dispatch";

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
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "customer",
      header: "Customer",
      cell: (o) => <span className="text-navy">{s.customerName(o.customerId)}</span>,
      sortValue: (o) => s.customerName(o.customerId),
      filter: { kind: "select", get: (o) => s.customerName(o.customerId) },
      tdClassName: "whitespace-nowrap",
    },
    // ⚠ Both location headers say WHICH location. One is where the customer takes
    //   delivery, the other is the site we ship from; an unqualified "Location"
    //   is the fastest way to have somebody filter the wrong one.
    {
      key: "customerLocation",
      header: "Customer location",
      cell: (o) => <span className="text-grey">{o.customerLocation ?? "—"}</span>,
      sortValue: (o) => o.customerLocation ?? "",
      filter: { kind: "select", get: (o) => o.customerLocation ?? "—" },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "company",
      header: "Company",
      cell: (o) => <span className="text-grey">{s.masterName("company", o.companyId)}</span>,
      sortValue: (o) => s.masterName("company", o.companyId),
      filter: { kind: "select", get: (o) => s.masterName("company", o.companyId) },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "dispatchLocation",
      header: "Dispatch location",
      cell: (o) => (
        <span className="text-grey">{s.masterName("company_location", o.locationId)}</span>
      ),
      sortValue: (o) => s.masterName("company_location", o.locationId),
      filter: { kind: "select", get: (o) => s.masterName("company_location", o.locationId) },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "poNo",
      header: "PO no.",
      cell: (o) => <span className="text-grey">{o.customerPoNo ?? "—"}</span>,
      sortValue: (o) => o.customerPoNo ?? "",
      filter: { kind: "text", get: (o) => o.customerPoNo ?? "" },
      tdClassName: "whitespace-nowrap",
    },
    {
      // "lines · quantity still owed" — on a fully dispatched order `pending` is
      // 0, so it falls back to what was ordered rather than reading as empty.
      key: "items",
      header: "Items",
      cell: (o) => {
        const t = qtyTotals(o);
        return (
          <span className="text-grey whitespace-nowrap">
            {o.lines.length} · {t.pending || t.ordered}
          </span>
        );
      },
      sortValue: (o) => o.lines.length,
      filter: { kind: "number", get: (o) => o.lines.length },
      exportValue: (o) => o.lines.length,
    },
    {
      key: "orderDate",
      header: "Order date",
      cell: (o) => <span className="text-grey whitespace-nowrap">{dmy(o.orderDate)}</span>,
      sortValue: (o) => o.orderDate,
      filter: { kind: "date", get: (o) => o.orderDate },
      exportValue: (o) => dmy(o.orderDate),
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "step",
      header: "Current step",
      cell: (o) => <span className="text-grey">{stepLabel(o)}</span>,
      sortValue: (o) => stepLabel(o),
      filter: { kind: "select", get: (o) => stepLabel(o) },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "status",
      header: "Status",
      cell: (o) => <StatusPill status={o.status} />,
      sortValue: (o) => o.status,
      filter: { kind: "select", get: (o) => o.status },
      tdClassName: "whitespace-nowrap",
    },
  ];

  return (
    <QueueTable<DispatchOrder>
      rows={orders}
      rowKey={(o) => o.id}
      columns={columns}
      actions={(o) => (
        <Link to={`${B}/orders/${o.id}`} className="text-[13px] font-semibold text-orange hover:underline">
          Open
        </Link>
      )}
      rowsLabel="orders"
      initialSort={{ key: "orderNo", dir: "desc" }}
      emptyTitle={emptyTitle}
      emptyMessage={emptyMessage}
      exportName={exportName}
    />
  );
}
