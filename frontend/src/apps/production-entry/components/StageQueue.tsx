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
import { dmy, requestSubject } from "../lib/format";
import { STEP_CONFIG } from "../lib/stepConfig";
import type { StageEntry, QueueStep } from "../lib/queues";
import StepModal from "./StepModal";
import { useProductionStore } from "../store";
import type { ProductionRequest } from "../types";

interface Row {
  request: ProductionRequest;
  dueIso: string | null;
}

/**
 * A per-step STAGE view. Two tabs over the same step: the work still owed —
 * `store.myQueue(step)`, the same entries the Control Center counts — and the work
 * already done here, which stays editable until the next step is done. Every stage
 * screen renders through this one component; it reads the step's config (title,
 * captured column, action label) from lib/stepConfig.
 */
export default function StageQueue({ stepKey }: { stepKey: QueueStep }) {
  const s = useProductionStore();
  const session = useSession();
  const cfg = STEP_CONFIG[stepKey];
  const [acting, setActing] = useState<ProductionRequest | null>(null);
  const editing = useEntryModal<ProductionRequest>();

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
      header: "Job Card",
      cell: ({ request: r }) => (
        <Link to={`/production-entry/requests/${r.id}`} className="font-semibold text-navy hover:text-orange">
          {r.reqNo}
        </Link>
      ),
      sortValue: ({ request }) => request.reqNo,
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "subject",
      header: "Job Card No.",
      cell: ({ request: r }) => <span className="text-navy">{requestSubject(r)}</span>,
      filter: { kind: "text", get: ({ request }) => requestSubject(request) },
    },
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

  const completedColumns: QueueColumn<StageEntry<ProductionRequest>>[] = [
    {
      key: "reqNo",
      header: "Job Card",
      cell: (e) => (
        <Link to={`/production-entry/requests/${e.requestId}`} className="font-semibold text-navy hover:text-orange">
          {e.ref}
        </Link>
      ),
      sortValue: (e) => e.ref,
      filter: { kind: "text", get: (e) => e.ref },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "subject",
      header: "Job Card No.",
      cell: (e) => <span className="text-navy">{requestSubject(e.row)}</span>,
      filter: { kind: "text", get: (e) => requestSubject(e.row) },
    },
    {
      key: cfg.captured.key,
      header: cfg.captured.header,
      cell: (e) => <span className="text-navy">{cfg.captured.get(e.row)}</span>,
      sortValue: (e) => cfg.captured.get(e.row),
      filter: { kind: "text", get: (e) => cfg.captured.get(e.row) },
      tdClassName: "whitespace-nowrap",
    },
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
        <h1 className="text-[22px] font-bold text-navy">{cfg.title}</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">{stage.showingCompleted ? cfg.completedBlurb : cfg.description}</p>
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
        <QueueTable<StageEntry<ProductionRequest>>
          rows={stage.rows}
          rowKey={(e) => e.id}
          columns={completedColumns}
          groupBy={{ idOf: () => "all", nameOf: () => "All job cards", allLabel: "All job cards", label: "" }}
          rowsLabel="job cards"
          emptyTitle="Nothing here yet"
          emptyMessage={cfg.completedBlurb}
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
          groupBy={{ idOf: () => "all", nameOf: () => "All job cards", allLabel: "All job cards", label: "" }}
          initialSort={{ key: "due", dir: "asc" }}
          rowsLabel="job cards"
          emptyTitle="Nothing waiting on you"
          emptyMessage="Job cards needing your action will appear here."
          actions={({ request }) => (
            <Button size="sm" variant="ghost" onClick={() => setActing(request)}>
              {cfg.actionLabel}
            </Button>
          )}
        />
      )}

      <StepModal stepKey={stepKey} open={acting !== null} onClose={() => setActing(null)} request={acting} />
      <StepModal
        stepKey={stepKey}
        open={editing.row !== null}
        onClose={editing.close}
        request={editing.row}
        editing
        readOnly={editing.isView}
      />
    </div>
  );
}
