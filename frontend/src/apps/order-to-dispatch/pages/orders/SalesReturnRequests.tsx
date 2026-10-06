import { useState } from "react";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import StageTabs, { type StageMode } from "@/shared/components/ui/StageTabs";
import { useDispatchStore } from "../../store";
import RequestReturnModal from "../../components/RequestReturnModal";
import { SalesReturnTable, useSalesReturnRows } from "./AllSalesReturns";

/**
 * Sales Return — where a return is RAISED, and where the raiser follows it.
 *
 * The first half of a two-page cycle, the same split as New Sales Order / My
 * Orders against the step queues:
 *   1. here, somebody raises a sales return against an invoice that went out;
 *   2. it lands on Generate Sales Return (Tally), where its owner makes the
 *      entry in Tally, enters the number and attaches it — which closes it.
 *
 * Lists only the returns this person raised: "Waiting for Tally" until the
 * Tally owner submits, then "Completed". Everyone's returns are on All Sales
 * Returns.
 */
export default function SalesReturnRequests() {
  const s = useDispatchStore();
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [mode, setMode] = useState<StageMode>("pending");

  const mine = useSalesReturnRows().filter((r) => r.ret && r.requestedBy === s.userId);
  const pending = mine.filter((r) => r.status === "Pending");
  const done = mine.filter((r) => r.status !== "Pending");

  const canRaise = s.canEdit && s.orders.some((o) => s.canRequestRoundReturn(o));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-navy">Sales Return</h1>
          <p className="text-[13.5px] text-grey-2 mt-1 max-w-[760px]">
            {mode === "completed"
              ? "Sales returns you raised that are closed — generated in Tally, or withdrawn."
              : "Raise a sales return against an invoice that has gone out. It goes to Generate Sales Return (Tally), and closes once the Tally entry is made."}
          </p>
        </div>
        {canRaise && <Button onClick={() => setRaiseOpen(true)}>Raise sales return</Button>}
      </div>

      <StageTabs
        mode={mode}
        onMode={setMode}
        pendingCount={pending.length}
        completedCount={done.length}
      />

      <Card className="p-4">
        <SalesReturnTable
          rows={mode === "completed" ? done : pending}
          exportName={mode === "completed" ? "Order_To_Dispatch_My_Sales_Returns_Closed" : "Order_To_Dispatch_My_Sales_Returns"}
          emptyTitle={mode === "completed" ? "Nothing closed yet" : "Nothing waiting for Tally"}
          emptyMessage={
            mode === "completed"
              ? "Sales returns you raised will appear here once the Tally entry is made."
              : "Sales returns you raise will wait here until the Tally entry is made."
          }
        />
      </Card>

      <RequestReturnModal open={raiseOpen} onClose={() => setRaiseOpen(false)} />
    </div>
  );
}
