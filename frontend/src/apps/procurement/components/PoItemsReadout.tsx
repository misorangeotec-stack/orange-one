import { useProcurementStore } from "../store";
import { inr } from "../lib/format";
import QtyTotal from "./QtyTotal";
import type { PurchaseOrder } from "../types";

/**
 * A read-only list of a PO's line items, for the PO-stage modals (Share PO, the
 * PO-number view, …). Those dialogs used to show only the PO number/terms, so a
 * viewer couldn't see WHAT the PO covers — this drops the same Item/Qty/Rate/
 * Line-Value table (with a totals row) into any of them.
 */
export default function PoItemsReadout({ po }: { po: PurchaseOrder }) {
  const s = useProcurementStore();
  const items = s.poItemsForPo(po.id);
  if (items.length === 0) return null;

  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[480px] text-[13px]">
        <thead>
          <tr className="border-b border-line bg-page/60 text-left text-grey-2">
            <th className="px-3 py-2 font-medium">Item</th>
            <th className="px-3 py-2 font-medium">Qty</th>
            <th className="px-3 py-2 font-medium">Rate</th>
            <th className="px-3 py-2 text-right font-medium">Line Value</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const line = s.lineById(it.requestItemId);
            return (
              <tr key={it.id} className="border-b border-line/70 last:border-0">
                <td className="px-3 py-2 font-medium text-navy whitespace-nowrap">{line ? s.itemLabel(line.itemId) : "—"}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {it.qty} {line?.unit ?? ""}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{inr(it.rate)}</td>
                <td className="px-3 py-2 text-right font-semibold text-navy whitespace-nowrap">{inr(it.lineValue)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-line bg-orange-soft/50">
            <td className="px-3 py-2 text-right text-[11.5px] font-semibold uppercase tracking-wide text-grey-2">Total</td>
            <td className="px-3 py-2 font-bold text-navy whitespace-nowrap">
              <QtyTotal entries={items.map((it) => ({ qty: it.qty, unit: s.lineById(it.requestItemId)?.unit }))} />
            </td>
            <td className="px-3 py-2" />
            <td className="px-3 py-2 text-right font-bold text-navy whitespace-nowrap">
              {inr(items.reduce((sum, it) => sum + (it.lineValue ?? 0), 0))}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
