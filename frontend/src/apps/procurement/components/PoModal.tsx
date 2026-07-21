import { useEffect, useMemo, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { SECTION_HEADING_CLASS } from "@/shared/components/ui/Readout";
import { useProcurementStore } from "../store";
import { inr } from "../lib/format";
import QtyTotal from "./QtyTotal";
import type { PurchaseRequest, RequestItem } from "../types";

interface VendorGroup {
  /** Null = lines sourcing never assigned a vendor. They cannot become a PO. */
  vendorId: string | null;
  lines: RequestItem[];
}

/**
 * Stage 4 — generate this requisition's POs.
 *
 * A PO never spans two requisitions, so the unit of work is the requisition and
 * the modal is scoped to exactly one. Within it a PO is still per VENDOR: a
 * legacy requisition sourced across two vendors yields one section each and two
 * POs, because `fms_purchase_generate_po` refuses a mixed-vendor line list.
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
  const s = useProcurementStore();
  const [selected, setSelected] = useState<Set<string>>(new Set());
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

  if (!request) return null;

  const company = s.companyById(request.companyId);
  const companyLabel = company ? (company.location ? `${company.name} — ${company.location}` : company.name) : "—";
  const poCount = groups.filter((g) => g.vendorId).length;

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

  const generate = async (g: VendorGroup) => {
    if (!g.vendorId) return;
    const ids = g.lines.filter((l) => selected.has(l.id)).map((l) => l.id);
    if (ids.length === 0) {
      setErr("Tick at least one item for this vendor.");
      return;
    }
    setErr(null);
    setBusyVendorId(g.vendorId);
    try {
      await s.generatePo({ vendorId: g.vendorId, companyId: request.companyId, requestItemIds: ids });
      setSelected((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      // `generatePo` awaits the refetch, so the pool below is already post-write.
      // Anything left — another vendor, or items deliberately held back for a
      // second PO — keeps the dialog open.
      if (s.poDeskLinesForRequest(request.id).length === 0) onClose();
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
      subtitle={`${lines.length} item${lines.length === 1 ? "" : "s"} · ${poCount} PO${poCount === 1 ? "" : "s"} · ${companyLabel}`}
    >
      <div className="space-y-4">
        {groups.map((g) => {
          const picked = g.lines.filter((l) => selected.has(l.id));
          const total = Math.round(picked.reduce((sum, l) => sum + (l.lineValue ?? 0), 0) * 100) / 100;
          const base = Math.round(picked.reduce((sum, l) => sum + (l.finalQty ?? 0) * (l.finalRate ?? 0), 0) * 100) / 100;
          const gst = Math.round((total - base) * 100) / 100;
          const actionable = !readOnly && !!g.vendorId;
          const busy = busyVendorId === g.vendorId;

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
                <table className="w-full min-w-[640px] text-[13px]">
                  <thead>
                    <tr className="bg-page text-left text-[11.5px] uppercase tracking-wide text-grey-2">
                      {actionable && <th className="w-9 px-3 py-2" />}
                      <th className="px-3 py-2 font-semibold">Item</th>
                      <th className="w-28 px-2 py-2 font-semibold">Qty</th>
                      <th className="w-28 px-2 py-2 font-semibold">Rate</th>
                      <th className="w-24 px-2 py-2 font-semibold">GST %</th>
                      <th className="w-28 px-2 py-2 font-semibold">Lead</th>
                      <th className="w-32 px-3 py-2 text-right font-semibold">Value</th>
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
                          <td className="whitespace-nowrap px-2 py-1.5">
                            {l.finalQty ?? l.quantity} {l.unit}
                          </td>
                          <td className="px-2 py-1.5">{inr(l.finalRate)}</td>
                          <td className="px-2 py-1.5">{l.gstPct ?? "—"}</td>
                          <td className="px-2 py-1.5">{l.leadTimeDays === null ? "—" : `${l.leadTimeDays}d`}</td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-right font-semibold text-navy">
                            {inr(l.lineValue)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {picked.length > 0 && (
                    <tfoot>
                      <tr className="border-t-2 border-line bg-orange-soft/50">
                        {actionable && <td className="px-3 py-2" />}
                        <td className="px-3 py-2 text-right text-[11.5px] font-semibold uppercase tracking-wide text-grey-2">Total</td>
                        <td className="px-2 py-2 font-bold text-navy whitespace-nowrap">
                          <QtyTotal entries={picked.map((l) => ({ qty: l.finalQty ?? l.quantity, unit: l.unit }))} />
                        </td>
                        <td className="px-2 py-2" />
                        <td className="px-2 py-2 font-bold text-navy whitespace-nowrap">{inr(gst)}</td>
                        <td className="px-2 py-2" />
                        <td className="px-3 py-2 text-right font-bold text-navy whitespace-nowrap">{inr(total)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              {!g.vendorId ? (
                <p className="text-[11.5px] text-ryg-red">
                  These items have no vendor, so they cannot be turned into a PO. Send the requisition back through
                  Sourcing.
                </p>
              ) : !readOnly ? (
                <div className="flex justify-end rounded-xl bg-orange-soft/50 px-3.5 py-2.5">
                  <Button size="sm" onClick={() => generate(g)} disabled={busy || picked.length === 0}>
                    {busy ? "Generating…" : "Generate PO"}
                  </Button>
                </div>
              ) : null}
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
