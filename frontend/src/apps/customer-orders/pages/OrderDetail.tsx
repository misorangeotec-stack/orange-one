import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Button from "@/shared/components/ui/Button";
import { TextArea } from "@/shared/components/ui/Form";
import OrderDeskShell from "../components/OrderDeskShell";
import OrderForm from "../components/OrderForm";
import { useCustomer } from "../CustomerOrdersApp";
import { StatusPill, orderDate } from "./MyOrders";
import { customerStatus, callUs, WINDOW_SHUT } from "../lib/customerLabels";
import {
  fetchDeskOrders, fetchDeskItems, updateDeskOrder, cancelDeskOrder,
  ORDERS_QK, ITEMS_QK, type DeskLineInput,
} from "../data/orderDesk";

/**
 * One order.
 *
 * ⚠ CHANGE AND CANCEL ARE OFFERED OFF `canChange`, WHICH IS THE SERVER'S OWN
 *   WINDOW — never off the status word on the screen. Two different states both
 *   read "Placed" to the customer and only one of them is still open, so a screen
 *   that decided from its own label would offer a button the server then refuses.
 *
 *   And hiding the buttons is not the enforcement. Both write RPCs re-ask the same
 *   question before they touch anything, so a stale tab, a second browser or a
 *   hand-made call all get the same answer. What this screen owes the customer is
 *   not a lock — it is the SENTENCE explaining why, which is the thing a hidden
 *   button never says.
 */
export default function OrderDetail() {
  const { id = "" } = useParams();
  const customer = useCustomer();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const { data: orders, isLoading } = useQuery({
    queryKey: ORDERS_QK, queryFn: fetchDeskOrders, staleTime: 30_000,
  });
  // Only needed once they press Change; the picker cannot open before that.
  const { data: items } = useQuery({
    queryKey: ITEMS_QK, queryFn: fetchDeskItems, staleTime: 10 * 60_000, enabled: editing,
  });

  const order = (orders ?? []).find((o) => o.id === id);

  if (isLoading) {
    return (
      <OrderDeskShell title="Your order" subtitle={customer.displayName}>
        <div className="rounded-2xl border border-line bg-white p-8 text-[14px] text-grey">Loading…</div>
      </OrderDeskShell>
    );
  }

  if (!order) {
    return (
      <OrderDeskShell title="Your order" subtitle={customer.displayName}>
        <div className="rounded-2xl border border-line bg-white p-8 max-w-2xl">
          <p className="text-[15px] font-semibold">We cannot find that order.</p>
          <p className="text-[14px] text-grey mt-2">
            It may have been opened from an old link. {callUs("Please call us")} if you were
            expecting to see it.
          </p>
          <Link to=".." relative="path" className="inline-block mt-5 text-[14px] font-semibold text-orange">
            Back to my orders
          </Link>
        </div>
      </OrderDeskShell>
    );
  }

  const status = customerStatus(order.statusKey);

  const save = async (lines: DeskLineInput[], remarks: string) => {
    await updateDeskOrder({ orderId: order.id, orderRemarks: remarks, lines });
    await qc.invalidateQueries({ queryKey: ORDERS_QK });
    setEditing(false);
  };

  const doCancel = async () => {
    setBusy(true);
    setErr("");
    try {
      await cancelDeskOrder(order.id, reason);
      await qc.invalidateQueries({ queryKey: ORDERS_QK });
      setCancelling(false);
      navigate("..", { relative: "path", replace: true });
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  const subtitle = (
    <Link to=".." relative="path" className="text-grey hover:text-orange font-medium">
      ← My orders
    </Link>
  );

  if (editing) {
    return (
      <OrderDeskShell title={`Change ${order.orderNo}`} subtitle={subtitle}>
        {items ? (
          <OrderForm
            items={items}
            /*
              Anything on the order that is no longer offered. Computed here rather
              than inside the form because only this screen knows both halves — what
              was ordered, and what may be ordered now. Almost always empty.
            */
            retired={order.lines
              .filter((l) => !items.some((i) => i.itemId === l.itemId))
              .map((l) => ({ itemId: l.itemId, name: l.name }))}
            initialLines={order.lines.map((l) => ({
              itemId: l.itemId,
              quantity: String(l.quantity),
              lineRemark: l.lineRemark ?? "",
            }))}
            initialRemarks={order.orderRemarks ?? ""}
            submitLabel="Save the change"
            busyLabel="Saving…"
            onSubmit={save}
            onCancel={() => setEditing(false)}
            cancelLabel="Leave it as it is"
          />
        ) : (
          <div className="rounded-2xl border border-line bg-white p-8 text-[14px] text-grey">
            Loading your items…
          </div>
        )}
      </OrderDeskShell>
    );
  }

  return (
    <OrderDeskShell title={order.orderNo} subtitle={subtitle}>
      <div className="space-y-5 max-w-3xl">
        <div className="rounded-2xl border border-line bg-white p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <StatusPill statusKey={order.statusKey} />
              <p className="text-[14px] text-grey mt-2.5">{status.blurb}</p>
            </div>
            <div className="text-right text-[13px] text-grey-2">
              <div>Placed {orderDate(order.orderDate)}</div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-white overflow-hidden">
          <div className="px-6 py-3.5 border-b border-line bg-[#FBFCFE] text-[12px] font-semibold text-grey uppercase tracking-wide">
            What you ordered
          </div>
          <div className="divide-y divide-line">
            {order.lines.map((l) => (
              <div key={l.lineNo} className="px-6 py-3.5 flex items-baseline justify-between gap-4">
                <div className="min-w-0">
                  <span className="text-[14px] font-medium">{l.name}</span>
                  {l.lineRemark ? (
                    <span className="block text-[12.5px] text-grey-2 mt-0.5">{l.lineRemark}</span>
                  ) : null}
                </div>
                <span className="text-[14px] font-semibold whitespace-nowrap">
                  {l.quantity} <span className="text-grey font-medium">{l.unit ?? ""}</span>
                </span>
              </div>
            ))}
          </div>
          {order.orderRemarks ? (
            <div className="px-6 py-4 border-t border-line bg-[#FBFCFE]">
              <span className="text-[12px] font-semibold text-grey uppercase tracking-wide">Your note</span>
              <p className="text-[14px] mt-1">{order.orderRemarks}</p>
            </div>
          ) : null}
        </div>

        {order.canChange ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => setEditing(true)}>Change this order</Button>
            <Button variant="ghost" onClick={() => setCancelling(true)}>Cancel this order</Button>
          </div>
        ) : (
          <div className="rounded-2xl border border-line bg-[#FBFCFE] p-5 text-[14px] text-grey leading-relaxed">
            {WINDOW_SHUT}
          </div>
        )}

        {cancelling ? (
          <div className="rounded-2xl border border-[#f6d2d3] bg-white p-6">
            <p className="text-[15px] font-semibold">Cancel {order.orderNo}?</p>
            <p className="text-[14px] text-grey mt-1.5">
              We will stop work on it. You can always place a new order afterwards.
            </p>
            <div className="mt-4">
              <label className="block text-[13px] font-semibold mb-1.5">Why, so we know?</label>
              <TextArea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="Optional"
              />
            </div>
            {err ? <p className="text-[13.5px] text-[#B3282C] mt-3">{err}</p> : null}
            <div className="flex gap-3 mt-4">
              <Button onClick={doCancel} disabled={busy}>
                {busy ? "Cancelling…" : "Yes, cancel it"}
              </Button>
              <Button variant="ghost" onClick={() => setCancelling(false)} disabled={busy}>
                Keep the order
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </OrderDeskShell>
  );
}
