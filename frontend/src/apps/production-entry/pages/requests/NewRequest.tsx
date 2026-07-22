import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboboxHandle } from "@/shared/components/ui/Combobox";
import LineGrid, { type LineGridColumn } from "@/shared/components/ui/LineGrid";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { useProductionStore } from "../../store";
import { useJobCardForm, makeEmptyRmLine, isRmLineBlank, type RmLine } from "./useJobCardForm";

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
            // Default qty to 1 on first pick, matching the RM-purchase grid.
            api.patch({ rawMaterialId: v, qty: row.qty || "1" });
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
      key: "unit",
      header: "Unit",
      className: "w-32",
      cell: (row, api) => (
        <Combobox
          ref={api.focusRef as (el: ComboboxHandle | null) => void}
          value={row.unitId}
          onChange={(v) => {
            api.patch({ unitId: v });
            api.advance();
          }}
          options={f.unitOptions}
          placeholder="Unit…"
          searchable
          triggerClassName="px-2.5 py-1.5 text-[13.5px]"
          onTriggerKeyDown={api.keyHandler}
        />
      ),
    },
  ];

  // Total quantity across the filled BOM lines. Units can differ per line, so we
  // show the shared unit when every line agrees, else "mixed".
  const filledLines = f.lines.filter((l) => !isRmLineBlank(l));
  const totalQty = Math.round(filledLines.reduce((sm, l) => sm + (Number(l.qty) || 0), 0) * 1000) / 1000;
  const totalUnits = [...new Set(filledLines.map((l) => s.unitById(l.unitId)?.name).filter(Boolean))] as string[];
  const totalUnitLabel = totalUnits.length === 1 ? totalUnits[0] : totalUnits.length === 0 ? "" : "mixed";

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Generate Issue Slip</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Raise a new production job card. Missing an option below? Request it on the{" "}
          <Link to="/production-entry/master-requests" className="font-semibold text-orange hover:underline">Master Requests</Link> page.
        </p>
      </div>

      <Card className="p-5 space-y-4">
        <FieldLabel label="Job Card No." required>
          <TextInput value={f.jobcardNo} onChange={(e) => f.setJobcardNo(e.target.value)} placeholder="e.g. JC-1043" />
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
                  <tr className="border-t border-line bg-page/50 text-navy">
                    <td className="px-3 py-2 text-right text-[12px] font-semibold uppercase tracking-wide text-grey-2">Total Qty</td>
                    <td className="px-2.5 py-2 text-right tabular-nums font-semibold text-[13.5px]">{totalQty}</td>
                    <td className="px-2.5 py-2 text-[12.5px] text-grey-2">{totalUnitLabel}</td>
                    <td />
                  </tr>
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
