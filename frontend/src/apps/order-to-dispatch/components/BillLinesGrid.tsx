import { TextInput } from "@/shared/components/ui/Form";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useDispatchStore } from "../store";
import { sharedUnit } from "../lib/format";
import type { DispatchOrder } from "../types";

/**
 * WHAT THE INVOICE ACTUALLY COVERS — the billing desk's own quantity, typed
 * against what the store released.
 *
 * WHY IT EXISTS: `ship_qty` used to be the only quantity in the system. The
 * billing clerk could see what was picked but had no way to say the Tally
 * invoice covered less than that, so a short bill was invisible everywhere
 * downstream — the gate pass printed the picked figure, and the order settled
 * against it as though the whole lot had been invoiced.
 *
 * ⚠ THIS GRID BELONGS TO THE SALES-BILL STEP, AND ONLY TO IT. Rights come for
 *   free: `fms_dispatch_can_act` on the sales_bill step already gates the RPC
 *   behind admin, the coordinator, or the configured step owner, so nobody else
 *   can reach these boxes. There is no second permission check to add here, and
 *   one added anyway could only ever disagree with the server.
 *
 * Three deliberate choices, all mirroring ShipLinesGrid for the same reasons:
 *   • It seeds BLANK on a first record, never with the going-out figure.
 *     Pre-filling would make "bill everything" the accidental default, which is
 *     exactly the state this grid exists to make deliberate. An EDIT seeds from
 *     what was saved, because there the stored answer is the thing being changed.
 *   • Each line is capped at what went out. You cannot invoice what did not
 *     leave the building, and the gate pass prints this figure.
 *   • A blank line is a line NOT billed. Its quantity stays pending and comes
 *     back as its own round — the same road a short-shipped line already takes.
 */

export interface BillLineValue {
  id: string;
  bill_qty: string;
}

/** The lines going out this round, seeded from whatever is already billed. */
export function billLinesFrom(order: DispatchOrder): BillLineValue[] {
  return order.lines
    .filter((l) => (l.shipQty ?? 0) > 0)
    .map((l) => ({
      id: l.id,
      // ⚠ 0 SEEDS AS BLANK, not as "0". Zero is how the server records "went out,
      //   not billed"; echoing it back as a typed figure would read as a decision
      //   someone made in this box rather than the absence of one.
      bill_qty: l.billQty ? String(l.billQty) : "",
    }));
}

/** How many lines are asking to invoice more than the store released. */
export const overBilledCount = (order: DispatchOrder, values: BillLineValue[]): number => {
  const byId = new Map(values.map((v) => [v.id, v]));
  return order.lines.filter((l) => {
    const ship = Number(l.shipQty) || 0;
    if (ship <= 0) return false;
    return (Number(byId.get(l.id)?.bill_qty) || 0) > ship;
  }).length;
};

export default function BillLinesGrid({
  order, values, onChange, readOnly = false,
}: {
  order: DispatchOrder;
  values: BillLineValue[];
  onChange: (next: BillLineValue[]) => void;
  readOnly?: boolean;
}) {
  const s = useDispatchStore();
  const byId = new Map(values.map((v) => [v.id, v]));
  // Only what is going out this round. The balance of the order belongs to a
  // LATER round and must not be invited onto this invoice — the same rule the
  // read-only recap has always followed.
  const lines = order.lines.filter((l) => (l.shipQty ?? 0) > 0);

  const patch = (id: string, bill_qty: string) => {
    onChange(values.map((v) => (v.id === id ? { ...v, bill_qty } : v)));
  };

  const shipTotal = lines.reduce((a, l) => a + (Number(l.shipQty) || 0), 0);
  // Summed from `values`, not from the order: this is being typed right now.
  const billTotal = lines.reduce((a, l) => a + (Number(byId.get(l.id)?.bill_qty) || 0), 0);
  const totalUnit = sharedUnit(lines);
  const short = billTotal > 0 && billTotal < shipTotal;

  if (lines.length === 0) {
    return (
      <p className="text-[12.5px] text-grey-2">
        Nothing has been picked for this round yet — there is nothing to bill.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <ScrollableTable>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-grey-2 border-b border-line">
              <th className="py-2 pr-3 font-semibold min-w-[190px]">Item</th>
              <th className="py-2 pr-3 font-semibold text-right whitespace-nowrap">Going out</th>
              {/* Directly beside the figure it is measured against, so the ceiling
                  is readable without looking anywhere else. */}
              <th className="py-2 pr-3 font-semibold w-[104px]">Sales bill qty</th>
              <th className="py-2 pr-3 font-semibold w-[56px]">Unit</th>
              {/* Fixed, not `min-w`: a LOT number is one unbroken token, so a
                  min-width lets it push the whole table sideways instead of
                  wrapping. The width plus `break-words` on the cell is what
                  actually keeps it inside the dialog. */}
              <th className="py-2 pr-3 font-semibold w-[150px]">LOT no.</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const v = byId.get(l.id) ?? { id: l.id, bill_qty: "" };
              const ship = Number(l.shipQty) || 0;
              const over = (Number(v.bill_qty) || 0) > ship;
              return (
                <tr key={l.id} className="border-b border-line/70 last:border-0">
                  <td className="py-2 pr-3 text-navy">{s.itemName(l.itemId)}</td>
                  <td className="py-2 pr-3 text-navy font-semibold text-right tabular-nums">{ship}</td>
                  <td className="py-2 pr-3">
                    {/*
                      ⚠ THE WIDTH IS ON THE WRAPPER, NOT ON THE INPUT, AND IT HAS TO
                        BE. `cn` (shared/lib/cn.ts) is a plain string joiner — not
                        tailwind-merge — so a `w-24` passed as className does not
                        replace the `w-full` baked into `fieldBase`; both survive
                        and Tailwind's own source order decides, which `w-full`
                        wins. The box then eats the whole cell and shoves the LOT
                        column off the dialog. Constraining the parent and letting
                        the input keep its `w-full` is deterministic.

                        Sized for five digits at 14px, with room for a decimal.
                        NOT `maxLength={5}` — quantities are numeric(14,3) and a
                        legitimate "1234.5" is six characters.
                    */}
                    <div className="w-[92px]">
                      <TextInput
                        value={v.bill_qty}
                        onChange={(e) => patch(l.id, e.target.value)}
                        disabled={readOnly}
                        inputMode="decimal"
                        placeholder="0"
                        className={`px-2.5 text-right tabular-nums${over ? " border-ryg-red" : ""}`}
                      />
                    </div>
                  </td>
                  <td className="py-2 pr-3 text-grey whitespace-nowrap">{l.unit || "—"}</td>
                  {/* `break-words` so a slash-run like 2604842/490/2604841/10 wraps
                      onto a second line instead of widening the table. */}
                  <td className="py-2 pr-3 text-grey break-words">{l.lotNo ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-line text-navy">
              <td className="py-2 pr-3 text-[11.5px] font-semibold uppercase tracking-wide text-grey-2">
                Total
              </td>
              <td className="py-2 pr-3 text-right tabular-nums font-bold">{shipTotal}</td>
              {/* Same 92px as the wrapper above, so the running total sits under
                  the boxes it is adding rather than beside them. */}
              <td className="py-2 pr-3">
                <span className="block w-[92px] pr-2.5 text-right tabular-nums font-bold text-orange">
                  {billTotal || "—"}
                </span>
              </td>
              <td className="py-2 pr-3 text-grey whitespace-nowrap">{totalUnit || "—"}</td>
              <td className="py-2 pr-3" />
            </tr>
          </tfoot>
        </table>
      </ScrollableTable>

      {/*
        THE CONSEQUENCE, STATED BEFORE IT HAPPENS. Billing short is legal and
        sometimes right, but it leaves a balance the order will keep asking for —
        and a quantity that has physically left the gate with no invoice against
        it. Someone finding that out a week later, from a queue the order
        unexpectedly reappeared in, is the failure this line exists to prevent.
      */}
      <p className={`text-[12.5px] ${short ? "text-navy" : "text-grey-2"}`}>
        {billTotal <= 0
          ? "Enter the quantity the Tally invoice actually covers. This is what prints on the gate pass."
          : short
            ? `Billing ${billTotal}${totalUnit ? ` ${totalUnit}` : ""} of the ${shipTotal} going out — the balance stays pending and comes back as its own round.`
            : "The full consignment is being billed."}
      </p>
    </div>
  );
}
