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
import { DISPATCH_TYPE_LABEL, dmy, isCreditHeld, isoFromDmy, qtyTotals } from "../lib/format";
import { currentRoundView, type RoundView } from "../lib/rounds";
import type { QueueStep, StageEntry } from "../lib/queues";
import StepModal from "./StepModal";
import StatusPill from "./StatusPill";
import type { DispatchOrder } from "../types";

/**
 * A per-step STAGE view. Two tabs over the same step: the work still owed —
 * `store.myQueue(step)`, the same entries both Control Centers count — and the
 * work already done here.
 *
 * ⚠ THE COMPLETED TAB IS ROUND-SCOPED. An order that has looped three times
 *   contributes three sales bills, three gate entries and three deliveries — each
 *   its own row. So the modal must be handed the ROUND the row describes, not
 *   just the order: `useEntryModal` carries both, because opening round 1 while
 *   the order is on round 3 would otherwise show round 3's invoice.
 */
interface PendingRow {
  order: DispatchOrder;
  dueIso: string | null;
}

/** What the modal needs to open: the order AND which consignment. */
interface ActingRow {
  order: DispatchOrder;
  view: RoundView | null;
}

export default function StageQueue({ stepKey }: { stepKey: QueueStep }) {
  const s = useDispatchStore();
  const cfg = STEP_CONFIG[stepKey];

  const pending = s.myQueue(stepKey);
  const completedAll = s.completedFor(stepKey);
  const stage = useStageMode<StageEntry<DispatchOrder>>(completedAll, s.userId);
  const acting = useEntryModal<ActingRow>();

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
        <span className="inline-flex items-center gap-2">
          <Link to={`${B}/orders/${r.order.id}`} className="font-semibold text-navy hover:text-orange">
            {r.order.orderNo}
          </Link>
          {r.order.roundNo > 1 && (
            <span className="rounded bg-[#F1F4F9] px-1.5 py-0.5 text-[11px] font-semibold text-grey">
              R{r.order.roundNo}
            </span>
          )}
        </span>
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
    // Settled at intake, so they are known on every queue including this step's.
    // QueueTable derives its .xlsx from `columns`, so these export for free.
    //
    // ⚠ TWO LOCATIONS, AND BOTH HEADERS SAY WHICH. "Location" alone was fine
    //   while there was only one; now that the order also records the site it
    //   leaves FROM, an unqualified header is the fastest way to have somebody
    //   filter the wrong one.
    {
      key: "customerLocation",
      header: "Customer location",
      cell: (r) => <span className="text-grey">{r.order.customerLocation ?? "—"}</span>,
      sortValue: (r) => r.order.customerLocation ?? "",
      filter: { kind: "select", get: (r) => r.order.customerLocation ?? "—" },
    },
    {
      key: "company",
      header: "Company",
      cell: (r) => <span className="text-grey">{s.masterName("company", r.order.companyId)}</span>,
      sortValue: (r) => s.masterName("company", r.order.companyId),
      filter: { kind: "select", get: (r) => s.masterName("company", r.order.companyId) },
    },
    {
      key: "dispatchLocation",
      header: "Dispatch location",
      cell: (r) => (
        <span className="text-grey">{s.masterName("company_location", r.order.locationId)}</span>
      ),
      sortValue: (r) => s.masterName("company_location", r.order.locationId),
      filter: { kind: "select", get: (r) => s.masterName("company_location", r.order.locationId) },
    },
    {
      key: "poNo",
      header: "PO no.",
      cell: (r) => <span className="text-grey">{r.order.customerPoNo ?? "—"}</span>,
      sortValue: (r) => r.order.customerPoNo ?? "",
      filter: { kind: "text", get: (r) => r.order.customerPoNo ?? "" },
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
            {r.order.lines.length} · {t.pending || t.ordered} pending
          </span>
        );
      },
      sortValue: (r) => qtyTotals(r.order).pending,
    },
    // The credit hold has to be visible where the decision is made, or the remark
    // the user made compulsory is written into a void.
    ...(stepKey === "credit_check"
      ? [{
          key: "hold",
          header: "On hold",
          cell: (r: PendingRow) =>
            isCreditHeld(r.order) ? (
              <span className="text-[12.5px] font-semibold text-yellow">
                {r.order.ccRemarks ?? "On hold"}
              </span>
            ) : (
              <span className="text-grey-2">—</span>
            ),
          sortValue: (r: PendingRow) => (isCreditHeld(r.order) ? 0 : 1),
          filter: { kind: "select" as const, get: (r: PendingRow) => (isCreditHeld(r.order) ? "On hold" : "—") },
        }]
      : []),
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
        <span className="inline-flex items-center gap-2">
          <Link to={`${B}/orders/${e.orderId}`} className="font-semibold text-navy hover:text-orange">
            {e.ref}
          </Link>
          {e.roundNo > 0 && (e.row.rounds.length > 0 || e.row.roundNo > 1) && (
            <span className="rounded bg-[#F1F4F9] px-1.5 py-0.5 text-[11px] font-semibold text-grey">
              R{e.roundNo}
            </span>
          )}
        </span>
      ),
      sortValue: (e) => `${e.ref}-${String(e.roundNo).padStart(3, "0")}`,
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
      key: "customerLocation",
      header: "Customer location",
      cell: (e) => <span className="text-grey">{e.row.customerLocation ?? "—"}</span>,
      sortValue: (e) => e.row.customerLocation ?? "",
      filter: { kind: "select", get: (e) => e.row.customerLocation ?? "—" },
    },
    {
      // The ROUND first, for the same reason the company column reads it first:
      // an archived round keeps its own frozen copy.
      key: "dispatchLocation",
      header: "Dispatch location",
      cell: (e) => (
        <span className="text-grey">
          {s.masterName("company_location", e.view.locationId ?? e.row.locationId)}
        </span>
      ),
      sortValue: (e) => s.masterName("company_location", e.view.locationId ?? e.row.locationId),
      filter: {
        kind: "select",
        get: (e) => s.masterName("company_location", e.view.locationId ?? e.row.locationId),
      },
    },
    {
      key: "company",
      // ⚠ The ROUND first. A completed row can be an ARCHIVED round, which keeps
      //   its own frozen company; falling back to the header covers orders raised
      //   before the company moved to intake.
      header: "Company",
      cell: (e) => (
        <span className="text-grey">{s.masterName("company", e.view.companyId ?? e.row.companyId)}</span>
      ),
      sortValue: (e) => s.masterName("company", e.view.companyId ?? e.row.companyId),
      filter: { kind: "select", get: (e) => s.masterName("company", e.view.companyId ?? e.row.companyId) },
    },
    {
      key: "poNo",
      header: "PO no.",
      cell: (e) => <span className="text-grey">{e.row.customerPoNo ?? "—"}</span>,
      sortValue: (e) => e.row.customerPoNo ?? "",
      filter: { kind: "text", get: (e) => e.row.customerPoNo ?? "" },
    },
    {
      key: cfg.captured.key,
      header: cfg.captured.header,
      cell: (e) => <span className="text-grey">{cfg.captured.get(e.row, e.view)}</span>,
      // A dd-mm-yyyy display value must still sort chronologically.
      sortValue: (e) =>
        cfg.captured.isDate ? isoFromDmy(cfg.captured.get(e.row, e.view)) : cfg.captured.get(e.row, e.view),
      filter: { kind: "text", get: (e) => cfg.captured.get(e.row, e.view) },
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
              onEdit={() => acting.openEdit({ order: e.row, view: e.view })}
              onView={() => acting.openView({ order: e.row, view: e.view })}
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
              <Button size="sm" onClick={() => acting.openEdit({ order: r.order, view: currentRoundView(r.order) })}>
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
        order={acting.row?.order ?? null}
        round={acting.row?.view ?? null}
        // A row opened from the Completed tab is an EDIT; from Pending it is a record.
        editing={!!acting.row && stage.showingCompleted && !acting.isView}
        readOnly={acting.isView}
      />
    </div>
  );
}
