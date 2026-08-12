import { useRef, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { parseXlsxRows } from "@/shared/lib/importXlsx";
import { BOM_SHEET_COLUMNS, buildBomImportPlan, exportBomTemplate, type BomImportPlan } from "../lib/bomIo";
import { useProductionStore } from "../store";
import type { BomImportResult } from "../data/productionWrites";

/**
 * Import BOMs from the block-format spreadsheet (see lib/bomIo.ts). Preview
 * first, apply second — and the preview names every FG item and raw material
 * that would be CREATED, so nothing is added to a master behind the user's back.
 *
 * Re-running the same file is a no-op: BOMs are keyed on item name + BOM name and
 * their components are replaced, so an import is safe to repeat.
 */
export default function BomImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useProductionStore();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [plan, setPlan] = useState<BomImportPlan | null>(null);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<BomImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reset = () => {
    setPlan(null);
    setFileName("");
    setResult(null);
    setErr(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const close = () => {
    reset();
    onClose();
  };

  const pick = async (file: File) => {
    setErr(null);
    setResult(null);
    try {
      const rows = await parseXlsxRows(file);
      const headers = Object.keys(rows[0] ?? {});
      if (!headers.includes(BOM_SHEET_COLUMNS.bomName) || !headers.includes(BOM_SHEET_COLUMNS.particulars)) {
        setPlan(null);
        setErr(
          `That sheet has no "${BOM_SHEET_COLUMNS.bomName}" / "${BOM_SHEET_COLUMNS.particulars}" columns. Download the template to see the expected layout.`,
        );
        return;
      }
      setFileName(file.name);
      setPlan(buildBomImportPlan(rows, { fgItems: s.fgItems, rawMaterials: s.rawMaterials }));
    } catch (e) {
      setPlan(null);
      setErr(e instanceof Error ? e.message : "That file could not be read.");
    }
  };

  const apply = async () => {
    if (!plan) return;
    setBusy(true);
    setErr(null);
    try {
      setResult(await s.importBoms(plan.valid));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "The import could not be applied.");
    } finally {
      setBusy(false);
    }
  };

  const problems = plan?.boms.filter((b) => b.problems.length > 0) ?? [];

  return (
    <Modal
      open={open}
      onClose={close}
      title="Import BOMs"
      subtitle={result ? undefined : "Review what will change before anything is written."}
      size="xl"
      footer={
        result ? (
          <Button size="sm" onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={close} disabled={busy}>Cancel</Button>
            <Button size="sm" onClick={apply} disabled={busy || !plan || plan.valid.length === 0}>
              {busy ? "Importing…" : `Import ${plan?.valid.length ?? 0} BOM${plan?.valid.length === 1 ? "" : "s"}`}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-2 text-[13.5px]">
          <p className="font-medium text-navy">Import complete.</p>
          <ul className="list-disc pl-5 text-[13px] text-grey space-y-0.5">
            <li><span className="text-navy tabular-nums">{result.boms_added}</span> BOM(s) added, <span className="text-navy tabular-nums">{result.boms_updated}</span> updated</li>
            <li><span className="text-navy tabular-nums">{result.components}</span> raw-material line(s) written</li>
            {result.fg_items_created > 0 && <li><span className="text-navy tabular-nums">{result.fg_items_created}</span> FG item(s) created</li>}
            {result.raw_materials_created > 0 && <li><span className="text-navy tabular-nums">{result.raw_materials_created}</span> raw material(s) created</li>}
          </ul>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void pick(f);
              }}
              className="text-[13px] text-grey file:mr-3 file:rounded-lg file:border-0 file:bg-navy file:px-3 file:py-1.5 file:text-[12.5px] file:font-semibold file:text-white hover:file:bg-navy/90"
            />
            <button onClick={exportBomTemplate} className="text-[12.5px] font-semibold text-orange hover:underline">
              Download template
            </button>
          </div>

          {fileName && <p className="text-[12.5px] text-grey-2">Read <span className="text-navy">{fileName}</span></p>}

          {plan && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                {[
                  { label: "BOMs", n: plan.valid.length, cls: "text-navy" },
                  { label: "Raw-material lines", n: plan.componentCount, cls: "text-navy" },
                  { label: "FG items to create", n: plan.newFgItems.length, cls: plan.newFgItems.length ? "text-orange" : "text-grey-2" },
                  { label: "Raw materials to create", n: plan.newRawMaterials.length, cls: plan.newRawMaterials.length ? "text-orange" : "text-grey-2" },
                ].map((c) => (
                  <div key={c.label} className="rounded-xl border border-line px-3 py-2">
                    <div className={`text-[18px] font-bold tabular-nums ${c.cls}`}>{c.n}</div>
                    <div className="text-[11.5px] text-grey-2">{c.label}</div>
                  </div>
                ))}
              </div>

              {plan.valid.length > 0 && (
                <div className="rounded-xl border border-line max-h-56 overflow-y-auto">
                  <table className="w-full text-[13px]">
                    <thead className="sticky top-0 bg-page/90">
                      <tr className="text-left text-grey-2 border-b border-line">
                        <th className="font-medium px-3 py-2">FG Item</th>
                        <th className="font-medium px-3 py-2">BOM</th>
                        <th className="font-medium px-3 py-2 text-right w-24">Lines</th>
                        <th className="font-medium px-3 py-2 text-right w-24">Total %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.valid.map((b, i) => (
                        <tr key={i} className="border-b border-line/70 last:border-0">
                          <td className="px-3 py-1.5 text-navy">{b.fgItem}</td>
                          <td className="px-3 py-1.5 text-navy">{b.bomName}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-grey">{b.components.length}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-grey">
                            {Math.round(b.components.reduce((a, c) => a + c.pct, 0) * 10) / 10}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {(plan.newFgItems.length > 0 || plan.newRawMaterials.length > 0) && (
                <div className="rounded-xl border border-orange/30 bg-orange/5 px-3 py-2 space-y-1">
                  <p className="text-[12.5px] font-semibold text-navy">These will be added to the masters:</p>
                  {plan.newFgItems.length > 0 && (
                    <p className="text-[12.5px] text-grey"><span className="text-navy">FG items:</span> {plan.newFgItems.join(", ")}</p>
                  )}
                  {plan.newRawMaterials.length > 0 && (
                    <p className="text-[12.5px] text-grey"><span className="text-navy">Raw materials:</span> {plan.newRawMaterials.join(", ")}</p>
                  )}
                </div>
              )}

              {problems.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[12.5px] font-semibold text-ryg-red">{problems.length} BOM(s) will be skipped:</p>
                  <ul className="list-disc pl-5 text-[12.5px] text-grey max-h-32 overflow-y-auto">
                    {problems.map((b, i) => (
                      <li key={i}>{b.problems.join(" ")}</li>
                    ))}
                  </ul>
                </div>
              )}

              {plan.orphanRows > 0 && (
                <p className="text-[12.5px] text-grey-2">
                  {plan.orphanRows} row(s) appeared before any BOM name and were ignored.
                </p>
              )}

              <p className="text-[12px] text-grey-2">
                Existing BOMs matching on FG item + BOM name are updated in place and their raw materials replaced —
                re-importing the same file changes nothing.
              </p>
            </div>
          )}

          {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
        </div>
      )}
    </Modal>
  );
}
