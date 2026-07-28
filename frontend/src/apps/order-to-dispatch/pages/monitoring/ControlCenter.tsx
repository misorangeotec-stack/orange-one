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
import { DISPATCH_TYPE_LABEL, dmy } from "../../lib/format";
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
      key: "owner",
      header: "Owner",
      cell: (e) => {
        const names = s.ownerNamesFor(e.stepKey);
        return <span className="text-grey">{names.length ? names.join(", ") : "Unassigned"}</span>;
      },
      sortValue: (e) => s.ownerNamesFor(e.stepKey).join(", "),
      filter: { kind: "select", get: (e) => s.ownerNamesFor(e.stepKey).join(", ") || "Unassigned" },
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
    {
      key: "type",
      header: "Type",
      cell: (e) => {
        const o = s.orderById(e.entityId);
        return <span className="text-grey">{o ? DISPATCH_TYPE_LABEL[o.dispatchType] : "—"}</span>;
      },
      sortValue: (e) => s.orderById(e.entityId)?.dispatchType ?? "",
      filter: {
        kind: "select",
        get: (e) => {
          const o = s.orderById(e.entityId);
          return o ? DISPATCH_TYPE_LABEL[o.dispatchType] : "—";
        },
      },
    },
    {
      key: "promised",
      header: "Promised",
      cell: (e) => <span className="text-grey whitespace-nowrap">{dmy(s.orderById(e.entityId)?.promisedDate)}</span>,
      sortValue: (e) => s.orderById(e.entityId)?.promisedDate ?? "",
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

      <StepPipeline<StepKey>
        nodes={nodes}
        selectedKeys={selected}
        onChange={setSelected}
        groups={STAGES.map((g) => ({ label: g.label, keys: g.keys }))}
      />

      <QueueTable<QueueEntry>
        rows={rows}
        rowKey={(e) => `${e.stepKey}:${e.entityId}`}
        columns={columns}
        groupBy={{
          idOf: (e) => e.stepKey,
          nameOf: (id) => stepByKey(id)?.short ?? id,
          allLabel: "All steps",
          label: "Step",
        }}
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
