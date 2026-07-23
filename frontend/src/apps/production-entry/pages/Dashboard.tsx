import { useMemo } from "react";
import { Link } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { queueRollup, distribution, countInWindow, windowStartIso } from "@/shared/lib/fmsDashboard";
import KpiRow, { type KpiTile } from "@/shared/components/dashboard/KpiRow";
import DistributionCard from "@/shared/components/dashboard/DistributionCard";
import WhereStuckCard from "@/shared/components/dashboard/WhereStuckCard";
import NeedsAttentionCard from "@/shared/components/dashboard/NeedsAttentionCard";
import type { AttentionRow } from "@/shared/lib/fmsDashboard";
import { appName } from "@/apps/appInfo";
import { useProductionStore } from "../store";
import { STEPS, STAGES, stepByKey } from "../lib/steps";
import { STATUS_LABEL, STATUS_TONE, requestSubject } from "../lib/format";
import type { ProductionStatus } from "../types";

const PIPELINE_STEPS = STEPS.filter((s) => !s.noQueue);
const MONITORING = "/production-entry/monitoring";
const REQUESTS = "/production-entry/requests";

/**
 * Production Entry home — a per-FMS dashboard scoped to this FMS, seen by everyone
 * with the app (the store is already row-scoped). No money side (job cards carry
 * quantities, not values). The coordinator Control Center at
 * `/production-entry/monitoring` is unchanged. Every section degrades to a
 * meaningful zero-state — never blank.
 */
export default function Dashboard() {
  const s = useProductionStore();
  const todayIso = todayLocalIso();
  const since30 = windowStartIso(todayIso, 30);

  const { counts, nodes } = useMemo(() => queueRollup(s.queueEntries, PIPELINE_STEPS, todayIso), [s.queueEntries, todayIso]);

  const statusDist = useMemo(
    () =>
      distribution(
        s.requests,
        (r) => r.status,
        Object.keys(STATUS_LABEL),
        (k) => STATUS_LABEL[k as ProductionStatus],
        (k) => STATUS_TONE[k as ProductionStatus],
      ),
    [s.requests],
  );

  const completed30 = useMemo(() => countInWindow(s.completedFor("fg_transfer"), since30), [s.completedFor, since30]);

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
          href: `/production-entry/requests/${e.requestId}`,
          stageShort: stepByKey(e.stepKey)?.short ?? e.stepKey,
          detail: r ? requestSubject(r) : "—",
          dueIso: e.dueIso,
          value: null,
        };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.queueEntries, todayIso]);

  const open = s.requests.filter((r) => s.isOpenRequest(r)).length;
  const inProduction = s.requests.filter((r) => r.status === "awaiting_production").length;

  // Pending/Delayed are queue (step-work) metrics — their home is the coordinator
  // Control Center, which is gated. Link there only for coordinators, so a regular
  // user is never sent to Access Denied.
  const queueHref = s.isProcessCoordinator ? MONITORING : undefined;

  const kpiTiles: KpiTile[] = [
    { key: "pending", label: "Pending today", value: counts.delayed + counts.today, hint: "delayed + due today", size: "hero", tone: counts.delayed + counts.today > 0 ? "red" : undefined, href: queueHref },
    { key: "open", label: "Open job cards", value: open, hint: "not yet closed", href: REQUESTS },
    { key: "production", label: "In production", value: inProduction, hint: "on the floor", href: `${REQUESTS}?status=awaiting_production` },
    { key: "delayed", label: "Delayed", value: counts.delayed, hint: "past due", tone: counts.delayed > 0 ? "red" : undefined, href: queueHref },
    { key: "done", label: "Completed (30d)", value: completed30, hint: "FG transferred", href: `${REQUESTS}?status=closed` },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold text-navy">{appName("production-entry")}</h1>
          <p className="text-[13.5px] text-grey-2 mt-1">
            Where ink production job cards stand today — handover, production, quality, packing and FG transfer.
          </p>
        </div>
        <Link to="/production-entry/requests/new">
          <Button size="sm">Generate issue slip</Button>
        </Link>
      </div>

      <KpiRow tiles={kpiTiles} />

      <NeedsAttentionCard rows={attention} todayIso={todayIso} actionHref={MONITORING} showAction={s.isProcessCoordinator} />

      <DistributionCard
        title="Job cards by status"
        rows={statusDist}
        emptyLabel="No job cards yet."
        hrefFor={(r) => `${REQUESTS}?status=${r.key}`}
      />

      <WhereStuckCard nodes={nodes} groups={STAGES} actionHref={MONITORING} showAction={s.isProcessCoordinator} />
    </div>
  );
}
