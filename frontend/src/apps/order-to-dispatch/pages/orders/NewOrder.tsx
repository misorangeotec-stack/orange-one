import { useNavigate } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { SectionHeading } from "@/shared/components/ui/Readout";
import { useSession } from "@/core/platform/session";
import { useDispatchStore } from "../../store";
import SalesOrderFields from "../../components/SalesOrderFields";
import OrderLinesGrid from "../../components/OrderLinesGrid";
import { useSalesOrderForm } from "./useSalesOrderForm";
import AccessDenied from "../system/AccessDenied";

export default function NewOrder() {
  const s = useDispatchStore();
  const { user } = useSession();
  const nav = useNavigate();
  const f = useSalesOrderForm();

  if (!s.canRaise) return <AccessDenied />;

  const submit = async () => {
    const problem = f.validate();
    if (problem) { f.setError(problem); return; }
    f.setBusy(true);
    f.setError(null);
    try {
      const id = await s.submitOrder(f.toInput(user.name));
      nav(`/order-to-dispatch/orders/${id}`);
    } catch (e) {
      f.setError(e instanceof Error ? e.message : "Could not raise the order.");
      f.setBusy(false);
    }
  };

  return (
    <div className="space-y-5 max-w-6xl">
      <div>
        <h1 className="text-[22px] font-bold text-navy">New Sales Order</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Raising an order sends it to the collection team for credit confirmation.
          {s.orderNoPreview && <> It will be numbered <span className="font-semibold text-navy">{s.orderNoPreview}</span>.</>}
        </p>
      </div>

      <Card className="p-5">
        <SalesOrderFields f={f} />
      </Card>

      <Card className="p-5 space-y-3">
        <SectionHeading>Items</SectionHeading>
        <OrderLinesGrid rows={f.lines} onRowsChange={f.setLines} customerId={f.form.customerId} />
      </Card>

      {f.error && <p className="text-[13px] font-medium text-ryg-red">{f.error}</p>}

      <div className="flex gap-3">
        <Button onClick={submit} disabled={f.busy}>{f.busy ? "Raising…" : "Raise order"}</Button>
        <Button variant="ghost" onClick={() => nav(-1)} disabled={f.busy}>Cancel</Button>
      </div>
    </div>
  );
}
