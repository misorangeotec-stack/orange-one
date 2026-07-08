import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import EmptyState from "@/shared/components/ui/EmptyState";
import { formatDateDMY } from "@/shared/lib/date";
import StatCard from "../components/StatCard";
import FilterBar from "../components/FilterBar";
import { ChartCard, LeadsTimeChart, BarSeriesChart, DonutChart, HourChart } from "../components/Charts";
import { useLeads } from "../lib/LeadsProvider";
import type { LeadFilters } from "../lib/transforms";
import {
  computeKpis, leadsOverTime, bySalesperson, interestDistribution, categoryBreakdown,
  askedAboutBreakdown, followUpFunnel, captureByHour, byLocation,
} from "../lib/transforms";

const ic = {
  total: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h16M4 12h16M4 18h10" /></svg>,
  clock: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  building: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M9 8h.01M15 8h.01M9 12h.01M15 12h.01M9 16h.01M15 16h.01" /></svg>,
  fire: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3s5 4 5 9a5 5 0 0 1-10 0c0-2 1-3 1-3s1 2 2 2c0-3 2-6 2-8Z" /></svg>,
  flag: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></svg>,
  mic: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M6 11a6 6 0 0 0 12 0M12 17v4" /></svg>,
  users: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3 3-5 6-5s6 2 6 5" /><circle cx="17.5" cy="9" r="2.4" /></svg>,
  tag: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 12l-8 8-9-9V3h8Z" /><circle cx="7.5" cy="7.5" r="1.2" fill="currentColor" /></svg>,
};

export default function Overview() {
  const { leads, filtered, masters, loading, error, filters, setFilters, resetFilters, activeFilterCount } = useLeads();
  const navigate = useNavigate();
  const now = useMemo(() => new Date(), []);
  const kpis = useMemo(() => computeKpis(filtered, masters, now), [filtered, masters, now]);
  const timeSeries = useMemo(() => leadsOverTime(filtered), [filtered]);
  const sales = useMemo(() => bySalesperson(filtered), [filtered]);
  const interest = useMemo(() => interestDistribution(filtered, masters), [filtered, masters]);
  const categories = useMemo(() => categoryBreakdown(filtered, masters), [filtered, masters]);
  const asked = useMemo(() => askedAboutBreakdown(filtered, masters), [filtered, masters]);
  const funnel = useMemo(() => followUpFunnel(filtered, masters), [filtered, masters]);
  const hours = useMemo(() => captureByHour(filtered), [filtered]);
  const locations = useMemo(() => byLocation(filtered), [filtered]);

  // Drill down: add a single-value filter and jump to the All Leads table.
  const drill = (patch: Partial<LeadFilters>) => {
    setFilters({ ...filters, ...patch });
    navigate("/leads-dashboard/leads");
  };

  if (loading) return <LoadingBlock />;
  if (error) return <Card className="p-8 text-center text-[13px] text-rose">Couldn’t load leads: {error}</Card>;
  if (leads.length === 0)
    return <EmptyState title="No leads captured yet" message="Leads scanned in the Orange One mobile app will appear here for analysis." />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[20px] font-bold text-navy">Leads Overview</h1>
        <p className="text-[13px] text-grey-2 mt-0.5">
          {kpis.total} of {leads.length} lead{leads.length === 1 ? "" : "s"}
          {activeFilterCount > 0 ? " (filtered)" : ""} · as of {formatDateDMY(now)}
        </p>
      </div>

      <FilterBar leads={leads} masters={masters} filters={filters} onChange={setFilters} onReset={resetFilters} activeCount={activeFilterCount} />

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total leads" value={kpis.total} icon={ic.total} tone="orange" />
        <StatCard label="Captured today" value={kpis.today} icon={ic.clock} tone="blue" hint={`${kpis.thisWeek} this week`} />
        <StatCard label="Unique companies" value={kpis.uniqueCompanies} icon={ic.building} tone="violet" />
        <StatCard label="Hot leads" value={kpis.hot} icon={ic.fire} tone="rose" hint="Very interested / ready to buy" />
        <StatCard label="Follow-up set" value={`${kpis.followUpPct}%`} icon={ic.flag} tone="green" />
        <StatCard label="Voice-note coverage" value={`${kpis.voicePct}%`} icon={ic.mic} tone="blue" />
        <StatCard label="Avg / salesperson" value={kpis.avgPerSalesperson} icon={ic.users} tone="orange" />
        <StatCard label="Top category" value={kpis.topCategory?.label || "—"} icon={ic.tag} tone="violet" hint={kpis.topCategory ? `${kpis.topCategory.count} leads` : undefined} />
      </div>

      {filtered.length === 0 ? (
        <Card><EmptyState title="No leads match these filters" message="Adjust or clear the filters above." /></Card>
      ) : (
        <>
          <ChartCard title="Leads over time" subtitle="Captured per day">
            <LeadsTimeChart data={timeSeries} />
          </ChartCard>

          <div className="grid lg:grid-cols-2 gap-4">
            <ChartCard title="By salesperson" subtitle="Click a bar to drill into their leads"><BarSeriesChart data={sales} horizontal onSelect={(k) => drill({ salespeople: [k] })} /></ChartCard>
            <ChartCard title="Interest level" subtitle="Click a slice to filter"><DonutChart data={interest} onSelect={(k) => drill({ interests: [k] })} /></ChartCard>
            <ChartCard title="Categories" subtitle="Click a bar to filter"><BarSeriesChart data={categories} onSelect={(k) => drill({ categories: [k] })} /></ChartCard>
            <ChartCard title="What they asked about" subtitle="Click a bar to filter"><BarSeriesChart data={asked} onSelect={(k) => drill({ askedAbout: [k] })} /></ChartCard>
            <ChartCard title="Follow-up funnel" subtitle="All → follow-up set → hot interest"><BarSeriesChart data={funnel} /></ChartCard>
            <ChartCard title="Capture activity by hour" subtitle="Hour of day (local)"><HourChart data={hours} /></ChartCard>
            {locations.length > 0 && (
              <ChartCard title="By location" subtitle="Where leads were captured — click to filter" className="lg:col-span-2"><BarSeriesChart data={locations} horizontal onSelect={(k) => drill({ locations: [k] })} /></ChartCard>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function LoadingBlock() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-6 w-48 bg-line rounded" />
      <div className="h-24 bg-white border border-line rounded-card" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-[92px] bg-white border border-line rounded-card" />)}
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="h-56 bg-white border border-line rounded-card" />
        <div className="h-56 bg-white border border-line rounded-card" />
      </div>
    </div>
  );
}
