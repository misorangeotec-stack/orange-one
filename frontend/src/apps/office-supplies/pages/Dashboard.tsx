import { useMemo } from "react";
import { Link } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { queueRollup, distribution, countInWindow, windowStartIso } from "@/shared/lib/fmsDashboard";
import KpiRow, { type KpiTile } from "@/shared/components/dashboard/KpiRow";
import DistributionCard from "@/shared/components/dashboard/DistributionCard";
import WhereStuckCard from "@/shared/components/dashboard/WhereStuckCard";
import ThroughputCard, { type ThroughputColumn } from "@/shared/components/dashboard/ThroughputCard";
import NeedsAttentionCard from "@/shared/components/dashboard/NeedsAttentionCard";
import type { AttentionRow } from "@/shared/lib/fmsDashboard";
import { appName } from "@/apps/appInfo";
import { useSuppliesStore } from "../store";
import { STEPS, STAGES, stepByKey } from "../lib/steps";
import { STATUS_LABEL, STATUS_TONE } from "../lib/format";
import type { RequestStatus } from "../types";

const PIPELINE_STEPS = STEPS.filter((s) => !s.noQueue);
const MONITORING = "/office-supplies/monitoring";
const requestHref = (id: string) => `/office-supplies/requests/${id}`;

/**
 * Office Supplies home — a per-FMS dashboard scoped to this FMS, seen by everyone
 * with the app (the store is already row-scoped). No money side (supply requests
 * carry a quantity, not a value). The coordinator Control Center at
 * `/office-supplies/monitoring` is unchanged. Every section degrades to a
 * meaningful zero-state — never blank.
 */
export default function Dashboard() {
  const s = useSuppliesStore();
  const todayIso = todayLocalIso();
  const since30 = windowStartIso(todayIso, 30);

  const { counts, nodes } = useMemo(() => queueRollup(s.queueEntries, PIPELINE_STEPS, todayIso), [s.queueEntries, todayIso]);

  const statusDist = useMemo(
    () =>
      distribution(
        s.requests,
        (r) => r.status,
        Object.keys(STATUS_LABEL),
        (k) => STATUS_LABEL[k as RequestStatus],
        (k) => STATUS_TONE[k as RequestStatus],
      ),
    [s.requests],
  );

  const delivered30 = useMemo(() => countInWindow(s.completedHandoverEntries, since30), [s.completedHandoverEntries, since30]);

  const throughput: ThroughputColumn[] = useMemo(
    () => [
      { key: "first_approval", label: "First approval", entries: s.completedFirstApprovalEntries },
      { key: "second_approval", label: "Second approval", entries: s.completedSecondApprovalEntries },
      { key: "handover", label: "Handover", entries: s.completedHandoverEntries },
    ],
    [s.completedFirstApprovalEntries, s.completedSecondApprovalEntries, s.completedHandoverEntries],
  );

  const attention: AttentionRow[] = useMemo(() => {
    return s.queueEntries
      .filter((e) => (e.dueIso ? e.dueIso < todayIso : false))
      .sort((a, b) => (a.dueIso ?? "9999").localeCompare(b.dueIso ?? "9999"))
      .slice(0, 8)
      .map((e) => ({
        key: `${e.stepKey}:${e.entityId}`,
        ref: e.ref,
        href: requestHref(e.requestId),
        stageShort: stepByKey(e.stepKey)?.short ?? e.stepKey,
        detail: s.requestById(e.requestId)?.itemName ?? "—",
        dueIso: e.dueIso,
        value: null,
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.queueEntries, todayIso]);

  const openRequests = s.requests.filter((r) => s.isOpenRequest(r)).length;
  const inApproval = s.requests.filter((r) => r.status === "pending_first_approval" || r.status === "pending_second_approval").length;

  const kpiTiles: KpiTile[] = [
    { key: "pending", label: "Pending today", value: counts.delayed + counts.today, hint: "delayed + due today", size: "hero", tone: counts.delayed + counts.today > 0 ? "red" : undefined },
    { key: "open", label: "Open requests", value: openRequests, hint: "not yet closed" },
    { key: "approval", label: "In approval", value: inApproval, hint: "awaiting a sign-off" },
    { key: "delayed", label: "Delayed", value: counts.delayed, hint: "past due", tone: counts.delayed > 0 ? "red" : undefined },
    { key: "delivered", label: "Delivered (30d)", value: delivered30, hint: "handed over" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold text-navy">{appName("office-supplies")}</h1>
          <p className="text-[13.5px] text-grey-2 mt-1">
            Where office-supply requests stand today — stationery, computer &amp; tech accessories, maintenance and services.
          </p>
        </div>
        <Link to="/office-supplies/requests/new">
          <Button size="sm">Raise a request</Button>
        </Link>
      </div>

      <KpiRow tiles={kpiTiles} />

      <DistributionCard title="Requests by status" rows={statusDist} emptyLabel="No requests yet." />

      <WhereStuckCard nodes={nodes} groups={STAGES} actionHref={MONITORING} showAction={s.isProcessCoordinator} />

      <ThroughputCard columns={throughput} todayIso={todayIso} />

      <NeedsAttentionCard rows={attention} todayIso={todayIso} actionHref={MONITORING} showAction={s.isProcessCoordinator} />
    </div>
  );
}
