import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import ApprovalModal from "./ApprovalModal";
import HandoverModal from "./HandoverModal";
import { dmy, requestTypeLabel } from "../lib/format";
import type { StepKey } from "../lib/steps";
import { useSuppliesStore } from "../store";
import type { SupplyRequest } from "../types";

interface Row {
  request: SupplyRequest;
  dueIso: string | null;
}

/**
 * A per-step work queue (first approval / second approval / handover). Reads
 * `store.myQueue(step)`, groups by department, and offers the step's action inline.
 * Same entries the Control Center counts, so they cannot disagree.
 */
export default function RequestQueue({
  stepKey,
  mode,
  title,
  description,
  actionLabel,
}: {
  stepKey: StepKey;
  mode: "first" | "second" | "handover";
  title: string;
  description: string;
  actionLabel: string;
}) {
  const s = useSuppliesStore();
  const [acting, setActing] = useState<SupplyRequest | null>(null);

  const today = todayLocalIso();
  const rows: Row[] = useMemo(() => {
    return s
      .myQueue(stepKey)
      .map((e) => {
        const request = s.requestById(e.requestId);
        return request ? { request, dueIso: e.dueIso } : null;
      })
      .filter((r): r is Row => r !== null);
  }, [s, stepKey]);

  const columns: QueueColumn<Row>[] = [
    {
      key: "reqNo",
      header: "Request",
      cell: ({ request: r }) => (
        <Link to={`/office-supplies/requests/${r.id}`} className="font-semibold text-navy hover:text-orange">
          {r.reqNo}
        </Link>
      ),
      sortValue: ({ request }) => request.reqNo,
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "item",
      header: "Item / Service",
      cell: ({ request: r }) => <span className="text-navy">{r.itemName ?? "—"}</span>,
      filter: { kind: "text", get: ({ request }) => request.itemName ?? "" },
    },
    {
      key: "type",
      header: "Type",
      cell: ({ request: r }) => <span className="text-grey-2">{requestTypeLabel(r.requestType)}</span>,
      filter: { kind: "select", get: ({ request }) => requestTypeLabel(request.requestType) },
    },
    {
      key: "for",
      header: "Requested for",
      cell: ({ request: r }) => <span className="text-grey">{r.requestedForName}</span>,
    },
    { key: "qty", header: "Qty", cell: ({ request: r }) => <span className="text-grey-2">{r.quantity}</span> },
    {
      key: "due",
      header: "Due",
      cell: ({ dueIso }) => {
        if (!dueIso) return <span className="text-grey-2">—</span>;
        const overdue = dueIso < today;
        return <span className={overdue ? "text-ryg-red font-semibold" : "text-navy"}>{dmy(dueIso)}</span>;
      },
      sortValue: ({ dueIso }) => dueIso ?? "9999-99-99",
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">{title}</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">{description}</p>
      </div>

      <QueueTable<Row>
        rows={rows}
        rowKey={({ request }) => request.id}
        columns={columns}
        groupBy={{
          idOf: ({ request }) => request.departmentId,
          nameOf: (id) => s.departmentById(id)?.name ?? "—",
          allLabel: "All departments",
          label: "Department",
        }}
        initialSort={{ key: "due", dir: "asc" }}
        rowsLabel="requests"
        emptyTitle="Nothing waiting on you"
        emptyMessage="Requests needing your action will appear here."
        actions={({ request }) => (
          <Button size="sm" variant="ghost" onClick={() => setActing(request)}>
            {actionLabel}
          </Button>
        )}
      />

      {mode === "handover" ? (
        <HandoverModal open={acting !== null} onClose={() => setActing(null)} request={acting} />
      ) : (
        <ApprovalModal open={acting !== null} onClose={() => setActing(null)} request={acting} stage={mode} />
      )}
    </div>
  );
}
