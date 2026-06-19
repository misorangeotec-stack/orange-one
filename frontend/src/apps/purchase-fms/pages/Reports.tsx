import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import EmptyState from "@/shared/components/ui/EmptyState";
import StatCard from "@/apps/task-management/components/StatCard";
import RygBar from "@/apps/task-management/components/RygBar";
import { formatDate } from "@/shared/lib/time";
import { useSession } from "@/core/platform/session";
import { useDirectory } from "@/core/platform/store";
import { useFmsStore } from "../mock/store";
import { ownerLabel } from "../lib/owner";
import {
  ALL_STAGE_KEYS,
  overview,
  pipelineDistribution,
  stageTurnaround,
  stageOnTime,
  overdueEntries,
  bottleneck,
  monthlyThroughput,
  statusBreakdown,
  totalPoValue,
  spendByCategory,
  topVendors,
} from "../lib/analytics";
import { formatINRShort } from "../lib/format";
import BarList from "../components/charts/BarList";
import DonutChart from "../components/charts/DonutChart";
import TrendBars from "../components/charts/TrendBars";

const ic = {
  active: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  overdue: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12" y2="17" /></svg>,
  ontime: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>,
  cycle: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7" /><polyline points="21 3 21 8 16 8" /></svg>,
};

/** Admin & manager analytics: pipeline distribution and turnaround / SLA. */
export default function Reports() {
  const { user, isAdmin } = useSession();
  const { downlineIds, profileById } = useDirectory();
  const { entries, stepOwners, ownerForStep } = useFmsStore();

  // Scope: admins see all stages; managers see only stages their team owns.
  const scope = useMemo(() => {
    if (isAdmin) return ALL_STAGE_KEYS;
    const team = new Set([user.id, ...downlineIds(user.id)]);
    return stepOwners.filter((o) => o.employeeIds.some((id) => team.has(id))).map((o) => o.stepKey);
  }, [isAdmin, user.id, downlineIds, stepOwners]);

  const stats = useMemo(() => overview(entries, scope), [entries, scope]);
  const distribution = useMemo(() => pipelineDistribution(entries, scope), [entries, scope]);
  const turnaround = useMemo(() => stageTurnaround(entries, scope), [entries, scope]);
  const onTime = useMemo(() => stageOnTime(entries, scope), [entries, scope]);
  const overdue = useMemo(() => overdueEntries(entries, scope), [entries, scope]);
  const slowest = useMemo(() => bottleneck(turnaround), [turnaround]);

  // End-to-end (global) trend & value metrics.
  const throughput = useMemo(() => monthlyThroughput(entries, 6), [entries]);
  const status = useMemo(() => statusBreakdown(entries), [entries]);
  const poTotal = useMemo(() => totalPoValue(entries), [entries]);
  const spendCat = useMemo(() => spendByCategory(entries), [entries]);
  const vendors = useMemo(() => topVendors(entries, 5), [entries]);

  const mostCongested = useMemo(
    () => distribution.filter((d) => d.key !== "__completed").reduce((m, d) => (d.count > (m?.count ?? -1) ? d : m), null as null | (typeof distribution)[number]),
    [distribution]
  );

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[22px] font-bold text-navy">Reports &amp; Analytics</h2>
        <p className="text-grey text-[13px] mt-1">
          {isAdmin ? "All purchases across the pipeline." : "Scoped to the stages your team owns."}
        </p>
      </div>

      {!isAdmin && scope.length === 0 ? (
        <Card>
          <EmptyState
            title="No stages assigned to you yet"
            message="Once an admin maps you (or your team) to a workflow step in Settings → Workflow Setup, your reports will appear here."
          />
        </Card>
      ) : (
        <>
          {/* KPI strip */}
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            <StatCard label="Active Entries" value={stats.active} icon={ic.active} tone="blue" />
            <StatCard label="Overdue Stages" value={stats.overdue} icon={ic.overdue} tone="rose" />
            <StatCard label="On-time" value={stats.onTimePct == null ? "—" : `${stats.onTimePct}%`} icon={ic.ontime} tone="green" />
            <StatCard label="Avg Cycle Time" value={stats.avgCycleDays == null ? "—" : `${stats.avgCycleDays}d`} icon={ic.cycle} tone="orange" hint={`${stats.completed} completed`} />
          </div>

          {/* Status snapshot + throughput trend */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <h3 className="text-[14px] font-semibold text-navy">Status Snapshot</h3>
              <p className="text-[12px] text-grey-2 mb-4">Where every entry stands right now.</p>
              <DonutChart
                centerLabel="entries"
                items={[
                  { key: "completed", label: "Completed", value: status.completed, color: "#27AE60" },
                  { key: "onTrack", label: "In progress", value: status.onTrack, color: "#3B82F6" },
                  { key: "overdue", label: "Overdue", value: status.overdue, color: "#D64545" },
                ]}
              />
            </Card>
            <Card className="p-5">
              <h3 className="text-[14px] font-semibold text-navy">Throughput</h3>
              <p className="text-[12px] text-grey-2 mb-4">Orders raised vs completed, last 6 months.</p>
              <TrendBars rows={throughput} />
            </Card>
          </div>

          {/* Pipeline distribution */}
          <Card className="p-5">
            <h3 className="text-[14px] font-semibold text-navy">Pipeline Distribution</h3>
            <p className="text-[12px] text-grey-2 mb-4">How many entries are sitting at each stage right now.</p>
            <BarList items={distribution.map((d) => ({ key: d.key, label: d.label, value: d.count }))} highlightKey={mostCongested?.key} />
            {mostCongested && mostCongested.count > 0 && (
              <p className="mt-4 text-[12.5px] text-grey">
                Most entries are waiting at <b className="text-navy font-semibold">{mostCongested.label}</b> ({mostCongested.count}).
              </p>
            )}
          </Card>

          {/* Procurement value (admin-only — org-wide spend) */}
          {isAdmin && (
            <Card className="p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h3 className="text-[14px] font-semibold text-navy">Procurement Value</h3>
                  <p className="text-[12px] text-grey-2">Based on PO value (incl. GST) captured at the Share-PO stage.</p>
                </div>
                <div className="text-right">
                  <div className="text-[22px] font-bold text-navy leading-none">{formatINRShort(poTotal)}</div>
                  <div className="text-[11px] text-grey-2 mt-1">total PO value</div>
                </div>
              </div>
              <div className="mt-5 grid gap-6 lg:grid-cols-2">
                <div>
                  <h4 className="text-[12.5px] font-semibold text-navy mb-3">Spend by Category</h4>
                  <BarList items={spendCat} format={formatINRShort} emptyText="No PO value captured yet." />
                </div>
                <div>
                  <h4 className="text-[12.5px] font-semibold text-navy mb-3">Top Vendors</h4>
                  <BarList items={vendors} format={formatINRShort} emptyText="No PO value captured yet." />
                </div>
              </div>
            </Card>
          )}

          {/* Turnaround & SLA */}
          <Card className="p-5 space-y-6">
            <div>
              <h3 className="text-[14px] font-semibold text-navy">Average Days per Stage</h3>
              <p className="text-[12px] text-grey-2 mb-4">Time taken in each stage. The slowest is your bottleneck.</p>
              <BarList
                items={turnaround.map((t) => ({ key: t.key, label: t.label, value: t.avgDays ?? 0, note: `${t.samples}×` }))}
                unit="d"
                highlightKey={slowest?.key}
              />
              {slowest && (
                <p className="mt-4 text-[12.5px] text-grey">
                  Bottleneck: <b className="text-navy font-semibold">{slowest.label}</b> averages{" "}
                  <b className="text-navy font-semibold">{slowest.avgDays}d</b>.
                </p>
              )}
            </div>

            <div>
              <h3 className="text-[14px] font-semibold text-navy">On-time vs Delayed by Stage</h3>
              <p className="text-[12px] text-grey-2 mb-3">Share of completions that met their planned date.</p>
              <ScrollableTable>
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-grey-2 border-b border-line">
                      <th className="py-2 pr-3 font-semibold">Stage</th>
                      <th className="py-2 px-3 font-semibold w-12">Done</th>
                      <th className="py-2 px-3 font-semibold w-[40%]">On-time / Delayed</th>
                      <th className="py-2 pl-3 font-semibold text-right w-16">On-time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {onTime.map((r) => {
                      const total = r.onTime + r.delayed;
                      return (
                        <tr key={r.key} className="border-b border-line last:border-0">
                          <td className="py-2.5 pr-3 text-navy font-medium">{r.label}</td>
                          <td className="py-2.5 px-3 text-grey tabular-nums">{total}</td>
                          <td className="py-2.5 px-3">
                            {total === 0 ? <span className="text-grey-2">—</span> : <RygBar green={r.pct ?? 0} yellow={0} red={100 - (r.pct ?? 0)} showLegend={false} />}
                          </td>
                          <td className="py-2.5 pl-3 text-right tabular-nums font-semibold text-navy">{r.pct == null ? "—" : `${r.pct}%`}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </ScrollableTable>
            </div>

            <div>
              <h3 className="text-[14px] font-semibold text-navy">Overdue Now</h3>
              <p className="text-[12px] text-grey-2 mb-3">Entries whose current stage is past its planned date.</p>
              {overdue.length === 0 ? (
                <p className="text-[12.5px] text-[#1f9d57] font-medium">Nothing overdue — every active stage is on schedule.</p>
              ) : (
                <ul className="divide-y divide-line border border-line rounded-card overflow-hidden">
                  {overdue.map((r) => (
                    <li key={r.entry.id}>
                      <Link to={`/purchase-fms/entries/${r.entry.id}`} className="flex flex-wrap items-center gap-3 px-3.5 py-2.5 hover:bg-page transition">
                        <span className="font-semibold text-navy w-20">{r.entry.code}</span>
                        <span className="flex-1 min-w-[140px] text-navy">{r.entry.itemName}</span>
                        <span className="text-grey-2">{r.stageTitle}</span>
                        <span className="text-grey-2 hidden sm:inline">{ownerLabel(ownerForStep(r.stageKey), profileById)}</span>
                        <span className="text-grey-2 tabular-nums">planned {formatDate(r.plannedDate)}</span>
                        <span className="rounded-pill bg-[#FDE9F1] text-[#d23c6e] px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap">{r.daysOverdue}d overdue</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
