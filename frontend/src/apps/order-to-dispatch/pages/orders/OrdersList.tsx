import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import StepPipeline from "@/shared/components/ui/StepPipeline";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { queueRollup } from "@/shared/lib/fmsDashboard";
import { useDispatchStore } from "../../store";
import { STEPS, STAGES, type StepKey } from "../../lib/steps";
import { openStep } from "../../lib/queues";
import OrdersTable from "../../components/OrdersTable";

/**
 * Every order, with the bottleneck rail across the top. Clicking a step on the
 * rail filters the table to the orders sitting there — the counts come from the
 * same `queueEntries` the Control Centers use, so the rail and the table agree.
 */
export default function OrdersList() {
  const s = useDispatchStore();
  const nav = useNavigate();
  const [selected, setSelected] = useState<StepKey[]>([]);

  const pipelineSteps = useMemo(() => STEPS.filter((st) => !st.noQueue), []);
  const { nodes } = useMemo(
    () => queueRollup(s.queueEntries, pipelineSteps, todayLocalIso()),
    [s.queueEntries, pipelineSteps],
  );

  const groups = useMemo(() => STAGES.map((g) => ({ label: g.label, keys: g.keys })), []);

  const rows = useMemo(() => {
    if (selected.length === 0) return s.orders;
    const wanted = new Set<string>(selected);
    return s.orders.filter((o) => {
      const step = openStep(o);
      return step ? wanted.has(step) : false;
    });
  }, [s.orders, selected]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-navy">All Orders</h1>
          <p className="text-[13.5px] text-grey-2 mt-1">
            Every sales order in the system. Pick a step on the rail to see just the work stuck there.
          </p>
        </div>
        {s.canRaise && (
          <Button onClick={() => nav("/order-to-dispatch/orders/new")}>New sales order</Button>
        )}
      </div>

      <StepPipeline<StepKey>
        nodes={nodes}
        selectedKeys={selected}
        onChange={setSelected}
        groups={groups}
      />

      <OrdersTable
        orders={rows}
        exportName="Order_To_Dispatch_Orders"
        emptyTitle={selected.length ? "Nothing at that step" : "No orders yet"}
        emptyMessage={
          selected.length
            ? "Clear the rail selection to see every order."
            : "Raise a sales order to start the flow."
        }
      />
    </div>
  );
}
