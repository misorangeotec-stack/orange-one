import { useState } from "react";
import { Link } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import PillToggle from "@/shared/components/ui/PillToggle";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import StageRowAction from "@/shared/components/ui/StageRowAction";
import StageTabs from "@/shared/components/ui/StageTabs";
import DueCell, { overdueRowClass } from "@/shared/components/ui/DueCell";
import { useEntryModal } from "@/shared/lib/useEntryModal";
import { useStageMode } from "@/shared/lib/useStageMode";
import { formatDateTime } from "@/shared/lib/time";
import { useDispatchStore } from "../store";
import { STEP_CONFIG } from "../lib/stepConfig";
import { DISPATCH_TYPE_LABEL, dmy, isoFromDmy, qtyTotals, STEP_HOLD } from "../lib/format";
import { currentRoundView, type RoundView } from "../lib/rounds";
import type { QueueStep, StageEntry } from "../lib/queues";
import StepModal from "./StepModal";
import StatusPill, { OutcomePill } from "./StatusPill";
import GatePassButton from "./GatePassButton";
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

  /*
    HELD ORDERS ARE STILL PENDING WORK, and that is the whole difficulty. A credit
    hold leaves the order at `awaiting_credit_check` with `cc_at` null, and a bill
    hold leaves it at `awaiting_sales_bill` with `sb_at` null, so either sits in
    its queue looking exactly like an order nobody has touched — same status pill,
    same due clock. The pill and this filter are what tell the two apart.

    ⚠ READ OFF `STEP_HOLD`, NEVER OFF `stepKey`. Two steps can park a row today
      and the wording differs between them; a third needs one entry in that map
      and no edit here.
  */
  const hold = STEP_HOLD[stepKey];
  const [heldOnly, setHeldOnly] = useState(false);

  const pending = s.myQueue(stepKey);
  const completedAll = s.completedFor(stepKey);
  const stage = useStageMode<StageEntry<DispatchOrder>>(completedAll, s.userId);
  const acting = useEntryModal<ActingRow>();

  const B = "/order-to-dispatch";

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
    // A hold has to be visible where the decision is made, or the remark the user
    // made compulsory is written into a void. Next to the customer, not out at
    // the right edge: the reason is read together with who it is about.
    ...(hold
      ? [{
          key: "hold",
          header: "On hold",
          cell: (r: PendingRow) =>
            hold.held(r.order) ? (
              <span className="inline-flex items-center gap-1.5">
                <OutcomePill label="On hold" tone="yellow" />
                <span className="text-[12.5px] text-grey">{hold.reason(r.order)}</span>
              </span>
            ) : (
              <span className="text-grey-2">—</span>
            ),
          sortValue: (r: PendingRow) => (hold.held(r.order) ? 0 : 1),
          filter: { kind: "select" as const, get: (r: PendingRow) => (hold.held(r.order) ? "On hold" : "—") },
          exportValue: (r: PendingRow) =>
            hold.held(r.order) ? `On hold: ${hold.reason(r.order) ?? ""}` : "",
        }]
      : []),
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

  const heldCount = hold ? pending.filter((r) => hold.held(r.order)).length : 0;
  /*
    ⚠ The TAB COUNT stays `pending.length` whatever this is set to. Narrowing the
      rows is a lens on the queue, not a change to how much work it holds — a
      count that moved with the filter would report the backlog as smaller than
      it is the moment somebody looked at the holds.
  */
  const pendingRows = heldOnly && hold ? pending.filter((r) => hold.held(r.order)) : pending;

  /*
    Rendered into StageTabs' `right` slot rather than as a third tab: StageTabs is
    shared by every FMS stage screen and not every step has a hold to filter.
    Hidden when nothing is held, so the control shows up exactly when it means
    something.
  */
  /*
    A hold outranks the overdue tint. The order is parked on purpose, and painting
    it red would report a deliberate decision as a failure to act; yellow says
    "waiting on payment", which is what is actually true of the row.
  */
  const pendingRowClass = (r: PendingRow): string =>
    hold?.held(r.order) ? "border-l-4 border-l-yellow" : overdueRowClass(r.dueIso);

  const holdFilter =
    hold && !stage.showingCompleted && heldCount > 0 ? (
      <PillToggle<"all" | "held">
        value={heldOnly ? "held" : "all"}
        onChange={(v) => setHeldOnly(v === "held")}
        options={[
          { value: "all", label: "All" },
          { value: "held", label: `On hold · ${heldCount}` },
        ]}
      />
    ) : undefined;

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
        right={holdFilter}
      />

      {stage.showingCompleted ? (
        <QueueTable<StageEntry<DispatchOrder>>
          rows={stage.rows}
          rowKey={(e) => e.id}
          columns={completedColumns}
          actions={(e) => (
            <div className="flex items-center justify-end gap-2">
              {/* Reprints. An archived round keeps its own number, so this hands
                  back the identical slip however long afterwards. */}
              {stepKey === "gate_out" && <GatePassButton order={e.row} view={e.view} />}
              <StageRowAction
                as="button"
                lockReason={e.lockReason}
                canEdit={s.canEdit && s.canActOn(stepKey, e.row)}
                permissionReason="Only an owner of this step can edit the entry."
                onEdit={() => acting.openEdit({ order: e.row, view: e.view })}
                onView={() => acting.openView({ order: e.row, view: e.view })}
              />
            </div>
          )}
          rowsLabel="entries"
          emptyTitle="Nothing recorded here yet"
          emptyMessage="Entries you record at this step will appear here."
          exportName={`${exportStem}_Completed`}
        />
      ) : (
        <QueueTable<PendingRow>
          rows={pendingRows}
          rowKey={(r) => r.order.id}
          columns={pendingColumns}
          actions={(r) => (
            <div className="flex items-center justify-end gap-2">
              {/* ⚠ GATED ON THE STEP. StageQueue renders all five queues, so an
                  ungated button would offer a gate pass at the credit check. It
                  sits here rather than only inside the modal because the ask was
                  to print it BEFORE recording the gate entry — the slip travels
                  with the goods, the register entry happens as they leave. */}
              {stepKey === "gate_out" && (
                <GatePassButton order={r.order} view={currentRoundView(r.order)} />
              )}
              {s.canEdit && s.canActOn(stepKey, r.order) ? (
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
              )}
            </div>
          )}
          rowClassName={pendingRowClass}
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
