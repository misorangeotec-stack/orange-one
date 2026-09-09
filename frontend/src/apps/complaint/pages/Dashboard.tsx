import { useMemo } from "react";
import { Link } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { queueRollup, distribution, countInWindow, windowStartIso } from "@/shared/lib/fmsDashboard";
import type { AttentionRow } from "@/shared/lib/fmsDashboard";
import KpiRow, { type KpiTile } from "@/shared/components/dashboard/KpiRow";
import StepPipeline from "@/shared/components/ui/StepPipeline";
import DistributionCard from "@/shared/components/dashboard/DistributionCard";
import WhereStuckCard from "@/shared/components/dashboard/WhereStuckCard";
import ThroughputCard, { type ThroughputColumn } from "@/shared/components/dashboard/ThroughputCard";
import NeedsAttentionCard from "@/shared/components/dashboard/NeedsAttentionCard";
import { appName } from "@/apps/appInfo";
import { useComplaintStore } from "../store";
import { STEPS, STAGES, stepByKey } from "../lib/steps";
import {
  CAUSE_GROUP_TONE,
  COMPLAINT_TYPE_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  complaintSubject,
} from "../lib/format";
import { monitoringHref, newRequestHref, requestHref, requestsHref } from "../lib/routes";
import { CAUSE_GROUP_LABEL, COMPLAINT_TYPE_LABEL, type CauseGroup, type RequestStatus } from "../types";

const PIPELINE_STEPS = STEPS.filter((s) => !s.noQueue);

/**
 * Complaint home — scoped to this FMS and seen by everyone with the app (the store
 * is already row-scoped). The coordinator Control Center at `/complaint/monitoring`
 * is the deeper view. Every section degrades to a meaningful zero-state, never blank.
 *
 * The three distributions answer the three questions people actually ask of a
 * complaint register: where is it in the process (status), which side is
 * complaining (RM vs FG), and what keeps going wrong (root-cause group).
 */
export default function Dashboard() {
  const s = useComplaintStore();
  const todayIso = todayLocalIso();
  const since30 = windowStartIso(todayIso, 30);

  const { counts, nodes } = useMemo(
    () => queueRollup(s.queueEntries, PIPELINE_STEPS, todayIso),
    [s.queueEntries, todayIso],
  );

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

  const typeDist = useMemo(
    () =>
      distribution(
        s.requests,
        (r) => r.complaintType,
        Object.keys(COMPLAINT_TYPE_LABEL),
        (k) => COMPLAINT_TYPE_LABEL[k as keyof typeof COMPLAINT_TYPE_LABEL],
        (k) => COMPLAINT_TYPE_TONE[k as keyof typeof COMPLAINT_TYPE_TONE],
      ),
    [s.requests],
  );

  // One closing step — the flow is linear, so `close` is the only way out other
  // than a rejection at acknowledge.
  const completed30 = useMemo(
    () => countInWindow(s.completedFor("management_review"), since30),
    [s.completedFor, since30],
  );

  const throughput: ThroughputColumn[] = useMemo(
    () => PIPELINE_STEPS.map((st) => ({ key: st.key, label: st.short, entries: s.completedFor(st.key) })),
    [s.completedFor],
  );

  const attention: AttentionRow[] = useMemo(
    () =>
      s.queueEntries
        .filter((e) => (e.dueIso ? e.dueIso < todayIso : false))
        .sort((a, b) => (a.dueIso ?? "9999").localeCompare(b.dueIso ?? "9999"))
        .slice(0, 8)
        .map((e) => {
          const r = s.requestById(e.requestId);
          return {
            key: `${e.stepKey}:${e.entityId}`,
            ref: e.ref,
            href: requestHref(e.requestId),
            stageShort: stepByKey(e.stepKey)?.short ?? e.stepKey,
            detail: r ? complaintSubject(r.complaintNo, r.partyName) : "—",
            dueIso: e.dueIso,
            value: null,
          };
        }),
    [s.queueEntries, s.requestById, todayIso],
  );

  const open = s.requests.filter((r) => s.isOpenRequest(r));
  const openFg = open.filter((r) => r.complaintType === "finished_good").length;
  const openRm = open.filter((r) => r.complaintType === "raw_material").length;

  const kpiTiles: KpiTile[] = [
    {
      key: "pending",
      label: "Pending today",
      value: counts.delayed + counts.today,
      hint: "delayed + due today",
      size: "hero",
      tone: counts.delayed + counts.today > 0 ? "red" : undefined,
    },
    { key: "openFg", label: "Open — finished good", value: openFg, hint: "customer complaints", href: requestsHref() },
    { key: "openRm", label: "Open — raw material", value: openRm, hint: "supplier complaints", href: requestsHref() },
    { key: "delayed", label: "Delayed", value: counts.delayed, hint: "past due", tone: counts.delayed > 0 ? "red" : undefined },
    { key: "done", label: "Closed (30d)", value: completed30, hint: "reviewed and closed" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold text-navy">{appName("complaint")}</h1>
          <p className="text-[13.5px] text-grey-2 mt-1">
            Where quality complaints stand today — raw material and finished good, from the LOT that
            failed through to the resolution the party accepted.
          </p>
        </div>
        {s.canRaise && (
          <Link to={newRequestHref()}>
            <Button size="sm">Raise a complaint</Button>
          </Link>
        )}
      </div>

      {/*
        THE PIPELINE, on top — the same rail Purchase FMS leads with. Read-only
        here (`interactive={false}`): a dashboard rail is informational, and the
        filtering version belongs on a screen that has rows to filter.

        Fed by the SAME `nodes` the Where-stuck card uses, so the two cannot
        disagree about where work is sitting.
      */}
      <StepPipeline
        nodes={nodes}
        selectedKeys={[]}
        onChange={() => {}}
        interactive={false}
      />

      <KpiRow tiles={kpiTiles} />

      <DistributionCard title="Complaints by status" rows={statusDist} emptyLabel="No complaints yet." />

      <DistributionCard title="Raw material vs finished good" rows={typeDist} emptyLabel="No complaints yet." />

      <WhereStuckCard
        nodes={nodes}
        groups={STAGES}
        actionHref={monitoringHref()}
        showAction={s.isProcessCoordinator}
      />

      <ThroughputCard columns={throughput} todayIso={todayIso} />

      <NeedsAttentionCard
        rows={attention}
        todayIso={todayIso}
        actionHref={monitoringHref()}
        showAction={s.isProcessCoordinator}
      />
    </div>
  );
}
