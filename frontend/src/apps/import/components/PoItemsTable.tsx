import { inr, fxMoney } from "../lib/format";
import { useImportStore } from "../store";
import type { PurchaseOrder } from "../types";

/**
 * A generated PO's line items, read-only — the same Item · Qty · Rate ·
 * Value (FCY) · Value (INR) layout (with a totals footer) that the Approve and
 * Generate-PO dialogs use, so a PO reads consistently wherever it is opened.
 *
 * Rate is in the vendor's foreign currency; the foreign line value is qty × rate
 * (a PO item stores only the INR `line_value`), and the totals come off the PO
 * itself so they always agree with the header.
 */
export default function PoItemsTable({ po }: { po: PurchaseOrder }) {
  const s = useImportStore();
  const items = s.poItemsForPo(po.id);
  const ccy = po.currency;

  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[560px] text-[13px]">
        <thead>
          <tr className="border-b border-line bg-page/60 text-left text-grey-2">
            <th className="px-3 py-2 font-medium">Item</th>
            <th className="px-3 py-2 font-medium">Qty</th>
            <th className="px-3 py-2 font-medium">Rate</th>
            <th className="px-3 py-2 text-right font-medium">Value ({ccy ?? "FCY"})</th>
            <th className="px-3 py-2 text-right font-medium">Value (INR)</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const line = s.lineById(it.requestItemId);
            return (
              <tr key={it.id} className="border-b border-line/70 last:border-0">
                <td className="px-3 py-2 font-medium text-navy whitespace-nowrap">{line ? s.itemLabel(line.itemId) : "—"}</td>
                <td className="px-3 py-2 whitespace-nowrap">{it.qty}{line?.unit ? ` ${line.unit}` : ""}</td>
                <td className="px-3 py-2">{fxMoney(it.rate, ccy)}</td>
                <td className="px-3 py-2 text-right font-medium text-navy whitespace-nowrap">{fxMoney(it.qty * it.rate, ccy)}</td>
                <td className="px-3 py-2 text-right font-semibold text-navy whitespace-nowrap">{inr(it.lineValue)}</td>
              </tr>
            );
          })}
          {items.length === 0 && (
            <tr>
              <td colSpan={5} className="px-3 py-4 text-center text-[12.5px] text-grey-2">No items on this PO.</td>
            </tr>
          )}
        </tbody>
        {items.length > 0 && (
          <tfoot>
            <tr className="border-t-2 border-line bg-orange-soft/50">
              <td colSpan={3} className="px-3 py-2.5 text-right text-[11.5px] font-semibold uppercase tracking-wide text-grey-2">
                Total
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right font-bold text-navy">{fxMoney(po.totalValueFx, ccy)}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right font-bold text-navy">{inr(po.totalValue)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
