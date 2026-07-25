import { useMemo } from "react";
import Card from "@/shared/components/ui/Card";
import { SECTION_HEADING_CLASS } from "@/shared/components/ui/Readout";
import StepPipeline from "@/shared/components/ui/StepPipeline";
import { Link } from "react-router-dom";
import { useEffectiveIdentity } from "@/shared/sandbox/useEffectiveIdentity";
import { useSandbox } from "@/shared/sandbox/SandboxContext";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import SandboxDashboard from "../sandbox/SandboxDashboard";
import { appName } from "@/apps/appInfo";
import { useImportStore } from "../store";
import { stepByKey } from "../lib/steps";
import type { QueueEntry } from "../lib/queues";
import { linkResolver } from "../lib/links";
import {
  queueRollup,
  poStageDistribution,
  lineStatusDistribution,
  moneySummary,
  countInWindow,
  windowStartIso,
} from "../lib/dashboardMetrics";
import HeadlineKpis from "./dashboard/HeadlineKpis";
import StageDistribution from "./dashboard/StageDistribution";
import ThroughputStrip, { type ThroughputColumn } from "./dashboard/ThroughputStrip";
import MoneySummary from "./dashboard/MoneySummary";
import NeedsAttention, { type AttentionRow } from "./dashboard/NeedsAttention";

/**
 * Import home — a per-FMS dashboard scoped to Import Purchase, seen by everyone
 * with the app (each user's store is already row-scoped, so "the FMS-wide picture,
 * bounded by what you may see" comes for free). In demo mode it swaps to the
 * per-persona SandboxDashboard. The coordinator-only Control Center at
 * `/import/monitoring` is the deeper "chase the late items" tool and is unchanged.
 *
 * Every section derives from `store` selectors and degrades to a meaningful
 * zero-state — the dashboard is never blank, even with no open work.
 */
export default function Dashboard() {
  const { user } = useEffectiveIdentity();
  const { active } = useSandbox();
  const s = useImportStore();
  const todayIso = todayLocalIso();

  // --- shared open-backlog rollup (identical to the Control Center's) ---
  const { counts, nodes } = useMemo(() => queueRollup(s.queueEntries, todayIso), [s.queueEntries, todayIso]);

  // --- distributions over ALL live entities (survive an empty queue) ---
  const poDist = useMemo(() => poStageDistribution(s.pos), [s.pos]);
  const lineDist = useMemo(() => lineStatusDistribution(s.requestItems), [s.requestItems]);

  // --- money + throughput (30-day window for the "closed"/booked figures) ---
  const since30 = windowStartIso(todayIso, 30);
  const money = useMemo(
    () =>
      moneySummary({
        pos: s.pos,
        pendingAmount: s.pendingAmount,
        completedTallyEntries: s.completedTallyEntries,
        poById: s.poById,
        sinceIso: since30,
      }),
    [s.pos, s.pendingAmount, s.completedTallyEntries, s.poById, since30],
  );
  const closed30 = useMemo(() => countInWindow(s.completedTallyEntries, since30), [s.completedTallyEntries, since30]);

  const throughputColumns: ThroughputColumn[] = useMemo(
    () => [
      { key: "approval", label: "Approved", entries: s.completedApprovalRequestEntries },
      { key: "po", label: "POs raised", entries: s.completedPoGenEntries },
      { key: "share_po", label: "Shared", entries: s.completedShareEntries },
      { key: "follow_up", label: "Followed up", entries: s.completedFollowupEntries },
      { key: "inward", label: "Received", entries: s.completedGrnEntries },
      { key: "tally", label: "Booked", entries: s.completedTallyEntries },
    ],
    [
      s.completedApprovalRequestEntries,
      s.completedPoGenEntries,
      s.completedShareEntries,
      s.completedFollowupEntries,
      s.completedGrnEntries,
      s.completedTallyEntries,
    ],
  );

  // --- top overdue open items (compact list, not the full table) ---
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
        valueInr: e.value,
      }));
    // detailOf reads several stable store lookups; queueEntries + todayIso drive it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.queueEntries, todayIso, linkOf]);

  if (active) return <SandboxDashboard />;

  const openRequests = s.requests.filter((r) => r.status === "open").length;
  const livePos = s.pos.filter((p) => p.currentStage !== "closed" && p.currentStage !== "cancelled").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[22px] font-bold text-navy">{appName("import")}</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Welcome{user?.name ? `, ${user.name.split(" ")[0]}` : ""}. Here's where Import purchasing stands today —
          requisitions, POs, what's completed and what needs chasing.
        </p>
      </div>

      <HeadlineKpis
        openRequests={openRequests}
        livePos={livePos}
        pendingToday={counts.delayed + counts.today}
        delayed={counts.delayed}
        closed30={closed30}
      />

      <div className="grid md:grid-cols-2 gap-4">
        <StageDistribution title="Purchase orders by stage" rows={poDist} emptyLabel="No purchase orders yet." />
        <StageDistribution title="Requisition lines by status" rows={lineDist} emptyLabel="No requisition lines yet." />
      </div>

      <Card className="p-4 space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={SECTION_HEADING_CLASS}>Where it's stuck</h2>
          {s.isProcessCoordinator && (
            <Link to="/import/monitoring" className="text-[12px] font-semibold text-orange hover:underline">
              Open Control Center →
            </Link>
          )}
        </div>
        {/* Informational on the home page: selection is fixed empty and onChange is a
            no-op, so clicks never toggle or navigate a non-coordinator into the
            RequireMonitor-gated board. Coordinators use the link above. */}
        <StepPipeline nodes={nodes} selectedKeys={[]} onChange={() => {}} />
      </Card>

      <ThroughputStrip columns={throughputColumns} todayIso={todayIso} />

      <MoneySummary data={money} />

      <NeedsAttention rows={attention} todayIso={todayIso} showControlCenterLink={s.isProcessCoordinator} />
    </div>
  );
}
