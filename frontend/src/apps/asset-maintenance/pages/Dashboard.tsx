import { useMemo } from "react";
import KpiRow, { type KpiTile } from "@/shared/components/dashboard/KpiRow";
import WhereStuckCard from "@/shared/components/dashboard/WhereStuckCard";
import NeedsAttentionCard from "@/shared/components/dashboard/NeedsAttentionCard";
import DistributionCard from "@/shared/components/dashboard/DistributionCard";
import ThroughputCard from "@/shared/components/dashboard/ThroughputCard";
import { distribution, queueRollup, type AttentionRow } from "@/shared/lib/fmsDashboard";
import { addDaysIso } from "@/shared/lib/dueBuckets";
import { useAssetStore } from "../store";
import { STAGES, STEPS } from "../lib/steps";
import { liveTracks } from "../lib/schedules";
import { STATUS_LABEL, dmy, duePhrase, inr } from "../lib/format";
import type { QueueStep } from "../lib/queues";

const B = "/asset-maintenance";

const BADGE = "bg-[#EEF1F6] text-grey";

/**
 * The home screen.
 *
 * ⚠ THE HERO TILE IS "OVERDUE", not "due today". Everywhere else in this portal the
 *   hero is today's work, because work arrives daily and yesterday's is gone. Here
 *   the whole failure mode is the opposite: a service missed in March is STILL
 *   missed in August, and it is the accumulating pile — not today's slice — that
 *   the module exists to make impossible to ignore.
 */
export default function Dashboard() {
  const s = useAssetStore();
  const today = s.todayIso;

  const pipelineSteps = useMemo(
    () => STEPS.filter((st) => !st.noQueue).map((st) => ({ key: st.key as QueueStep, index: st.index, short: st.short })),
    [],
  );

  const { counts, nodes } = useMemo(
    () => queueRollup(s.queueEntries.map((e) => ({ stepKey: e.stepKey as QueueStep, dueIso: e.dueIso })), pipelineSteps, today),
    [s.queueEntries, pipelineSteps, today],
  );

  /** Everything dated across the register — the reminder engine's actual input. */
  const allTracks = useMemo(
    () => s.assets.filter((a) => a.active).flatMap((a) => liveTracks(a.schedules).map((t) => ({ asset: a, track: t }))),
    [s.assets],
  );

  const in30 = addDaysIso(today, 30);
  const dueSoon = allTracks.filter((x) => (x.track.nextDueDate as string) >= today && (x.track.nextDueDate as string) <= in30);
  const renewalsSoon = dueSoon.filter(
    (x) => s.scheduleTypes.find((t) => t.id === x.track.scheduleTypeId)?.kind === "renewal",
  );
  const untracked = s.assets.filter((a) => a.active && liveTracks(a.schedules).length === 0).length;

  const fySpend = useMemo(() => {
    // Indian FY: April to March.
    const [y, m] = today.split("-").map(Number);
    const fyStart = `${m >= 4 ? y : y - 1}-04-01`;
    return s.jobs
      .filter((j) => j.sdActualDate && j.sdActualDate >= fyStart)
      .reduce((n, j) => n + (j.sdCost ?? 0), 0);
  }, [s.jobs, today]);

  const tiles: KpiTile[] = [
    {
      key: "overdue",
      label: "Overdue",
      value: s.overdueJobs.length,
      hint: "Past their due date with no service recorded",
      size: "hero",
      tone: s.overdueJobs.length > 0 ? "red" : undefined,
      href: `${B}/monitoring`,
    },
    { key: "today", label: "Step due today", value: counts.today, href: `${B}/queues/schedule` },
    { key: "open", label: "Open jobs", value: s.openJobs.length, href: `${B}/jobs` },
    {
      key: "soon", label: "Due in 30 days", value: dueSoon.length,
      hint: `${renewalsSoon.length} of them renewals`, href: `${B}/calendar`,
    },
    { key: "assets", label: "Assets in use", value: s.assets.filter((a) => a.active).length, href: `${B}/assets` },
    {
      key: "untracked", label: "Nothing tracked", value: untracked,
      hint: untracked ? "These assets remind nobody" : "Every asset has a track",
      tone: untracked > 0 ? "red" : undefined,
      href: `${B}/assets`,
    },
    { key: "spend", label: "Service spend this FY", value: inr(fySpend) },
  ];

  /**
   * What to chase, soonest first. Reads the TRACKS, not the queue — a track whose
   * job has not opened yet is exactly what you want to see coming, and the queue by
   * definition cannot show it.
   */
  const attention: AttentionRow[] = useMemo(
    () =>
      [...allTracks]
        .filter((x) => (x.track.nextDueDate as string) <= in30)
        .sort((a, b) => (a.track.nextDueDate as string).localeCompare(b.track.nextDueDate as string))
        .slice(0, 12)
        .map((x) => ({
          key: x.track.id,
          ref: `${x.asset.assetNo} ${x.asset.name}`,
          href: `${B}/assets/${x.asset.id}`,
          stageShort: s.scheduleTypeName(x.track.scheduleTypeId),
          detail: `${dmy(x.track.nextDueDate)} · ${duePhrase(x.track.nextDueDate, today)}`,
          dueIso: x.track.nextDueDate,
          value: null,
        })),
    [allTracks, in30, today, s],
  );

  const byStatus = useMemo(
    () =>
      distribution(
        s.jobs,
        (j) => j.status,
        ["awaiting_schedule", "awaiting_service", "awaiting_verification", "on_hold", "closed", "skipped", "cancelled"],
        (k) => STATUS_LABEL[k as keyof typeof STATUS_LABEL] ?? k,
        () => BADGE,
      ),
    [s.jobs],
  );

  const byType = useMemo(
    () =>
      distribution(
        allTracks,
        (x) => x.track.scheduleTypeId,
        s.scheduleTypes.map((t) => t.id),
        (k) => s.scheduleTypeName(k),
        () => BADGE,
      ),
    [allTracks, s],
  );

  const byCategory = useMemo(
    () =>
      distribution(
        s.assets.filter((a) => a.active),
        (a) => a.categoryId ?? "",
        [...s.categories.map((c) => c.id), ""],
        (k) => (k ? s.masterName("category", k) : "Uncategorised"),
        () => BADGE,
      ),
    [s],
  );

  const throughputColumns = useMemo(
    () =>
      STEPS.filter((st) => !st.noQueue).map((st) => ({
        key: st.key,
        label: st.short,
        entries: s.completedFor(st.key as QueueStep),
      })),
    [s],
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Asset Maintenance</h1>
        <p className="mt-1 text-[13.5px] text-grey-2">
          Every asset, when each is next due, and what has slipped.
        </p>
      </div>

      <KpiRow tiles={tiles} />

      {untracked > 0 && (
        <p className="rounded-lg bg-[#FEF6E0] px-3 py-2 text-[12.5px] text-[#946200]">
          <strong>{untracked}</strong> active {untracked === 1 ? "asset has" : "assets have"} no dated
          track, so nothing will ever remind you about {untracked === 1 ? "it" : "them"}. That is the
          one failure this module cannot catch for you.
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <WhereStuckCard nodes={nodes} groups={STAGES} actionHref={`${B}/monitoring`} showAction={s.canMonitor} />
        <NeedsAttentionCard rows={attention} todayIso={today} actionHref={`${B}/calendar`} showAction />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <DistributionCard title="Service jobs by status" rows={byStatus} emptyLabel="No service jobs yet" />
        <DistributionCard title="What is tracked" rows={byType} emptyLabel="Nothing tracked yet" />
        <DistributionCard title="Assets by category" rows={byCategory} emptyLabel="No assets yet" />
      </div>

      <ThroughputCard columns={throughputColumns} todayIso={today} />
    </div>
  );
}
