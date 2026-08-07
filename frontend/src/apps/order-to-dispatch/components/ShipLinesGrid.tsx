import { TextInput } from "@/shared/components/ui/Form";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useDispatchStore } from "../store";
import { creditHeadroomOf, pendingQtyOf } from "../lib/rounds";
import { qtyTotals, sharedUnit } from "../lib/format";
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
 */

export interface ShipLineValue {
  id: string;
  ship_qty: string;
  lot_no: string;
}

/** Seed from the order's live header — an edit shows what this round already has. */
export function shipLinesFrom(order: DispatchOrder): ShipLineValue[] {
  return order.lines.map((l) => ({
    id: l.id,
    ship_qty: l.shipQty !== null && l.shipQty !== undefined ? String(l.shipQty) : "",
    lot_no: l.lotNo ?? "",
  }));
}

export default function ShipLinesGrid({
  order, values, onChange, readOnly = false,
}: {
  order: DispatchOrder;
  values: ShipLineValue[];
  onChange: (next: ShipLineValue[]) => void;
  readOnly?: boolean;
}) {
  const s = useDispatchStore();
  const byId = new Map(values.map((v) => [v.id, v]));

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
              <th className="py-2 pr-3 font-semibold min-w-[150px]">LOT no.</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((l) => {
              const v = byId.get(l.id) ?? { id: l.id, ship_qty: "", lot_no: "" };
              const pending = pendingQtyOf(l);
              const done = pending <= 0;
              const unit = l.unit ?? "";
              return (
                <tr key={l.id} className="border-b border-line/70 last:border-0">
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
                      <TextInput
                        value={v.lot_no}
                        onChange={(e) => patch(l.id, { lot_no: e.target.value })}
                        disabled={readOnly}
                        placeholder="as marked on the stock"
                      />
                    )}
                  </td>
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
