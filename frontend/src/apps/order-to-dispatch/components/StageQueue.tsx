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
import { useDispatchStore } from "../store";
import { STEP_CONFIG } from "../lib/stepConfig";
import { DISPATCH_TYPE_LABEL, dmy, isoFromDmy, qtyTotals } from "../lib/format";
import type { QueueStep, StageEntry } from "../lib/queues";
import StepModal from "./StepModal";
import StatusPill from "./StatusPill";
import type { DispatchOrder } from "../types";

/**
 * A per-step STAGE view. Two tabs over the same step: the work still owed —
 * `store.myQueue(step)`, the same entries both Control Centers count — and the
 * work already done here, which stays editable until the next step is recorded.
 *
 * Every stage screen renders through this one component; it reads the step's
 * config (title, captured column, action label) from lib/stepConfig.
 */
interface PendingRow {
  order: DispatchOrder;
  dueIso: string | null;
}

export default function StageQueue({ stepKey }: { stepKey: QueueStep }) {
  const s = useDispatchStore();
  const cfg = STEP_CONFIG[stepKey];

  const pending = s.myQueue(stepKey);
  const completedAll = s.completedFor(stepKey);
  const stage = useStageMode<StageEntry<DispatchOrder>>(completedAll, s.userId);
  const acting = useEntryModal<DispatchOrder>();

  const B = "/order-to-dispatch";

  const groupBy = useMemo(
    () => ({
      idOf: (r: PendingRow) => r.order.customerId,
      nameOf: (id: string) => s.customerName(id),
      allLabel: "All customers",
      label: "Customer",
    }),
    [s],
  );

  const pendingColumns: QueueColumn<PendingRow>[] = [
    {
      key: "orderNo",
      header: "Order",
      cell: (r) => (
        <Link to={`${B}/orders/${r.order.id}`} className="font-semibold text-navy hover:text-orange">
          {r.order.orderNo}
        </Link>
      ),
      sortValue: (r) => r.order.orderNo,
      filter: { kind: "text", get: (r) => r.order.orderNo },
      exportValue: (r) => r.order.orderNo,
    },
    {
      key: "customer",
      header: "Customer",
      cell: (r) => <span className="text-navy">{s.customerName(r.order.customerId)}</span>,
      sortValue: (r) => s.customerName(r.order.customerId),
      filter: { kind: "select", get: (r) => s.customerName(r.order.customerId) },
    },
    {
      key: "type",
      header: "Type",
      cell: (r) => <span className="text-grey">{DISPATCH_TYPE_LABEL[r.order.dispatchType]}</span>,
      sortValue: (r) => r.order.dispatchType,
      filter: { kind: "select", get: (r) => DISPATCH_TYPE_LABEL[r.order.dispatchType] },
    },
    {
      key: "items",
      header: "Items",
      align: "right",
      cell: (r) => {
        const t = qtyTotals(r.order);
        return (
          <span className="text-grey whitespace-nowrap">
            {r.order.lines.length} · {t.final || t.ordered}
          </span>
        );
      },
      sortValue: (r) => r.order.lines.length,
    },
    {
      key: "promised",
      header: "Promised",
      cell: (r) => <span className="text-grey whitespace-nowrap">{dmy(r.order.promisedDate)}</span>,
      sortValue: (r) => r.order.promisedDate ?? "",
      filter: { kind: "date", get: (r) => r.order.promisedDate ?? "" },
    },
    {
      key: "due",
      header: "Due",
      cell: (r) => <DueCell dueIso={r.dueIso} />,
      sortValue: (r) => r.dueIso ?? "9999-12-31",
      filter: { kind: "date", get: (r) => r.dueIso ?? "" },
      exportValue: (r) => (r.dueIso ? dmy(r.dueIso) : ""),
    },
  ];

  const completedColumns: QueueColumn<StageEntry<DispatchOrder>>[] = [
    {
      key: "orderNo",
      header: "Order",
      cell: (e) => (
        <Link to={`${B}/orders/${e.orderId}`} className="font-semibold text-navy hover:text-orange">
          {e.ref}
        </Link>
      ),
      sortValue: (e) => e.ref,
      filter: { kind: "text", get: (e) => e.ref },
    },
    {
      key: "customer",
      header: "Customer",
      cell: (e) => <span className="text-navy">{s.customerName(e.row.customerId)}</span>,
      sortValue: (e) => s.customerName(e.row.customerId),
      filter: { kind: "select", get: (e) => s.customerName(e.row.customerId) },
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
      header: "Order status",
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
    {
      key: "edited",
      header: "Edited",
      cell: (e) =>
        e.editedAtIso ? (
          <span className="text-grey-2 whitespace-nowrap">
            {formatDateTime(e.editedAtIso)} · {s.personName(e.editedById)}
          </span>
        ) : (
          <span className="text-grey-2">—</span>
        ),
      sortValue: (e) => e.editedAtIso ?? "",
    },
  ];

  const exportStem = `Order_To_Dispatch_${cfg.title.replace(/[^\w]+/g, "_")}`;

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
        <QueueTable<StageEntry<DispatchOrder>>
          rows={stage.rows}
          rowKey={(e) => e.id}
          columns={completedColumns}
          groupBy={{
            idOf: (e) => e.row.customerId,
            nameOf: (id) => s.customerName(id),
            allLabel: "All customers",
            label: "Customer",
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
          rowKey={(r) => r.order.id}
          columns={pendingColumns}
          groupBy={groupBy}
          actions={(r) =>
            s.canActOn(stepKey, r.order) ? (
              <Button size="sm" onClick={() => acting.openEdit(r.order)}>
                {cfg.actionLabel}
              </Button>
            ) : (
              <Link
                to={`${B}/orders/${r.order.id}`}
                className="text-[13px] font-semibold text-orange hover:underline"
              >
                Open
              </Link>
            )
          }
          rowClassName={(r) => overdueRowClass(r.dueIso)}
          rowsLabel="orders"
          initialSort={{ key: "due", dir: "asc" }}
          emptyTitle="Nothing waiting here"
          emptyMessage="Orders reaching this step will appear here."
          exportName={exportStem}
        />
      )}

      <StepModal
        stepKey={stepKey}
        open={!!acting.row}
        onClose={acting.close}
        order={acting.row}
        // A row opened from the Completed tab is an EDIT; from Pending it is a record.
        editing={!!acting.row && stage.showingCompleted && !acting.isView}
        readOnly={acting.isView}
      />
    </div>
  );
}
