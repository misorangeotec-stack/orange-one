import { useMemo } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import StepPipeline from "@/shared/components/ui/StepPipeline";
import { SectionHeading } from "@/shared/components/ui/Readout";
import { queueRollup } from "@/shared/lib/fmsDashboard";
import { useAssetStore } from "../../store";
import { STAGES, STEPS } from "../../lib/steps";
import { liveTracks } from "../../lib/schedules";
import { dmy, duePhrase } from "../../lib/format";
import type { QueueStep } from "../../lib/queues";

/**
 * The coordinator's view: where work is stuck, and — more importantly here — what
 * has actually been missed.
 *
 * The two halves answer different questions and are deliberately not merged:
 *   the rail  → is anyone slow at a STEP?
 *   the lists → has an OBLIGATION lapsed?
 * A team can be perfectly punctual at every step and still be six weeks past an
 * insurance expiry, because the job only opens inside its lead window.
 */
export default function ControlCenter() {
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

  /** Overdue TRACKS — including those whose job has not opened yet. */
  const overdueTracks = useMemo(() => {
    const out: { assetId: string; label: string; type: string; due: string; category: string }[] = [];
    for (const a of s.assets) {
      if (!a.active) continue;
      for (const t of liveTracks(a.schedules)) {
        if ((t.nextDueDate as string) < today) {
          out.push({
            assetId: a.id,
            label: `${a.assetNo} ${a.name}`,
            type: s.scheduleTypeName(t.scheduleTypeId),
            due: t.nextDueDate as string,
            category: s.masterName("category", a.categoryId),
          });
        }
      }
    }
    return out.sort((x, z) => x.due.localeCompare(z.due));
  }, [s, today]);

  const byCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of overdueTracks) m.set(o.category, (m.get(o.category) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [overdueTracks]);

  const byCustodian = useMemo(() => {
    const m = new Map<string, number>();
    for (const j of s.overdueJobs) {
      const name = s.personName(s.assetById(j.assetId)?.custodianUserId ?? null);
      m.set(name, (m.get(name) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [s]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Control Center</h1>
        <p className="mt-1 text-[13.5px] text-grey-2">
          Where the work is sitting, and what has slipped past its date.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { label: "Step delayed", value: counts.delayed, tone: counts.delayed > 0 },
          { label: "Step due today", value: counts.today, tone: false },
          { label: "Tomorrow", value: counts.tomorrow, tone: false },
          { label: "Day after", value: counts.dayAfter, tone: false },
          { label: "Overdue services", value: overdueTracks.length, tone: overdueTracks.length > 0 },
        ].map((k) => (
          <Card key={k.label} className="p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-grey">{k.label}</div>
            <div className={`mt-1 text-[22px] font-bold ${k.tone ? "text-ryg-red" : "text-navy"}`}>{k.value}</div>
          </Card>
        ))}
      </div>

      <Card className="p-4">
        <SectionHeading>Where the work is</SectionHeading>
        <div className="mt-3">
          {/*
            Read-only: the actionable lists below are TRACK-based (what has
            lapsed), not step-based, so a step filter would not narrow them. The
            rail is here for the bottleneck read-out only.
          */}
          <StepPipeline nodes={nodes} groups={STAGES} interactive={false} selectedKeys={[]} onChange={() => {}} />
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-baseline justify-between gap-3 border-b border-line pb-2">
            <SectionHeading>Past due</SectionHeading>
            <span className="text-[12px] text-grey-2">{overdueTracks.length} tracks</span>
          </div>
          {overdueTracks.length === 0 ? (
            <p className="mt-3 text-[13px] text-grey-2">Nothing is past its date. That is the goal.</p>
          ) : (
            <ul className="mt-3 space-y-1.5 text-[13px]">
              {overdueTracks.slice(0, 20).map((o) => (
                <li key={`${o.assetId}-${o.type}`} className="flex flex-wrap items-baseline gap-2">
                  <span className="w-24 shrink-0 font-semibold text-ryg-red">{dmy(o.due)}</span>
                  <Link to={`/asset-maintenance/assets/${o.assetId}`} className="text-navy hover:text-orange">
                    {o.label}
                  </Link>
                  <span className="text-grey-2">· {o.type} · {duePhrase(o.due, today)}</span>
                </li>
              ))}
            </ul>
          )}
          {overdueTracks.length > 20 && (
            <p className="mt-2 text-[12.5px] text-grey-2">and {overdueTracks.length - 20} more.</p>
          )}
        </Card>

        <div className="space-y-5">
          <Card className="p-5">
            <SectionHeading>Overdue by category</SectionHeading>
            {byCategory.length === 0 ? (
              <p className="mt-3 text-[13px] text-grey-2">Nothing overdue.</p>
            ) : (
              <ul className="mt-3 space-y-1.5 text-[13px]">
                {byCategory.map(([k, n]) => (
                  <li key={k} className="flex items-baseline justify-between gap-2">
                    <span className="text-navy">{k}</span>
                    <span className="font-semibold text-ryg-red">{n}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-5">
            <SectionHeading>Overdue jobs by custodian</SectionHeading>
            {byCustodian.length === 0 ? (
              <p className="mt-3 text-[13px] text-grey-2">Nothing overdue.</p>
            ) : (
              <ul className="mt-3 space-y-1.5 text-[13px]">
                {byCustodian.map(([k, n]) => (
                  <li key={k} className="flex items-baseline justify-between gap-2">
                    <span className="text-navy">{k}</span>
                    <span className="font-semibold text-ryg-red">{n}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
