import { useMemo, useState } from "react";
import type { ComponentType } from "react";
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
import { directionLabel, dmy, requestSubject } from "../lib/format";
import type { StageEntry } from "../lib/queues";
import type { StepKey } from "../lib/steps";
import { useSamplingStore } from "../store";
import type { SamplingRequest } from "../types";

/** One pending row. Exported so a queue page can type its own `pendingColumn`. */
export interface Row {
  request: SamplingRequest;
  dueIso: string | null;
}

export interface StageModalProps {
  open: boolean;
  onClose: () => void;
  request: SamplingRequest | null;
  editing?: boolean;
  readOnly?: boolean;
}

/**
 * A per-step STAGE view (receive / send / confirm / testing / result).
 *
 * Two tabs over the same step: the work still owed — `store.myQueue(step)`, the
 * same entries the Control Center counts — and the work already done here, which
 * stays editable until the next step is done. Every stage screen renders through
 * this one component, so the tabs and the edit path are defined once; each passes
 * its own stage modal + the "captured" column its step records.
 */
export default function RequestQueue({
  stepKey,
  title,
  description,
  actionLabel,
  StageModal,
  capturedColumn,
  completedBlurb,
  pendingColumn,
  pendingActionLabel,
}: {
  stepKey: StepKey;
  title: string;
  description: string;
  actionLabel: string;
  StageModal: ComponentType<StageModalProps>;
  capturedColumn: QueueColumn<StageEntry<SamplingRequest>>;
  completedBlurb: string;
  /**
   * An extra column on the PENDING side. Only `lab_process` needs one: it is a
   * two-pass step, so two requests with the same status can be at different points
   * and would otherwise be indistinguishable in the queue.
   */
  pendingColumn?: QueueColumn<Row>;
  /** Per-row action label, when it depends on how far the row has got. */
  pendingActionLabel?: (r: SamplingRequest) => string;
}) {
  const s = useSamplingStore();
  const session = useSession();
  const [acting, setActing] = useState<SamplingRequest | null>(null);
  const editing = useEntryModal<SamplingRequest>();

  const completedEntries = s.completedFor(stepKey);
  const stage = useStageMode(completedEntries, session.user?.id ?? "");

  const today = todayLocalIso();
  const rows: Row[] = useMemo(
    () =>
      s
        .myQueue(stepKey)
        .map((e) => {
          const request = s.requestById(e.requestId);
          return request ? { request, dueIso: e.dueIso } : null;
        })
        .filter((r): r is Row => r !== null),
    [s, stepKey],
  );

  const columns: QueueColumn<Row>[] = [
    {
      key: "reqNo",
      header: "Request",
      cell: ({ request: r }) => (
        <Link to={`/sampling/requests/${r.id}`} className="font-semibold text-navy hover:text-orange">
          {r.reqNo}
        </Link>
      ),
      sortValue: ({ request }) => request.reqNo,
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "subject",
      header: "Product / Party",
      cell: ({ request: r }) => <span className="text-navy">{requestSubject(r)}</span>,
      filter: { kind: "text", get: ({ request }) => requestSubject(request) },
    },
    {
      key: "direction",
      header: "Direction",
      cell: ({ request: r }) => <span className="text-grey-2">{directionLabel(r.direction)}</span>,
      filter: { kind: "select", get: ({ request }) => directionLabel(request.direction) },
    },
    ...(pendingColumn ? [pendingColumn] : []),
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

  const completedColumns: QueueColumn<StageEntry<SamplingRequest>>[] = [
    {
      key: "reqNo",
      header: "Request",
      cell: (e) => (
        <Link to={`/sampling/requests/${e.requestId}`} className="font-semibold text-navy hover:text-orange">
          {e.ref}
        </Link>
      ),
      sortValue: (e) => e.ref,
      filter: { kind: "text", get: (e) => e.ref },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "subject",
      header: "Product / Party",
      cell: (e) => <span className="text-navy">{requestSubject(e.row)}</span>,
      filter: { kind: "text", get: (e) => requestSubject(e.row) },
    },
    capturedColumn,
    {
      key: "doneAt",
      header: "Recorded",
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

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">{title}</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">{stage.showingCompleted ? completedBlurb : description}</p>
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
        <QueueTable<StageEntry<SamplingRequest>>
          rows={stage.rows}
          rowKey={(e) => e.id}
          columns={completedColumns}
          groupBy={{
            idOf: (e) => e.row.companyId,
            nameOf: (id) => s.companyById(id)?.name ?? "—",
            allLabel: "All companies",
            label: "Company",
          }}
          rowsLabel="requests"
          emptyTitle="Nothing here yet"
          emptyMessage={completedBlurb}
          actions={(e) => (
            <StageRowAction
              as="button"
              lockReason={e.lockReason}
              canEdit={s.canActOn(stepKey, e.row)}
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
          groupBy={{
            idOf: ({ request }) => request.companyId,
            nameOf: (id) => s.companyById(id)?.name ?? "—",
            allLabel: "All companies",
            label: "Company",
          }}
          initialSort={{ key: "due", dir: "asc" }}
          rowsLabel="requests"
          emptyTitle="Nothing waiting on you"
          emptyMessage="Requests needing your action will appear here."
          actions={({ request }) => (
            <Button size="sm" variant="ghost" onClick={() => setActing(request)}>
              {pendingActionLabel ? pendingActionLabel(request) : actionLabel}
            </Button>
          )}
        />
      )}

      <StageModal open={acting !== null} onClose={() => setActing(null)} request={acting} />
      <StageModal
        open={editing.row !== null}
        onClose={editing.close}
        request={editing.row}
        editing
        readOnly={editing.isView}
      />
    </div>
  );
}
