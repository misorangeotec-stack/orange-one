import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import EmptyState from "@/shared/components/ui/EmptyState";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import { Field, SectionHeading } from "@/shared/components/ui/Readout";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { formatDateTime } from "@/shared/lib/time";
import { useDispatchStore } from "../../store";
import DispatchStepper from "../../components/DispatchStepper";
import PlannedVsActualTable from "../../components/PlannedVsActualTable";
import StatusPill, { OutcomePill } from "../../components/StatusPill";
import {
  DISPATCH_TYPE_LABEL, MATERIAL_STATUS_LABEL, dmy, dmyTime, inr, qtyTotals,
} from "../../lib/format";

export default function OrderDetail() {
  const { id = "" } = useParams();
  const s = useDispatchStore();
  const nav = useNavigate();
  const order = s.orderById(id);

  const [holdOpen, setHoldOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (s.isLoading) return <p className="text-[13.5px] text-grey-2">Loading…</p>;
  if (!order) {
    return <EmptyState title="Order not found" message="It may have been removed, or the link is stale." />;
  }

  const customer = s.customers.find((c) => c.id === order.customerId);
  const shipTo = s.shipTos.find((a) => a.id === order.shipToId);
  const activity = s.activityFor("order", order.id);
  const totals = qtyTotals(order);

  const act = async (fn: () => Promise<void>, close: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      close();
      setReason("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not complete that.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-[22px] font-bold text-navy">{order.orderNo}</h1>
            <StatusPill status={order.status} />
            {order.msStatus === "production_required" && (
              <OutcomePill label={MATERIAL_STATUS_LABEL.production_required} tone="red" />
            )}
            {order.dcStatus === "returned" && <OutcomePill label="Returned" tone="red" />}
          </div>
          <p className="text-[13.5px] text-grey-2 mt-1">
            {s.customerName(order.customerId)} · {DISPATCH_TYPE_LABEL[order.dispatchType]} · raised by{" "}
            {order.requesterName} on {dmy(order.submittedAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {s.canEditOrder(order) && (
            <Button variant="ghost" onClick={() => nav(`/order-to-dispatch/orders/${order.id}/edit`)}>
              Edit order
            </Button>
          )}
          {s.isProcessCoordinator && order.status !== "cancelled" && order.status !== "closed" && (
            <Button variant="ghost" onClick={() => setHoldOpen(true)}>
              {order.status === "on_hold" ? "Take off hold" : "Put on hold"}
            </Button>
          )}
          {s.isProcessCoordinator && order.status !== "cancelled" && order.status !== "closed" && (
            <Button variant="ghost" onClick={() => setCancelOpen(true)}>Cancel order</Button>
          )}
        </div>
      </div>

      {/* The progress block is ALWAYS first — the standing rule across every FMS. */}
      <Card className="p-5">
        <DispatchStepper order={order} />
      </Card>

      {order.status === "on_hold" && order.holdReason && (
        <p className="text-[13px] text-yellow">On hold: {order.holdReason}</p>
      )}
      {order.status === "cancelled" && order.cancelReason && (
        <p className="text-[13px] text-ryg-red">Cancelled: {order.cancelReason}</p>
      )}

      <Card className="p-5">
        <PlannedVsActualTable order={order} />
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="p-5 space-y-3 lg:col-span-2">
          <SectionHeading>Items</SectionHeading>
          <ScrollableTable>
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-grey-2 border-b border-line">
                  <th className="py-2 pr-3 font-semibold min-w-[190px]">Item</th>
                  <th className="py-2 pr-3 font-semibold">Ordered</th>
                  <th className="py-2 pr-3 font-semibold">Availability</th>
                  <th className="py-2 pr-3 font-semibold">LOT</th>
                  <th className="py-2 pr-3 font-semibold">Final qty</th>
                  <th className="py-2 pr-3 font-semibold">Packing</th>
                </tr>
              </thead>
              <tbody>
                {order.lines.map((l) => (
                  <tr key={l.id} className="border-b border-line/70 last:border-0">
                    <td className="py-2 pr-3 text-navy">{s.itemName(l.itemId)}</td>
                    <td className="py-2 pr-3 text-grey whitespace-nowrap">
                      {l.quantity} {s.unitName(l.unitId)}
                    </td>
                    <td className="py-2 pr-3">
                      {l.msLineStatus ? (
                        <OutcomePill
                          label={MATERIAL_STATUS_LABEL[l.msLineStatus]}
                          tone={l.msLineStatus === "production_required" ? "red" : "green"}
                        />
                      ) : (
                        <span className="text-grey-2">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-grey">{l.lotNoSnapshot ?? "—"}</td>
                    <td className="py-2 pr-3 text-navy whitespace-nowrap">
                      {l.finalQty !== null ? `${l.finalQty} ${s.unitName(l.finalUnitId ?? l.unitId)}` : "—"}
                    </td>
                    <td className="py-2 pr-3 text-grey">
                      {l.packingTypeId ? s.masterName("packing_type", l.packingTypeId) : "—"}
                      {l.packs !== null ? ` · ${l.packs}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollableTable>
          <p className="text-[12.5px] text-grey-2">
            {order.lines.length} line{order.lines.length === 1 ? "" : "s"} · {totals.ordered} ordered
            {totals.final ? ` · ${totals.final} confirmed for dispatch` : ""}
          </p>
        </Card>

        <Card className="p-5 space-y-3">
          <SectionHeading>Order</SectionHeading>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <Field label="Customer" value={s.customerName(order.customerId)} />
            <Field label="Delivery address" value={shipTo ? shipTo.name : "—"} />
            <Field label="Company" value={order.companyId ? s.masterName("company", order.companyId) : "—"} />
            <Field label="Order source" value={order.orderSourceId ? s.masterName("order_source", order.orderSourceId) : "—"} />
            <Field label="Customer's reference" value={order.customerRef ?? "—"} />
            <Field label="Order date" value={dmy(order.orderDate)} />
            <Field
              label="Promised dispatch"
              value={order.promisedDate ? `${dmy(order.promisedDate)}${order.tatDays ? ` · ${order.tatDays}d TAT` : ""}` : "—"}
            />
            {order.sbInvoiceNo && (
              <Field
                label="Sales invoice"
                value={`${order.sbInvoiceNo}${order.sbInvoiceValue ? ` · ${inr(order.sbInvoiceValue)}` : ""}`}
              />
            )}
            {order.goGatePassNo && <Field label="Gate pass" value={order.goGatePassNo} />}
            {order.dcLrNo && (
              <Field
                label="LR"
                value={`${order.dcLrNo}${order.dcTransporterId ? ` · ${s.masterName("transporter", order.dcTransporterId)}` : ""}`}
              />
            )}
            {order.dcReceiverName && <Field label="Received by" value={order.dcReceiverName} />}
            {customer?.email && (
              <Field
                label="Customer mail"
                value={
                  order.msMailQueuedAt
                    ? `Sent ${dmyTime(order.msMailQueuedAt)}`
                    : order.msMailSkippedReason ?? "Not sent"
                }
              />
            )}
          </div>
        </Card>
      </div>

      {activity.length > 0 && (
        <Card className="p-5 space-y-3">
          <SectionHeading>Activity</SectionHeading>
          <ul className="space-y-2.5">
            {activity
              .slice()
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .map((a) => (
                <li key={a.id} className="flex flex-wrap gap-x-2 gap-y-0.5 text-[13px]">
                  <span className="text-grey-2 whitespace-nowrap">{formatDateTime(a.createdAt)}</span>
                  <span className="text-navy">{a.note ?? a.type}</span>
                  <span className="text-grey-2">— {s.personName(a.actorId)}</span>
                </li>
              ))}
          </ul>
        </Card>
      )}

      <p className="text-[12.5px] text-grey-2">
        <Link to="/order-to-dispatch/orders" className="font-semibold text-orange hover:underline">
          ← All orders
        </Link>
      </p>

      <Modal
        open={holdOpen}
        onClose={() => setHoldOpen(false)}
        title={order.status === "on_hold" ? "Take this order off hold" : "Put this order on hold"}
        subtitle={order.orderNo}
        footer={
          <>
            <Button variant="ghost" onClick={() => setHoldOpen(false)} disabled={busy}>Cancel</Button>
            <Button
              onClick={() => act(() => s.holdOrder(order.id, order.status !== "on_hold", reason), () => setHoldOpen(false))}
              disabled={busy}
            >
              {busy ? "Saving…" : order.status === "on_hold" ? "Resume" : "Hold"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-[13px] text-grey-2">
            {order.status === "on_hold"
              ? "The order returns to whichever step it was on."
              : "A held order leaves every queue until it is resumed."}
          </p>
          {order.status !== "on_hold" && (
            <FieldLabel label="Reason">
              <TextArea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
            </FieldLabel>
          )}
          {error && <p className="text-[13px] font-medium text-ryg-red">{error}</p>}
        </div>
      </Modal>

      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel this order"
        subtitle={order.orderNo}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCancelOpen(false)} disabled={busy}>Keep it</Button>
            <Button onClick={() => act(() => s.cancelOrder(order.id, reason), () => setCancelOpen(false))} disabled={busy}>
              {busy ? "Cancelling…" : "Cancel order"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-[13px] text-grey-2">A cancelled order leaves every queue and cannot be reopened.</p>
          <FieldLabel label="Reason" required>
            <TextArea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </FieldLabel>
          {error && <p className="text-[13px] font-medium text-ryg-red">{error}</p>}
        </div>
      </Modal>
    </div>
  );
}
