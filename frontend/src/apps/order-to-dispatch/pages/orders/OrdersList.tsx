import { useNavigate } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { useDispatchStore } from "../../store";
import OrdersTable from "../../components/OrdersTable";

/**
 * Every order, as a plain register — the same shape as the purchase-request
 * lists.
 *
 * The bottleneck rail that used to sit above the table is gone. It duplicated
 * the Control Center (which is built around exactly that rollup) and the per-step
 * queues in the sidebar, and on a book with nothing late it filled the top third
 * of the screen to say "all clear" four times over. This screen answers "where is
 * order X?"; chasing what is stuck belongs on the screens built for it.
 */
export default function OrdersList() {
  const s = useDispatchStore();
  const nav = useNavigate();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-navy">All Orders</h1>
          <p className="text-[13.5px] text-grey-2 mt-1">Every sales order in the system.</p>
        </div>
        {s.canRaise && (
          <Button size="sm" onClick={() => nav("/order-to-dispatch/orders/new")}>+ New sales order</Button>
        )}
      </div>

      <Card className="p-4">
        <OrdersTable
          orders={s.orders}
          exportName="Order_To_Dispatch_Orders"
          emptyTitle="No orders yet"
          emptyMessage="Raise a sales order to start the flow."
        />
      </Card>
    </div>
  );
}
