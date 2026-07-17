import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import EmptyState from "@/shared/components/ui/EmptyState";
import { Lock } from "lucide-react";
import Modal from "@/shared/components/ui/Modal";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import { formatDateTime } from "@/shared/lib/time";
import { useEffectiveIdentity } from "@/shared/sandbox/useEffectiveIdentity";
import StageTabs from "@/shared/components/ui/StageTabs";
import { useStageMode } from "@/shared/lib/useStageMode";
import { useImportStore } from "../../store";
import { inr } from "../../lib/format";
import type { StageEntry } from "../../lib/queues";
import type { RequestItem, PurchaseOrder } from "../../types";

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
  const { user } = useEffectiveIdentity();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editPo, setEditPo] = useState<PurchaseOrder | null>(null);
  const [poNo, setPoNo] = useState("");
  const [savingNo, setSavingNo] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);
  const stage = useStageMode(s.completedPoGenEntries, user.id);

  const completedColumns: QueueColumn<StageEntry<PurchaseOrder>>[] = [
    { key: "po", header: "PO No.", cell: (e) => <Link to={`/import/pos/${e.poId}`} className="font-semibold text-navy hover:text-orange">{e.ref}</Link>, sortValue: (e) => e.ref, filter: { kind: "text", get: (e) => e.ref }, tdClassName: "whitespace-nowrap" },
    { key: "vendor", header: "Vendor", cell: (e) => s.vendorById(e.row.vendorId)?.name ?? "—", sortValue: (e) => s.vendorById(e.row.vendorId)?.name ?? "", filter: { kind: "select", get: (e) => s.vendorById(e.row.vendorId)?.name ?? "—" }, tdClassName: "whitespace-nowrap" },
    { key: "value", header: "Value", cell: (e) => <span className="font-semibold text-navy">{inr(e.row.totalValue)}</span>, sortValue: (e) => e.row.totalValue, filter: { kind: "number", get: (e) => e.row.totalValue }, tdClassName: "whitespace-nowrap" },
    { key: "lines", header: "Lines", cell: (e) => s.poItemsForPo(e.row.id).length, sortValue: (e) => s.poItemsForPo(e.row.id).length, tdClassName: "whitespace-nowrap" },
    { key: "stage", header: "Now At", cell: (e) => <span className="text-grey-2">{e.row.currentStage.replace(/_/g, " ")}</span>, sortValue: (e) => e.row.currentStage, filter: { kind: "select", get: (e) => e.row.currentStage.replace(/_/g, " ") }, tdClassName: "whitespace-nowrap" },
    { key: "genAt", header: "Generated On", cell: (e) => formatDateTime(e.atIso), sortValue: (e) => e.atIso, filter: { kind: "date", get: (e) => e.atIso.slice(0, 10) }, tdClassName: "whitespace-nowrap" },
    {
      key: "genBy", header: "By",
      cell: (e) => (e.actorId ? s.personName(e.actorId) : <span className="text-grey-2">Not recorded</span>),
      sortValue: (e) => s.personName(e.actorId),
      filter: { kind: "select", get: (e) => (e.actorId ? s.personName(e.actorId) : "Not recorded") },
      tdClassName: "whitespace-nowrap",
    },
  ];

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
        <h1 className="text-[22px] font-bold text-navy">PO Stage</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          {stage.showingCompleted
            ? "POs already generated. The PO number stays editable until it is shared with the vendor."
            : "Approved lines, grouped by vendor and company. Select lines and generate a PO."}
        </p>
      </div>

      <StageTabs
        mode={stage.mode}
        onMode={stage.setMode}
        pendingCount={groups.length}
        completedCount={s.completedPoGenEntries.length}
        scope={stage.scope}
        onScope={stage.setScope}
        scopeNote={`Showing ${user.name}'s entries`}
      />

      {stage.showingCompleted ? (
        <Card className="p-4">
          <QueueTable
            rows={stage.rows}
            rowKey={(e) => e.id}
            columns={completedColumns}
            groupBy={{ idOf: (e) => e.companyId, nameOf: (id) => s.companyById(id)?.name ?? "—", allLabel: "All companies" }}
            rowsLabel="POs"
            emptyTitle="Nothing here yet"
            emptyMessage="POs you generate will appear here. Only the PO number is amendable — and only until the PO is shared."
            actions={(e) =>
              e.lockReason ? (
                <span className="text-[12.5px] font-semibold text-grey-2 cursor-not-allowed inline-flex items-center gap-1" title={e.lockReason}>
                  <Lock className="w-3 h-3" aria-hidden /> Locked
                </span>
              ) : s.canGeneratePo ? (
                <button onClick={() => { setEditPo(e.row); setPoNo(e.row.poNo); setEditErr(null); }} className="text-[12.5px] font-semibold text-orange hover:underline">Edit</button>
              ) : (
                <span className="text-[12.5px] font-semibold text-grey-2 cursor-not-allowed inline-flex items-center gap-1" title="Only the PO Desk can edit a PO.">
                  <Lock className="w-3 h-3" aria-hidden /> Locked
                </span>
              )
            }
          />
        </Card>
      ) : (
        <>
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
        </>
      )}

      {/* Only po_no is amendable: vendor / company / lines are what the PO IS,
          and changing them is a cancel-and-regenerate, not a correction. */}
      <Modal
        open={editPo !== null}
        onClose={() => setEditPo(null)}
        title="Edit PO Number"
        subtitle={editPo ? `${editPo.poNo} · editable until the PO is shared with the vendor.` : undefined}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setEditPo(null)} disabled={savingNo}>Cancel</Button>
            <Button size="sm" disabled={savingNo || !poNo.trim()} onClick={async () => {
              if (!editPo) return;
              setEditErr(null);
              setSavingNo(true);
              try {
                await s.updatePoNo(editPo.id, poNo.trim());
                setEditPo(null);
              } catch (e) { setEditErr((e as Error).message); } finally { setSavingNo(false); }
            }}>{savingNo ? "Saving…" : "Save Changes"}</Button>
          </>
        }
      >
        <div className="space-y-3">
          <FieldLabel label="PO Number" required>
            <TextInput value={poNo} onChange={(e) => setPoNo(e.target.value)} />
          </FieldLabel>
          {editErr && <p className="text-[12.5px] text-ryg-red">{editErr}</p>}
        </div>
      </Modal>
    </div>
  );
}
