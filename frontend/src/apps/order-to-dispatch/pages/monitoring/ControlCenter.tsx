import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Kpi from "@/shared/components/ui/Kpi";
import StepPipeline from "@/shared/components/ui/StepPipeline";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import DueCell, { overdueRowClass } from "@/shared/components/ui/DueCell";
import { SECTION_HEADING_CLASS } from "@/shared/components/ui/Readout";
import { bucketOf, todayLocalIso, type Bucket } from "@/shared/lib/dueBuckets";
import { queueRollup } from "@/shared/lib/fmsDashboard";
import { useDispatchStore } from "../../store";
import { STEPS, STAGES, stepByKey, type StepKey } from "../../lib/steps";
import { stepVariance } from "../../lib/orderVm";
import {
  dispatchTypeText, dmy, isCreditHeld, isStepHeld, stepHoldLabel, stepHoldReason,
} from "../../lib/format";
import type { QueueEntry } from "../../lib/queues";

const B = "/order-to-dispatch";

const BUCKETS: { key: Bucket; label: string }[] = [
  { key: "delayed", label: "Delayed" },
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "dayAfter", label: "Day after" },
  { key: "noDate", label: "No date" },
];

/**
 * The coordinator's board: where every open work-item is, and how late each step
 * has been running.
 *
 * Both the rail and the table read `store.queueEntries` — the same
 * `buildQueueEntries` the step queues and the cross-FMS scoreboard use — so the
 * three can never report different numbers for the same step.
 */
export default function ControlCenter() {
  const s = useDispatchStore();
  const today = todayLocalIso();
  const [selected, setSelected] = useState<StepKey[]>([]);

  /**
   * Orders a step has parked, longest first — credit sitting on the order, or
   * billing sitting on its invoice.
   *
   * ⚠ Counted here IN ADDITION TO the queue, not instead of it. A step hold
   *   leaves the order at `awaiting_credit_check` or `awaiting_sales_bill`, so it
   *   is still an open work-item and still owed by that team — unlike a held
   *   requisition in HR, which leaves its queue entirely. Pulling these out of
   *   `queueRollup` would quietly shrink the Credit or Billing node, the
   *   cross-FMS scoreboard and My Work, all of which read the same
   *   `buildQueueEntries`. This strip only makes them findable: without it the
   *   hold is a word in one column of one screen.
   *
   * ⚠ EACH CHIP SAYS WHICH HOLD IT IS. One undifferentiated "on hold" list would
   *   send whoever is chasing it to the wrong desk.
   */
  const held = useMemo(
    () =>
      s.orders
        .filter(isStepHeld)
        .map((o) => {
          const at = isCreditHeld(o) ? o.ccDecidedAt : o.sbHoldAt;
          return {
            o,
            what: stepHoldLabel(o) ?? "On hold",
            why: stepHoldReason(o),
            days: at
              ? Math.max(0, Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000))
              : null,
          };
        })
        .sort((a, b) => (b.days ?? 0) - (a.days ?? 0)),
    [s.orders],
  );

  const pipelineSteps = useMemo(() => STEPS.filter((st) => !st.noQueue), []);
  const { counts, nodes } = useMemo(
    () => queueRollup(s.queueEntries, pipelineSteps, today),
    [s.queueEntries, pipelineSteps, today],
  );

  const rows = useMemo(() => {
    const wanted = new Set<string>(selected);
    return s.queueEntries.filter((e) => selected.length === 0 || wanted.has(e.stepKey));
  }, [s.queueEntries, selected]);

  /**
   * The sheet's whole point, as a number: how many days late each step actually
   * runs. Measured on CLOSED orders only — an order still in flight hasn't
   * finished being late yet.
   */
  const variance = useMemo(
    () =>
      stepVariance(
        s.orders.filter((o) => o.status === "closed"),
        { snap: s.snapshot, ownerNamesFor: s.ownerNamesFor, todayIso: today },
      ),
    [s, today],
  );

  /** Who owns this entry's step AT THIS ORDER'S SITE. */
  const ownersOf = (e: QueueEntry): string[] =>
    s.ownerNamesFor(e.stepKey, s.orderById(e.entityId)?.locationId ?? null);

  const columns: QueueColumn<QueueEntry>[] = [
    {
      key: "ref",
      header: "Order",
      cell: (e) => (
        <Link to={`${B}/orders/${e.entityId}`} className="font-semibold text-navy hover:text-orange">
          {e.ref}
        </Link>
      ),
      sortValue: (e) => e.ref,
      filter: { kind: "text", get: (e) => e.ref },
    },
    {
      key: "step",
      header: "Step",
      cell: (e) => <span className="text-navy">{stepByKey(e.stepKey)?.title ?? e.stepKey}</span>,
      sortValue: (e) => stepByKey(e.stepKey)?.index ?? 0,
      filter: { kind: "select", get: (e) => stepByKey(e.stepKey)?.title ?? e.stepKey },
    },
    {
      // ⚠ Scoped to the order's OWN location. Listing every owner of the step
      //   across every site would name people who cannot see this order, let
      //   alone action it — the exact question this column is asked.
      key: "owner",
      header: "Owner",
      cell: (e) => {
        const names = ownersOf(e);
        return <span className="text-grey">{names.length ? names.join(", ") : "Unassigned"}</span>;
      },
      sortValue: (e) => ownersOf(e).join(", "),
      filter: { kind: "select", get: (e) => ownersOf(e).join(", ") || "Unassigned" },
    },
    {
      key: "customer",
      header: "Customer",
      cell: (e) => {
        const o = s.orderById(e.entityId);
        return <span className="text-grey">{o ? s.customerName(o.customerId) : "—"}</span>;
      },
      sortValue: (e) => {
        const o = s.orderById(e.entityId);
        return o ? s.customerName(o.customerId) : "";
      },
      filter: {
        kind: "select",
        get: (e) => {
          const o = s.orderById(e.entityId);
          return o ? s.customerName(o.customerId) : "—";
        },
      },
    },
    // Like every cell here, these re-resolve the order: a QueueEntry carries only
    // ref / dueIso / orderId, never the row itself.
    {
      key: "customerLocation",
      header: "Customer location",
      cell: (e) => {
        const o = s.orderById(e.entityId);
        return <span className="text-grey">{o?.customerLocation ?? "—"}</span>;
      },
      sortValue: (e) => s.orderById(e.entityId)?.customerLocation ?? "",
      filter: { kind: "select", get: (e) => s.orderById(e.entityId)?.customerLocation ?? "—" },
    },
    // The site the work sits at — the dimension the Control Center is about to
    // be sliced by once step ownership becomes per-location.
    {
      key: "dispatchLocation",
      header: "Dispatch location",
      cell: (e) => (
        <span className="text-grey">
          {s.masterName("company_location", s.orderById(e.entityId)?.locationId ?? null)}
        </span>
      ),
      sortValue: (e) => s.masterName("company_location", s.orderById(e.entityId)?.locationId ?? null),
      filter: {
        kind: "select",
        get: (e) => s.masterName("company_location", s.orderById(e.entityId)?.locationId ?? null),
      },
    },
    {
      key: "company",
      header: "Company",
      cell: (e) => {
        const o = s.orderById(e.entityId);
        return <span className="text-grey">{s.masterName("company", o?.companyId ?? null)}</span>;
      },
      sortValue: (e) => s.masterName("company", s.orderById(e.entityId)?.companyId ?? null),
      filter: { kind: "select", get: (e) => s.masterName("company", s.orderById(e.entityId)?.companyId ?? null) },
    },
    {
      key: "poNo",
      header: "PO no.",
      cell: (e) => {
        const o = s.orderById(e.entityId);
        return <span className="text-grey">{o?.customerPoNo ?? "—"}</span>;
      },
      sortValue: (e) => s.orderById(e.entityId)?.customerPoNo ?? "",
      filter: { kind: "text", get: (e) => s.orderById(e.entityId)?.customerPoNo ?? "" },
    },
    {
      key: "type",
      header: "Type",
      cell: (e) => {
        const o = s.orderById(e.entityId);
        return <span className="text-grey">{o ? dispatchTypeText(o) : "—"}</span>;
      },
      sortValue: (e) => { const o = s.orderById(e.entityId); return o ? dispatchTypeText(o) : ""; },
      filter: {
        kind: "select",
        get: (e) => {
          const o = s.orderById(e.entityId);
          return o ? dispatchTypeText(o) : "—";
        },
      },
    },
    {
      key: "round",
      header: "Round",
      cell: (e) => {
        const o = s.orderById(e.entityId);
        return <span className="text-grey whitespace-nowrap">{o && o.roundNo > 1 ? `R${o.roundNo}` : "—"}</span>;
      },
      sortValue: (e) => s.orderById(e.entityId)?.roundNo ?? 0,
    },
    {
      key: "due",
      header: "Step due",
      cell: (e) => <DueCell dueIso={e.dueIso} />,
      sortValue: (e) => e.dueIso ?? "9999-12-31",
      exportValue: (e) => (e.dueIso ? dmy(e.dueIso) : ""),
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Order to Dispatch Control Center</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Every open work-item, wherever it sits. Pick a step on the rail to narrow the table.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {BUCKETS.map((b) => (
          <Kpi
            key={b.key}
            label={b.label}
            value={counts[b.key]}
            tone={b.key === "delayed" && counts.delayed > 0 ? "red" : undefined}
          />
        ))}
      </div>

      {/*
        A plain count, deliberately NOT a sixth KPI tile and NOT a node on the
        rail. Those are both built from `queueEntries`, which a cancelled order
        never enters — Sales Return sits beside the six-step chain, not inside
        it, so it has no bucket and no due date to roll up. But a coordinator is
        who chases an invoice that has been left live in Tally, so the number
        belongs on this page even though the machinery behind it does not.
      */}
      {s.salesReturnPending.length > 0 && (
        <Card className="p-3.5 border-l-4 border-l-ryg-red">
          <p className="text-[13px] text-navy">
            <span className="font-semibold">
              {s.salesReturnPending.length} cancelled{" "}
              {s.salesReturnPending.length === 1 ? "order has" : "orders have"} a sales bill still to
              be unwound in Tally.
            </span>{" "}
            <Link to={`${B}/queues/sales-return`} className="font-semibold text-orange hover:underline">
              Open Sales Return
            </Link>
          </p>
        </Card>
      )}

      <StepPipeline<StepKey>
        nodes={nodes}
        selectedKeys={selected}
        onChange={setSelected}
        groups={STAGES.map((g) => ({ label: g.label, keys: g.keys }))}
      />

      {held.length > 0 && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-grey">On hold</span>
            <span className="text-[12px] text-grey">
              {held.length} {held.length === 1 ? "order" : "orders"} parked on purpose — still counted
              above, because the decision to release them is that desk's own work.
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {held.map(({ o, what, why, days }) => (
              <Link
                key={o.id}
                to={`${B}/orders/${o.id}`}
                title={why ?? undefined}
                className="inline-flex items-center gap-2 rounded-lg border border-line bg-page/60 px-2.5 py-1.5 text-[12px] transition hover:border-orange/40"
              >
                <span className="font-semibold text-navy">{o.orderNo}</span>
                <span className="max-w-[180px] truncate text-grey">{s.customerName(o.customerId)}</span>
                <span className="text-grey-2">{what}</span>
                {days !== null && <span className="font-semibold text-grey-2">{days}d</span>}
              </Link>
            ))}
          </div>
        </Card>
      )}

      <QueueTable<QueueEntry>
        rows={rows}
        rowKey={(e) => `${e.stepKey}:${e.entityId}`}
        columns={columns}
        rowClassName={(e) => overdueRowClass(e.dueIso)}
        rowsLabel="work-items"
        initialSort={{ key: "due", dir: "asc" }}
        emptyTitle="Nothing open"
        emptyMessage="Every order has cleared its steps."
        exportName="Order_To_Dispatch_Control_Center"
      />

      <Card className="p-4 space-y-3">
        <div className="border-b border-line pb-2">
          <h3 className={SECTION_HEADING_CLASS}>Planned vs actual</h3>
        </div>
        {variance.length === 0 ? (
          <p className="text-[13px] text-grey-2">
            No closed orders yet — this fills in once orders have run the full course.
          </p>
        ) : (
          <>
            <p className="text-[12.5px] text-grey-2">
              Mean days late per step, across closed orders. This is the source sheet's whole question, answered.
            </p>
            <ul className="space-y-1.5">
              {variance.map((v) => (
                <li key={v.stepKey} className="flex items-baseline justify-between gap-4 text-[13px]">
                  <span className="text-navy">{v.short}</span>
                  <span className="flex items-baseline gap-2">
                    <span className={v.meanLate > 0.5 ? "font-semibold text-ryg-red" : "text-grey"}>
                      {v.meanLate.toFixed(1)} d
                    </span>
                    <span className="text-[11.5px] text-grey-2">over {v.samples}</span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
