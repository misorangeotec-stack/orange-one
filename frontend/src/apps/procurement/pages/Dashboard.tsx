import { useMemo } from "react";
import { useEffectiveIdentity } from "@/shared/sandbox/useEffectiveIdentity";
import { useSandbox } from "@/shared/sandbox/SandboxContext";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { queueRollup, distribution, countInWindow, windowStartIso } from "@/shared/lib/fmsDashboard";
import KpiRow, { type KpiTile } from "@/shared/components/dashboard/KpiRow";
import DistributionCard from "@/shared/components/dashboard/DistributionCard";
import WhereStuckCard from "@/shared/components/dashboard/WhereStuckCard";
import ThroughputCard, { type ThroughputColumn } from "@/shared/components/dashboard/ThroughputCard";
import MoneyCard, { type MoneyTile } from "@/shared/components/dashboard/MoneyCard";
import NeedsAttentionCard from "@/shared/components/dashboard/NeedsAttentionCard";
import type { AttentionRow } from "@/shared/lib/fmsDashboard";
import SandboxDashboard from "../sandbox/SandboxDashboard";
import { appName } from "@/apps/appInfo";
import { useProcurementStore } from "../store";
import { STEPS, stepByKey } from "../lib/steps";
import type { QueueEntry } from "../lib/queues";
import { linkResolver, poStageHref, PROC_POS, PROC_REQUESTS } from "../lib/links";
import { inr, PO_STAGE_LABEL, PO_STAGE_CLASS, LINE_STATUS_LABEL, LINE_STATUS_CLASS } from "../lib/format";

const PIPELINE_STEPS = STEPS.filter((s) => !s.noQueue);
const MONITORING = "/procurement/monitoring";

/**
 * Purchase RM Domestic home — a per-FMS dashboard scoped to this FMS, seen by
 * everyone with the app (the store is already row-scoped). Demo mode swaps to the
 * per-persona SandboxDashboard; the coordinator Control Center at
 * `/procurement/monitoring` is the deeper "chase the late items" tool and is
 * unchanged. Every section degrades to a meaningful zero-state — never blank.
 */
export default function Dashboard() {
  const { user } = useEffectiveIdentity();
  const { active } = useSandbox();
  const s = useProcurementStore();
  const todayIso = todayLocalIso();
  const since30 = windowStartIso(todayIso, 30);

  const { counts, nodes } = useMemo(() => queueRollup(s.queueEntries, PIPELINE_STEPS, todayIso), [s.queueEntries, todayIso]);

  const poDist = useMemo(
    () =>
      distribution(
        s.pos,
        (p) => p.currentStage,
        Object.keys(PO_STAGE_LABEL),
        (k) => PO_STAGE_LABEL[k] ?? k,
        (k) => PO_STAGE_CLASS[k] ?? "text-grey-2 bg-page",
      ),
    [s.pos],
  );
  const lineDist = useMemo(
    () =>
      distribution(
        s.requestItems,
        (l) => l.status,
        Object.keys(LINE_STATUS_LABEL),
        (k) => LINE_STATUS_LABEL[k as keyof typeof LINE_STATUS_LABEL],
        (k) => LINE_STATUS_CLASS[k as keyof typeof LINE_STATUS_CLASS],
      ),
    [s.requestItems],
  );

  const closed30 = useMemo(() => countInWindow(s.completedTallyEntries, since30), [s.completedTallyEntries, since30]);

  const money = useMemo(() => {
    const live = s.pos.filter((p) => p.currentStage !== "closed" && p.currentStage !== "cancelled");
    let inFlight = 0;
    let advancePending = 0;
    let paid = 0;
    for (const p of live) {
      const pending = s.pendingAmount(p);
      inFlight += p.totalValue;
      advancePending += pending;
      paid += Math.max(0, p.totalValue - pending);
    }
    const bookedIds = new Set<string>();
    for (const e of s.completedTallyEntries) if (e.atIso.slice(0, 10) >= since30 && e.poId) bookedIds.add(e.poId);
    let bookedTally = 0;
    for (const id of bookedIds) bookedTally += s.poById(id)?.totalValue ?? 0;
    return { inFlight, advancePending, paid, bookedTally };
  }, [s.pos, s.pendingAmount, s.completedTallyEntries, s.poById, since30]);

  const throughput: ThroughputColumn[] = useMemo(
    () => [
      { key: "sourcing", label: "Sourced", entries: s.completedSourcingRequestEntries },
      { key: "approval", label: "Approved", entries: s.completedApprovalRequestEntries },
      { key: "po", label: "POs raised", entries: s.completedPoGenEntries },
      { key: "share_po", label: "Shared", entries: s.completedShareEntries },
      { key: "collect_pi", label: "PI", entries: s.completedPiEntries },
      { key: "advance_payment", label: "Advance", entries: s.completedAdvanceEntries },
      { key: "follow_up", label: "Followed up", entries: s.completedFollowupEntries },
      { key: "inward", label: "Received", entries: s.completedGrnEntries },
      { key: "tally", label: "Booked", entries: s.completedTallyEntries },
    ],
    [
      s.completedSourcingRequestEntries,
      s.completedApprovalRequestEntries,
      s.completedPoGenEntries,
      s.completedShareEntries,
      s.completedPiEntries,
      s.completedAdvanceEntries,
      s.completedFollowupEntries,
      s.completedGrnEntries,
      s.completedTallyEntries,
    ],
  );

  const linkOf = useMemo(() => linkResolver(s.requestItems), [s.requestItems]);
  const detailOf = (e: QueueEntry): string => {
    if (e.entityType === "request") {
      const lines = s.itemsForRequest(e.entityId);
      const first = lines[0] ? s.itemById(lines[0].itemId)?.name ?? "" : "";
      return lines.length === 1 ? first : `${lines.length} items${first ? ` · ${first}…` : ""}`;
    }
    if (e.entityType === "line") {
      const l = s.lineById(e.entityId);
      return l ? s.itemLabel(l.itemId) : "—";
    }
    return s.vendorById(s.poById(e.entityId)?.vendorId ?? null)?.name ?? "—";
  };
  const attention: AttentionRow[] = useMemo(() => {
    return s.queueEntries
      .filter((e) => (e.dueIso ? e.dueIso < todayIso : false))
      .sort((a, b) => (a.dueIso ?? "9999").localeCompare(b.dueIso ?? "9999"))
      .slice(0, 8)
      .map((e) => ({
        key: `${e.stepKey}:${e.entityId}`,
        ref: e.ref,
        href: linkOf(e),
        stageShort: stepByKey(e.stepKey)?.short ?? e.stepKey,
        detail: detailOf(e),
        dueIso: e.dueIso,
        value: e.value === null ? null : inr(e.value),
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.queueEntries, todayIso, linkOf]);

  if (active) return <SandboxDashboard />;

  const openRequests = s.requests.filter((r) => r.status === "open").length;
  const livePos = s.pos.filter((p) => p.currentStage !== "closed" && p.currentStage !== "cancelled").length;

  // The Control Center is RequireMonitor-gated, so only a coordinator gets a link —
  // everyone else keeps the tile, just not clickable.
  const queueHref = s.isProcessCoordinator ? MONITORING : undefined;

  const kpiTiles: KpiTile[] = [
    { key: "pending", label: "Pending today", value: counts.delayed + counts.today, hint: "delayed + due today", size: "hero", tone: counts.delayed + counts.today > 0 ? "red" : undefined, href: queueHref },
    { key: "open", label: "Open requisitions", value: openRequests, hint: "not yet closed", href: PROC_REQUESTS },
    { key: "pos", label: "Live POs", value: livePos, hint: "in progress", href: PROC_POS },
    { key: "delayed", label: "Delayed", value: counts.delayed, hint: "past due", tone: counts.delayed > 0 ? "red" : undefined, href: queueHref },
    { key: "closed", label: "Closed (30d)", value: closed30, hint: "booked in Tally", href: PROC_POS },
  ];
  const moneyTiles: MoneyTile[] = [
    { key: "inflight", label: "Value in flight", value: inr(money.inFlight), hint: "live POs" },
    { key: "advance", label: "Advance pending", value: inr(money.advancePending), hint: "on advance-term POs" },
    { key: "paid", label: "Paid to vendors", value: inr(money.paid), hint: "on live POs" },
    { key: "booked", label: "Booked in Tally (30d)", value: inr(money.bookedTally), hint: "PO value booked" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[22px] font-bold text-navy">{appName("procurement")}</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Welcome{user?.name ? `, ${user.name.split(" ")[0]}` : ""}. Here's where domestic RM purchasing stands today —
          requisitions, POs, what's completed and what needs chasing.
        </p>
      </div>

      <KpiRow tiles={kpiTiles} />

      <div className="grid md:grid-cols-2 gap-4">
        <DistributionCard
          title="Purchase orders by stage"
          rows={poDist}
          emptyLabel="No purchase orders yet."
          hrefFor={(r) => poStageHref(r.key)}
        />
        {/* Requisition lines have no page of their own — a line always opens its parent
            requisition — so these rows stay un-clickable. */}
        <DistributionCard title="Requisition lines by status" rows={lineDist} emptyLabel="No requisition lines yet." />
      </div>

      <WhereStuckCard nodes={nodes} actionHref={MONITORING} showAction={s.isProcessCoordinator} />

      <ThroughputCard columns={throughput} todayIso={todayIso} />

      <MoneyCard tiles={moneyTiles} />

      <NeedsAttentionCard rows={attention} todayIso={todayIso} actionHref={MONITORING} showAction={s.isProcessCoordinator} />
    </div>
  );
}
