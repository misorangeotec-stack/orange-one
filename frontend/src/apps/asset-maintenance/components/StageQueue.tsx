import { useMemo } from "react";
import { Link } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import StageRowAction from "@/shared/components/ui/StageRowAction";
import StageTabs from "@/shared/components/ui/StageTabs";
import DueCell, { overdueRowClass } from "@/shared/components/ui/DueCell";
import { useEntryModal } from "@/shared/lib/useEntryModal";
import { useStageMode } from "@/shared/lib/useStageMode";
import { formatDateTime } from "@/shared/lib/time";
import { useAssetStore } from "../store";
import { STEP_CONFIG } from "../lib/stepConfig";
import { dmy, isoFromDmy } from "../lib/format";
import { isOverdue, type QueueStep, type StageEntry } from "../lib/queues";
import StepModal from "./StepModal";
import StatusPill from "./StatusPill";
import type { ServiceJob } from "../types";

/**
 * A per-step STAGE view. Two tabs over the same step: the work still owed —
 * `store.myQueue(step)`, the same entries both Control Centers count — and the
 * work already done here, which stays editable until the next step is recorded.
 *
 * Every stage screen renders through this one component; it reads the step's
 * config (title, captured column, action label) from lib/stepConfig.
 *
 * ⚠ TWO DIFFERENT "DUE" COLUMNS, and the distinction is the whole module:
 *     Service due — the day the insurance lapses or the service falls due. Misses
 *                   here are real-world consequences.
 *     Step due    — the internal SLA for the person holding this step.
 *   A job can be comfortably inside its step SLA and still be a fortnight past the
 *   date the cover expired, so showing only one of them would hide exactly what
 *   this module was built to surface.
 */
interface PendingRow {
  job: ServiceJob;
  dueIso: string | null;
}

export default function StageQueue({ stepKey }: { stepKey: QueueStep }) {
  const s = useAssetStore();
  const cfg = STEP_CONFIG[stepKey];

  const pending = s.myQueue(stepKey);
  const completedAll = s.completedFor(stepKey);
  const stage = useStageMode<StageEntry<ServiceJob>>(completedAll, s.userId);
  const acting = useEntryModal<ServiceJob>();

  const B = "/asset-maintenance";

  const groupBy = useMemo(
    () => ({
      idOf: (r: PendingRow) => r.job.scheduleTypeId ?? "",
      nameOf: (id: string) => s.scheduleTypeName(id || null),
      allLabel: "All types",
      label: "What is due",
    }),
    [s],
  );

  const pendingColumns: QueueColumn<PendingRow>[] = [
    {
      key: "jobNo",
      header: "Job",
      cell: (r) => (
        <Link to={`${B}/jobs/${r.job.id}`} className="font-semibold text-navy hover:text-orange">
          {r.job.jobNo}
        </Link>
      ),
      sortValue: (r) => r.job.jobNo,
      filter: { kind: "text", get: (r) => r.job.jobNo },
      exportValue: (r) => r.job.jobNo,
    },
    {
      key: "asset",
      header: "Asset",
      cell: (r) => (
        <Link to={`${B}/assets/${r.job.assetId}`} className="text-navy hover:text-orange">
          {s.assetLabel(r.job.assetId)}
        </Link>
      ),
      sortValue: (r) => s.assetLabel(r.job.assetId),
      filter: { kind: "text", get: (r) => s.assetLabel(r.job.assetId) },
    },
    {
      key: "what",
      header: "What is due",
      cell: (r) => <span className="text-grey">{s.scheduleTypeName(r.job.scheduleTypeId)}</span>,
      sortValue: (r) => s.scheduleTypeName(r.job.scheduleTypeId),
      filter: { kind: "select", get: (r) => s.scheduleTypeName(r.job.scheduleTypeId) },
    },
    {
      key: "serviceDue",
      header: "Service due",
      cell: (r) => (
        <span
          className={`whitespace-nowrap ${
            isOverdue(r.job, s.todayIso) ? "font-semibold text-ryg-red" : "text-grey"
          }`}
        >
          {dmy(r.job.dueDate)}
        </span>
      ),
      sortValue: (r) => r.job.dueDate ?? "9999-12-31",
      filter: { kind: "date", get: (r) => r.job.dueDate ?? "" },
      exportValue: (r) => (r.job.dueDate ? dmy(r.job.dueDate) : ""),
    },
    {
      key: "due",
      header: "Step due",
      cell: (r) => <DueCell dueIso={r.dueIso} />,
      sortValue: (r) => r.dueIso ?? "9999-12-31",
      filter: { kind: "date", get: (r) => r.dueIso ?? "" },
      exportValue: (r) => (r.dueIso ? dmy(r.dueIso) : ""),
    },
  ];

  const completedColumns: QueueColumn<StageEntry<ServiceJob>>[] = [
    {
      key: "jobNo",
      header: "Job",
      cell: (e) => (
        <Link to={`${B}/jobs/${e.jobId}`} className="font-semibold text-navy hover:text-orange">
          {e.row.jobNo}
        </Link>
      ),
      sortValue: (e) => e.row.jobNo,
      filter: { kind: "text", get: (e) => e.row.jobNo },
    },
    {
      key: "asset",
      header: "Asset",
      cell: (e) => <span className="text-navy">{s.assetLabel(e.row.assetId)}</span>,
      sortValue: (e) => s.assetLabel(e.row.assetId),
      filter: { kind: "text", get: (e) => s.assetLabel(e.row.assetId) },
    },
    {
      key: "what",
      header: "What was due",
      cell: (e) => <span className="text-grey">{s.scheduleTypeName(e.row.scheduleTypeId)}</span>,
      sortValue: (e) => s.scheduleTypeName(e.row.scheduleTypeId),
      filter: { kind: "select", get: (e) => s.scheduleTypeName(e.row.scheduleTypeId) },
    },
    {
      key: cfg.captured.key,
      header: cfg.captured.header,
      cell: (e) => <span className="text-grey">{cfg.captured.get(e.row)}</span>,
      // A dd-mm-yyyy display value must still sort chronologically.
      sortValue: (e) => (cfg.captured.isDate ? isoFromDmy(cfg.captured.get(e.row)) : cfg.captured.get(e.row)),
      filter: { kind: "text", get: (e) => cfg.captured.get(e.row) },
    },
    {
      key: "status",
      header: "Job status",
      cell: (e) => <StatusPill status={e.row.status} />,
      sortValue: (e) => e.row.status,
      filter: { kind: "select", get: (e) => e.row.status },
    },
    {
      key: "at",
      header: "Recorded",
      cell: (e) => <span className="text-grey whitespace-nowrap">{formatDateTime(e.atIso)}</span>,
      sortValue: (e) => e.atIso,
    },
    {
      key: "by",
      header: "By",
      cell: (e) => <span className="text-grey">{s.personName(e.actorId)}</span>,
      sortValue: (e) => s.personName(e.actorId),
      filter: { kind: "select", get: (e) => s.personName(e.actorId) },
    },
  ];

  const exportStem = `Asset_Maintenance_${cfg.title.replace(/[^\w]+/g, "_")}`;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">{cfg.title}</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          {stage.showingCompleted ? cfg.completedBlurb : cfg.description}
        </p>
      </div>

      <StageTabs
        mode={stage.mode}
        onMode={stage.setMode}
        pendingCount={pending.length}
        completedCount={stage.rows.length}
        scope={stage.scope}
        onScope={stage.setScope}
        scopeNote="Mine shows entries you recorded yourself."
      />

      {stage.showingCompleted ? (
        <QueueTable<StageEntry<ServiceJob>>
          rows={stage.rows}
          rowKey={(e) => e.id}
          columns={completedColumns}
          groupBy={{
            idOf: (e) => e.row.scheduleTypeId ?? "",
            nameOf: (id) => s.scheduleTypeName(id || null),
            allLabel: "All types",
            label: "What was due",
          }}
          actions={(e) => (
            <StageRowAction
              as="button"
              lockReason={e.lockReason}
              canEdit={s.canActOn(stepKey, e.row)}
              permissionReason="Only an owner of this step can edit the entry."
              onEdit={() => acting.openEdit(e.row)}
              onView={() => acting.openView(e.row)}
            />
          )}
          rowsLabel="entries"
          emptyTitle="Nothing recorded here yet"
          emptyMessage="Entries you record at this step will appear here."
          exportName={`${exportStem}_Completed`}
        />
      ) : (
        <QueueTable<PendingRow>
          rows={pending}
          rowKey={(r) => r.job.id}
          columns={pendingColumns}
          groupBy={groupBy}
          actions={(r) =>
            s.canActOn(stepKey, r.job) ? (
              <Button size="sm" onClick={() => acting.openEdit(r.job)}>
                {cfg.actionLabel}
              </Button>
            ) : (
              <Link
                to={`${B}/jobs/${r.job.id}`}
                className="text-[13px] font-semibold text-orange hover:underline"
              >
                Open
              </Link>
            )
          }
          // Red-tints a row whose SERVICE is overdue, not merely its step SLA —
          // that is the miss people need to see from across the room.
          rowClassName={(r) => overdueRowClass(r.job.dueDate) || overdueRowClass(r.dueIso)}
          rowsLabel="jobs"
          initialSort={{ key: "serviceDue", dir: "asc" }}
          emptyTitle="Nothing waiting here"
          emptyMessage="Service jobs reaching this step will appear here."
          exportName={exportStem}
        />
      )}

      <StepModal
        stepKey={stepKey}
        open={!!acting.row}
        onClose={acting.close}
        job={acting.row}
        // A row opened from the Completed tab is an EDIT; from Pending it is a record.
        editing={!!acting.row && stage.showingCompleted && !acting.isView}
        readOnly={acting.isView}
      />
    </div>
  );
}
