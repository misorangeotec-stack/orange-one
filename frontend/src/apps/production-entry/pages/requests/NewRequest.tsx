import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboboxHandle } from "@/shared/components/ui/Combobox";
import LineGrid, { type LineGridColumn } from "@/shared/components/ui/LineGrid";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { useProductionStore } from "../../store";
import { useJobCardForm, makeEmptyRmLine, isRmLineBlank, type RmLine } from "./useJobCardForm";
import { qtyTotals } from "../../lib/format";

/**
 * The issue-slip intake form (step 1). Picks the FG item, captures the job-card
 * details and a multi-raw-material BOM (one card = one FG made from many raw
 * materials), then raises the card into the material-handover queue.
 */
export default function NewRequest() {
  const s = useProductionStore();
  const navigate = useNavigate();
  const f = useJobCardForm();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    f.setErr(null);
    const built = f.build();
    if ("error" in built) return f.setErr(built.error);
    setBusy(true);
    try {
      const id = await s.submitRequest(built.input);
      navigate(`/production-entry/requests/${id}`);
    } catch (e) {
      f.setErr((e as Error).message);
      setBusy(false);
    }
  };

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
      className: "w-36",
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
  // Grand total = numeric sum across every unit; only shown when >1 unit is present.
  const { grand: grandTotal, multiUnit } = qtyTotals(totalsByUnit);

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Generate Batch Card</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Raise a new production batch card. Missing an option below? Request it on the{" "}
          <Link to="/production-entry/master-requests" className="font-semibold text-orange hover:underline">Master Requests</Link> page.
        </p>
      </div>

      <Card className="p-5 space-y-4">
        <FieldLabel label="Lot/Batch Card Number" required>
          <TextInput value={f.jobcardNo} onChange={(e) => f.setJobcardNo(e.target.value)} placeholder="e.g. BC-1043" />
        </FieldLabel>
        <FieldLabel label="FG Item Name" required>
          <Combobox value={f.fgItemId} onChange={f.setFgItemId} options={f.fgItemOptions} placeholder="Select finished-good item" autoAdvance />
        </FieldLabel>

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
        </div>

        <FieldLabel label="Remarks">
          <TextArea rows={2} value={f.issueRemarks} onChange={(e) => f.setIssueRemarks(e.target.value)} placeholder="Anything the team should know" />
        </FieldLabel>

        {f.err && <p className="text-[12.5px] text-ryg-red">{f.err}</p>}

        <div className="flex justify-end pt-1">
          <Button size="sm" onClick={submit} disabled={busy}>{busy ? "Submitting…" : "Raise job card"}</Button>
        </div>
      </Card>
    </div>
  );
}
