import { useMemo } from "react";
import KpiRow, { type KpiTile } from "@/shared/components/dashboard/KpiRow";
import DistributionCard from "@/shared/components/dashboard/DistributionCard";
import WhereStuckCard from "@/shared/components/dashboard/WhereStuckCard";
import NeedsAttentionCard from "@/shared/components/dashboard/NeedsAttentionCard";
import ThroughputCard from "@/shared/components/dashboard/ThroughputCard";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { distribution, queueRollup, type AttentionRow } from "@/shared/lib/fmsDashboard";
import { useDispatchStore } from "../store";
import { allRoundViews } from "../lib/rounds";
import { STEPS, STAGES, stepByKey, type StepKey } from "../lib/steps";
import { openStep, type QueueStep } from "../lib/queues";
import {
  DISPATCH_TYPE_LABEL, STATUS_LABEL, dmy, qtyTotals,
} from "../lib/format";
import type { DispatchOrder, DispatchStatus } from "../types";

const B = "/order-to-dispatch";

const STATUS_ORDER: DispatchStatus[] = [
  "awaiting_credit_check", "awaiting_material_status",
  "awaiting_sales_bill", "awaiting_gate_out", "awaiting_dispatch_confirm",
  "on_hold", "closed", "cancelled",
];

const STATUS_BADGE: Record<DispatchStatus, string> = {
  awaiting_credit_check: "bg-[#EAF1FE] text-blue",
  awaiting_material_status: "bg-[#EAF1FE] text-blue",
  awaiting_sales_bill: "bg-[#FFF1E8] text-orange",
  awaiting_gate_out: "bg-[#FFF1E8] text-orange",
  awaiting_dispatch_confirm: "bg-[#FFF1E8] text-orange",
  closed: "bg-[#E8F7EE] text-ryg-green",
  on_hold: "bg-[#FFF7E6] text-yellow",
  cancelled: "bg-[#F1F4F9] text-grey-2",
};

export default function Dashboard() {
  const s = useDispatchStore();
  const today = todayLocalIso();

  const pipelineSteps = useMemo(() => STEPS.filter((st) => !st.noQueue), []);
  const { counts, nodes } = useMemo(
    () => queueRollup(s.queueEntries, pipelineSteps, today),
    [s.queueEntries, pipelineSteps, today],
  );

  const open = s.openOrders;
  const awaitingDispatch = open.filter(
    (o) => o.status === "awaiting_gate_out" || o.status === "awaiting_dispatch_confirm",
  );
  /**
   * Replaces the old "Partially dispatched" tile, which needed a promised date the order
   * no longer captures. What matters on a partial order is that it went out
   * incomplete and is still owed.
   */
  const partiallyDispatched = open.filter((o) => o.rounds.length > 0);

  /**
   * Deliveries in the last 30 days, counted across ROUNDS.
   *
   * Reading `o.dcAt` alone would undercount badly: the moment an order loops its
   * header is wiped, so every delivery except the final one would vanish from
   * this tile while still having physically happened.
   */
  const dispatched30 = useMemo(() => {
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    return s.orders.flatMap((o) =>
      allRoundViews(o).filter((v) => v.dcStatus === "delivered" && v.dcAt && v.dcAt >= since),
    );
  }, [s.orders]);

  const tiles: KpiTile[] = [
    {
      key: "todayDue",
      label: "Due today",
      value: counts.delayed + counts.today,
      hint: `${counts.delayed} delayed`,
      tone: counts.delayed > 0 ? "red" : undefined,
      size: "hero",
      href: `${B}/monitoring`,
    },
    { key: "open", label: "Open orders", value: open.length, href: `${B}/orders` },
    { key: "awaiting", label: "Awaiting dispatch", value: awaitingDispatch.length, href: `${B}/queues/gate-out` },
    {
      key: "tat",
      label: "Partially dispatched",
      value: partiallyDispatched.length,
      // The hint here still described a promised dispatch date, which the reshape
      // removed — it had stopped being true of the tile it sat under.
      tone: partiallyDispatched.length > 0 ? "red" : undefined,
      href: `${B}/orders`,
    },
    { key: "done30", label: "Delivered (30d)", value: dispatched30.length },
  ];

  const byStatus = distribution<DispatchOrder>(
    s.orders,
    (o) => o.status,
    STATUS_ORDER,
    (k) => STATUS_LABEL[k as DispatchStatus],
    (k) => STATUS_BADGE[k as DispatchStatus],
  );

  const byType = distribution<DispatchOrder>(
    open,
    (o) => o.dispatchType,
    ["local", "transport"],
    (k) => DISPATCH_TYPE_LABEL[k as "local" | "transport"],
    (k) => (k === "local" ? "bg-[#EAF1FE] text-blue" : "bg-[#FFF1E8] text-orange"),
  );

  /** Overdue work first, then whatever is due soonest. */
  const attention: AttentionRow[] = useMemo(() => {
    return s.queueEntries
      .filter((e) => e.dueIso && e.dueIso <= today)
      .sort((a, b) => (a.dueIso ?? "").localeCompare(b.dueIso ?? ""))
      .slice(0, 12)
      .map((e) => {
        const o = s.orderById(e.entityId);
        const totals = o ? qtyTotals(o) : { ordered: 0, dispatched: 0, shipping: 0, pending: 0 };
        return {
          key: `${e.stepKey}:${e.entityId}`,
          ref: e.ref,
          href: `${B}/orders/${e.entityId}`,
          stageShort: stepByKey(e.stepKey)?.short ?? "—",
          detail: o
            ? `${s.customerName(o.customerId)} · ${o.lines.length} line${o.lines.length === 1 ? "" : "s"} · ${
                totals.pending || totals.ordered
              } pending${o.roundNo > 1 ? ` · round ${o.roundNo}` : ""}`
            : "",
          dueIso: e.dueIso,
          value: null,
        };
      });
  }, [s, today]);

  const throughputColumns = useMemo(
    () =>
      pipelineSteps.map((st) => ({
        key: st.key,
        label: st.short,
        entries: s.completedFor(st.key as QueueStep),
      })),
    [pipelineSteps, s],
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Order to Dispatch</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Customer order to delivery: credit, stock, LOT and quantity, sales bill, gate out, delivery.
        </p>
      </div>

      <KpiRow tiles={tiles} />

      <div className="grid gap-4 lg:grid-cols-2">
        <WhereStuckCard<StepKey>
          nodes={nodes}
          groups={STAGES.map((g) => ({ label: g.label, keys: g.keys }))}
          actionHref={`${B}/monitoring`}
          showAction={s.canMonitor}
        />
        <NeedsAttentionCard rows={attention} todayIso={today} actionHref={`${B}/orders`} showAction />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <DistributionCard title="Orders by status" rows={byStatus} emptyLabel="No orders yet." />
        <DistributionCard title="Open orders by type" rows={byType} emptyLabel="Nothing open." />
      </div>

      <ThroughputCard columns={throughputColumns} todayIso={today} />
    </div>
  );
}
