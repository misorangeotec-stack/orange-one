import type { ReactNode } from "react";
import Card from "@/shared/components/ui/Card";
import Combobox, { type ComboboxHandle } from "@/shared/components/ui/Combobox";
import LineGrid, { type LineGridColumn } from "@/shared/components/ui/LineGrid";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { useProductionStore } from "../store";
import { makeEmptyRmLine, isRmLineBlank, type RmLine, type JobCardFormApi } from "../pages/requests/useJobCardForm";
import { qtyTotals } from "../lib/format";

/**
 * The issue-slip form body (FG item, FG total qty, the multi-raw-material BOM
 * grid with per-unit totals, and remarks). Shared by New Request (Generate Issue
 * Slip) and Edit Request so both stay in lock-step. The page supplies the
 * Lot/Batch Card field (auto-preview when new, the fixed number when editing) via
 * `batchField`, and the action buttons via `children` (rendered inside the card).
 */
export default function IssueSlipFields({
  f,
  batchField,
  children,
}: {
  f: JobCardFormApi;
  batchField?: ReactNode;
  children?: ReactNode;
}) {
  const s = useProductionStore();

  const columns: LineGridColumn<RmLine>[] = [
    {
      key: "rm",
      header: "Raw Material",
      className: "min-w-[240px]",
      cell: (row, api) => (
        <Combobox
          ref={api.focusRef as (el: ComboboxHandle | null) => void}
          value={row.rawMaterialId}
          onChange={(v) => {
            // The unit follows the raw material's own master unit; default qty to 1.
            api.patch({ rawMaterialId: v, unitId: f.unitForRawMaterial(v), qty: row.qty || "1" });
            api.advance();
          }}
          options={f.rawMaterialOptionsFor(row)}
          placeholder="Select raw material…"
          searchable
          triggerClassName="px-2.5 py-1.5 text-[13.5px]"
          onTriggerKeyDown={api.keyHandler}
        />
      ),
    },
    {
      key: "qty",
      header: <span className="block text-right">Qty</span>,
      className: "w-36 min-w-[7rem]",
      cell: (row, api) => (
        <TextInput
          ref={api.focusRef as (el: HTMLInputElement | null) => void}
          type="number"
          className="w-full px-2.5 py-1.5 text-[13.5px] text-right tabular-nums"
          value={row.qty}
          onChange={(e) => api.patch({ qty: e.target.value })}
          onKeyDown={api.keyHandler}
        />
      ),
    },
    {
      // Read-only: the unit comes from the selected raw material's master.
      key: "unit",
      header: "Unit",
      className: "w-24",
      skipFocus: true,
      cell: (row) => <span className="text-grey">{s.unitById(row.unitId)?.name ?? "—"}</span>,
    },
  ];

  // Totals across the filled BOM lines, split BY UNIT — items in different units
  // (KGS, LTR, …) each get their own subtotal rather than a meaningless single sum.
  const filledLines = f.lines.filter((l) => !isRmLineBlank(l));
  const totalsByUnit = new Map<string, number>();
  for (const l of filledLines) {
    const u = s.unitById(l.unitId)?.name ?? "—";
    totalsByUnit.set(u, (totalsByUnit.get(u) ?? 0) + (Number(l.qty) || 0));
  }
  const unitTotals = [...totalsByUnit.entries()].map(([unit, qty]) => ({ unit, qty: Math.round(qty * 1000) / 1000 }));
  const { grand: grandTotal, multiUnit } = qtyTotals(totalsByUnit);

  return (
    <Card className="p-5 space-y-4">
      {batchField}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FieldLabel label="FG Item Name" required>
          <Combobox value={f.fgItemId} onChange={f.setFgItemId} options={f.fgItemOptions} placeholder="Select finished-good item" autoAdvance />
        </FieldLabel>
        <FieldLabel label="FG Total Quantity" required hint="the raw materials below must add up to this">
          <TextInput
            type="number"
            className="text-right tabular-nums"
            value={f.fgTotalQty}
            onChange={(e) => f.setFgTotalQty(e.target.value)}
            placeholder="e.g. 500"
          />
        </FieldLabel>
      </div>

      <div className="space-y-2">
        <span className="block text-[13px] font-medium text-navy">
          Raw Materials <span className="text-orange">*</span>
        </span>
        <LineGrid
          rows={f.lines}
          onRowsChange={f.setLines}
          columns={columns}
          makeEmptyRow={makeEmptyRmLine}
          isRowBlank={isRmLineBlank}
          footer={
            filledLines.length > 0 ? (
              <tfoot>
                {unitTotals.map((t, i) => (
                  <tr key={t.unit} className={`bg-page/50 text-navy ${i === 0 ? "border-t border-line" : ""}`}>
                    <td className="px-3 py-2 text-right text-[12px] font-semibold uppercase tracking-wide text-grey-2">
                      {i === 0 ? "Total Qty" : ""}
                    </td>
                    <td className="px-2.5 py-2 text-right tabular-nums font-semibold text-[13.5px]">{t.qty}</td>
                    <td className="px-2.5 py-2 text-[12.5px] text-grey-2">{t.unit}</td>
                    <td />
                  </tr>
                ))}
                {multiUnit && (
                  <tr className="bg-page/70 text-navy border-t border-line">
                    <td className="px-3 py-2 text-right text-[12px] font-semibold uppercase tracking-wide text-grey-2">Grand Total</td>
                    <td className="px-2.5 py-2 text-right tabular-nums font-bold text-[13.5px]">{grandTotal}</td>
                    <td className="px-2.5 py-2 text-[12px] text-grey-2">all units</td>
                    <td />
                  </tr>
                )}
              </tfoot>
            ) : undefined
          }
        />
        <p className="text-[12px] text-grey-2">
          List every raw material that goes into this FG item, each with its own quantity and unit. Press Tab or Enter at
          the end of a row to start the next one.
        </p>
        {filledLines.length > 0 && (
          <div className={`text-[12.5px] font-medium ${f.sumMatches ? "text-ryg-green" : "text-ryg-red"}`}>
            Raw-material total: <span className="tabular-nums">{f.rmSum}</span>
            {f.fgTotal > 0 && <> / FG total <span className="tabular-nums">{f.fgTotal}</span></>}
            {f.fgTotal > 0 && !f.sumMatches && " — must match to save"}
          </div>
        )}
      </div>

      <FieldLabel label="Remarks">
        <TextArea rows={2} value={f.issueRemarks} onChange={(e) => f.setIssueRemarks(e.target.value)} placeholder="Anything the team should know" />
      </FieldLabel>

      {f.err && <p className="text-[12.5px] text-ryg-red">{f.err}</p>}

      {children}
    </Card>
  );
}
