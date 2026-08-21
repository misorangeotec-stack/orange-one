import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useSession } from "@/core/platform/session";
import Button from "@/shared/components/ui/Button";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import StageRowAction from "@/shared/components/ui/StageRowAction";
import { useEntryModal } from "@/shared/lib/useEntryModal";
import StageTabs from "@/shared/components/ui/StageTabs";
import { useStageMode } from "@/shared/lib/useStageMode";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { formatDateTime } from "@/shared/lib/time";
import ApprovalModal from "./ApprovalModal";
import HandoverModal from "./HandoverModal";
import { dmy, requestTypeLabel } from "../lib/format";
import { requestHref } from "../lib/routes";
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
  const editing = useEntryModal<SupplyRequest>();

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

  /**
   * The completed entry stamps `departmentId` nullable, the request's is not — one
   * helper so both Department columns render an unset department the same way.
   */
  const deptName = (id: string | null): string => (id ? (s.departmentById(id)?.name ?? "—") : "—");

  const columns: QueueColumn<Row>[] = [
    {
      key: "reqNo",
      header: "Request",
      cell: ({ request: r }) => (
        <Link to={requestHref(r.id)} className="font-semibold text-navy hover:text-orange">
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
    {
      key: "department",
      header: "Department",
      cell: ({ request: r }) => <span className="text-grey">{deptName(r.departmentId)}</span>,
      sortValue: ({ request }) => deptName(request.departmentId),
      filter: { kind: "select", get: ({ request }) => deptName(request.departmentId) },
      tdClassName: "whitespace-nowrap",
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
        <Link to={requestHref(e.requestId)} className="font-semibold text-navy hover:text-orange">
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
    // Reads the entry's OWN `departmentId`, stamped at build time in lib/queues.ts
    // — not a lookup off `e.row`. The filter runs per row per sort comparison, so
    // resolving it here would be the O(n·m) this module has always avoided.
    {
      key: "department",
      header: "Department",
      cell: (e) => <span className="text-grey">{deptName(e.departmentId)}</span>,
      sortValue: (e) => deptName(e.departmentId),
      filter: { kind: "select", get: (e) => deptName(e.departmentId) },
      tdClassName: "whitespace-nowrap",
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
          rowsLabel="requests"
          emptyTitle="Nothing here yet"
          emptyMessage={completedBlurb}
          actions={(e) => (
            <StageRowAction
              as="button"
              lockReason={e.lockReason}
              canEdit={s.canEdit && s.canActOn(stepKey, e.row)}
              permissionReason="Only an owner of this step can edit the entry."
              onEdit={() => editing.openEdit(e.row)}
              onView={() => editing.openView(e.row)}
            />
          )}
        />
      ) : (
        <QueueTable<Row>
          rows={rows}
          rowKey={({ request }) => request.id}
          columns={columns}
          initialSort={{ key: "due", dir: "asc" }}
          rowsLabel="requests"
          emptyTitle="Nothing waiting on you"
          emptyMessage="Requests needing your action will appear here."
          readOnly={!s.canEdit}
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
          <HandoverModal
            open={editing.row !== null}
            onClose={editing.close}
            request={editing.row}
            editing
            readOnly={editing.isView}
          />
        </>
      ) : (
        <>
          <ApprovalModal open={acting !== null} onClose={() => setActing(null)} request={acting} stage={mode} />
          <ApprovalModal
            open={editing.row !== null}
            onClose={editing.close}
            request={editing.row}
            stage={mode}
            editing
            readOnly={editing.isView}
          />
        </>
      )}
    </div>
  );
}
