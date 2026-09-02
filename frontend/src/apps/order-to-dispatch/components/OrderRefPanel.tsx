import type { ReactNode } from "react";
import { Field } from "@/shared/components/ui/Readout";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useDispatchStore } from "../store";
import StepDocLink from "./StepDocLink";
import { billedQtyOf, isBilled, roundBillTotal, type RoundView } from "../lib/rounds";
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
  /** This round's consignment: item · going out · sales bill qty (once billed) · unit · LOT. */
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

        {/* How this consignment left, recorded at the stock check. Round-scoped and
            optional, so they appear only once someone has actually answered. */}
        {round.msTempoNo && <Field label="Tempo no." value={round.msTempoNo} />}
        {round.msPorter !== null && <Field label="Porter" value={round.msPorter ? "Yes" : "No"} />}

        {showInvoice && <Field label="Tally invoice no." value={round.sbInvoiceNo ?? "—"} />}
        {/* Rides with the invoice, because it was issued for it. Shown wherever
            the invoice is, so the number on the printed slip can be checked
            against the screen without leaving the step. */}
        {/* One number, named as both, because they ARE both: the gate outward
            entry records the gate pass number rather than a second series. */}
        {showInvoice && round.gpNo && <Field label="Gate pass / outward no." value={round.gpNo} />}
        {/*
          ⚠ ONLY WHEN IT DISAGREES, which since 20260928120000 means only on a
            round dispatched BEFORE it. The gate outward number is now derived
            from the gate pass, so on every new round these two are one value and
            printing both would just say it twice under two names. Archived
            rounds keep whatever was typed — 183 of them a mangled paste of the
            gate pass — and there the difference is the thing worth showing.
        */}
        {showOutward && round.goOutwardNo !== round.gpNo && (
          <Field label="Gate outward no. (as recorded)" value={round.goOutwardNo ?? "—"} />
        )}
        {children}
      </div>

      {/* Directly under the facts, ABOVE the documents and the item table. A
          remark is the one thing on this panel that nobody can guess from
          anywhere else, and parked at the foot it sat below a table people stop
          scrolling at. */}
      <RemarksTrail order={order} round={round} />

      {/* The invoice itself, and the e-way bill when the consignment carries one —
          the gate is exactly where both get checked. See the trap note above for
          why this is gated. */}
      {showInvoice && !readOnly && (round.sbAttachmentPath || round.sbEwayPath) && (
        <div className="flex flex-wrap items-center gap-3">
          {round.sbAttachmentPath && (
            <StepDocLink path={round.sbAttachmentPath} name={round.sbAttachmentName ?? "Sales invoice"} />
          )}
          {round.sbEwayPath && (
            <StepDocLink path={round.sbEwayPath} name={round.sbEwayName ?? "E-way bill"} />
          )}
        </div>
      )}

      {showOrderLines && <OrderedLines order={order} />}
      {showLines && <RefLines round={round} />}
    </RefPanel>
  );
}

/**
 * EVERY REMARK RECORDED SO FAR, in the order the steps happen.
 *
 * WHY IT EXISTS: each step already collected a Remarks box, and each one was
 * readable only on the step that wrote it. So the store keeper could not see why
 * credit had released only part of the order, the billing desk could not see the
 * store keeper’s note about the consignment, and the gate could see neither —
 * every desk wrote into a box the next desk never opened.
 *
 * ⚠ IT REPLACES THE TWO REMARK CELLS THAT USED TO SIT IN THE FACT GRID (order
 *   remarks, credit remark) rather than joining them. Nothing was dropped: both
 *   appear here, first and second. They moved because a remark is a sentence and
 *   the grid gave it a quarter of the width — four words a line, wrapped into a
 *   column, which is the shape people stop reading.
 *
 * ⚠ ROUND-SCOPED, EXCEPT WHERE THE ANSWER GENUINELY IS NOT. The ms/sb/go/dc
 *   remarks are read off the ROUND, so an archived round shows its own. Credit is
 *   the exception in the same way it is everywhere else in this module: a live
 *   round running under an earlier approval carries no decision of its own, so it
 *   falls back to the order header — the decision actually governing it. An
 *   archived round does NOT fall back, because there the header has moved on and
 *   borrowing it would print a later decision under an older heading.
 */
function RemarksTrail({ order, round }: { order: DispatchOrder; round: RoundView }) {
  const s = useDispatchStore();

  const entries: { step: string; text: string | null; who: string | null; at: string | null }[] = [
    { step: "Order", text: order.orderRemarks, who: order.requesterName, at: order.orderDate },
    {
      step: "Credit",
      text: round.isArchived ? round.ccRemarks : (round.ccRemarks ?? order.ccRemarks),
      who: s.personName(round.ccBy ?? order.ccBy),
      at: round.ccAt ?? order.ccAt,
    },
    { step: "Stock check", text: round.msRemarks, who: s.personName(round.msBy), at: round.msAt },
    {
      // The reason an invoice has NOT been raised. Only while the hold is live —
      // once the bill goes out the hold is history and the sales-bill remark
      // below is the current word.
      step: "Bill on hold",
      text: round.sbAt ? null : round.sbHoldReason,
      who: s.personName(round.sbHoldBy),
      at: round.sbHoldAt,
    },
    { step: "Sales bill", text: round.sbRemarks, who: s.personName(round.sbBy), at: round.sbAt },
    { step: "Gate outward", text: round.goRemarks, who: s.personName(round.goBy), at: round.goAt },
    { step: "Delivery", text: round.dcRemarks, who: s.personName(round.dcBy), at: round.dcAt },
  ].filter((e) => !!(e.text ?? "").trim());

  // No heading over an empty list. Most orders carry one remark or none, and a
  // standing "Remarks" label with nothing under it reads as a loading failure.
  if (entries.length === 0) return null;

  return (
    <section className="border-t border-line pt-3 space-y-2">
      <div className="text-[11.5px] font-semibold uppercase tracking-wide text-grey-2">
        Remarks so far
      </div>
      <ul className="space-y-2">
        {entries.map((e) => (
          <li key={e.step} className="text-[12.5px] leading-5">
            <div className="flex flex-wrap items-baseline gap-x-1.5">
              <span className="font-semibold text-navy">{e.step}</span>
              {e.who && e.who !== "—" && <span className="text-grey-2">· {e.who}</span>}
              {e.at && <span className="text-grey-2">· {dmy(e.at)}</span>}
            </div>
            {/*
              `whitespace-pre-wrap` keeps the line breaks the writer typed — a
              three-point note stays three lines instead of collapsing into one
              paragraph. `break-words` is what stops a pasted reference number or
              a URL widening the dialog instead of wrapping inside it.
            */}
            <p className="text-grey whitespace-pre-wrap break-words">{e.text}</p>
          </li>
        ))}
      </ul>
    </section>
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

  /*
    ⚠ THE BILLED COLUMN APPEARS ONLY ONCE THERE IS A BILL. Before the invoice
      is raised there is no billed figure to state, and a column of dashes beside
      the picked quantity would read as "nothing is being invoiced" rather than
      "nobody has said yet". After it, BOTH are shown: the gate person is
      checking a vehicle against an invoice, and a consignment where those two
      disagree is exactly what they need to see rather than have averaged away.
  */
  const billed = isBilled(round);
  const shipTotal = items.reduce((a, i) => a + (Number(i.shipQty) || 0), 0);
  const billTotal = roundBillTotal(round);
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
            {billed && (
              <th className="py-1.5 pr-3 font-semibold text-right whitespace-nowrap">Sales bill qty</th>
            )}
            <th className="py-1.5 pr-3 font-semibold">Unit</th>
            <th className="py-1.5 pr-3 font-semibold min-w-[130px]">LOT no.</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => {
            const q = billedQtyOf(i);
            return (
              <tr key={i.id} className="border-b border-line/70 last:border-0">
                <td className="py-1.5 pr-3 text-navy">{i.itemName || s.itemName(i.itemId)}</td>
                <td className="py-1.5 pr-3 text-navy font-semibold text-right tabular-nums">{i.shipQty}</td>
                {billed && (
                  /* Orange because it is the operative figure from here on — the
                     one on the gate pass and the one the order settles against. */
                  <td className="py-1.5 pr-3 font-semibold text-right tabular-nums text-orange">{q}</td>
                )}
                <td className="py-1.5 pr-3 text-grey whitespace-nowrap">{i.unitName || "—"}</td>
                <td className="py-1.5 pr-3 text-grey">{i.lotNo ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-line text-navy">
            <td className="py-1.5 pr-3 text-[11.5px] font-semibold uppercase tracking-wide text-grey-2">
              {billed ? "Total" : "Total going out"}
            </td>
            <td className={`py-1.5 pr-3 text-right tabular-nums font-bold${billed ? "" : " text-orange"}`}>
              {shipTotal}
            </td>
            {billed && (
              <td className="py-1.5 pr-3 text-right tabular-nums font-bold text-orange">{billTotal}</td>
            )}
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
  // Travels with the invoice — same step, same consignment — and is null on the
  // many consignments that need no e-way bill at all.
  const eway = showInvoice && round.sbEwayPath ? round.sbEwayPath : null;
  const receiver = showReceiver && round.dcAttachmentPath ? round.dcAttachmentPath : null;
  /*
    ⚠ THE EXTRA PAGES MUST APPEAR HERE OR THEY ARE UNREACHABLE. Once a delivery
      is confirmed the round is archived, so every later view of it is read-only
      — and a read-only StepModal renders no file control at all, only this
      strip. If pages 2..N are not listed here, the back of the LR is uploaded,
      stored, and can never be opened by anyone again.
  */
  const pages = showReceiver ? round.dcAttachmentPages : [];
  if (!invoice && !eway && !receiver && pages.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-4">
      {invoice && <StepDocLink path={invoice} name={round.sbAttachmentName ?? "Sales invoice"} />}
      {eway && <StepDocLink path={eway} name={round.sbEwayName ?? "E-way bill"} />}
      {receiver && (
        <StepDocLink
          path={receiver}
          // Numbered only when there is more than one, so a single-page LR is
          // not labelled "1 of 1" for the sake of consistency.
          name={pages.length > 0 ? "Receiver copy — front" : (round.dcAttachmentName ?? "Receiver copy / LR")}
        />
      )}
      {pages.map((d, i) => (
        <StepDocLink key={d.path} path={d.path} name={i === 0 ? "Receiver copy — back" : `Receiver copy — page ${i + 2}`} />
      ))}
    </div>
  );
}
