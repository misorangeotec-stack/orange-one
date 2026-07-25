import QtyTotal from "./QtyTotal";
import { useImportStore } from "../store";
import type { PurchaseOrder } from "../types";

/**
 * A generated PO's line items, read-only — the same Item · Qty layout (with a
 * quantity-total footer) that the Approve and Generate-PO dialogs use, so a PO
 * reads consistently wherever it is opened. Import is a pure quantity
 * requisition: there is no rate or value on a PO line.
 */
export default function PoItemsTable({ po }: { po: PurchaseOrder }) {
  const s = useImportStore();
  const items = s.poItemsForPo(po.id);

  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[420px] text-[13px]">
        <thead>
          <tr className="border-b border-line bg-page/60 text-left text-grey-2">
            <th className="px-3 py-2 font-medium">Item</th>
            <th className="px-3 py-2 text-right font-medium">Qty</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const line = s.lineById(it.requestItemId);
            return (
              <tr key={it.id} className="border-b border-line/70 last:border-0">
                <td className="px-3 py-2 font-medium text-navy whitespace-nowrap">{line ? s.itemLabel(line.itemId) : "—"}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">{it.qty}{line?.unit ? ` ${line.unit}` : ""}</td>
              </tr>
            );
          })}
          {items.length === 0 && (
            <tr>
              <td colSpan={2} className="px-3 py-4 text-center text-[12.5px] text-grey-2">No items on this PO.</td>
            </tr>
          )}
        </tbody>
        {items.length > 0 && (
          <tfoot>
            <tr className="border-t-2 border-line bg-orange-soft/50">
              <td className="px-3 py-2.5 text-right text-[11.5px] font-semibold uppercase tracking-wide text-grey-2">
                Total
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right font-bold text-navy">
                <QtyTotal entries={items.map((it) => ({ qty: it.qty, unit: s.lineById(it.requestItemId)?.unit }))} />
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
