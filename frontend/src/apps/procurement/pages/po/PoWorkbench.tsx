import { useState } from "react";
import { Link } from "react-router-dom";
import { Upload, X } from "lucide-react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import StageRowAction from "@/shared/components/ui/StageRowAction";
import DueCell, { overdueRowClass } from "@/shared/components/ui/DueCell";
import { useEntryModal } from "@/shared/lib/useEntryModal";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import { formatDate, formatDateTime } from "@/shared/lib/time";
import { useEffectiveIdentity } from "@/shared/sandbox/useEffectiveIdentity";
import StageTabs from "@/shared/components/ui/StageTabs";
import { useStageMode } from "@/shared/lib/useStageMode";
import { useProcurementStore } from "../../store";
import { inr } from "../../lib/format";
import PoModal from "../../components/PoModal";
import PoItemsReadout from "../../components/PoItemsReadout";
import PoRefPanel from "../../components/PoRefPanel";
import { PoDocLink } from "../../components/DocLinks";
import type { StageEntry } from "../../lib/queues";
import type { PurchaseRequest, RequestItem, PurchaseOrder } from "../../types";

/**
 * PO Stage — one row per REQUISITION whose approved items are waiting for a PO,
 * matching Sourcing and Approvals. Open a row to see every item and generate the
 * PO from there.
 *
 * A PO never spans two requisitions. Within one it is still per vendor, so a
 * legacy requisition sourced across two vendors produces two POs — see PoModal.
 */
export default function PoWorkbench() {
  const s = useProcurementStore();
  const { user } = useEffectiveIdentity();
  const [poRequest, setPoRequest] = useState<PurchaseRequest | null>(null);
  const editPo = useEntryModal<PurchaseOrder>();
  const [poNo, setPoNo] = useState("");
  const [tallyPoNo, setTallyPoNo] = useState("");
  const [editFile, setEditFile] = useState<File | null>(null);
  const [savingNo, setSavingNo] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);

  /** Seed the edit dialog from the row it was opened on. */
  const seedEdit = (po: PurchaseOrder) => {
    setPoNo(po.poNo);
    setTallyPoNo(po.tallyPoNo ?? "");
    setEditFile(null);
    setEditErr(null);
  };
  const stage = useStageMode(s.completedPoGenEntries, user.id);

  const companyName = (id: string) => s.companyById(id)?.name ?? "—";
  /** Admin-configured: anchor step's completion + N working days (Setup → Due Dates). */
  const dueIso = (r: PurchaseRequest) => s.dueIsoForRequest(r, "po");
  /**
   * Every column below reads THIS set, never the whole requisition: a rejected
   * or already-PO'd sibling line must not show up in the count, the quantity or
   * the money.
   */
  const poolLines = (r: PurchaseRequest) => s.poDeskLinesForRequest(r.id);

  /**
   * Quantity SUMS across items, so it can carry a unit only when every item
   * shares one; folding KGS and PCS into "2500 KGS" would be a plain lie, so a
   * mixed requisition says so and lists its units on hover. Same treatment as
   * the Sourcing and Approvals queues, deliberately.
   */
  const qtyOf = (r: PurchaseRequest) => {
    const lines = poolLines(r);
    const total = Math.round(lines.reduce((sum, l) => sum + (l.finalQty ?? l.quantity), 0) * 1000) / 1000;
    const units = [...new Set(lines.map((l) => l.unit).filter(Boolean))];
    if (units.length === 1) return { total, label: units[0], title: undefined as string | undefined };
    if (units.length === 0) return { total, label: "", title: undefined };
    return { total, label: "mixed", title: `Different units on this requisition: ${units.join(", ")}` };
  };
  const qtyCell = (q: ReturnType<typeof qtyOf>) => (
    <span title={q.title}>
      {q.total}
      {q.label && <span className="ml-1 text-[11.5px] text-grey-2">{q.label}</span>}
    </span>
  );

  /**
   * Base (qty × rate, pre-GST) and the GST on it. GST is derived from the total
   * rather than summed separately, so the three figures can never disagree.
   */
  const money = (r: PurchaseRequest) => {
    const lines = poolLines(r);
    const total = Math.round(lines.reduce((sum, l) => sum + (l.lineValue ?? 0), 0) * 100) / 100;
    const base = Math.round(lines.reduce((sum, l) => sum + (l.finalQty ?? 0) * (l.finalRate ?? 0), 0) * 100) / 100;
    return { base, gst: Math.round((total - base) * 100) / 100, total };
  };

  const itemsCell = (lines: RequestItem[]) => {
    const names = lines.slice(0, 2).map((l) => s.itemById(l.itemId)?.name ?? "—");
    const rest = lines.length - names.length;
    return (
      <div className="min-w-0">
        <span className="font-medium text-navy">{lines.length} item{lines.length === 1 ? "" : "s"}</span>
        <span className="ml-1.5 text-[11.5px] text-grey-2">{names.join(", ")}{rest > 0 ? ` +${rest} more` : ""}</span>
      </div>
    );
  };
  const itemsText = (r: PurchaseRequest) => poolLines(r).map((l) => s.itemById(l.itemId)?.name ?? "").join(", ");

  /**
   * How many POs this row will produce, named where there is only one. Says so
   * up front rather than making the user open the dialog to find out.
   */
  const vendorNames = (r: PurchaseRequest) =>
    s.poDeskVendorIdsForRequest(r.id).map((id) => s.vendorById(id)?.name ?? "—");
  const vendorText = (r: PurchaseRequest) => {
    const names = vendorNames(r);
    if (names.length === 1) return names[0];
    if (names.length === 0) return "No vendor";
    return `${names.length} vendors`;
  };
  const vendorCell = (r: PurchaseRequest) => {
    const names = vendorNames(r);
    if (names.length === 0) return <span className="text-ryg-red">No vendor</span>;
    return <span title={names.length > 1 ? names.join(", ") : undefined}>{vendorText(r)}</span>;
  };

  const columns: QueueColumn<PurchaseRequest>[] = [
    { key: "company", header: "Company", cell: (r) => companyName(r.companyId), sortValue: (r) => companyName(r.companyId), filter: { kind: "select", get: (r) => companyName(r.companyId) }, tdClassName: "whitespace-nowrap" },
    { key: "request", header: "Request", cell: (r) => <Link to={`/procurement/requests/${r.id}`} className="font-semibold text-navy hover:text-orange">{r.requestNo}</Link>, sortValue: (r) => r.requestNo, filter: { kind: "text", get: (r) => r.requestNo }, tdClassName: "whitespace-nowrap" },
    { key: "items", header: "Items", cell: (r) => itemsCell(poolLines(r)), sortValue: (r) => poolLines(r).length, filter: { kind: "text", get: (r) => itemsText(r) } },
    { key: "qty", header: "Total Qty", cell: (r) => qtyCell(qtyOf(r)), sortValue: (r) => qtyOf(r).total, filter: { kind: "number", get: (r) => qtyOf(r).total }, tdClassName: "whitespace-nowrap" },
    { key: "vendor", header: "Vendor", cell: (r) => vendorCell(r), sortValue: (r) => vendorText(r), filter: { kind: "select", get: (r) => vendorText(r) }, tdClassName: "whitespace-nowrap" },
    { key: "base", header: "Base", cell: (r) => inr(money(r).base), sortValue: (r) => money(r).base, filter: { kind: "number", get: (r) => money(r).base }, tdClassName: "whitespace-nowrap" },
    { key: "gst", header: "GST", cell: (r) => inr(money(r).gst), sortValue: (r) => money(r).gst, filter: { kind: "number", get: (r) => money(r).gst }, tdClassName: "whitespace-nowrap" },
    { key: "value", header: "Total", cell: (r) => <span className="font-semibold text-navy">{inr(money(r).total)}</span>, sortValue: (r) => money(r).total, filter: { kind: "number", get: (r) => money(r).total }, tdClassName: "whitespace-nowrap" },
    { key: "created", header: "Created", cell: (r) => formatDate(r.createdAt), sortValue: (r) => r.createdAt, filter: { kind: "date", get: (r) => r.createdAt }, tdClassName: "whitespace-nowrap" },
    { key: "due", header: "Due", cell: (r) => <DueCell dueIso={dueIso(r)} />, sortValue: (r) => dueIso(r), filter: { kind: "date", get: (r) => dueIso(r) }, tdClassName: "whitespace-nowrap" },
  ];

  const completedColumns: QueueColumn<StageEntry<PurchaseOrder>>[] = [
    { key: "company", header: "Company", cell: (e) => companyName(e.companyId ?? ""), sortValue: (e) => companyName(e.companyId ?? ""), filter: { kind: "select", get: (e) => companyName(e.companyId ?? "") }, tdClassName: "whitespace-nowrap" },
    { key: "po", header: "PO No.", cell: (e) => <Link to={`/procurement/pos/${e.poId}`} className="font-semibold text-navy hover:text-orange">{e.ref}</Link>, sortValue: (e) => e.ref, filter: { kind: "text", get: (e) => e.ref }, tdClassName: "whitespace-nowrap" },
    { key: "tallyPo", header: "Tally PO No.", cell: (e) => e.row.tallyPoNo ?? "—", sortValue: (e) => e.row.tallyPoNo ?? "", filter: { kind: "text", get: (e) => e.row.tallyPoNo ?? "" }, tdClassName: "whitespace-nowrap" },
    { key: "pdf", header: "PO PDF", cell: (e) => (e.row.documentPath ? <PoDocLink po={e.row} /> : <span className="text-grey-2">—</span>), tdClassName: "whitespace-nowrap" },
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

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">PO Stage</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          {stage.showingCompleted
            ? "POs already generated. The PO number, Tally PO number and PDF stay editable until the PO is shared with the vendor."
            : "Approved requisitions waiting for a PO. Open one to see its items, enter the Tally PO number, attach the PO PDF and generate."}
        </p>
      </div>

      <StageTabs
        mode={stage.mode}
        onMode={stage.setMode}
        pendingCount={s.poRequestQueue.length}
        completedCount={s.completedPoGenEntries.length}
        scope={stage.scope}
        onScope={stage.setScope}
        scopeNote={`Showing ${user.name}'s entries`}
      />

      {!stage.showingCompleted && !s.canGeneratePo && (
        <Card className="px-4 py-3 text-[12.5px] text-grey-2">
          You can open a requisition and see its pool, but only the PO Desk can generate POs.
        </Card>
      )}

      <Card className="p-4">
        {stage.showingCompleted ? (
          <QueueTable
            rows={stage.rows}
            rowKey={(e) => e.id}
            columns={completedColumns}
            groupBy={{ idOf: (e) => e.companyId, nameOf: companyName, allLabel: "All companies" }}
            hideGroupHeaders
            rowsLabel="POs"
            emptyTitle="Nothing here yet"
            emptyMessage="POs you generate will appear here. The PO number, Tally PO number and PDF stay amendable until the PO is shared."
            actions={(e) => (
              <StageRowAction
                lockReason={e.lockReason}
                canEdit={s.canGeneratePo}
                permissionReason="Only the PO Desk can edit a PO."
                onEdit={() => { editPo.openEdit(e.row); seedEdit(e.row); }}
                onView={() => { editPo.openView(e.row); seedEdit(e.row); }}
              />
            )}
          />
        ) : (
          <QueueTable
            rows={s.poRequestQueue}
            rowKey={(r) => r.id}
            columns={columns}
            groupBy={{ idOf: (r) => r.companyId, nameOf: companyName, allLabel: "All companies" }}
            hideGroupHeaders
            rowClassName={(r) => overdueRowClass(dueIso(r))}
            rowsLabel="requests"
            emptyTitle="Nothing to PO"
            emptyMessage="Approved requisitions waiting for a PO will appear here."
            initialSort={{ key: "value", dir: "desc" }}
            actions={(r) => (
              <button onClick={() => setPoRequest(r)} className="text-[12.5px] font-semibold text-orange hover:underline">
                {s.canGeneratePo ? "Generate" : "View"}
              </button>
            )}
          />
        )}
      </Card>

      <PoModal
        request={poRequest}
        open={poRequest !== null}
        readOnly={!s.canGeneratePo}
        onClose={() => setPoRequest(null)}
      />

      {/* Only what the PO STAGE recorded is amendable — its number, the Tally PO
          number and the PDF. Vendor / company / lines are what the PO IS, and
          changing them is a cancel-and-regenerate, not a correction.

          `readOnlyHeader` is load-bearing: in View mode the body is rendered
          inside a disabled <fieldset>, so a PDF link placed there would be dead. */}
      <Modal
        open={editPo.row !== null}
        readOnly={editPo.isView}
        readOnlyHeader={editPo.row ? <PoDocLink po={editPo.row} /> : undefined}
        onClose={editPo.close}
        size="2xl"
        title={editPo.isView ? "PO Details" : "Edit PO Details"}
        subtitle={editPo.row ? `${editPo.row.poNo} · editable until the PO is shared with the vendor.` : undefined}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={editPo.close} disabled={savingNo}>Cancel</Button>
            <Button size="sm" disabled={savingNo || !poNo.trim() || !tallyPoNo.trim()} onClick={async () => {
              if (!editPo.row) return;
              setEditErr(null);
              setSavingNo(true);
              try {
                // Upload first, so a failed upload never half-writes the row. The
                // superseded file is left in storage on purpose — uploads are
                // immutable timestamped keys and the document's history matters.
                const doc = editFile ? await s.uploadPoDocument(editPo.row.id, editFile) : null;
                await s.updatePoDetails({
                  poId: editPo.row.id,
                  poNo: poNo.trim(),
                  tallyPoNo: tallyPoNo.trim(),
                  documentPath: doc?.path ?? null, // null ⇒ server keeps the existing document
                  documentName: doc?.name ?? null,
                });
                editPo.close();
              } catch (e) { setEditErr((e as Error).message); } finally { setSavingNo(false); }
            }}>{savingNo ? "Saving…" : "Save Changes"}</Button>
          </>
        }
      >
        <div className="space-y-3.5">
          {/* The company and the vendor, in the same block every other stage form
              opens with. The PO number and the Tally PO number are left out of it
              on purpose — they are the fields being edited right below. */}
          {editPo.row && <PoRefPanel po={editPo.row} readOnly={editPo.isView} />}

          <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
            <FieldLabel label="PO Number" required>
              <TextInput value={poNo} onChange={(e) => setPoNo(e.target.value)} />
            </FieldLabel>
            <FieldLabel label="Tally PO Number" required hint="Generated in Tally/ERP">
              <TextInput value={tallyPoNo} onChange={(e) => setTallyPoNo(e.target.value)} placeholder="e.g. 2627/PO/0042" />
            </FieldLabel>
          </div>

          {!editPo.isView && (
            <FieldLabel label="PO PDF" hint="Leave as-is to keep the attached file — the previous version is retained either way.">
              <div className="flex flex-wrap items-center gap-2.5">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-white px-3.5 py-2.5 text-[13px] font-medium text-navy transition hover:border-orange hover:text-orange">
                  <Upload className="h-4 w-4" />
                  {editFile ? "Change file" : editPo.row?.documentPath ? "Replace file" : "Choose file"}
                  <input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx,image/*,application/pdf"
                    onChange={(e) => setEditFile(e.target.files?.[0] ?? null)} />
                </label>
                {editFile ? (
                  <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-grey-2">
                    <span className="max-w-[260px] truncate text-navy">{editFile.name}</span>
                    <button type="button" onClick={() => setEditFile(null)} className="shrink-0 text-grey-2 hover:text-ryg-red" aria-label="Remove file"><X className="h-3.5 w-3.5" /></button>
                  </span>
                ) : editPo.row?.documentPath ? (
                  <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-grey-2">
                    Current: <span className="max-w-[260px] truncate text-navy">{editPo.row.documentName ?? "attached file"}</span>
                  </span>
                ) : (
                  <span className="text-[12.5px] text-ryg-red">No PDF attached — the PO cannot be shared without one.</span>
                )}
              </div>
            </FieldLabel>
          )}

          {editPo.row && <PoItemsReadout po={editPo.row} />}
          {editErr && <p className="text-[12.5px] text-ryg-red">{editErr}</p>}
        </div>
      </Modal>
    </div>
  );
}
