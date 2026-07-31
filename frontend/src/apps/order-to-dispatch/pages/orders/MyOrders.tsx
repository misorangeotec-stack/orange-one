import { useNavigate } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { useDispatchStore } from "../../store";
import OrdersTable from "../../components/OrdersTable";

/** The orders I raised — the same table as the full list, scoped to me. */
export default function MyOrders() {
  const s = useDispatchStore();
  const nav = useNavigate();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-navy">My Orders</h1>
          <p className="text-[13.5px] text-grey-2 mt-1">Sales orders you raised, wherever they have reached.</p>
        </div>
        {s.canRaise && (
          <Button size="sm" onClick={() => nav("/order-to-dispatch/orders/new")}>+ New sales order</Button>
        )}
      </div>

      <Card className="p-4">
        <OrdersTable
          orders={s.myOrders}
          exportName="Order_To_Dispatch_My_Orders"
          emptyTitle="You haven't raised any orders"
          emptyMessage="Orders you raise will appear here so you can follow them through."
        />
      </Card>
    </div>
  );
}
