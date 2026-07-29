import { cn } from "@/shared/lib/cn";
import QtyTotal from "./QtyTotal";
import { useImportStore } from "../store";
import type { PurchaseOrder } from "../types";

/**
 * A generated PO's line items, read-only — the same Item · Qty layout (with a
 * quantity-total footer) that the Approve and Generate-PO dialogs use, so a PO
 * reads consistently wherever it is opened. Import is a pure quantity
 * requisition: there is no rate or value on a PO line.
 *
 * `compact` is for the steps where this table is CONTEXT rather than the subject
 * — Follow-up, Book in Tally — where it sits in a side column beside the entry
 * fields. It tightens the rows and caps the height so a long PO scrolls inside
 * the table instead of stretching the dialog; the header and the totals row stay
 * pinned, which is the only reason the cap is safe to apply.
 */
export default function PoItemsTable({ po, compact = false }: { po: PurchaseOrder; compact?: boolean }) {
  const s = useImportStore();
  const items = s.poItemsForPo(po.id);

  const cell = compact ? "px-2.5 py-1.5" : "px-3 py-2";

  return (
    <div className={cn("overflow-x-auto rounded-xl border border-line", compact && "max-h-52 overflow-y-auto")}>
      <table className={cn("w-full text-[13px]", compact ? "min-w-[280px]" : "min-w-[420px]")}>
        <thead>
          {/* Solid (not /60) when pinned: a translucent header would let the rows
              scrolling underneath show straight through it. */}
          <tr
            className={cn(
              "border-b border-line text-left text-grey-2",
              compact ? "sticky top-0 z-10 bg-page" : "bg-page/60",
            )}
          >
            <th className={cn(cell, "font-medium")}>Item</th>
            <th className={cn(cell, "text-right font-medium")}>Qty</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const line = s.lineById(it.requestItemId);
            return (
              <tr key={it.id} className="border-b border-line/70 last:border-0">
                <td className={cn(cell, "font-medium text-navy whitespace-nowrap")}>
                  {line ? s.itemLabel(line.itemId) : "—"}
                </td>
                <td className={cn(cell, "text-right whitespace-nowrap")}>
                  {it.qty}
                  {line?.unit ? ` ${line.unit}` : ""}
                </td>
              </tr>
            );
          })}
          {items.length === 0 && (
            <tr>
              <td colSpan={2} className="px-3 py-4 text-center text-[12.5px] text-grey-2">
                No items on this PO.
              </td>
            </tr>
          )}
        </tbody>
        {items.length > 0 && (
          <tfoot>
            <tr
              className={cn(
                "border-t-2 border-line",
                compact ? "sticky bottom-0 z-10 bg-orange-soft" : "bg-orange-soft/50",
              )}
            >
              <td
                className={cn(
                  compact ? cell : "px-3 py-2.5",
                  "text-right text-[11.5px] font-semibold uppercase tracking-wide text-grey-2",
                )}
              >
                Total
              </td>
              <td className={cn(compact ? cell : "px-3 py-2.5", "whitespace-nowrap text-right font-bold text-navy")}>
                <QtyTotal entries={items.map((it) => ({ qty: it.qty, unit: s.lineById(it.requestItemId)?.unit }))} />
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
