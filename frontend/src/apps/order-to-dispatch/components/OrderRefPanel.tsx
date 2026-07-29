import type { ReactNode } from "react";
import { Field } from "@/shared/components/ui/Readout";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useDispatchStore } from "../store";
import StepDocLink from "./StepDocLink";
import { pendingQtyOf, type RoundView } from "../lib/rounds";
import { CREDIT_STATUS_LABEL, DISPATCH_TYPE_LABEL, dmy } from "../lib/format";
import type { DispatchOrder } from "../types";

/**
 * The tinted recap card every step after credit opens with.
 *
 * WHY IT EXISTS: before this, each step modal was a bare form. The person writing
 * a gate entry could not see which invoice they were gating, and the person
 * raising the invoice could not see what the store had actually picked. One shell
 * rather than four hand-rolled context divs, because four would drift — exactly
 * as procurement's did before its RefPanel was pulled out.
 *
 * ⚠ THE DISABLED-FIELDSET TRAP. `Modal` puts its body inside `<fieldset disabled>`
 *   in read-only mode, which flattens EVERY button inside it. `StepDocLink` IS a
 *   button — it mints a short-lived signed URL on click, so it cannot be a plain
 *   anchor. So in `readOnly` this panel renders the numbers as plain text with no
 *   link (a link that looks live and does nothing is worse than none), and the
 *   caller passes `OrderRefDocs` to `Modal`'s `readOnlyHeader`, which sits
 *   OUTSIDE the fieldset. On the record path there is no fieldset, so the
 *   in-panel link works and is the one the gate person actually uses.
 */

export function RefPanel({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-page/50 p-4 space-y-3">{children}</div>
  );
}

export interface OrderRefPanelProps {
  order: DispatchOrder;
  round: RoundView;
  readOnly?: boolean;
  /** Credit outcome + the remark behind it. */
  showCredit?: boolean;
  /** The full item list: ordered · dispatched · pending · going out now · LOT. */
  showLines?: boolean;
  /** Tally invoice no. (+ a button to open it, when not read-only). */
  showInvoice?: boolean;
  /** Gate outward no. */
  showOutward?: boolean;
  children?: ReactNode;
}

export default function OrderRefPanel({
  order, round, readOnly = false,
  showCredit = false, showLines = false, showInvoice = false, showOutward = false,
  children,
}: OrderRefPanelProps) {
  const s = useDispatchStore();

  return (
    <RefPanel>
      {/*
        The fixed cells are the literal answer to "show whatever we entered in the
        previous steps": everything the raiser typed, plus which round this is.
        `orderRemarks` is one of only four intake fields, so it is the most likely
        place a special instruction lives — it must not be the thing that is cut.
      */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Order no." value={order.orderNo} />
        <Field label="Round" value={`#${round.roundNo}`} />
        <Field label="Customer" value={s.customerName(order.customerId)} />
        <Field
          label="Company"
          value={order.companyId ? s.masterName("company", order.companyId) : "—"}
        />
        <Field label="Dispatch type" value={DISPATCH_TYPE_LABEL[order.dispatchType]} />
        <Field label="Order date" value={dmy(order.orderDate)} />
        <Field label="Raised by" value={order.requesterName} />
        {order.orderRemarks && <Field label="Order remarks" value={order.orderRemarks} />}

        {showCredit && (
          <Field
            label="Credit"
            value={order.ccStatus ? CREDIT_STATUS_LABEL[order.ccStatus] : "—"}
          />
        )}
        {showCredit && order.ccRemarks && <Field label="Credit remark" value={order.ccRemarks} />}

        {showInvoice && <Field label="Tally invoice no." value={round.sbInvoiceNo ?? "—"} />}
        {showOutward && <Field label="Gate outward no." value={round.goOutwardNo ?? "—"} />}
        {children}
      </div>

      {/* The invoice itself. See the trap note above for why this is gated. */}
      {showInvoice && !readOnly && round.sbAttachmentPath && (
        <div>
          <StepDocLink path={round.sbAttachmentPath} name={round.sbAttachmentName ?? "Sales invoice"} />
        </div>
      )}

      {showLines && <RefLines order={order} round={round} />}
    </RefPanel>
  );
}

/**
 * What was ordered AND what dispatch has picked for this round — both halves,
 * deliberately. Showing only the picked lines would leave the billing clerk
 * unable to see that three more lines were requested and are still pending.
 */
function RefLines({ order, round }: { order: DispatchOrder; round: RoundView }) {
  const s = useDispatchStore();
  const shipByLine = new Map(round.items.map((i) => [i.orderItemId ?? "", i]));

  return (
    <ScrollableTable>
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-left text-grey-2 border-b border-line">
            <th className="py-1.5 pr-3 font-semibold min-w-[170px]">Item</th>
            <th className="py-1.5 pr-3 font-semibold text-right">Ordered</th>
            <th className="py-1.5 pr-3 font-semibold text-right">Dispatched</th>
            <th className="py-1.5 pr-3 font-semibold text-right">Pending</th>
            <th className="py-1.5 pr-3 font-semibold text-right">Going out now</th>
            <th className="py-1.5 pr-3 font-semibold">LOT no.</th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((l) => {
            const ship = shipByLine.get(l.id);
            const unit = s.unitName(l.unitId);
            return (
              <tr key={l.id} className="border-b border-line/70 last:border-0">
                <td className="py-1.5 pr-3 text-navy">{s.itemName(l.itemId)}</td>
                <td className="py-1.5 pr-3 text-grey text-right tabular-nums whitespace-nowrap">
                  {l.quantity} {unit}
                </td>
                <td className="py-1.5 pr-3 text-grey text-right tabular-nums">{l.dispatchedQty || "—"}</td>
                <td className="py-1.5 pr-3 text-grey text-right tabular-nums">{pendingQtyOf(l) || "—"}</td>
                <td className="py-1.5 pr-3 text-navy font-semibold text-right tabular-nums">
                  {ship ? ship.shipQty : "—"}
                </td>
                <td className="py-1.5 pr-3 text-grey">{ship?.lotNo ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollableTable>
  );
}

/**
 * The panel's attachments ALONE, for `Modal`'s `readOnlyHeader` slot — the one
 * place outside the disabled fieldset. Returns null when there is nothing to
 * open, so a caller can pass it unconditionally.
 */
export function OrderRefDocs({
  round, showInvoice = false, showReceiver = false,
}: { round: RoundView; showInvoice?: boolean; showReceiver?: boolean }) {
  const invoice = showInvoice && round.sbAttachmentPath ? round.sbAttachmentPath : null;
  const receiver = showReceiver && round.dcAttachmentPath ? round.dcAttachmentPath : null;
  if (!invoice && !receiver) return null;
  return (
    <div className="flex flex-wrap items-center gap-4">
      {invoice && <StepDocLink path={invoice} name={round.sbAttachmentName ?? "Sales invoice"} />}
      {receiver && <StepDocLink path={receiver} name={round.dcAttachmentName ?? "Receiver copy / LR"} />}
    </div>
  );
}
