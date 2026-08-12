import { useState } from "react";
import Button from "@/shared/components/ui/Button";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import BomEditorModal from "../../components/BomEditorModal";
import BomImportModal from "../../components/BomImportModal";
import { exportBomsToXlsx } from "../../lib/bomIo";
import { round3 } from "../../lib/bomMath";
import { useProductionStore } from "../../store";
import type { Bom } from "../../types";

/**
 * The BOM master — FG item → BOM → raw material → split %.
 *
 * Not a MasterCrud surface: that component is flat (one row per record) and a BOM
 * is a header plus a component list, so this screen owns its own table, editor and
 * spreadsheet round trip. Everything else about it is deliberately familiar —
 * same QueueTable, same deactivate-don't-delete rule as every other master.
 */
export default function BomMaster() {
  const s = useProductionStore();
  const canManage = s.canManage("bom");

  const [editing, setEditing] = useState<Bom | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fgName = (b: Bom) => s.fgItemById(b.fgItemId)?.name ?? "—";
  const totalPct = (b: Bom) => round3(s.bomComponentsFor(b.id).reduce((a, c) => a + c.pct, 0));

  // Show inactive BOMs too — they are deactivated, never deleted, and an owner
  // needs to find one to bring it back.
  const rows = [...s.boms].sort(
    (a, b) => fgName(a).localeCompare(fgName(b)) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
  );

  const toggleActive = async (b: Bom) => {
    setBusyId(b.id);
    try {
      await s.saveBom({
        id: b.id,
        fgItemId: b.fgItemId ?? "",
        name: b.name,
        // Deactivating also drops the default flag server-side — an unpickable
        // BOM must not stay the one a job card reaches for.
        isDefault: b.isDefault,
        active: !b.active,
        sortOrder: b.sortOrder,
        components: s.bomComponentsFor(b.id).map((c) => ({ rawMaterialId: c.rawMaterialId, pct: String(c.pct) })),
      });
    } finally {
      setBusyId(null);
    }
  };

  const columns: QueueColumn<Bom>[] = [
    {
      key: "fg",
      header: "FG Item",
      cell: (b) => <span className="text-navy">{fgName(b)}</span>,
      sortValue: fgName,
      filter: { kind: "select", get: fgName },
    },
    {
      key: "name",
      header: "BOM",
      cell: (b) => <span className="font-medium text-navy">{b.name}</span>,
      sortValue: (b) => b.name,
      filter: { kind: "text", get: (b) => b.name },
    },
    {
      key: "default",
      header: "Default",
      cell: (b) =>
        b.isDefault ? (
          <span className="inline-flex items-center rounded-full bg-orange/10 px-2 py-0.5 text-[11.5px] font-semibold text-orange">Default</span>
        ) : (
          <span className="text-grey-2">—</span>
        ),
      sortValue: (b) => (b.isDefault ? 0 : 1),
      filter: { kind: "select", get: (b) => (b.isDefault ? "Default" : "Alternate") },
    },
    {
      key: "components",
      header: "Components",
      align: "right",
      cell: (b) => <span className="tabular-nums text-grey">{s.bomComponentsFor(b.id).length}</span>,
      sortValue: (b) => s.bomComponentsFor(b.id).length,
    },
    {
      key: "total",
      header: "Total %",
      align: "right",
      // Never flagged as an error: BOMs legitimately total less than 100%.
      cell: (b) => <span className="tabular-nums text-grey">{totalPct(b)}%</span>,
      sortValue: totalPct,
      exportValue: totalPct,
    },
    {
      key: "active",
      header: "Status",
      cell: (b) =>
        b.active ? (
          <span className="text-ryg-green text-[12.5px] font-medium">Active</span>
        ) : (
          <span className="text-grey-2 text-[12.5px]">Inactive</span>
        ),
      sortValue: (b) => (b.active ? 0 : 1),
      filter: { kind: "select", get: (b) => (b.active ? "Active" : "Inactive") },
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-[13px] text-grey-2 max-w-2xl">
          Each BOM is one formulation of one FG item, stored as percentage splits so it works at any batch size. An FG can
          have several; the one marked <span className="text-navy font-medium">Default</span> is what a job card loads
          automatically — and a job card can always ignore it and enter raw materials by hand.
        </p>
        {canManage && (
          <div className="flex gap-2 shrink-0">
            <Button variant="ghost" size="sm" onClick={() => exportBomsToXlsx(rows, s)}>Export</Button>
            <Button variant="ghost" size="sm" onClick={() => setImporting(true)}>Import</Button>
            <Button size="sm" onClick={() => setAdding(true)}>Add BOM</Button>
          </div>
        )}
      </div>

      <QueueTable<Bom>
        rows={rows}
        rowKey={(b) => b.id}
        columns={columns}
        rowsLabel="BOMs"
        initialSort={{ key: "fg", dir: "asc" }}
        emptyTitle="No BOMs yet"
        emptyMessage="Add one, or import the spreadsheet your formulations already live in."
        rowClassName={(b) => (b.active ? "" : "opacity-60")}
        actions={
          canManage
            ? (b) => (
                <div className="flex gap-2 whitespace-nowrap">
                  <button onClick={() => setEditing(b)} className="text-[12.5px] font-semibold text-orange hover:underline">
                    Edit
                  </button>
                  <button
                    onClick={() => void toggleActive(b)}
                    disabled={busyId === b.id}
                    className="text-[12.5px] font-semibold text-grey-2 hover:underline disabled:opacity-50"
                  >
                    {b.active ? "Deactivate" : "Activate"}
                  </button>
                </div>
              )
            : undefined
        }
      />

      <BomEditorModal open={adding} onClose={() => setAdding(false)} bom={null} />
      <BomEditorModal open={editing !== null} onClose={() => setEditing(null)} bom={editing} />
      <BomImportModal open={importing} onClose={() => setImporting(false)} />
    </div>
  );
}
