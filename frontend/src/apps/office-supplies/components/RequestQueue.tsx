import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Lock } from "lucide-react";
import { useSession } from "@/core/platform/session";
import Button from "@/shared/components/ui/Button";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import StageTabs from "@/shared/components/ui/StageTabs";
import { useStageMode } from "@/shared/lib/useStageMode";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { formatDateTime } from "@/shared/lib/time";
import ApprovalModal from "./ApprovalModal";
import HandoverModal from "./HandoverModal";
import { dmy, requestTypeLabel } from "../lib/format";
import type { StageEntry } from "../lib/queues";
import type { StepKey } from "../lib/steps";
import { useSuppliesStore } from "../store";
import type { SupplyRequest } from "../types";

interface Row {
  request: SupplyRequest;
  dueIso: string | null;
}

/**
 * A per-step STAGE view (first approval / second approval / handover).
 *
 * Two tabs over the same step: the work still owed — `store.myQueue(step)`, the
 * same entries the Control Center counts, so they cannot disagree — and the work
 * already done here, which stays editable until the next step is done.
 *
 * All three stage screens render through this one component, so the tabs and the
 * edit path are defined once.
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
  const session = useSession();
  const [acting, setActing] = useState<SupplyRequest | null>(null);
  const [editing, setEditing] = useState<SupplyRequest | null>(null);

  // This app has no sandbox/personas, so the real session user IS the effective
  // one — hence useSession rather than useEffectiveIdentity, and no scopeNote on
  // the tabs below.
  const completedEntries = s.completedFor(stepKey);
  const stage = useStageMode(completedEntries, session.user?.id ?? "");

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

  const isHandover = mode === "handover";

  /**
   * The Completed columns. `formatDateTime`, not `dmy`: these are timestamptz,
   * and slicing the raw UTC string would render an 02:00 IST entry as the
   * previous day — exactly the wrong thing to tell someone checking their own work.
   */
  const completedColumns: QueueColumn<StageEntry<SupplyRequest>>[] = [
    {
      key: "reqNo",
      header: "Request",
      cell: (e) => (
        <Link to={`/office-supplies/requests/${e.requestId}`} className="font-semibold text-navy hover:text-orange">
          {e.ref}
        </Link>
      ),
      sortValue: (e) => e.ref,
      filter: { kind: "text", get: (e) => e.ref },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "item",
      header: "Item / Service",
      cell: (e) => <span className="text-navy">{e.row.itemName ?? "—"}</span>,
      filter: { kind: "text", get: (e) => e.row.itemName ?? "" },
    },
    {
      key: "for",
      header: "Requested for",
      cell: (e) => <span className="text-grey">{e.row.requestedForName}</span>,
      sortValue: (e) => e.row.requestedForName,
    },
    { key: "qty", header: "Qty", cell: (e) => <span className="text-grey-2">{e.row.quantity}</span> },
    isHandover
      ? {
          // Handover's outcome is a delivery, not an approve/reject.
          key: "delivered",
          header: "Delivered On",
          cell: (e) =>
            e.row.actualDeliveryDate ? (
              <span className="text-navy">{dmy(e.row.actualDeliveryDate)}</span>
            ) : (
              <span className="text-grey-2" title="Handover recorded; awaiting the actual delivery date.">Not yet</span>
            ),
          sortValue: (e) => e.row.actualDeliveryDate ?? "",
          filter: { kind: "date", get: (e) => e.row.actualDeliveryDate ?? "" },
          tdClassName: "whitespace-nowrap",
        }
      : {
          // A rejection IS a completed decision — the kind of thing an approver
          // most wants to look back at — so it shows here, locked.
          key: "decision",
          header: "Decision",
          cell: (e) =>
            e.row.status === "rejected" ? (
              <span className="text-ryg-red font-semibold">Not approved</span>
            ) : (
              <span className="text-ryg-green font-semibold">Approved</span>
            ),
          sortValue: (e) => e.row.status,
          filter: { kind: "select", get: (e) => (e.row.status === "rejected" ? "Not approved" : "Approved") },
          tdClassName: "whitespace-nowrap",
        },
    {
      key: "doneAt",
      header: isHandover ? "Handed Over" : "Decided On",
      cell: (e) => formatDateTime(e.atIso),
      sortValue: (e) => e.atIso,
      filter: { kind: "date", get: (e) => e.atIso.slice(0, 10) },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "doneBy",
      header: "By",
      cell: (e) =>
        e.actorId ? (
          s.personName(e.actorId)
        ) : (
          <span className="text-grey-2" title="Recorded before the app captured who did this step.">Not recorded</span>
        ),
      sortValue: (e) => s.personName(e.actorId),
      filter: { kind: "select", get: (e) => (e.actorId ? s.personName(e.actorId) : "Not recorded") },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "edited",
      header: "Edited",
      cell: (e) =>
        e.editedAtIso ? (
          <span className="text-[12px] text-grey-2" title={`Last edited by ${s.personName(e.editedById)}`}>
            {formatDateTime(e.editedAtIso)}
          </span>
        ) : (
          <span className="text-grey-2">—</span>
        ),
      sortValue: (e) => e.editedAtIso ?? "",
      tdClassName: "whitespace-nowrap",
    },
  ];

  const completedBlurb = isHandover
    ? "Handovers you record will appear here. A delivered request stays correctable — handover is the last step, so nothing downstream depends on it."
    : "Decisions you make will appear here, and stay revisable until the next step is done.";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">{title}</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          {stage.showingCompleted ? completedBlurb : description}
        </p>
      </div>

      <StageTabs
        mode={stage.mode}
        onMode={stage.setMode}
        pendingCount={rows.length}
        completedCount={completedEntries.length}
        scope={stage.scope}
        onScope={stage.setScope}
      />

      {stage.showingCompleted ? (
        <QueueTable<StageEntry<SupplyRequest>>
          rows={stage.rows}
          rowKey={(e) => e.id}
          columns={completedColumns}
          // departmentId is stamped onto the entry at build time on purpose:
          // QueueTable calls idOf from inside its sort comparator, so a lookup
          // here would be O(n·m) over a list that grows for the life of the business.
          groupBy={{
            idOf: (e) => e.departmentId,
            nameOf: (id) => s.departmentById(id)?.name ?? "—",
            allLabel: "All departments",
            label: "Department",
          }}
          rowsLabel="requests"
          emptyTitle="Nothing here yet"
          emptyMessage={completedBlurb}
          actions={(e) =>
            e.lockReason ? (
              <span className="text-[12.5px] font-semibold text-grey-2 cursor-not-allowed inline-flex items-center gap-1" title={e.lockReason}>
                <Lock className="w-3 h-3" aria-hidden /> Locked
              </span>
            ) : s.canActOn(stepKey, e.row) ? (
              <Button size="sm" variant="ghost" onClick={() => setEditing(e.row)}>Edit</Button>
            ) : (
              <span className="text-[12.5px] font-semibold text-grey-2 cursor-not-allowed inline-flex items-center gap-1" title="Only an owner of this step can edit the entry.">
                <Lock className="w-3 h-3" aria-hidden /> Locked
              </span>
            )
          }
        />
      ) : (
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
      )}

      {isHandover ? (
        <>
          <HandoverModal open={acting !== null} onClose={() => setActing(null)} request={acting} />
          <HandoverModal open={editing !== null} onClose={() => setEditing(null)} request={editing} editing />
        </>
      ) : (
        <>
          <ApprovalModal open={acting !== null} onClose={() => setActing(null)} request={acting} stage={mode} />
          <ApprovalModal open={editing !== null} onClose={() => setEditing(null)} request={editing} stage={mode} editing />
        </>
      )}
    </div>
  );
}
