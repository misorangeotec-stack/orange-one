import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import { FieldLabel } from "@/shared/components/ui/Form";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { formatDateTime } from "@/shared/lib/time";
import { numOrDash } from "../../lib/format";
import { useProductionStore } from "../../store";
import type { ProductionRequest } from "../../types";

/**
 * FG Transfer to Godown — the last step. The user multi-selects the cards ready
 * for transfer and uploads ONE Tally voucher file, which closes every selected
 * card and attaches the file to each.
 */
export default function FgTransferQueue() {
  const s = useProductionStore();
  const [picked, setPicked] = useState<ProductionRequest[] | null>(null);
  const [clearFn, setClearFn] = useState<(() => void) | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const rows = useMemo(
    () => s.myQueue("fg_transfer").map((e) => s.requestById(e.requestId)).filter((r): r is ProductionRequest => !!r),
    [s],
  );

  // The repackaging FG lot is carried through every step, so it shows here too —
  // but only when a card in view has one, since a manufactured lot never does.
  const hasFgLot = rows.some((r) => !!r.fgLotNo);

  const columns: QueueColumn<ProductionRequest>[] = [
    {
      key: "batch",
      header: "Batch Card No.",
      cell: (r) => (
        <Link to={`/production-entry/requests/${r.id}`} className="font-semibold text-navy hover:text-orange">{r.jobcardNo || r.reqNo}</Link>
      ),
      sortValue: (r) => r.jobcardNo || r.reqNo,
      filter: { kind: "text", get: (r) => r.jobcardNo || r.reqNo },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "fg",
      header: "FG Item",
      cell: (r) => <span className="text-navy">{s.fgItemById(r.fgItemId)?.name ?? "—"}</span>,
      sortValue: (r) => s.fgItemById(r.fgItemId)?.name ?? "",
      filter: { kind: "select", get: (r) => s.fgItemById(r.fgItemId)?.name ?? "—" },
    },
    ...(hasFgLot
      ? [{
          key: "fgLotNo",
          header: "FG Lot No.",
          cell: (r: ProductionRequest) => <span className="text-navy">{r.fgLotNo || "—"}</span>,
          sortValue: (r: ProductionRequest) => r.fgLotNo ?? "",
          filter: { kind: "text" as const, get: (r: ProductionRequest) => r.fgLotNo ?? "" },
          tdClassName: "whitespace-nowrap",
        }]
      : []),
    {
      key: "packed",
      header: "Packed Qty",
      align: "right",
      cell: (r) => <span className="tabular-nums text-navy">{numOrDash(r.tsPackedQty)}</span>,
      sortValue: (r) => r.tsPackedQty ?? 0,
      filter: { kind: "number", get: (r) => r.tsPackedQty ?? 0 },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "peTally",
      header: "Tally Production Entry",
      cell: (r) => <span className="text-navy">{r.peTallyEntry || "—"}</span>,
      filter: { kind: "text", get: (r) => r.peTallyEntry ?? "" },
    },
    {
      key: "rtdAt",
      header: "Ready Since",
      cell: (r) => <span className="text-grey-2">{formatDateTime(r.rtdAt)}</span>,
      sortValue: (r) => r.rtdAt ?? "",
      filter: { kind: "date", get: (r) => (r.rtdAt ?? "").slice(0, 10) },
      tdClassName: "whitespace-nowrap",
    },
  ];

  const openModal = (selected: ProductionRequest[], clear: () => void) => {
    setPicked(selected);
    setClearFn(() => clear);
    setFile(null);
    setErr(null);
  };
  const close = () => {
    setPicked(null);
    setClearFn(null);
    setFile(null);
    setErr(null);
    setBusy(false);
  };
  const confirm = async () => {
    if (!picked) return;
    if (!file) { setErr("Upload the Tally voucher file."); return; }
    setBusy(true);
    setErr(null);
    try {
      await s.transferFgBulk(picked.map((r) => r.id), file);
      clearFn?.();
      close();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">FG Transfer to Godown (Tally)</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">Select the cards ready for transfer, then upload the Tally voucher to close them.</p>
      </div>
      <QueueTable<ProductionRequest>
        rows={rows}
        rowKey={(r) => r.id}
        columns={columns}
        rowsLabel="job cards"
        emptyTitle="Nothing waiting for transfer"
        emptyMessage="Cards ready for the finished-good transfer will appear here."
        // Bulk "Transfer to Godown" + its file upload are writes; a view-only
        // grant drops the checkbox column and the bulk bar, keeping the queue.
        readOnly={!s.canEdit}
        selectable={{
          renderBulkActions: (selected, clear) => (
            <Button size="sm" onClick={() => openModal(selected, clear)}>Transfer to Godown ({selected.length})</Button>
          ),
        }}
      />

      <Modal
        open={picked !== null}
        onClose={close}
        title="Transfer to godown"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={close} disabled={busy}>Cancel</Button>
            <Button size="sm" onClick={confirm} disabled={busy}>{busy ? "Closing…" : "Transfer & close"}</Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-[13px] text-grey">
            {picked?.length ?? 0} job card{(picked?.length ?? 0) === 1 ? "" : "s"} will be closed with the uploaded Tally voucher.
          </p>
          <FieldLabel label="Tally voucher file" required hint="the transfer entry (PDF / image)">
            <input
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-[12.5px] text-grey file:mr-3 file:rounded-lg file:border-0 file:bg-page file:px-3 file:py-1.5 file:text-[12.5px] file:font-semibold file:text-navy hover:file:bg-line"
            />
          </FieldLabel>
          {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
        </div>
      </Modal>
    </div>
  );
}
