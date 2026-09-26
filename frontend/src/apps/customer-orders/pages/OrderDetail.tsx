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
  fetchDeskOrders, fetchDeskItems, updateDeskOrder, cancelDeskOrder, deskFormLabel,
  ORDERS_QK, itemsQueryKey, type DeskLineInput,
} from "../data/orderDesk";
import { deskPaths } from "../lib/paths";

/**
 * One order.
 *
 * ⚠ BOTH BUTTONS ARE OFFERED OFF `canChange`, THE SERVER'S OWN WINDOW — never
 *   off the status word on the screen. Since OD-16 the two agree by construction
 *   (`status_key` tests the same function), but that is a fact about the server,
 *   not licence to read the label: the day a state is added that reads
 *   "Request raised" without being open, a screen deciding from the words would
 *   offer buttons the server then refuses.
 *
 *   And hiding the buttons is not the enforcement. Both write RPCs re-ask the same
 *   question before it touches anything, so a stale tab, a second browser or a
 *   hand-made call all get the same answer. What this screen owes the customer is
 *   not a lock — it is the SENTENCE explaining why, which is the thing a hidden
 *   button never says.
 *
 * ⚠ CHANGE AND CANCEL SHUT TOGETHER, on the one window (OD-16). While the order
 *   reads "Request raised" both are offered; the moment we accept it, both go and
 *   `WINDOW_SHUT` says so in one sentence covering both verbs. There is no state
 *   in which one is open and the other is not, which is why they share a branch.
 *
 * ⚠ AND THE ONLY REMARK THEY SEE IS `dispatchNotes`. `go_remarks` — the internal
 *   note beside it — is not in the RPC, so there is nothing here to accidentally
 *   render. If a future screen wants "what did the store say", the answer is that
 *   it is not ours to show.
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
  const order = (orders ?? []).find((o) => o.id === id);

  /**
   * Only needed once they press Change; the picker cannot open before that.
   *
   * ⚠ SCOPED TO THE ORDER'S OWN BOOK (OD-14). An order is committed to one of our
   *   companies the moment it is placed, and only that book can supply it — so the
   *   picker on a change has to be that book's list, not the union across all of
   *   them. Passing null here would quietly let a customer add a line the billing
   *   company cannot fulfil, which is the whole failure OD-14 removed.
   *
   *   An order placed before OD-14 has no company yet; those fall back to the union,
   *   which is exactly the behaviour they were placed under.
   */
  const { data: items } = useQuery({
    queryKey: itemsQueryKey(order?.companyId ?? null),
    queryFn: () => fetchDeskItems(order?.companyId ?? null),
    staleTime: 10 * 60_000,
    enabled: editing && !!order,
  });

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
          <Link to={deskPaths.orders} className="inline-block mt-5 text-[14px] font-semibold text-orange">
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
      navigate(deskPaths.orders, { replace: true });
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  const subtitle = (
    <Link to={deskPaths.orders} className="text-grey hover:text-orange font-medium">
      ← My orders
    </Link>
  );

  if (editing) {
    return (
      <OrderDeskShell title={`Change ${order.orderNo}`} subtitle={subtitle}>
        {items ? (
          <OrderForm
            items={items}
            /* Shown, not offered: the form is fixed once the order exists. */
            companyLabel={deskFormLabel(order.formName, order.companyLabel)}
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

        {/*
          WHAT WE TOLD THEM WHEN IT WENT OUT.

          ⚠ ABOVE the change controls and BELOW the items, on purpose. It is news
            about the order, so it belongs with the order; putting it under the
            buttons would file the newest thing on the page beneath the least
            interesting thing on it.

          One consignment prints as one note with no numbering — "Note 1 of 1" is
          noise. Several are numbered, because on a part-dispatched order the
          customer is holding one delivery and waiting for another, and which note
          belongs to which is the only question they have.
        */}
        {order.dispatchNotes.length > 0 ? (
          <div className="rounded-2xl border border-line bg-white overflow-hidden">
            <div className="px-6 py-3.5 border-b border-line bg-[#FBFCFE] text-[12px] font-semibold text-grey uppercase tracking-wide">
              {order.dispatchNotes.length === 1 ? "When we sent it" : "As we sent each part"}
            </div>
            <div className="divide-y divide-line">
              {order.dispatchNotes.map((n, i) => (
                <div key={`${n.roundNo ?? i}-${i}`} className="px-6 py-3.5">
                  {order.dispatchNotes.length > 1 || n.sentOn ? (
                    <div className="text-[12.5px] text-grey-2 mb-1">
                      {order.dispatchNotes.length > 1 ? `Part ${i + 1}` : null}
                      {order.dispatchNotes.length > 1 && n.sentOn ? " · " : null}
                      {n.sentOn ? `Sent ${orderDate(n.sentOn)}` : null}
                    </div>
                  ) : null}
                  <p className="text-[14px] leading-relaxed">{n.note}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {order.canChange ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => setEditing(true)}>Change this order</Button>
              <Button variant="ghost" onClick={() => setCancelling(true)}>Cancel this order</Button>
            </div>
            {/* Says the deadline out loud. The buttons vanish the moment we accept,
                and a customer who did not know that is reading for is left
                wondering what they did wrong. */}
            <p className="text-[12.5px] text-grey-2">
              You can do either until we accept this order.
            </p>
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
