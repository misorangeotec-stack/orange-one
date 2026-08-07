import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import EmptyState from "@/shared/components/ui/EmptyState";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import Combobox from "@/shared/components/ui/Combobox";
import { Field, SectionHeading } from "@/shared/components/ui/Readout";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { formatDateTime } from "@/shared/lib/time";
import { useDispatchStore } from "../../store";
import DispatchStepper from "../../components/DispatchStepper";
import StepDocLink from "../../components/StepDocLink";
import StatusPill, { OutcomePill } from "../../components/StatusPill";
import { allRoundViews, pendingQtyOf, type RoundView } from "../../lib/rounds";
import {
  CREDIT_STATUS_LABEL, DELIVERY_STATUS_LABEL, DISPATCH_TYPE_LABEL,
  dmy, dmyTime, isCreditHeld, qtyTotals, sharedUnit,
} from "../../lib/format";

export default function OrderDetail() {
  const { id = "" } = useParams();
  const s = useDispatchStore();
  const nav = useNavigate();
  const order = s.orderById(id);

  const [holdOpen, setHoldOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [amendRound, setAmendRound] = useState<RoundView | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (s.isLoading) return <p className="text-[13.5px] text-grey-2">Loading…</p>;
  if (!order) {
    return <EmptyState title="Order not found" message="It may have been removed, or the link is stale." />;
  }

  const activity = s.activityFor("order", order.id);
  const totals = qtyTotals(order);
  const rounds = allRoundViews(order).filter((v) => v.msAt || v.isArchived);
  const held = isCreditHeld(order);

  // Closing early is only legal BETWEEN rounds — mid-round the goods may already
  // be through the gate. The server enforces it; this keeps the button honest.
  const betweenRounds = order.status === "awaiting_material_status" || order.status === "on_hold";
  const canClose =
    s.isProcessCoordinator && betweenRounds && order.status !== "closed" && order.status !== "cancelled";

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
            {held && <OutcomePill label="Credit on hold" tone="yellow" />}
            {order.rounds.some((r) => r.dcStatus === "returned") && (
              <OutcomePill label="A round was returned" tone="red" />
            )}
            {order.closedReason && <OutcomePill label="Closed early" tone="grey" />}
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
          {canClose && <Button variant="ghost" onClick={() => setCloseOpen(true)}>Close order</Button>}
          {s.isProcessCoordinator && order.status !== "cancelled" && order.status !== "closed" && (
            <Button variant="ghost" onClick={() => setCancelOpen(true)}>Cancel order</Button>
          )}
        </div>
      </div>

      {/* The progress block is ALWAYS first — the standing rule across every FMS. */}
      <Card className="p-5">
        <DispatchStepper order={order} />
      </Card>

      {/*
        A credit hold is invisible everywhere else on this page — the status still
        reads "Awaiting credit" — so the remark that was made compulsory has to
        surface here, with who decided it and when.
      */}
      {held && (
        <Card className="p-4 border-l-4 border-l-yellow">
          <p className="text-[13px] text-navy">
            <span className="font-semibold">Credit put this order on hold.</span>{" "}
            {order.ccRemarks}
          </p>
          <p className="text-[12.5px] text-grey-2 mt-1">
            {s.personName(order.ccDecidedBy)}
            {order.ccDecidedAt ? ` · ${dmyTime(order.ccDecidedAt)}` : ""} · it stays in the Confirm
            Credit Limit queue until someone approves it.
          </p>
        </Card>
      )}

      {order.status === "on_hold" && order.holdReason && (
        <p className="text-[13px] text-yellow">On hold: {order.holdReason}</p>
      )}
      {order.status === "cancelled" && order.cancelReason && (
        <p className="text-[13px] text-ryg-red">Cancelled: {order.cancelReason}</p>
      )}
      {order.closedReason && (
        <p className="text-[13px] text-grey-2">
          Closed early by {s.personName(order.closedBy)}: {order.closedReason}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="p-5 space-y-3 lg:col-span-2">
          <SectionHeading>Items</SectionHeading>
          <ScrollableTable>
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-grey-2 border-b border-line">
                  <th className="py-2 pr-3 font-semibold min-w-[190px]">Item</th>
                  <th className="py-2 pr-3 font-semibold text-right">Ordered</th>
                  <th className="py-2 pr-3 font-semibold text-right">Dispatched</th>
                  <th className="py-2 pr-3 font-semibold text-right">Pending</th>
                  <th className="py-2 pr-3 font-semibold text-right">Going out now</th>
                  <th className="py-2 pr-3 font-semibold">LOT no.</th>
                </tr>
              </thead>
              <tbody>
                {order.lines.map((l) => {
                  const pending = pendingQtyOf(l);
                  return (
                    <tr key={l.id} className="border-b border-line/70 last:border-0">
                      <td className="py-2 pr-3 text-navy">{s.itemName(l.itemId)}</td>
                      <td className="py-2 pr-3 text-grey text-right tabular-nums whitespace-nowrap">
                        {l.quantity} {l.unit ?? ""}
                      </td>
                      <td className="py-2 pr-3 text-grey text-right tabular-nums">{l.dispatchedQty || "—"}</td>
                      <td className="py-2 pr-3 text-right tabular-nums font-semibold">
                        {pending > 0 ? <span className="text-navy">{pending}</span> : <span className="text-ryg-green">Complete</span>}
                      </td>
                      <td className="py-2 pr-3 text-grey text-right tabular-nums">{l.shipQty ?? "—"}</td>
                      <td className="py-2 pr-3 text-grey">{l.lotNo ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
              {/* Each figure totalled under its own column — the sentence below now
                  only counts the lines, so no number is stated twice. */}
              <tfoot>
                <tr className="border-t border-line text-navy">
                  <td className="py-2 pr-3 text-[11.5px] font-semibold uppercase tracking-wide text-grey-2">
                    Total
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums font-bold whitespace-nowrap">
                    {totals.ordered} {sharedUnit(order.lines)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums font-bold">{totals.dispatched || "—"}</td>
                  <td className="py-2 pr-3 text-right tabular-nums font-bold">{totals.pending || "—"}</td>
                  <td className="py-2 pr-3 text-right tabular-nums font-bold text-orange">{totals.shipping || "—"}</td>
                  <td className="py-2 pr-3" />
                </tr>
              </tfoot>
            </table>
          </ScrollableTable>
          <p className="text-[12.5px] text-grey-2">
            {order.lines.length} line{order.lines.length === 1 ? "" : "s"}
            {totals.pending ? "" : " · nothing outstanding"}
          </p>
        </Card>

        <Card className="p-5 space-y-3">
          <SectionHeading>Order</SectionHeading>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <Field label="Customer" value={s.customerName(order.customerId)} />
            <Field label="Customer location" value={order.customerLocation ?? "—"} />
            <Field label="Billing company" value={s.masterName("company", order.companyId)} />
            <Field
              label="Dispatch location"
              value={s.masterName("company_location", order.locationId)}
            />
            <Field label="Customer PO no." value={order.customerPoNo ?? "—"} />
            <Field label="Dispatch type" value={DISPATCH_TYPE_LABEL[order.dispatchType]} />
            <Field label="Order date" value={dmy(order.orderDate)} />
            <Field label="Round" value={`#${order.roundNo}`} />
            {/* The decision GOVERNING the order — the header, not the round. A
                partial is meaningless without its figure, so it carries one. */}
            <Field
              label="Credit"
              value={
                order.ccStatus
                  ? order.ccStatus === "partial" && order.ccApprovedQty != null
                    ? `${CREDIT_STATUS_LABEL[order.ccStatus]} · ${order.ccApprovedQty} of ${totals.ordered}`
                    : CREDIT_STATUS_LABEL[order.ccStatus]
                  : "—"
              }
            />
            {order.orderRemarks && <Field label="Remarks" value={order.orderRemarks} />}
            {order.sbInvoiceNo && <Field label="Invoice (this round)" value={order.sbInvoiceNo} />}
            {order.goOutwardNo && <Field label="Gate outward (this round)" value={order.goOutwardNo} />}
          </div>
        </Card>
      </div>

      {/*
        Replaces the old Progress table. On a partial order the useful history is
        not "which steps ran" — it is WHAT WENT OUT, when, on which invoice.
      */}
      {rounds.length > 0 && (
        <Card className="p-5 space-y-3">
          <SectionHeading>Dispatch rounds</SectionHeading>
          <ScrollableTable>
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-grey-2 border-b border-line">
                  <th className="py-2 pr-3 font-semibold">Round</th>
                  <th className="py-2 pr-3 font-semibold min-w-[200px]">Shipped</th>
                  <th className="py-2 pr-3 font-semibold">Tempo no.</th>
                  <th className="py-2 pr-3 font-semibold">Porter</th>
                  <th className="py-2 pr-3 font-semibold">Tally invoice</th>
                  <th className="py-2 pr-3 font-semibold">Gate outward</th>
                  <th className="py-2 pr-3 font-semibold">Outcome</th>
                  <th className="py-2 pr-3 font-semibold">Confirmed</th>
                  <th className="py-2 pr-3 font-semibold">Documents</th>
                  {s.isProcessCoordinator && <th className="py-2 pr-3 font-semibold" />}
                </tr>
              </thead>
              <tbody>
                {rounds.map((v) => (
                  <tr key={v.roundNo} className="border-b border-line/70 last:border-0 align-top">
                    <td className="py-2 pr-3 font-semibold text-navy whitespace-nowrap">
                      R{v.roundNo}
                      {!v.isArchived && <span className="ml-1.5 text-[11px] font-medium text-orange">live</span>}
                    </td>
                    <td className="py-2 pr-3 text-grey">
                      {v.items.length
                        ? v.items.map((i) => (
                            <div key={i.id}>
                              {i.itemName ? `${i.itemName} · ` : ""}
                              {i.shipQty} {i.unitName ?? ""}
                              {i.lotNo ? ` · LOT ${i.lotNo}` : ""}
                            </div>
                          ))
                        : "—"}
                    </td>
                    {/* Per ROUND, not per order: each consignment leaves on its own
                        vehicle, and one may go by porter where the next did not. */}
                    <td className="py-2 pr-3 text-grey whitespace-nowrap">{v.msTempoNo ?? "—"}</td>
                    <td className="py-2 pr-3 text-grey whitespace-nowrap">
                      {v.msPorter === null ? "—" : v.msPorter ? "Yes" : "No"}
                    </td>
                    <td className="py-2 pr-3 text-grey whitespace-nowrap">{v.sbInvoiceNo ?? "—"}</td>
                    <td className="py-2 pr-3 text-grey whitespace-nowrap">{v.goOutwardNo ?? "—"}</td>
                    <td className="py-2 pr-3">
                      {v.dcStatus ? (
                        <OutcomePill
                          label={DELIVERY_STATUS_LABEL[v.dcStatus]}
                          tone={v.dcStatus === "returned" ? "red" : "green"}
                        />
                      ) : (
                        <span className="text-grey-2">in progress</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-grey-2 whitespace-nowrap">
                      {v.dcAt ? `${dmyTime(v.dcAt)} · ${s.personName(v.dcBy)}` : "—"}
                      {v.amendReason && (
                        <div className="text-[11.5px] text-yellow">corrected: {v.amendReason}</div>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-col gap-1">
                        {v.sbAttachmentPath && (
                          <StepDocLink path={v.sbAttachmentPath} name={v.sbAttachmentName ?? "Invoice"} />
                        )}
                        {v.dcAttachmentPath && (
                          <StepDocLink path={v.dcAttachmentPath} name={v.dcAttachmentName ?? "Receiver copy"} />
                        )}
                        {!v.sbAttachmentPath && !v.dcAttachmentPath && <span className="text-grey-2">—</span>}
                      </div>
                    </td>
                    {s.isProcessCoordinator && (
                      <td className="py-2 pr-3">
                        {v.isArchived && v.roundId && (
                          <Button size="sm" variant="ghost" onClick={() => { setAmendRound(v); setError(null); }}>
                            Correct
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollableTable>
        </Card>
      )}

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
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        title="Close this order early"
        subtitle={`${order.orderNo} · ${totals.pending} still pending`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCloseOpen(false)} disabled={busy}>Keep it open</Button>
            <Button onClick={() => act(() => s.closeOrder(order.id, reason), () => setCloseOpen(false))} disabled={busy}>
              {busy ? "Closing…" : "Close order"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-[13px] text-grey-2">
            For an order that will never be finished — the customer cancelled the balance, say.
            What has already gone out stays on record; the pending quantity is simply written off.
          </p>
          <FieldLabel label="Reason" required>
            <TextArea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </FieldLabel>
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

      {amendRound && (
        <AmendRoundModal
          round={amendRound}
          orderNo={order.orderNo}
          onClose={() => setAmendRound(null)}
        />
      )}
    </div>
  );
}

/**
 * Correct a finished round — the coordinator's remedy for a part return ("60 went
 * out, the customer kept 40") and for a mis-tapped outcome. The server
 * recalculates the delivered totals from the archive and re-opens the order if
 * the correction leaves a balance, so nothing has to be adjusted by hand.
 */
function AmendRoundModal({
  round, orderNo, onClose,
}: { round: RoundView; orderNo: string; onClose: () => void }) {
  const s = useDispatchStore();
  const [outcome, setOutcome] = useState<string>(round.dcStatus ?? "delivered");
  const [qty, setQty] = useState<Record<string, string>>(
    () => Object.fromEntries(round.items.map((i) => [i.id, String(i.shipQty)])),
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!round.roundId || busy) return;
    if (!reason.trim()) { setError("A reason is required."); return; }
    setBusy(true);
    setError(null);
    try {
      await s.amendRound(round.roundId, {
        dcStatus: outcome === "returned" ? "returned" : "delivered",
        reason: reason.trim(),
        lines: round.items
          .filter((i) => qty[i.id] !== String(i.shipQty))
          .map((i) => ({ id: i.id, shipQty: qty[i.id] })),
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the correction.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Correct round ${round.roundNo}`}
      subtitle={`${orderNo} · invoice ${round.sbInvoiceNo ?? "—"}`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save correction"}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-[13px] text-grey-2">
          Set what actually happened. Anything you take off this round goes back into pending and can
          be dispatched again — if the order had already closed, it re-opens.
        </p>

        <FieldLabel label="Delivery outcome" required>
          <Combobox
            value={outcome}
            onChange={setOutcome}
            options={[
              { value: "delivered", label: DELIVERY_STATUS_LABEL.delivered },
              { value: "returned", label: DELIVERY_STATUS_LABEL.returned },
            ]}
          />
        </FieldLabel>

        <ScrollableTable>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-grey-2 border-b border-line">
                <th className="py-1.5 pr-3 font-semibold">Item</th>
                <th className="py-1.5 pr-3 font-semibold text-right">Recorded</th>
                <th className="py-1.5 pr-3 font-semibold">Actually delivered</th>
              </tr>
            </thead>
            <tbody>
              {round.items.map((i) => (
                <tr key={i.id} className="border-b border-line/70 last:border-0">
                  <td className="py-1.5 pr-3 text-navy">{i.itemName}</td>
                  <td className="py-1.5 pr-3 text-grey text-right tabular-nums">
                    {i.shipQty} {i.unitName ?? ""}
                  </td>
                  <td className="py-1.5 pr-3">
                    <TextInput
                      value={qty[i.id] ?? ""}
                      onChange={(e) => setQty((p) => ({ ...p, [i.id]: e.target.value }))}
                      inputMode="decimal"
                      className="w-28 text-right tabular-nums"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollableTable>

        <FieldLabel label="Reason" required>
          <TextArea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
            placeholder="e.g. 20 bags refused at the dock" />
        </FieldLabel>

        {error && <p className="text-[13px] font-medium text-ryg-red">{error}</p>}
      </div>
    </Modal>
  );
}
