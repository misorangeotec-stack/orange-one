import { useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboOption, type ComboboxHandle } from "@/shared/components/ui/Combobox";
import LineGrid, { newUid, type LineGridColumn, type LineGridRow } from "@/shared/components/ui/LineGrid";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import { useProductionStore } from "../store";
import { BOM_BASE_QTY, pctFromBaseQty, qtyAtBase, round3, round6 } from "../lib/bomMath";
import type { Bom } from "../types";

/**
 * Add / edit one BOM: the FG item it belongs to, its name, whether it is that
 * FG's default, and its raw materials as PERCENTAGE splits.
 *
 * ⚠ The stored value is always the percentage. The "Qty per 1000" column is a
 * convenience for people who authored these recipes against a 1000 kg batch (the
 * source spreadsheet's whole layout) — typing in either column just recomputes
 * the other. Percentages are NOT required to total 100: two BOMs in the source
 * data legitimately total 33.3% and 42.8%, so the footer reports the total and
 * never blocks on it.
 */

interface CompLine extends LineGridRow {
  rawMaterialId: string;
  pct: string;
}

const makeEmptyComp = (): CompLine => ({ uid: newUid(), rawMaterialId: "", pct: "" });
const isCompBlank = (l: CompLine) => !l.rawMaterialId && !l.pct;

export default function BomEditorModal({
  open,
  onClose,
  bom,
  fgItemId: initialFgItemId,
}: {
  open: boolean;
  onClose: () => void;
  /** The BOM being edited, or null to add a new one. */
  bom: Bom | null;
  /** Pre-selected FG when adding from a filtered list. */
  fgItemId?: string;
}) {
  const s = useProductionStore();

  // Re-seed whenever the dialog is opened on a different BOM. Keyed rather than
  // effect-driven so an in-flight edit is never wiped by a background refetch.
  const seedKey = `${open}:${bom?.id ?? "new"}`;
  const [key, setKey] = useState(seedKey);
  const [fgItemId, setFgItemId] = useState(bom?.fgItemId ?? initialFgItemId ?? "");
  const [name, setName] = useState(bom?.name ?? "");
  const [isDefault, setIsDefault] = useState(bom?.isDefault ?? false);
  const [sortOrder, setSortOrder] = useState(String(bom?.sortOrder ?? 0));
  const [lines, setLines] = useState<CompLine[]>([makeEmptyComp()]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (key !== seedKey) {
    setKey(seedKey);
    setFgItemId(bom?.fgItemId ?? initialFgItemId ?? "");
    setName(bom?.name ?? "");
    setIsDefault(bom?.isDefault ?? false);
    setSortOrder(String(bom?.sortOrder ?? 0));
    setLines(
      bom
        ? [
            ...s.bomComponentsFor(bom.id).map(
              (c): CompLine => ({ uid: newUid(), rawMaterialId: c.rawMaterialId, pct: String(c.pct) }),
            ),
            makeEmptyComp(),
          ]
        : [makeEmptyComp()],
    );
    setErr(null);
  }

  const fgOptions: ComboOption[] = s.activeFgItems.map((f) => ({ value: f.id, label: f.name }));

  /** Raw materials, minus ones another row already took (the pair is unique). */
  const rmOptionsFor = (line: CompLine): ComboOption[] => {
    const taken = new Set(lines.filter((l) => l.uid !== line.uid && l.rawMaterialId).map((l) => l.rawMaterialId));
    return s.activeRawMaterials.filter((rm) => !taken.has(rm.id)).map((rm) => ({ value: rm.id, label: rm.name }));
  };

  const columns: LineGridColumn<CompLine>[] = [
    {
      key: "rm",
      header: "Raw Material",
      className: "min-w-[240px]",
      cell: (row, api) => (
        <Combobox
          ref={api.focusRef as (el: ComboboxHandle | null) => void}
          value={row.rawMaterialId}
          onChange={(v) => {
            api.patch({ rawMaterialId: v });
            api.advance();
          }}
          options={rmOptionsFor(row)}
          placeholder="Select raw material…"
          searchable
          triggerClassName="px-2.5 py-1.5 text-[13.5px]"
          onTriggerKeyDown={api.keyHandler}
        />
      ),
    },
    {
      key: "pct",
      header: <span className="block text-right">Split %</span>,
      className: "w-32 min-w-[6rem]",
      cell: (row, api) => (
        <TextInput
          ref={api.focusRef as (el: HTMLInputElement | null) => void}
          type="number"
          className="w-full px-2.5 py-1.5 text-[13.5px] text-right tabular-nums"
          value={row.pct}
          onChange={(e) => api.patch({ pct: e.target.value })}
          onKeyDown={api.keyHandler}
        />
      ),
    },
    {
      // The same number expressed against a 1000 kg batch — how these recipes are
      // written down. Typing here just converts back into the percentage.
      key: "base",
      header: <span className="block text-right">Qty per {BOM_BASE_QTY}</span>,
      className: "w-36 min-w-[7rem]",
      cell: (row, api) => (
        <TextInput
          ref={api.focusRef as (el: HTMLInputElement | null) => void}
          type="number"
          className="w-full px-2.5 py-1.5 text-[13.5px] text-right tabular-nums"
          value={row.pct === "" ? "" : String(qtyAtBase(Number(row.pct) || 0))}
          onChange={(e) => {
            const v = e.target.value;
            api.patch({ pct: v === "" ? "" : String(pctFromBaseQty(Number(v) || 0)) });
          }}
          onKeyDown={api.keyHandler}
        />
      ),
    },
    {
      key: "unit",
      header: "Unit",
      className: "w-24",
      skipFocus: true,
      // Read-only: the unit belongs to the raw material's own master, so a BOM
      // never stores one of its own that could drift out of agreement.
      cell: (row) => (
        <span className="text-grey">{s.unitById(s.rawMaterialById(row.rawMaterialId)?.unitId ?? null)?.name ?? "—"}</span>
      ),
    },
  ];

  const filled = lines.filter((l) => !isCompBlank(l));
  const totalPct = round3(filled.reduce((a, l) => a + (Number(l.pct) || 0), 0));

  const save = async () => {
    setErr(null);
    if (!fgItemId) return setErr("FG item is required.");
    if (!name.trim()) return setErr("BOM name is required.");
    if (filled.length === 0) return setErr("Add at least one raw material.");
    if (filled.some((l) => !l.rawMaterialId)) return setErr("Every line needs a raw material.");
    if (filled.some((l) => !(Number(l.pct) > 0))) return setErr("Every line needs a split % greater than 0.");

    setBusy(true);
    try {
      await s.saveBom({
        id: bom?.id ?? null,
        fgItemId,
        name: name.trim(),
        isDefault,
        active: bom?.active ?? true,
        sortOrder: Math.max(0, Math.floor(Number(sortOrder) || 0)),
        components: filled.map((l) => ({ rawMaterialId: l.rawMaterialId, pct: String(round6(Number(l.pct) || 0)) })),
      });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save the BOM.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={bom ? "Edit BOM" : "Add BOM"}
      subtitle="Raw materials are stored as a share of the FG quantity, so one BOM works at any batch size."
      size="2xl"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save BOM"}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FieldLabel label="FG Item" required>
            <Combobox value={fgItemId} onChange={setFgItemId} options={fgOptions} placeholder="Select finished-good item" searchable autoAdvance />
          </FieldLabel>
          <FieldLabel label="BOM Name" required hint="e.g. KY BLACK-CHINA">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this formulation" />
          </FieldLabel>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FieldLabel label="Display Order">
            <TextInput type="number" className="text-right tabular-nums" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </FieldLabel>
          <label className="flex items-center gap-2 self-end pb-2 cursor-pointer">
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="accent-orange w-4 h-4" />
            <span className="text-[13px] text-navy">
              Default for this FG
              <span className="block text-[12px] text-grey-2">Loaded automatically when this FG is picked on a job card.</span>
            </span>
          </label>
        </div>

        <div className="space-y-2">
          <span className="block text-[13px] font-medium text-navy">
            Raw Materials <span className="text-orange">*</span>
          </span>
          <LineGrid
            rows={lines}
            onRowsChange={setLines}
            columns={columns}
            makeEmptyRow={makeEmptyComp}
            isRowBlank={isCompBlank}
            footer={
              filled.length > 0 ? (
                <tfoot>
                  <tr className="bg-page/50 text-navy border-t border-line">
                    <td className="px-3 py-2 text-right text-[12px] font-semibold uppercase tracking-wide text-grey-2">Total</td>
                    <td className="px-2.5 py-2 text-right tabular-nums font-semibold text-[13.5px]">{totalPct}%</td>
                    <td className="px-2.5 py-2 text-right tabular-nums text-[13px] text-grey">{qtyAtBase(totalPct)}</td>
                    <td />
                    <td />
                  </tr>
                </tfoot>
              ) : undefined
            }
          />
          <p className="text-[12px] text-grey-2">
            Type a percentage, or the quantity you would use in a {BOM_BASE_QTY} kg batch — each fills in the other. A BOM
            does not have to add up to 100%.
          </p>
          {filled.length > 0 && totalPct !== 100 && (
            <p className="text-[12.5px] text-grey">
              These components total <span className="tabular-nums font-medium">{totalPct}%</span> of the FG quantity. That is
              fine — saved as-is.
            </p>
          )}
        </div>

        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Modal>
  );
}
