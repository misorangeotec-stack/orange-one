import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { formatDateTime } from "@/shared/lib/time";
import { numOrDash } from "../../lib/format";
import { useProductionStore } from "../../store";
import type { ProductionRequest } from "../../types";

/**
 * Ready to Dispatch — the holding bay after packing. Each packed FG shows as a
 * line (batch card no · FG · packed qty · Tally production entry); the user
 * multi-selects and marks them ready, moving them on to FG transfer to godown.
 */
export default function ReadyToDispatchQueue() {
  const s = useProductionStore();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const rows = useMemo(
    () => s.myQueue("ready_to_dispatch").map((e) => s.requestById(e.requestId)).filter((r): r is ProductionRequest => !!r),
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
      key: "packedAt",
      header: "Packed",
      cell: (r) => <span className="text-grey-2">{formatDateTime(r.pkAt)}</span>,
      sortValue: (r) => r.pkAt ?? "",
      filter: { kind: "date", get: (r) => (r.pkAt ?? "").slice(0, 10) },
      tdClassName: "whitespace-nowrap",
    },
  ];

  const markReady = async (selected: ProductionRequest[], clear: () => void) => {
    setBusy(true);
    setErr(null);
    try {
      await s.markReadyToDispatch(selected.map((r) => r.id));
      clear();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Ready to Dispatch</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">Select the packed FG items ready to move to FG transfer to godown, then mark them ready to dispatch.</p>
      </div>
      {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      <QueueTable<ProductionRequest>
        rows={rows}
        rowKey={(r) => r.id}
        columns={columns}
        rowsLabel="job cards"
        emptyTitle="Nothing ready to dispatch"
        emptyMessage="Packed cards ready to dispatch will appear here."
        readOnly={!s.canEdit}
        selectable={{
          renderBulkActions: (selected, clear) => (
            <Button size="sm" disabled={busy} onClick={() => markReady(selected, clear)}>
              {busy ? "Working…" : `Ready to Dispatch (${selected.length})`}
            </Button>
          ),
        }}
      />
    </div>
  );
}
