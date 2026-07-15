import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import EmptyState from "@/shared/components/ui/EmptyState";
import { useImportStore } from "../../store";
import { inr } from "../../lib/format";
import type { RequestItem } from "../../types";

interface Group {
  key: string;
  vendorId: string;
  companyId: string;
  lines: RequestItem[];
}

/**
 * PO Generation Workbench — the approved-line pool grouped by (vendor × company).
 * Select lines from one group and generate a single vendor-wise PO (it may pull
 * lines from many requests).
 */
export default function PoWorkbench() {
  const s = useImportStore();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const groups: Group[] = useMemo(() => {
    const map = new Map<string, Group>();
    for (const l of s.poPool) {
      const req = s.requestById(l.requestId);
      if (!l.finalVendorId || !req) continue;
      const key = `${l.finalVendorId}__${req.companyId}`;
      if (!map.has(key)) map.set(key, { key, vendorId: l.finalVendorId, companyId: req.companyId, lines: [] });
      map.get(key)!.lines.push(l);
    }
    return [...map.values()];
  }, [s.poPool, s]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleGroup = (g: Group, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      g.lines.forEach((l) => (on ? next.add(l.id) : next.delete(l.id)));
      return next;
    });

  const generate = async (g: Group) => {
    const ids = g.lines.filter((l) => selected.has(l.id)).map((l) => l.id);
    if (ids.length === 0) {
      setErr("Select at least one line in this group.");
      return;
    }
    setErr(null);
    setBusyKey(g.key);
    try {
      await s.generatePo({ vendorId: g.vendorId, companyId: g.companyId, requestItemIds: ids });
      // Stay on the workbench — the generated lines drop out of the pool on refresh.
      setSelected((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">PO Workbench</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">Approved lines, grouped by vendor and company. Select lines and generate a PO.</p>
      </div>

      {!s.canGeneratePo && (
        <Card className="px-4 py-3 text-[12.5px] text-grey-2">You can view the pool, but only the PO Desk can generate POs.</Card>
      )}
      {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}

      {groups.length === 0 ? (
        <Card className="overflow-hidden"><EmptyState title="Pool is empty" message="Approved lines waiting for a PO will appear here." /></Card>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => {
            const co = s.companyById(g.companyId);
            const allOn = g.lines.every((l) => selected.has(l.id));
            const total = g.lines.filter((l) => selected.has(l.id)).reduce((a, l) => a + (l.lineValue ?? 0), 0);
            return (
              <Card key={g.key} className="overflow-hidden">
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-line bg-page/40">
                  <div>
                    <div className="font-semibold text-navy">{s.vendorById(g.vendorId)?.name ?? "Vendor"}</div>
                    <div className="text-[12px] text-grey-2">{co ? (co.location ? `${co.name} — ${co.location}` : co.name) : "—"} · {g.lines.length} line{g.lines.length === 1 ? "" : "s"}</div>
                  </div>
                  {s.canGeneratePo && (
                    <div className="flex items-center gap-3">
                      <span className="text-[12.5px] text-grey">Selected: <b className="text-navy">{inr(total)}</b></span>
                      <Button size="sm" onClick={() => generate(g)} disabled={busyKey === g.key}>
                        {busyKey === g.key ? "Generating…" : "Generate PO"}
                      </Button>
                    </div>
                  )}
                </div>
                <table className="w-full text-[13.5px]">
                  <thead>
                    <tr className="text-left text-grey-2 border-b border-line">
                      {s.canGeneratePo && (
                        <th className="px-4 py-2.5 w-10">
                          <input type="checkbox" className="w-4 h-4 accent-orange" checked={allOn} onChange={(e) => toggleGroup(g, e.target.checked)} />
                        </th>
                      )}
                      <th className="font-medium px-4 py-2.5">Item</th>
                      <th className="font-medium px-4 py-2.5">Request</th>
                      <th className="font-medium px-4 py-2.5">Qty</th>
                      <th className="font-medium px-4 py-2.5">Rate</th>
                      <th className="font-medium px-4 py-2.5">Line Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.lines.map((l) => {
                      const req = s.requestById(l.requestId);
                      return (
                        <tr key={l.id} className="border-b border-line/70 last:border-0 hover:bg-page/60">
                          {s.canGeneratePo && (
                            <td className="px-4 py-2.5">
                              <input type="checkbox" className="w-4 h-4 accent-orange" checked={selected.has(l.id)} onChange={() => toggle(l.id)} />
                            </td>
                          )}
                          <td className="px-4 py-2.5 font-medium text-navy">{s.itemLabel(l.itemId)}</td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            {req ? <Link to={`/import/requests/${req.id}`} className="text-orange hover:underline">{req.requestNo}</Link> : "—"}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">{l.finalQty ?? l.quantity} {l.unit}</td>
                          <td className="px-4 py-2.5 whitespace-nowrap">{inr(l.finalRate)}</td>
                          <td className="px-4 py-2.5 whitespace-nowrap">{inr(l.lineValue)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
