import type { Dispatch, SetStateAction } from "react";
import Combobox, { type ComboboxHandle, type ComboOption } from "@/shared/components/ui/Combobox";
import LineGrid, { type LineGridColumn } from "@/shared/components/ui/LineGrid";
import { TextInput } from "@/shared/components/ui/Form";
import { useProductionStore } from "../store";
import { numOrDash, packFinalQty } from "../lib/format";
import {
  capExtra,
  isCapItem,
  isPackRowBlank,
  makeEmptyPackRow,
  packGsum,
  packLineTotal,
  packQtyFromPrefix,
  type PackRow,
} from "../lib/packLines";
import type { PackingBomLine } from "../types";

/**
 * The packing-material grid — the ONE place packaging is entered.
 *
 * Used by the Log Book Entry (where `packedQty` is that step's Packed Qty input)
 * and by the Repackaging issue slip (where `packedQty` is the FG quantity, since
 * a repack has no wastage and the two are the same number).
 *
 * `readOnly` renders the recorded lines from `lines` instead of the editable
 * grid — the completed/view mode the log book already had.
 */
export default function PackLinesGrid({
  rows,
  onRowsChange,
  packedQty,
  readOnly = false,
  lines = [],
  onRaiseMaster,
  label = "Packing material used",
  hint,
}: {
  rows: PackRow[];
  /** Forwarded straight to LineGrid, so it must keep the updater form. */
  onRowsChange: Dispatch<SetStateAction<PackRow[]>>;
  /** The quantity the pack-size auto-fill divides by (log book: Packed Qty; repack: FG qty). */
  packedQty: string;
  readOnly?: boolean;
  /** Recorded lines, shown when `readOnly`. */
  lines?: PackingBomLine[];
  /** Raise a "Request new packaging item" for a name typed into the picker. */
  onRaiseMaster?: (name: string) => void;
  label?: string;
  /** Omitted → the default explainer. Pass `null` to show no hint at all. */
  hint?: string | null;
}) {
  const s = useProductionStore();

  const unitsList = (unitIds: Array<string | null>) => {
    const names: string[] = [];
    for (const id of unitIds) {
      const n = s.unitById(id)?.name;
      if (n && !names.includes(n)) names.push(n);
    }
    return names.join(" · ");
  };

  const packOptions: ComboOption[] = s.activePackagingItems.map((p) => ({ value: p.id, label: p.name }));

  const packColumns: LineGridColumn<PackRow>[] = [
    {
      key: "item",
      header: "Packaging Item",
      className: "min-w-[220px]",
      cell: (row, api) => (
        <Combobox
          ref={api.focusRef as (el: ComboboxHandle | null) => void}
          value={row.packagingItemId ?? ""}
          onChange={(v) => {
            const pi = s.packagingItemById(v);
            const qty = packQtyFromPrefix(pi?.name, packedQty) || row.qty;
            api.patch({
              packagingItemId: v,
              unitId: pi?.unitId ?? null,
              qty,
              // CAP items: Extra auto-fills to 7% of qty (rounded); others stay manual.
              extra: isCapItem(pi?.name) ? capExtra(qty) : row.extra,
            });
            api.advance();
          }}
          options={packOptions}
          placeholder="Pick a packaging item…"
          searchable
          triggerClassName="px-2.5 py-1.5 text-[13.5px]"
          onTriggerKeyDown={api.keyHandler}
          onCreate={onRaiseMaster ? (name) => onRaiseMaster(name) : undefined}
          createLabel={(q) => `Request new packaging item “${q}”`}
        />
      ),
    },
    {
      key: "qty",
      header: <span className="block text-right">Qty</span>,
      className: "w-24 min-w-[6.5rem]",
      cell: (row, api) => (
        <TextInput
          ref={api.focusRef as (el: HTMLInputElement | null) => void}
          type="number"
          className="w-full px-2.5 py-1.5 text-[13.5px] text-right tabular-nums"
          value={row.qty}
          onChange={(e) => {
            const qty = e.target.value;
            // Keep CAP's Extra in sync (7% of qty, rounded) as the qty changes.
            api.patch(isCapItem(s.packagingItemById(row.packagingItemId ?? "")?.name) ? { qty, extra: capExtra(qty) } : { qty });
          }}
          onKeyDown={api.keyHandler}
        />
      ),
    },
    {
      key: "extra",
      header: <span className="block text-right">Extra</span>,
      className: "w-24",
      cell: (row, api) => (
        <TextInput
          ref={api.focusRef as (el: HTMLInputElement | null) => void}
          type="number"
          className="w-full px-2.5 py-1.5 text-[13.5px] text-right tabular-nums"
          value={row.extra}
          onChange={(e) => api.patch({ extra: e.target.value })}
          onKeyDown={api.keyHandler}
        />
      ),
    },
    {
      key: "total",
      header: <span className="block text-right">Total</span>,
      className: "w-24",
      skipFocus: true,
      cell: (row) => (
        <span className="block text-right tabular-nums font-semibold text-navy">
          {row.qty || row.extra ? packLineTotal(row.qty, row.extra) : "—"}
        </span>
      ),
    },
    {
      key: "unit",
      header: "Unit",
      className: "w-20",
      skipFocus: true,
      cell: (row) => <span className="text-grey">{s.unitById(row.unitId)?.name ?? "—"}</span>,
    },
  ];

  return (
    <div className="space-y-1.5">
      <span className="block text-[13px] font-medium text-navy">{label}</span>
      {readOnly ? (
        <div className="rounded-xl border border-line overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-grey-2 border-b border-line bg-page/60">
                <th className="font-medium px-3 py-2 min-w-[220px]">Packaging Item</th>
                <th className="font-medium px-2 py-2 text-right w-20">Qty</th>
                <th className="font-medium px-2 py-2 text-right w-20">Extra</th>
                <th className="font-medium px-2 py-2 text-right w-20">Total</th>
                <th className="font-medium px-2 py-2 w-20">Unit</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-3 text-grey-2">No packaging items were recorded.</td>
                </tr>
              ) : (
                lines.map((l, i) => (
                  <tr key={i} className="border-b border-line/70 last:border-0">
                    <td className="px-3 py-2 text-navy">{s.packagingItemById(l.packagingItemId)?.name ?? "—"}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-navy">{numOrDash(l.qty)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-grey-2">{numOrDash(l.extra)}</td>
                    <td className="px-2 py-2 text-right tabular-nums font-semibold text-navy">{numOrDash(packFinalQty(l))}</td>
                    <td className="px-2 py-2 text-grey">{s.unitById(l.unitId)?.name ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <LineGrid
          rows={rows}
          onRowsChange={onRowsChange}
          columns={packColumns}
          makeEmptyRow={makeEmptyPackRow}
          isRowBlank={isPackRowBlank}
          footer={
            <tfoot>
              <tr className="border-t border-line bg-page/50 text-navy">
                <td className="px-2.5 py-2 text-[12px] font-semibold uppercase tracking-wide text-grey-2">Total</td>
                <td className="px-2.5 py-2 text-right tabular-nums font-semibold">{packGsum(rows.map((r) => Number(r.qty) || 0))}</td>
                <td className="px-2.5 py-2 text-right tabular-nums font-semibold">{packGsum(rows.map((r) => Number(r.extra) || 0))}</td>
                <td className="px-2.5 py-2 text-right tabular-nums font-semibold">{packGsum(rows.map((r) => packLineTotal(r.qty, r.extra)))}</td>
                <td className="px-2.5 py-2 text-[12px] text-grey-2">{unitsList(rows.map((r) => r.unitId))}</td>
                <td />
              </tr>
            </tfoot>
          }
        />
      )}
      {/* `hint === null` suppresses it entirely (the repackaging form); omitting
          the prop keeps the log book's default explainer. */}
      {!readOnly && hint !== null && (
        <p className="text-[12px] text-grey-2">
          {hint ??
            "Qty auto-fills from the item's pack size (its name prefix ÷ Packed Qty). Enter an Extra quantity as needed; for CAP items the Extra auto-fills to 7% of the qty (rounded). Total = Qty + Extra."}
        </p>
      )}
    </div>
  );
}
