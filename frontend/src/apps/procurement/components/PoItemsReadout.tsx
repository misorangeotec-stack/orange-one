import { cn } from "@/shared/lib/cn";
import { useProcurementStore } from "../store";
import { inr } from "../lib/format";
import QtyTotal from "./QtyTotal";
import type { PurchaseOrder } from "../types";

/**
 * A read-only list of a PO's line items, for the PO-stage modals (Share PO, the
 * PO-number view, …). Those dialogs used to show only the PO number/terms, so a
 * viewer couldn't see WHAT the PO covers — this drops the same Item/Qty/Rate/
 * Line-Value table (with a totals row) into any of them.
 *
 * `compact` is for the steps where this table is CONTEXT rather than the subject
 * — Record Advance, Follow-up, Book in Tally — where it sits in a side column
 * beside the entry fields. It tightens the rows and caps the height so a long PO
 * scrolls inside the table instead of stretching the dialog; the header and the
 * totals row stay pinned, which is the only reason the cap is safe to apply.
 */
export default function PoItemsReadout({ po, compact = false }: { po: PurchaseOrder; compact?: boolean }) {
  const s = useProcurementStore();
  const items = s.poItemsForPo(po.id);
  if (items.length === 0) return null;

  const cell = compact ? "px-2.5 py-1.5" : "px-3 py-2";

  return (
    <div className={cn("overflow-x-auto rounded-xl border border-line", compact && "max-h-52 overflow-y-auto")}>
      <table className={cn("w-full text-[13px]", compact ? "min-w-[340px]" : "min-w-[480px]")}>
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
            <th className={cn(cell, "font-medium")}>Qty</th>
            <th className={cn(cell, "font-medium")}>Rate</th>
            <th className={cn(cell, "text-right font-medium")}>Line Value</th>
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
                <td className={cn(cell, "whitespace-nowrap")}>
                  {it.qty} {line?.unit ?? ""}
                </td>
                <td className={cn(cell, "whitespace-nowrap")}>{inr(it.rate)}</td>
                <td className={cn(cell, "text-right font-semibold text-navy whitespace-nowrap")}>{inr(it.lineValue)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr
            className={cn(
              "border-t-2 border-line",
              compact ? "sticky bottom-0 z-10 bg-orange-soft" : "bg-orange-soft/50",
            )}
          >
            <td className={cn(cell, "text-right text-[11.5px] font-semibold uppercase tracking-wide text-grey-2")}>
              Total
            </td>
            <td className={cn(cell, "font-bold text-navy whitespace-nowrap")}>
              <QtyTotal entries={items.map((it) => ({ qty: it.qty, unit: s.lineById(it.requestItemId)?.unit }))} />
            </td>
            <td className={cell} />
            <td className={cn(cell, "text-right font-bold text-navy whitespace-nowrap")}>
              {inr(items.reduce((sum, it) => sum + (it.lineValue ?? 0), 0))}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
