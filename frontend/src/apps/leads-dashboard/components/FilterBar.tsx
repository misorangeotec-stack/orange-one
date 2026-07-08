import { useMemo } from "react";
import Card from "@/shared/components/ui/Card";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { cn } from "@/shared/lib/cn";
import { dayKey } from "@/shared/lib/date";
import type { Lead, Masters, MasterType } from "../lib/types";
import type { LeadFilters } from "../lib/transforms";

const opts = (masters: Masters, type: MasterType): MultiOption[] =>
  masters[type].map((m) => ({ value: m.id, label: m.label }));

/** The shared filter bar. Drives the filtered set for both Overview + All Leads. */
export default function FilterBar({
  leads,
  masters,
  filters,
  onChange,
  onReset,
  activeCount,
}: {
  leads: Lead[];
  masters: Masters;
  filters: LeadFilters;
  onChange: (f: LeadFilters) => void;
  onReset: () => void;
  activeCount: number;
}) {
  const set = (patch: Partial<LeadFilters>) => onChange({ ...filters, ...patch });

  const salesOptions = useMemo<MultiOption[]>(() => {
    const by = new Map<string, string>();
    for (const l of leads) if (!by.has(l.userId)) by.set(l.userId, l.salesperson);
    return [...by.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [leads]);

  const locationOptions = useMemo<MultiOption[]>(() => {
    const s = new Set<string>();
    for (const l of leads) if (l.location) s.add(l.location);
    return [...s].sort().map((v) => ({ value: v, label: v }));
  }, [leads]);

  const preset = (days: number | null) => {
    if (days === null) return set({ from: null, to: null });
    const d = new Date();
    d.setDate(d.getDate() - (days - 1));
    set({ from: dayKey(d), to: null });
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <svg className="text-orange" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5h18M6 12h12M10 19h4" /></svg>
          <span className="text-[13px] font-bold text-navy">Filters</span>
          {activeCount > 0 && <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-orange text-white text-[11px] font-semibold">{activeCount}</span>}
        </div>
        {activeCount > 0 && (
          <button onClick={onReset} className="text-[12.5px] font-semibold text-orange hover:underline">Clear all</button>
        )}
      </div>

      {/* Date range + presets */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[12px] text-grey-2">Captured</span>
        <input type="date" value={filters.from ?? ""} onChange={(e) => set({ from: e.target.value || null })} className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px] text-navy outline-none focus:border-orange" />
        <span className="text-grey-2 text-[13px]">→</span>
        <input type="date" value={filters.to ?? ""} onChange={(e) => set({ to: e.target.value || null })} className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px] text-navy outline-none focus:border-orange" />
        <div className="flex items-center gap-1 ml-1">
          {([["7d", 7], ["30d", 30], ["90d", 90], ["All", null]] as const).map(([label, days]) => (
            <button key={label} onClick={() => preset(days)} className="rounded-lg border border-line px-2 py-1 text-[11.5px] text-grey hover:border-orange/50 hover:text-orange transition">{label}</button>
          ))}
        </div>
      </div>

      {/* Multi-select filters */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2.5">
        <Field label="Salesperson"><MultiSelect values={filters.salespeople} onChange={(v) => set({ salespeople: v })} options={salesOptions} placeholder="All" /></Field>
        <Field label="Source"><MultiSelect values={filters.sources} onChange={(v) => set({ sources: v })} options={opts(masters, "source")} placeholder="Any" /></Field>
        <Field label="Interest"><MultiSelect values={filters.interests} onChange={(v) => set({ interests: v })} options={opts(masters, "interestLevels")} placeholder="Any" /></Field>
        <Field label="Category"><MultiSelect values={filters.categories} onChange={(v) => set({ categories: v })} options={opts(masters, "categories")} placeholder="Any" /></Field>
        <Field label="Asked about"><MultiSelect values={filters.askedAbout} onChange={(v) => set({ askedAbout: v })} options={opts(masters, "askedAbout")} placeholder="Any" /></Field>
        <Field label="Follow-up"><MultiSelect values={filters.followUps} onChange={(v) => set({ followUps: v })} options={opts(masters, "followUpActions")} placeholder="Any" /></Field>
        {locationOptions.length > 0 && <Field label="Location"><MultiSelect values={filters.locations} onChange={(v) => set({ locations: v })} options={locationOptions} placeholder="Any" /></Field>}
        <Field label="Voice note">
          <div className="flex rounded-xl border border-line overflow-hidden">
            {([["", "Any"], ["yes", "Yes"], ["no", "No"]] as const).map(([val, label]) => (
              <button key={val} onClick={() => set({ hasVoice: val })} className={cn("flex-1 px-2 py-2 text-[12.5px] transition", filters.hasVoice === val ? "bg-orange text-white font-semibold" : "bg-white text-grey hover:bg-page")}>{label}</button>
            ))}
          </div>
        </Field>
        <Field label="Search">
          <input value={filters.company} onChange={(e) => set({ company: e.target.value })} placeholder="Company or person…" className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-[14px] text-ink outline-none focus:border-orange focus:ring-4 focus:ring-orange/10" />
        </Field>
      </div>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wide text-grey-2 mb-1">{label}</label>
      {children}
    </div>
  );
}
