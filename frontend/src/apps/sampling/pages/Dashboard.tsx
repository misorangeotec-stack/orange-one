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
import { useSamplingStore } from "../store";
import { STEPS, STAGES, stepByKey } from "../lib/steps";
import { STATUS_LABEL, STATUS_TONE, requestSubject } from "../lib/format";
import type { RequestStatus } from "../types";

const PIPELINE_STEPS = STEPS.filter((s) => !s.noQueue);
const MONITORING = "/sampling/monitoring";

/**
 * Sampling home — a per-FMS dashboard scoped to this FMS, seen by everyone with
 * the app (the store is already row-scoped). No money side (sampling is movement,
 * testing and result). The coordinator Control Center at `/sampling/monitoring`
 * is unchanged. Every section degrades to a meaningful zero-state — never blank.
 */
export default function Dashboard() {
  const s = useSamplingStore();
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

  // A request closes at result_handover (lab branch) OR sample_received (no-lab branch).
  const completed30 = useMemo(
    () => countInWindow(s.completedFor("result_handover"), since30) + countInWindow(s.completedFor("sample_received"), since30),
    [s.completedFor, since30],
  );

  const throughput: ThroughputColumn[] = useMemo(
    () => PIPELINE_STEPS.map((st) => ({ key: st.key, label: st.short, entries: s.completedFor(st.key) })),
    [s.completedFor],
  );

  const attention: AttentionRow[] = useMemo(() => {
    return s.queueEntries
      .filter((e) => (e.dueIso ? e.dueIso < todayIso : false))
      .sort((a, b) => (a.dueIso ?? "9999").localeCompare(b.dueIso ?? "9999"))
      .slice(0, 8)
      .map((e) => {
        const r = s.requestById(e.requestId);
        return {
          key: `${e.stepKey}:${e.entityId}`,
          ref: e.ref,
          href: `/sampling/requests/${e.requestId}`,
          stageShort: stepByKey(e.stepKey)?.short ?? e.stepKey,
          detail: r ? requestSubject(r) : "—",
          dueIso: e.dueIso,
          value: null,
        };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.queueEntries, todayIso]);

  const open = s.requests.filter((r) => s.isOpenRequest(r)).length;
  const inTesting = s.requests.filter((r) => r.status === "awaiting_testing").length;

  const kpiTiles: KpiTile[] = [
    { key: "pending", label: "Pending today", value: counts.delayed + counts.today, hint: "delayed + due today", size: "hero", tone: counts.delayed + counts.today > 0 ? "red" : undefined },
    { key: "open", label: "Open requests", value: open, hint: "not yet closed" },
    { key: "testing", label: "In testing", value: inTesting, hint: "awaiting a result" },
    { key: "delayed", label: "Delayed", value: counts.delayed, hint: "past due", tone: counts.delayed > 0 ? "red" : undefined },
    { key: "done", label: "Completed (30d)", value: completed30, hint: "result handed over" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold text-navy">{appName("sampling")}</h1>
          <p className="text-[13.5px] text-grey-2 mt-1">
            Where ink / raw-material sampling stands today — movement, testing, result and handover.
          </p>
        </div>
        <Link to="/sampling/requests/new">
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
