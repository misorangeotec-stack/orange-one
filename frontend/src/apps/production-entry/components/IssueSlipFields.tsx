import type { ReactNode } from "react";
import Card from "@/shared/components/ui/Card";
import Combobox, { type ComboboxHandle } from "@/shared/components/ui/Combobox";
import LineGrid, { type LineGridColumn } from "@/shared/components/ui/LineGrid";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import RequestMasterModal from "./RequestMasterModal";
import { masterTypeLabel } from "../lib/masterFields";
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
            // The unit follows the raw material's own master unit; default qty to 1
            // (and let its share follow, so the row rescales like any other).
            const qty = row.qty || "1";
            api.patch({ rawMaterialId: v, unitId: f.unitForRawMaterial(v), ...f.patchLineQty(qty) });
            api.advance();
          }}
          options={f.rawMaterialOptionsFor(row)}
          placeholder="Select raw material…"
          searchable
          triggerClassName="px-2.5 py-1.5 text-[13.5px]"
          onTriggerKeyDown={api.keyHandler}
          onCreate={(name) => f.setRaise({ mt: "raw_material", prefill: { name } })}
          createLabel={(q) => `Request new raw material “${q}”`}
        />
      ),
    },
    {
      // Editing either of the next two columns re-derives the other, so a line
      // typed by hand still rescales when the FG quantity changes.
      key: "pct",
      header: <span className="block text-right">Split %</span>,
      className: "w-28 min-w-[5.5rem]",
      cell: (row, api) => (
        <TextInput
          ref={api.focusRef as (el: HTMLInputElement | null) => void}
          type="number"
          className="w-full px-2.5 py-1.5 text-[13.5px] text-right tabular-nums"
          value={row.pct}
          onChange={(e) => api.patch(f.patchLinePct(e.target.value))}
          onKeyDown={api.keyHandler}
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
          onChange={(e) => api.patch(f.patchLineQty(e.target.value))}
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
    <>
      <Card className="p-5 space-y-4">
        {batchField}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FieldLabel label="FG Item Name" required>
            <Combobox
              value={f.fgItemId}
              onChange={f.setFgItemId}
              options={f.fgItemOptions}
              placeholder="Select finished-good item"
              onCreate={(name) => f.setRaise({ mt: "fg_item", prefill: { name } })}
              createLabel={(q) => `Request new FG item “${q}”`}
              autoAdvance
            />
          </FieldLabel>
          <FieldLabel label="FG Total Quantity" required hint="each raw material below is scaled to this">
            <TextInput
              type="number"
              className="text-right tabular-nums"
              value={f.fgTotalQty}
              onChange={(e) => f.setFgTotalQty(e.target.value)}
              placeholder="e.g. 500"
            />
          </FieldLabel>
        </div>

        {/* The BOM picker only appears once the chosen FG actually has one — an FG
            without a BOM is simply typed out by hand, exactly as it always was. */}
        {f.fgHasBoms && (
          <FieldLabel
            label="BOM"
            hint="loads this formulation's raw materials, scaled to the quantity above"
          >
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <Combobox
                  value={f.bomId}
                  onChange={(v) => {
                    // Loading another BOM replaces the grid, so don't throw away
                    // hand-edited lines without asking. Picking "enter manually"
                    // keeps whatever is there as a starting point, so it's safe.
                    if (v && f.bomDirty && !window.confirm("Load this BOM? The raw materials you've changed will be replaced.")) return;
                    f.applyBom(v);
                  }}
                  options={f.bomOptions}
                  placeholder="No BOM — enter manually"
                  searchable
                />
              </div>
              {f.bomId && f.bomDirty && (
                <button
                  type="button"
                  onClick={() => f.applyBom(f.bomId)}
                  className="shrink-0 text-[12.5px] font-semibold text-orange hover:underline"
                >
                  Reset to BOM
                </button>
              )}
            </div>
          </FieldLabel>
        )}

        {f.skipped > 0 && (
          <p className="text-[12.5px] text-ryg-amber">
            {f.skipped} component{f.skipped === 1 ? "" : "s"} skipped — the raw material is no longer active. Add
            {f.skipped === 1 ? " it" : " them"} by hand, or reactivate in Masters.
          </p>
        )}

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
                      <td className="px-2.5 py-2 text-right tabular-nums text-[13px] text-grey-2">
                        {i === 0 ? `${f.pctTotal}%` : ""}
                      </td>
                      <td className="px-2.5 py-2 text-right tabular-nums font-semibold text-[13.5px]">{t.qty}</td>
                      <td className="px-2.5 py-2 text-[12.5px] text-grey-2">{t.unit}</td>
                      <td />
                    </tr>
                  ))}
                  {multiUnit && (
                    <tr className="bg-page/70 text-navy border-t border-line">
                      <td className="px-3 py-2 text-right text-[12px] font-semibold uppercase tracking-wide text-grey-2">Grand Total</td>
                      <td />
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
            List every raw material that goes into this FG item. Type a quantity or a split % — each fills in the other, and
            both follow the FG quantity above. Press Tab or Enter at the end of a row to start the next one. Missing one?
            Type its name to request it.
          </p>
          {f.requested && (
            <p className="text-[12px] text-teal">Requested {f.requested} — selectable once the master's owner approves it.</p>
          )}
          {/* Informational only. Formulations legitimately fall short of the FG
              quantity, so this reports the gap and never blocks the save. */}
          {filledLines.length > 0 && (
            <div className={`text-[12.5px] font-medium ${f.sumMatches ? "text-ryg-green" : "text-grey"}`}>
              Raw-material total: <span className="tabular-nums">{f.rmSum}</span>
              {f.fgTotal > 0 && (
                <>
                  {" / FG total "}
                  <span className="tabular-nums">{f.fgTotal}</span>
                  {" ("}
                  <span className="tabular-nums">{f.pctTotal}%</span>
                  {")"}
                  {!f.sumMatches && <span className="text-grey-2"> — doesn't add up to the FG quantity, which is fine</span>}
                </>
              )}
            </div>
          )}
        </div>

        <FieldLabel label="Remarks">
          <TextArea rows={2} value={f.issueRemarks} onChange={(e) => f.setIssueRemarks(e.target.value)} placeholder="Anything the team should know" />
        </FieldLabel>

        {f.err && <p className="text-[12.5px] text-ryg-red">{f.err}</p>}

        {children}
      </Card>

      <RequestMasterModal
        open={f.raise !== null}
        onClose={() => f.setRaise(null)}
        masterType={f.raise?.mt ?? null}
        lockType
        prefill={f.raise?.prefill}
        onRequested={(_id, mt, name) => f.setRequested(`${masterTypeLabel(mt).toLowerCase()} “${name}”`)}
      />
    </>
  );
}
