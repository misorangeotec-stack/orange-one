import { useNavigate, useParams } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import EmptyState from "@/shared/components/ui/EmptyState";
import { SectionHeading } from "@/shared/components/ui/Readout";
import { useSession } from "@/core/platform/session";
import { useDispatchStore } from "../../store";
import SalesOrderFields from "../../components/SalesOrderFields";
import OrderLinesGrid from "../../components/OrderLinesGrid";
import { useSalesOrderForm } from "./useSalesOrderForm";

/**
 * Edit the intake, while the order is still at the origin step.
 *
 * The guard here is a courtesy — `fms_dispatch_update_order` re-checks the same
 * rule server-side (raiser / admin / coordinator, and only before the credit check
 * has been recorded).
 */
export default function EditOrder() {
  const { id = "" } = useParams();
  const s = useDispatchStore();
  const { user } = useSession();
  const nav = useNavigate();
  const order = s.orderById(id);
  const f = useSalesOrderForm(order);

  if (s.isLoading) return <p className="text-[13.5px] text-grey-2">Loading…</p>;
  if (!order) {
    return <EmptyState title="Order not found" message="It may have been cancelled, or the link is stale." />;
  }
  if (!s.canEditOrder(order)) {
    return (
      <EmptyState
        title="This order can no longer be edited"
        message="The credit check has already been recorded. Ask a coordinator if something needs correcting."
      />
    );
  }

  const submit = async () => {
    const problem = f.validate();
    if (problem) { f.setError(problem); return; }
    f.setBusy(true);
    f.setError(null);
    try {
      await s.updateOrder(order.id, f.toInput(user.name));
      nav(`/order-to-dispatch/orders/${order.id}`);
    } catch (e) {
      f.setError(e instanceof Error ? e.message : "Could not save the order.");
      f.setBusy(false);
    }
  };

  return (
    <div className="space-y-5 max-w-6xl">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Edit {order.orderNo}</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Editable until the collection team records the credit confirmation.
        </p>
      </div>

      <Card className="p-5">
        <SalesOrderFields f={f} />
      </Card>

      <Card className="p-5 space-y-3">
        <SectionHeading>Items</SectionHeading>
        <OrderLinesGrid rows={f.lines} onRowsChange={f.setLines} />
      </Card>

      {f.error && <p className="text-[13px] font-medium text-ryg-red">{f.error}</p>}

      <div className="flex gap-3">
        <Button onClick={submit} disabled={f.busy}>{f.busy ? "Saving…" : "Save changes"}</Button>
        <Button variant="ghost" onClick={() => nav(-1)} disabled={f.busy}>Cancel</Button>
      </div>
    </div>
  );
}
