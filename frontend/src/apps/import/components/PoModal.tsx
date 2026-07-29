import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Upload, X } from "lucide-react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import { SECTION_HEADING_CLASS } from "@/shared/components/ui/Readout";
import { useImportStore } from "../store";
import QtyTotal from "./QtyTotal";
import { RequestRefPanel } from "./PoRefPanel";
import type { PurchaseRequest, RequestItem } from "../types";

interface VendorGroup {
  /** Null = lines sourcing never assigned a vendor. They cannot become a PO. */
  vendorId: string | null;
  lines: RequestItem[];
}

/** What the PO Desk types/attaches for ONE vendor's PO before generating it. */
interface PoEntry {
  tallyPoNo: string;
  file: File | null;
}
const EMPTY_ENTRY: PoEntry = { tallyPoNo: "", file: null };

/**
 * Stage 4 — generate this requisition's POs.
 *
 * A PO never spans two requisitions, so the unit of work is the requisition and
 * the modal is scoped to exactly one. Within it a PO is still per VENDOR: a
 * legacy requisition sourced across two vendors yields one section each and two
 * POs, because `fms_import_generate_po` refuses a mixed-vendor line list.
 *
 * The Tally PO number and the PO PDF are captured HERE, not at Share PO: the PO
 * Desk is who raises the PO in Tally and produces the file. Both are per VENDOR
 * for the same reason the Generate button is — one PO, one number, one PDF.
 *
 * Lines are read live from the store by id rather than captured on open, so each
 * generate makes its own section disappear without a remount.
 */
export default function PoModal({
  request,
  open,
  onClose,
  readOnly = false,
}: {
  request: PurchaseRequest | null;
  open: boolean;
  onClose: () => void;
  /** A viewer without `canGeneratePo`: the pool, no ticks, no Generate button. */
  readOnly?: boolean;
}) {
  const s = useImportStore();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [entries, setEntries] = useState<Record<string, PoEntry>>({});
  const [busyVendorId, setBusyVendorId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const requestId = request?.id ?? null;
  const lines = useMemo(() => (requestId ? s.poDeskLinesForRequest(requestId) : []), [requestId, s]);

  const groups: VendorGroup[] = useMemo(() => {
    const map = new Map<string, VendorGroup>();
    for (const l of lines) {
      const key = l.finalVendorId ?? "";
      if (!map.has(key)) map.set(key, { vendorId: l.finalVendorId ?? null, lines: [] });
      map.get(key)!.lines.push(l);
    }
    // Unassigned last — it is a problem to fix, not work to do.
    return [...map.values()].sort((a, b) => {
      if (!a.vendorId) return 1;
      if (!b.vendorId) return -1;
      return (s.vendorById(a.vendorId)?.name ?? "").localeCompare(s.vendorById(b.vendorId)?.name ?? "");
    });
  }, [lines, s]);

  /* Everything ticked by default: the old per-line workbench started empty, so
     the first click on Generate always failed with "select at least one line". */
  useEffect(() => {
    if (!open) return;
    setSelected(new Set(lines.map((l) => l.id)));
    setErr(null);
  }, [open, requestId, lines.length]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Deliberately a SEPARATE effect, and deliberately NOT keyed on lines.length.
     Generating vendor A's PO shrinks the pool, which refires the effect above —
     folding this into it would wipe the number and file vendor B had already
     typed and chosen. Typed input survives until the dialog is reopened. */
  useEffect(() => {
    if (!open) return;
    setEntries({});
  }, [open, requestId]);

  /* Once the last line has become a PO the pool is empty — close, rather than
     leave an empty "nothing waiting for a PO" shell open. `generate` can't do
     this itself: it holds the pre-write store snapshot in its closure, so its own
     emptiness check reads stale data. This runs on the post-refetch render. */
  useEffect(() => {
    if (open && requestId && lines.length === 0) onClose();
  }, [open, requestId, lines.length, onClose]);

  if (!request) return null;

  const poCount = groups.filter((g) => g.vendorId).length;
  /**
   * Named at the top only when the whole requisition goes to ONE vendor — the
   * normal case since sourcing became whole-requisition. A legacy split yields a
   * section per vendor, and each section already carries its name as a heading.
   */
  const soleVendorId = poCount === 1 ? groups.find((g) => g.vendorId)?.vendorId ?? undefined : undefined;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const setGroup = (g: VendorGroup, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      g.lines.forEach((l) => (on ? next.add(l.id) : next.delete(l.id)));
      return next;
    });

  const entryOf = (vendorId: string): PoEntry => entries[vendorId] ?? EMPTY_ENTRY;
  const patchEntry = (vendorId: string, patch: Partial<PoEntry>) =>
    setEntries((prev) => ({ ...prev, [vendorId]: { ...(prev[vendorId] ?? EMPTY_ENTRY), ...patch } }));

  const generate = async (g: VendorGroup) => {
    if (!g.vendorId) return;
    const ids = g.lines.filter((l) => selected.has(l.id)).map((l) => l.id);
    if (ids.length === 0) {
      setErr("Tick at least one item for this vendor.");
      return;
    }
    const entry = entryOf(g.vendorId);
    if (!entry.tallyPoNo.trim()) {
      setErr("Enter the PO number generated in Tally for this vendor.");
      return;
    }
    if (!entry.file) {
      setErr("Attach this vendor's PO PDF.");
      return;
    }
    setErr(null);
    setBusyVendorId(g.vendorId);
    try {
      // Upload BEFORE generating, so a failed upload never leaves a PO that can
      // never be shared. The PO id does not exist yet, so the object is keyed by
      // requisition; the stored path is opaque to everything downstream.
      const doc = await s.uploadNewPoDocument(request.id, entry.file);
      const poId = await s.generatePo({
        vendorId: g.vendorId,
        companyId: request.companyId,
        requestItemIds: ids,
        tallyPoNo: entry.tallyPoNo.trim(),
        documentPath: doc.path,
        documentName: doc.name,
      });
      // This vendor is done — drop its entry so a lingering dialog cannot
      // re-submit the same file against a second PO.
      setEntries((prev) => {
        const next = { ...prev };
        delete next[g.vendorId!];
        return next;
      });
      // Compute the leftover pool from the lines we just converted, not from the
      // store (the `s` in this closure is the pre-write snapshot).
      const done = new Set(ids);
      const remaining = lines.filter((l) => !done.has(l.id));
      if (remaining.length === 0) {
        // Whole requisition is on POs now — go straight to the PO just made
        // instead of leaving an empty pool dialog (or bouncing to the workbench).
        onClose();
        navigate(`/import/pos/${poId}`);
        return;
      }
      // Anything left — another vendor, or items held back for a second PO —
      // keeps the dialog open with those lines ticked-off. (The effect above is a
      // safety net if the pool empties by some other path.)
      setSelected((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyVendorId(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="2xl"
      readOnly={readOnly}
      title={`${readOnly ? "PO pool" : "Generate PO"} — ${request.requestNo}`}
      subtitle={`${lines.length} item${lines.length === 1 ? "" : "s"} · ${poCount} PO${poCount === 1 ? "" : "s"}`}
    >
      <div className="space-y-4">
        {/* Who this PO is being raised FOR and against whom — the same block every
            other stage form opens with. The company used to be a fragment of the
            subtitle, which is not where anyone looks before raising an order. */}
        <RequestRefPanel request={request} vendorId={soleVendorId} />

        {groups.map((g) => {
          const picked = g.lines.filter((l) => selected.has(l.id));
          const actionable = !readOnly && !!g.vendorId;
          const busy = busyVendorId === g.vendorId;
          const entry = g.vendorId ? entryOf(g.vendorId) : EMPTY_ENTRY;
          const ready = picked.length > 0 && !!entry.tallyPoNo.trim() && !!entry.file;

          return (
            <div key={g.vendorId ?? "__none"} className="space-y-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <div className="flex items-baseline gap-2.5">
                  <span className={SECTION_HEADING_CLASS}>
                    {g.vendorId ? s.vendorById(g.vendorId)?.name ?? "Vendor" : "No vendor assigned"}
                  </span>
                  {actionable && (
                    <>
                      <span className="text-[11.5px] text-grey-2">
                        {picked.length} of {g.lines.length} ticked
                      </span>
                      <button
                        type="button"
                        onClick={() => setGroup(g, true)}
                        disabled={picked.length === g.lines.length}
                        className="text-[11.5px] font-semibold text-orange hover:underline disabled:text-grey-2 disabled:no-underline"
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        onClick={() => setGroup(g, false)}
                        disabled={picked.length === 0}
                        className="text-[11.5px] font-semibold text-orange hover:underline disabled:text-grey-2 disabled:no-underline"
                      >
                        Clear all
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full min-w-[420px] text-[13px]">
                  <thead>
                    <tr className="bg-page text-left text-[11.5px] uppercase tracking-wide text-grey-2">
                      {actionable && <th className="w-9 px-3 py-2" />}
                      <th className="px-3 py-2 font-semibold">Item</th>
                      {/* No Lead column: an import line carries no lead time — the
                          promised dispatch date is captured later, at Share PO. */}
                      <th className="w-28 px-2 py-2 text-right font-semibold">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.lines.map((l) => {
                      const on = !actionable || selected.has(l.id);
                      return (
                        <tr key={l.id} className={`border-t border-line ${on ? "" : "opacity-45"}`}>
                          {actionable && (
                            <td className="px-3 py-1.5">
                              <input
                                type="checkbox"
                                className="accent-orange"
                                checked={selected.has(l.id)}
                                onChange={() => toggle(l.id)}
                                aria-label={`Include ${s.itemById(l.itemId)?.name ?? "this item"} on the PO`}
                              />
                            </td>
                          )}
                          <td className="whitespace-nowrap px-3 py-1.5 font-medium text-navy">
                            {s.itemById(l.itemId)?.name ?? "—"}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-right">
                            {l.finalQty ?? l.quantity} {l.unit}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-line bg-orange-soft/50">
                      {actionable && <td className="px-3 py-2" />}
                      <td className="px-3 py-2 text-right text-[11.5px] font-semibold uppercase tracking-wide text-grey-2">
                        Total
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-bold text-navy">
                        <QtyTotal entries={picked.map((l) => ({ qty: l.finalQty ?? l.quantity, unit: l.unit }))} />
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {g.vendorId ? (
                !readOnly && (
                  <div className="space-y-3 rounded-xl bg-orange-soft/50 px-3.5 py-3">
                    <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                      <FieldLabel label="Tally PO Number" required hint="Generated in Tally/ERP">
                        <TextInput
                          value={entry.tallyPoNo}
                          onChange={(e) => patchEntry(g.vendorId!, { tallyPoNo: e.target.value })}
                          placeholder="e.g. 2627/PO/0042"
                        />
                      </FieldLabel>
                      <FieldLabel label="PO PDF" required hint="PDF or any file — sent to the vendor">
                        <div className="flex flex-wrap items-center gap-2.5">
                          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-white px-3.5 py-2.5 text-[13px] font-medium text-navy transition hover:border-orange hover:text-orange">
                            <Upload className="h-4 w-4" />
                            {entry.file ? "Change file" : "Choose file"}
                            <input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx,image/*,application/pdf"
                              onChange={(e) => patchEntry(g.vendorId!, { file: e.target.files?.[0] ?? null })} />
                          </label>
                          {entry.file ? (
                            <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-grey-2">
                              <span className="max-w-[200px] truncate text-navy">{entry.file.name}</span>
                              <button type="button" onClick={() => patchEntry(g.vendorId!, { file: null })} className="shrink-0 text-grey-2 hover:text-ryg-red" aria-label="Remove file"><X className="h-3.5 w-3.5" /></button>
                            </span>
                          ) : (
                            <span className="text-[12.5px] text-grey-2">No file selected</span>
                          )}
                        </div>
                      </FieldLabel>
                    </div>
                    <div className="flex justify-end">
                      <Button size="sm" onClick={() => generate(g)} disabled={busy || !ready}>
                        {busy ? "Generating…" : "Generate PO"}
                      </Button>
                    </div>
                  </div>
                )
              ) : (
                <p className="text-[11.5px] text-ryg-red">
                  These items have no vendor, so they cannot be turned into a PO. Send the requisition back through
                  Sourcing.
                </p>
              )}
            </div>
          );
        })}

        {groups.length === 0 && (
          <p className="px-3 py-4 text-center text-[12.5px] text-grey-2">
            Nothing on this requisition is waiting for a PO.
          </p>
        )}

        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Modal>
  );
}
