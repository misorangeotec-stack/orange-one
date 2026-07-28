import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { TextInput } from "@/shared/components/ui/Form";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useDispatchStore } from "../store";
import type { DispatchOrder } from "../types";

/**
 * Per-line half of the LOT-confirmation step — the sheet's "LOT No. Use for
 * Dispatch" and "Final Dispatch Qty" columns, one row per item line.
 *
 * The LOT picker is a MASTER, filtered to the line's own item. The source sheet
 * typed a bare number into a cell; making it a master is what stops a mistyped lot
 * from existing at all, and a store keeper who finds an unlisted lot raises a
 * master request instead of inventing one.
 */
export interface LcLineValue {
  id: string;
  lot_id: string;
  final_qty: string;
  final_unit_id: string;
  packing_type_id: string;
  packs: string;
  lc_shortfall_reason_id: string;
}

export const lcLinesFrom = (order: DispatchOrder): LcLineValue[] =>
  order.lines.map((l) => ({
    id: l.id,
    lot_id: l.lotId ?? "",
    // Default the final quantity to whatever the stock check found available, or
    // to the ordered quantity — the common case is "all of it".
    final_qty:
      l.finalQty !== null ? String(l.finalQty)
      : l.msAvailableQty !== null ? String(l.msAvailableQty)
      : String(l.quantity),
    final_unit_id: l.finalUnitId ?? l.unitId ?? "",
    packing_type_id: l.packingTypeId ?? "",
    packs: l.packs !== null ? String(l.packs) : "",
    lc_shortfall_reason_id: l.lcShortfallReasonId ?? "",
  }));

export default function LotLinesGrid({
  order,
  values,
  onChange,
  readOnly,
}: {
  order: DispatchOrder;
  values: LcLineValue[];
  onChange: (next: LcLineValue[]) => void;
  readOnly?: boolean;
}) {
  const s = useDispatchStore();
  const unitOptions: ComboOption[] = s.activeOf(s.units).map((u) => ({ value: u.id, label: u.name }));
  const packingOptions: ComboOption[] = s.activeOf(s.packingTypes).map((p) => ({ value: p.id, label: p.name }));
  const reasonOptions: ComboOption[] = s.activeOf(s.shortfallReasons).map((r) => ({ value: r.id, label: r.name }));

  const patch = (id: string, next: Partial<LcLineValue>) =>
    onChange(values.map((v) => (v.id === id ? { ...v, ...next } : v)));

  /** Lots for this line's item. Lots with no item set are offered everywhere. */
  const lotOptionsFor = (itemId: string): ComboOption[] =>
    s
      .activeOf(s.lots)
      .filter((l) => !l.itemId || l.itemId === itemId)
      .map((l) => ({
        value: l.id,
        label: l.name,
        sublabel: l.availableQty !== null ? `${l.availableQty} available` : undefined,
      }));

  return (
    <ScrollableTable>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left text-grey-2 border-b border-line">
            <th className="py-2 pr-3 font-semibold min-w-[190px]">Item</th>
            <th className="py-2 pr-3 font-semibold w-[110px]">Ordered</th>
            <th className="py-2 pr-3 font-semibold min-w-[190px]">LOT no.</th>
            <th className="py-2 pr-3 font-semibold w-[130px] min-w-[130px]">Final qty</th>
            <th className="py-2 pr-3 font-semibold w-[110px] min-w-[110px]">Unit</th>
            <th className="py-2 pr-3 font-semibold min-w-[150px]">Packing</th>
            <th className="py-2 pr-3 font-semibold w-[100px] min-w-[100px]">Packs</th>
            <th className="py-2 pr-3 font-semibold min-w-[180px]">Shortfall reason</th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((l) => {
            const v = values.find((x) => x.id === l.id);
            if (!v) return null;
            const short = Number(v.final_qty || 0) < Number(l.quantity || 0);
            return (
              <tr key={l.id} className="border-b border-line/70 last:border-0">
                <td className="py-2 pr-3 text-navy">{s.itemName(l.itemId)}</td>
                <td className="py-2 pr-3 text-grey-2 whitespace-nowrap">
                  {l.quantity} {s.unitName(l.unitId)}
                </td>
                <td className="py-2 pr-3">
                  <Combobox
                    value={v.lot_id}
                    onChange={(next) => patch(l.id, { lot_id: next })}
                    options={lotOptionsFor(l.itemId)}
                    placeholder="Select LOT…"
                    searchable
                    disabled={readOnly}
                    triggerClassName="px-2.5 py-1.5 text-[13px]"
                  />
                </td>
                <td className="py-2 pr-3">
                  <TextInput
                    value={v.final_qty}
                    inputMode="decimal"
                    disabled={readOnly}
                    onChange={(e) => patch(l.id, { final_qty: e.target.value })}
                    className="px-2.5 py-1.5 text-[13px]"
                    placeholder="0"
                  />
                </td>
                <td className="py-2 pr-3">
                  <Combobox
                    value={v.final_unit_id}
                    onChange={(next) => patch(l.id, { final_unit_id: next })}
                    options={unitOptions}
                    placeholder="Unit"
                    disabled={readOnly}
                    triggerClassName="px-2.5 py-1.5 text-[13px]"
                  />
                </td>
                <td className="py-2 pr-3">
                  <Combobox
                    value={v.packing_type_id}
                    onChange={(next) => patch(l.id, { packing_type_id: next })}
                    options={packingOptions}
                    placeholder="Packing…"
                    disabled={readOnly}
                    triggerClassName="px-2.5 py-1.5 text-[13px]"
                  />
                </td>
                <td className="py-2 pr-3">
                  <TextInput
                    value={v.packs}
                    inputMode="decimal"
                    disabled={readOnly}
                    onChange={(e) => patch(l.id, { packs: e.target.value })}
                    className="px-2.5 py-1.5 text-[13px]"
                    placeholder="0"
                  />
                </td>
                <td className="py-2 pr-3">
                  <Combobox
                    value={v.lc_shortfall_reason_id}
                    onChange={(next) => patch(l.id, { lc_shortfall_reason_id: next })}
                    options={reasonOptions}
                    placeholder={short ? "Why short?" : "—"}
                    disabled={readOnly || !short}
                    triggerClassName="px-2.5 py-1.5 text-[13px]"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollableTable>
  );
}
