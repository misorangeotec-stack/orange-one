import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { TextInput } from "@/shared/components/ui/Form";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useDispatchStore } from "../store";
import { MATERIAL_STATUS_OPTIONS } from "../lib/stepConfig";
import type { DispatchOrder } from "../types";

/**
 * Per-line half of the material-status step.
 *
 * NOT a LineGrid: the lines already exist and their item + ordered quantity are
 * fixed intake, so nothing is appended or removed here — only the availability
 * columns are editable. That is also why partial availability is expressed per
 * line rather than as an order-level state.
 */
export interface MsLineValue {
  id: string;
  ms_line_status: string;
  ms_available_qty: string;
  ms_shortfall_reason_id: string;
}

export const msLinesFrom = (order: DispatchOrder): MsLineValue[] =>
  order.lines.map((l) => ({
    id: l.id,
    ms_line_status: l.msLineStatus ?? "",
    ms_available_qty: l.msAvailableQty !== null ? String(l.msAvailableQty) : "",
    ms_shortfall_reason_id: l.msShortfallReasonId ?? "",
  }));

export default function StockCheckGrid({
  order,
  values,
  onChange,
  readOnly,
}: {
  order: DispatchOrder;
  values: MsLineValue[];
  onChange: (next: MsLineValue[]) => void;
  readOnly?: boolean;
}) {
  const s = useDispatchStore();
  const reasonOptions: ComboOption[] = s.activeOf(s.shortfallReasons).map((r) => ({ value: r.id, label: r.name }));

  const patch = (id: string, next: Partial<MsLineValue>) =>
    onChange(values.map((v) => (v.id === id ? { ...v, ...next } : v)));

  return (
    <ScrollableTable>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left text-grey-2 border-b border-line">
            <th className="py-2 pr-3 font-semibold min-w-[200px]">Item</th>
            <th className="py-2 pr-3 font-semibold w-[110px]">Ordered</th>
            <th className="py-2 pr-3 font-semibold min-w-[190px]">Availability</th>
            <th className="py-2 pr-3 font-semibold w-[130px] min-w-[130px]">Available qty</th>
            <th className="py-2 pr-3 font-semibold min-w-[180px]">Shortfall reason</th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((l) => {
            const v = values.find((x) => x.id === l.id);
            if (!v) return null;
            const short = v.ms_line_status === "production_required";
            return (
              <tr key={l.id} className="border-b border-line/70 last:border-0">
                <td className="py-2 pr-3 text-navy">{s.itemName(l.itemId)}</td>
                <td className="py-2 pr-3 text-grey-2 whitespace-nowrap">
                  {l.quantity} {s.unitName(l.unitId)}
                </td>
                <td className="py-2 pr-3">
                  <Combobox
                    value={v.ms_line_status}
                    onChange={(next) => patch(l.id, { ms_line_status: next })}
                    options={MATERIAL_STATUS_OPTIONS}
                    placeholder="Availability…"
                    disabled={readOnly}
                    triggerClassName="px-2.5 py-1.5 text-[13px]"
                  />
                </td>
                <td className="py-2 pr-3">
                  <TextInput
                    value={v.ms_available_qty}
                    inputMode="decimal"
                    disabled={readOnly}
                    onChange={(e) => patch(l.id, { ms_available_qty: e.target.value })}
                    className="px-2.5 py-1.5 text-[13px]"
                    placeholder={String(l.quantity)}
                  />
                </td>
                <td className="py-2 pr-3">
                  <Combobox
                    value={v.ms_shortfall_reason_id}
                    onChange={(next) => patch(l.id, { ms_shortfall_reason_id: next })}
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
