import { TextInput } from "@/shared/components/ui/Form";
import LotAllocField, { filledLots, rowsFrom, type LotRow } from "./LotAllocField";
import { expiryKey, useLotExpiries } from "../data/lotExpiry";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useDispatchStore } from "../store";
import { makeBookOf, useLotsForItems } from "../lib/lotPicker";
import { creditHeadroomOf, pendingQtyOf } from "../lib/rounds";
import { dmy, qtyTotals, sharedUnit } from "../lib/format";
import type { DispatchOrder } from "../types";

/**
 * The heart of the reshaped flow: which lines are going out THIS round, how much
 * of each, and from which LOT.
 *
 * NOT a LineGrid. The lines already exist and their item and ordered quantity are
 * fixed intake, so nothing is appended or removed here — only the two dispatch
 * columns are editable. That is also why partial dispatch is expressed per line
 * rather than as an order-level state.
 *
 * Two deliberate choices:
 *   • "Ship now" seeds BLANK, never "all of it". This is a partial step by design;
 *     pre-filling the balance would make sending everything the accidental default.
 *   • A line with nothing left pending is locked and labelled Complete. It cannot
 *     be typed into, so nobody discovers by round-trip that the server refuses it.
 *
 * ⚠ THE CREDIT CEILING IS A SUM, NOT A PER-LINE CLAMP. Credit approves a quantity
 *   for the consignment and leaves the split to whoever can see the stock, so no
 *   individual input is capped — the TOTAL is, and it says so live in the footer.
 *   Clamping rows individually would invent a per-line allocation credit never
 *   made. A null headroom means uncapped: every order raised before partial
 *   approval existed has one, and they must keep behaving exactly as they did.
 *
 * THE LOT COMES LIVE FROM TALLY (OD-12), BUT CAN STILL BE TYPED.
 *   It used to be a bare text box reading "as marked on the stock", so a lot could be mistyped
 *   or invented and nothing checked it. It is now a picker of the lots Tally actually holds for
 *   that item, with how much of each is left.
 *
 *   ⚠ Typing is deliberately still allowed, via the picker's `onCreate`. The balance is Tally's
 *     paper trail, not a physical count, and ~3.6% of lots do not resolve to a clean figure. A
 *     lot in the store keeper's hands that we cannot see — Tally not yet posted, a manual
 *     adjustment — must never block a dispatch. The list HELPS; it does not gate.
 *
 *   ⚠ If ConnectWave is unreachable the fetch returns [] and this degrades to exactly the old
 *     free-text box. Dispatch does not wait on a reporting mirror.
 *
 * ONE SHIPMENT CAN DRAW ON SEVERAL LOTS (OD-15).
 *   The cell is now a multi-select with a quantity against each lot, in `LotAllocField`. Both
 *   principles above are ITS principles too and neither moved: typing stays possible, and the
 *   balance still only advises.
 *
 *   ⚠ A SINGLE LOT ASKS FOR NOTHING EXTRA — no quantity box, no second row, one line of balance
 *     text where the dropdown's sublabel used to be. 4,354 of 4,455 shipped lines are single-lot
 *     and that path must not get slower to type than the plain picker it replaces.
 *
 *   OD-16 · and several lots ask only when they must: when the picked lots hold no more than Ship
 *     now, their boxes fill from Tally's balances (`autoFill`). On here, deliberately NOT on the
 *     coordinator's correction screen, which edits a line that has already gone out.
 *
 * EXPIRY, PER LOT (gate pass). Tally's date shows read-only when Tally has one. Where
 *   it has none the store keeper may type it; edits are held by the caller
 *   (`expiryEdits`, keyed `expiryKey(itemId, lot)`) and saved with the step. The box
 *   only appears once the lot-expiry table exists on the database.
 */

export interface ShipLineValue {
  id: string;
  ship_qty: string;
  /** OD-15 · the lots this line draws on. Always at least one row, possibly blank. */
  lots: LotRow[];
}

/** Seed from the order's live header — an edit shows what this round already has. */
export function shipLinesFrom(order: DispatchOrder): ShipLineValue[] {
  return order.lines.map((l) => ({
    id: l.id,
    ship_qty: l.shipQty !== null && l.shipQty !== undefined ? String(l.shipQty) : "",
    // `rowsFrom` never parses a stored string — see its note. A line recorded
    // before OD-15 comes back as ONE row holding the whole value.
    lots: rowsFrom(l.lots, l.lotNo),
  }));
}

export default function ShipLinesGrid({
  order, values, onChange, readOnly = false, expiryEdits, onExpiryEdits,
}: {
  order: DispatchOrder;
  values: ShipLineValue[];
  onChange: (next: ShipLineValue[]) => void;
  readOnly?: boolean;
  /** Typed expiries changed on this screen. Omit both to hide the Expiry column. */
  expiryEdits?: Record<string, string>;
  onExpiryEdits?: (next: Record<string, string>) => void;
}) {
  const s = useDispatchStore();
  const byId = new Map(values.map((v) => [v.id, v]));

  /*
    The fetch and the book-naming both MOVED to lib/lotPicker when the correction
    screen gained the same field. One copy, so the NUL-joined dependency key and
    the financial-year trim cannot drift apart between the two screens.
  */
  const companyGuid = s.companies.find((c) => c.id === order.companyId)?.tallyGuid ?? null;
  const lots = useLotsForItems(order.lines.map((l) => s.itemName(l.itemId)), companyGuid);
  const bookOf = makeBookOf(s.companies);

  const showExpiry = !!expiryEdits && !!onExpiryEdits;
  const exp = useLotExpiries(
    showExpiry
      ? order.lines.flatMap((l) =>
          filledLots(byId.get(l.id)?.lots ?? []).map((r) => ({
            itemId: l.itemId, itemName: s.itemName(l.itemId), lot: r.lot_no,
          })))
      : [],
    companyGuid,
  );

  const patch = (id: string, part: Partial<ShipLineValue>) => {
    onChange(values.map((v) => (v.id === id ? { ...v, ...part } : v)));
  };

  // Ordered / dispatched / pending come off the order. "Ship now" must NOT — it is
  // being typed right now, so it is summed from `values` and moves as you type.
  const t = qtyTotals(order);
  const total = order.lines.reduce((a, l) => a + (Number(byId.get(l.id)?.ship_qty) || 0), 0);
  // Named for the totals row — the row map has its own per-line `unit`.
  const totalUnit = sharedUnit(order.lines);
  const headroom = creditHeadroomOf(order);
  const over = headroom !== null && total > headroom;

  return (
    <div className="space-y-2">
      <ScrollableTable>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-grey-2 border-b border-line">
              <th className="py-2 pr-3 font-semibold min-w-[180px]">Item</th>
              <th className="py-2 pr-3 font-semibold text-right">Ordered</th>
              <th className="py-2 pr-3 font-semibold text-right">Dispatched so far</th>
              <th className="py-2 pr-3 font-semibold text-right">Pending</th>
              <th className="py-2 pr-3 font-semibold min-w-[120px]">Ship now</th>
              <th className="py-2 pr-3 font-semibold min-w-[230px]">LOT no.</th>
              {showExpiry && <th className="py-2 pr-3 font-semibold min-w-[150px]">Expiry</th>}
            </tr>
          </thead>
          <tbody>
            {order.lines.map((l) => {
              const v = byId.get(l.id) ?? { id: l.id, ship_qty: "", lots: [{ lot_no: "", qty: "" }] };
              const pending = pendingQtyOf(l);
              const done = pending <= 0;
              const unit = l.unit ?? "";
              return (
                <tr key={l.id} className="border-b border-line/70 last:border-0 align-top">
                  <td className="py-2 pr-3 text-navy">
                    {s.itemName(l.itemId)}
                    {l.lineRemark && <span className="block text-[12px] text-grey-2">{l.lineRemark}</span>}
                  </td>
                  <td className="py-2 pr-3 text-grey text-right tabular-nums whitespace-nowrap">
                    {l.quantity} {unit}
                  </td>
                  <td className="py-2 pr-3 text-grey text-right tabular-nums">{l.dispatchedQty || "—"}</td>
                  <td className="py-2 pr-3 text-right tabular-nums font-semibold text-navy">
                    {done ? <span className="text-ryg-green">Complete</span> : pending}
                  </td>
                  <td className="py-2 pr-3">
                    {done ? (
                      <span className="text-[12.5px] text-grey-2">—</span>
                    ) : (
                      <TextInput
                        value={v.ship_qty}
                        onChange={(e) => patch(l.id, { ship_qty: e.target.value })}
                        disabled={readOnly}
                        inputMode="decimal"
                        placeholder="0"
                        className="w-24 text-right tabular-nums"
                      />
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {done ? (
                      <span className="text-[12.5px] text-grey-2">—</span>
                    ) : (
                      <LotAllocField
                        rows={v.lots}
                        onChange={(lots) => patch(l.id, { lots })}
                        quantity={v.ship_qty}
                        unit={unit}
                        options={lots[s.itemName(l.itemId)] ?? []}
                        bookOf={bookOf}
                        disabled={readOnly}
                        autoFill
                      />
                    )}
                  </td>
                  {showExpiry && (
                    <td className="py-2 pr-3">
                      {done ? (
                        <span className="text-[12.5px] text-grey-2">—</span>
                      ) : (
                        <div className="space-y-1">
                          {filledLots(v.lots).map((r) => {
                            const fromTally = exp.tally.get(expiryKey(s.itemName(l.itemId), r.lot_no));
                            const k = expiryKey(l.itemId, r.lot_no);
                            return (
                              <div key={r.lot_no} className="flex items-center gap-2 text-[12.5px]">
                                {filledLots(v.lots).length > 1 && (
                                  <span className="text-grey-2 truncate max-w-[90px]" title={r.lot_no}>{r.lot_no}</span>
                                )}
                                {fromTally ? (
                                  <span className="text-navy" title="From Tally">
                                    {dmy(fromTally)} <span className="text-grey-2">· Tally</span>
                                  </span>
                                ) : exp.typedAvailable ? (
                                  <input
                                    type="date"
                                    value={expiryEdits![k] ?? exp.typed.get(k) ?? ""}
                                    onChange={(e) => onExpiryEdits!({ ...expiryEdits!, [k]: e.target.value })}
                                    disabled={readOnly}
                                    title="Tally has no expiry for this lot — enter it from the label"
                                    className="h-8 rounded-md border border-line px-2 text-[12.5px] text-navy"
                                  />
                                ) : (
                                  <span className="text-grey-2">—</span>
                                )}
                              </div>
                            );
                          })}
                          {filledLots(v.lots).length === 0 && <span className="text-[12.5px] text-grey-2">Pick a lot</span>}
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          {/*
            Every figure column carries its own total, sitting directly under the
            column it sums. "Ship now" is the live one — it re-adds on each keystroke,
            so the store keeper can see the round's total without a calculator.
          */}
          <tfoot>
            <tr className="border-t border-line text-navy">
              <td className="py-2 pr-3 text-[11.5px] font-semibold uppercase tracking-wide text-grey-2">
                Total
              </td>
              <td className="py-2 pr-3 text-right tabular-nums font-bold whitespace-nowrap">
                {t.ordered} {totalUnit}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums font-bold">{t.dispatched || "—"}</td>
              <td className="py-2 pr-3 text-right tabular-nums font-bold">{t.pending || "—"}</td>
              {/* w-24 matches the input above it, so the figure lines up with the box. */}
              <td className="py-2 pr-3">
                <span
                  className={`block w-24 text-right tabular-nums font-bold ${
                    over ? "text-ryg-red" : "text-orange"
                  }`}
                >
                  {total || "—"}
                </span>
              </td>
              <td className="py-2 pr-3" />
              {showExpiry && <td className="py-2 pr-3" />}
            </tr>
          </tfoot>
        </table>
      </ScrollableTable>

      {/* The ceiling belongs beside the figure it caps, and it has to be legible
          BEFORE anyone types — a limit discovered by a refused save is not a
          limit, it is a surprise. */}
      {headroom !== null && (
        <p className={`text-[12.5px] ${over ? "text-ryg-red" : "text-grey-2"}`}>
          {over
            ? `Credit has authorised only ${headroom}${totalUnit ? ` ${totalUnit}` : ""} more on this order — reduce the quantities going out.`
            : `Credit approved: ${headroom}${totalUnit ? ` ${totalUnit}` : ""} still authorised.`}
        </p>
      )}

      <p className="text-[12.5px] text-grey-2">
        {total > 0
          ? "Anything left pending comes back here when it is ready."
          : "Enter a quantity against whatever is available. Use “Nothing available yet” if none of it is."}
      </p>
    </div>
  );
}
