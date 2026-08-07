import type { ReactNode } from "react";
import { Field } from "@/shared/components/ui/Readout";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useDispatchStore } from "../store";
import StepDocLink from "./StepDocLink";
import type { RoundView } from "../lib/rounds";
import { CREDIT_STATUS_LABEL, DISPATCH_TYPE_LABEL, dmy, qtyTotals, sharedUnit } from "../lib/format";
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
  /** The order as raised: item · quantity · unit · line remark. */
  showOrderLines?: boolean;
  /** Tally invoice no. (+ a button to open it, when not read-only). */
  showInvoice?: boolean;
  /** Gate outward no. */
  showOutward?: boolean;
  children?: ReactNode;
}

export default function OrderRefPanel({
  order, round, readOnly = false,
  showCredit = false, showLines = false, showOrderLines = false,
  showInvoice = false, showOutward = false,
  children,
}: OrderRefPanelProps) {
  const s = useDispatchStore();

  return (
    <RefPanel>
      {/*
        The fixed cells are the literal answer to "show whatever we entered in the
        previous steps": everything the raiser typed, plus which round this is.
        `orderRemarks` is one of the intake fields, so it is the most likely place
        a special instruction lives — it must not be the thing that is cut.
      */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Order no." value={order.orderNo} />
        <Field label="Round" value={`#${round.roundNo}`} />
        <Field label="Customer" value={s.customerName(order.customerId)} />
        <Field label="Customer location" value={order.customerLocation ?? "—"} />
        {/*
          Unconditional, all three of them. They are settled the moment the order
          is raised, so every step from the credit check onwards can be shown the
          answer — there is no step that legitimately does not know them.

          ⚠ `round.companyId ?? order.companyId` and not just one of the two: the
            live projection reads the order header, an ARCHIVED round reads its own
            frozen copy, and an order raised before the company moved to intake has
            neither. The fallback covers the last case without lying about the
            first two.
        */}
        <Field label="Billing company" value={s.masterName("company", round.companyId ?? order.companyId)} />
        {/* Same round-first fallback, same reason. Sits beside the company because
            it is that company's site — reading them apart invites the wrong one. */}
        <Field
          label="Dispatch location"
          value={s.masterName("company_location", round.locationId ?? order.locationId)}
        />
        <Field label="Customer PO no." value={order.customerPoNo ?? "—"} />
        <Field label="Dispatch type" value={DISPATCH_TYPE_LABEL[order.dispatchType]} />
        <Field label="Order date" value={dmy(order.orderDate)} />
        <Field label="Raised by" value={order.requesterName} />
        {order.orderRemarks && <Field label="Order remarks" value={order.orderRemarks} />}

        {/*
          ⚠ READ OFF THE ORDER HEADER, NOT THE ROUND, and that is deliberate. This
            card answers "what is credit's decision on this order right now",
            which is the question a store keeper or a biller has. The ROUND
            carries the decision that was MADE in it — null on a round running
            under an earlier approval — and showing that here would print a dash
            on every looped consignment that is perfectly well authorised.
        */}
        {showCredit && (
          <Field
            label="Credit"
            value={
              order.ccStatus
                ? order.ccStatus === "partial" && order.ccApprovedQty != null
                  ? `${CREDIT_STATUS_LABEL[order.ccStatus]} · ${order.ccApprovedQty} approved`
                  : CREDIT_STATUS_LABEL[order.ccStatus]
                : "—"
            }
          />
        )}
        {showCredit && order.ccRemarks && <Field label="Credit remark" value={order.ccRemarks} />}

        {/* How this consignment left, recorded at the stock check. Round-scoped and
            optional, so they appear only once someone has actually answered. */}
        {round.msTempoNo && <Field label="Tempo no." value={round.msTempoNo} />}
        {round.msPorter !== null && <Field label="Porter" value={round.msPorter ? "Yes" : "No"} />}

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

      {showOrderLines && <OrderedLines order={order} />}
      {showLines && <RefLines round={round} />}
    </RefPanel>
  );
}

/**
 * The order EXACTLY as it was raised — one row per intake line, with the quantity,
 * its unit and whatever the raiser noted against that item. No round columns: this
 * is for the steps that run before anything has been picked, where "Dispatched" and
 * "Going out now" would be a column of dashes.
 */
function OrderedLines({ order }: { order: DispatchOrder }) {
  const s = useDispatchStore();
  const t = qtyTotals(order);
  const totalUnit = sharedUnit(order.lines);

  return (
    <ScrollableTable>
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-left text-grey-2 border-b border-line">
            <th className="py-1.5 pr-3 font-semibold min-w-[200px]">Item</th>
            <th className="py-1.5 pr-3 font-semibold text-right whitespace-nowrap">Quantity</th>
            <th className="py-1.5 pr-3 font-semibold">Unit</th>
            <th className="py-1.5 font-semibold min-w-[150px]">Remark</th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((l) => (
            <tr key={l.id} className="border-b border-line/70 last:border-0">
              <td className="py-1.5 pr-3 text-navy">{s.itemName(l.itemId)}</td>
              <td className="py-1.5 pr-3 text-navy font-semibold text-right tabular-nums">{l.quantity}</td>
              <td className="py-1.5 pr-3 text-grey whitespace-nowrap">{l.unit || "—"}</td>
              <td className="py-1.5 text-grey">{l.lineRemark || "—"}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line text-navy">
            <td className="py-1.5 pr-3 text-[11.5px] font-semibold uppercase tracking-wide text-grey-2">
              Total
            </td>
            <td className="py-1.5 pr-3 text-right tabular-nums font-bold">{t.ordered}</td>
            <td className="py-1.5 pr-3 text-grey whitespace-nowrap">{totalUnit || "—"}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </ScrollableTable>
  );
}

/**
 * THIS ROUND'S CONSIGNMENT — and nothing else.
 *
 * ⚠ IT DELIBERATELY DOES NOT SHOW THE ORDERED / PENDING QUANTITY. It used to show
 *   both halves so the billing clerk could see what was still owed; that was wrong.
 *   Everything downstream of the stock check acts on ONE consignment: the invoice,
 *   the gate pass and the delivery confirmation all cover exactly what the store
 *   keeper released. A quantity ordered but not picked belongs to a LATER round, and
 *   putting it on this screen invites it onto this invoice. The balance is not lost —
 *   it comes back as its own round, and the order page shows the full picture.
 *
 * Rows come off the ROUND, so an archived round shows what IT shipped rather than
 * whatever the header now holds. Archived rows carry a frozen `itemName` (so history
 * survives a master rename); the live projection leaves it blank for us to resolve.
 */
function RefLines({ round }: { round: RoundView }) {
  const s = useDispatchStore();
  const items = round.items;

  const total = items.reduce((a, i) => a + (Number(i.shipQty) || 0), 0);
  const totalUnit = sharedUnit(items.map((i) => ({ unit: i.unitName })));

  if (items.length === 0) {
    return <p className="text-[12.5px] text-grey-2">Nothing has been picked for this round yet.</p>;
  }

  return (
    <ScrollableTable>
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-left text-grey-2 border-b border-line">
            <th className="py-1.5 pr-3 font-semibold min-w-[200px]">Item</th>
            <th className="py-1.5 pr-3 font-semibold text-right whitespace-nowrap">Going out</th>
            <th className="py-1.5 pr-3 font-semibold">Unit</th>
            <th className="py-1.5 pr-3 font-semibold min-w-[130px]">LOT no.</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id} className="border-b border-line/70 last:border-0">
              <td className="py-1.5 pr-3 text-navy">{i.itemName || s.itemName(i.itemId)}</td>
              <td className="py-1.5 pr-3 text-navy font-semibold text-right tabular-nums">{i.shipQty}</td>
              <td className="py-1.5 pr-3 text-grey whitespace-nowrap">{i.unitName || "—"}</td>
              <td className="py-1.5 pr-3 text-grey">{i.lotNo ?? "—"}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line text-navy">
            <td className="py-1.5 pr-3 text-[11.5px] font-semibold uppercase tracking-wide text-grey-2">
              Total going out
            </td>
            <td className="py-1.5 pr-3 text-right tabular-nums font-bold text-orange">{total}</td>
            <td className="py-1.5 pr-3 text-grey whitespace-nowrap">{totalUnit || "—"}</td>
            <td className="py-1.5 pr-3" />
          </tr>
        </tfoot>
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
