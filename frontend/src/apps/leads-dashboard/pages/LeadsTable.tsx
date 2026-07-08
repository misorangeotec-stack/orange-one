import { useState } from "react";
import Card from "@/shared/components/ui/Card";
import EmptyState from "@/shared/components/ui/EmptyState";
import Pagination from "@/shared/components/ui/Pagination";
import { usePagination } from "@/shared/lib/usePagination";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { formatDateDMY } from "@/shared/lib/date";
import FilterBar from "../components/FilterBar";
import LeadMediaDialog from "../components/LeadMediaDialog";
import { useLeads } from "../lib/LeadsProvider";
import { filtersKey, labelOf, colorOf, describeFilters } from "../lib/transforms";
import { exportLeadsToXlsx } from "../lib/exportLeads";
import type { Lead } from "../lib/types";

export default function LeadsTable() {
  const { leads, filtered, masters, loading, error, filters, setFilters, resetFilters, activeFilterCount } = useLeads();
  const pg = usePagination(filtered, { resetKey: filtersKey(filters) });
  const [active, setActive] = useState<Lead | null>(null);

  const salesName = (id: string) => leads.find((l) => l.userId === id)?.salesperson ?? id;
  const onExport = () => exportLeadsToXlsx(filtered, masters, describeFilters(filters, masters, salesName));

  if (loading) return <Card className="p-10 text-center text-[13px] text-grey-2">Loading leads…</Card>;
  if (error) return <Card className="p-8 text-center text-[13px] text-rose">Couldn’t load leads: {error}</Card>;
  if (leads.length === 0)
    return <EmptyState title="No leads captured yet" message="Leads scanned in the Orange One mobile app will appear here." />;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[20px] font-bold text-navy">All Leads</h1>
          <p className="text-[13px] text-grey-2 mt-0.5">{filtered.length} of {leads.length} shown</p>
        </div>
        <button
          onClick={onExport}
          disabled={filtered.length === 0}
          className="inline-flex items-center gap-2 rounded-xl bg-orange-grad text-white font-semibold text-[13px] px-4 py-2.5 shadow-cta hover:-translate-y-0.5 transition disabled:opacity-40 disabled:hover:translate-y-0"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>
          Export Excel
        </button>
      </div>

      <FilterBar leads={leads} masters={masters} filters={filters} onChange={setFilters} onReset={resetFilters} activeCount={activeFilterCount} />

      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState title="No leads match these filters" message="Adjust or clear the filters above." />
        ) : (
          <>
            <ScrollableTable className="rounded-t-card" maxHeight="max-h-[62vh]">
              <table className="w-full text-left border-collapse min-w-[960px]">
                <thead className="sticky top-0 z-10 bg-page">
                  <tr className="text-[11.5px] uppercase tracking-wide text-grey-2">
                    <Th>Company</Th>
                    <Th>Contact</Th>
                    <Th>Salesperson</Th>
                    <Th>Interest</Th>
                    <Th>Follow-up</Th>
                    <Th>Categories</Th>
                    <Th className="text-center">Media</Th>
                    <Th>Captured</Th>
                    <Th className="text-right">Details</Th>
                  </tr>
                </thead>
                <tbody>
                  {pg.pageItems.map((l) => {
                    const interest = labelOf(masters, "interestLevels", l.interestLevelId);
                    const interestColor = colorOf(masters, "interestLevels", l.interestLevelId);
                    const follow = labelOf(masters, "followUpActions", l.followUpActionId);
                    const cats = l.categoryIds.map((c) => labelOf(masters, "categories", c)).filter(Boolean);
                    const hasMedia = l.hasVoice || l.hasPhotos;
                    return (
                      <tr
                        key={l.id}
                        onClick={() => setActive(l)}
                        className="border-t border-line hover:bg-page/60 transition align-top cursor-pointer"
                      >
                        <Td><span className="font-semibold text-navy">{l.companyName || "—"}</span></Td>
                        <Td>
                          <div className="text-navy">{l.personName || "—"}</div>
                          <div className="text-[11.5px] text-grey-2">
                            {l.mobiles[0] || l.emails[0] || ""}
                            {l.peopleCount > 1 && <span className="ml-1.5 inline-flex items-center rounded-full bg-orange-soft text-orange px-1.5 text-[10.5px] font-semibold">+{l.peopleCount - 1}</span>}
                          </div>
                        </Td>
                        <Td><span className="text-navy">{l.salesperson}</span></Td>
                        <Td>
                          {interest ? (
                            <span className="inline-flex items-center gap-1.5 text-[12.5px] text-navy">
                              <span className="w-2 h-2 rounded-full" style={{ background: interestColor || "#94A3B8" }} />
                              {interest}
                            </span>
                          ) : <span className="text-grey-2">—</span>}
                        </Td>
                        <Td><span className="text-[12.5px] text-navy">{follow || <span className="text-grey-2">—</span>}</span></Td>
                        <Td>
                          {cats.length ? (
                            <div className="flex flex-wrap gap-1 max-w-[220px]">
                              {cats.slice(0, 2).map((c, i) => <span key={i} className="rounded-full bg-page border border-line px-2 py-0.5 text-[11px] text-navy">{c}</span>)}
                              {cats.length > 2 && <span className="text-[11px] text-grey-2">+{cats.length - 2}</span>}
                            </div>
                          ) : <span className="text-grey-2">—</span>}
                        </Td>
                        <Td className="text-center">
                          {hasMedia ? (
                            <span className="inline-flex items-center justify-center gap-2">
                              {l.hasVoice && (
                                <svg className="text-orange" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><title>Voice note</title><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M6 11a6 6 0 0 0 12 0M12 17v4" /></svg>
                              )}
                              {l.hasPhotos && (
                                <svg className="text-navy" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><title>Photos / card scan</title><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="10.5" r="1.5" /><path d="M21 16l-5-5-9 8" /></svg>
                              )}
                            </span>
                          ) : <span className="text-grey-2">—</span>}
                        </Td>
                        <Td><span className="text-[12.5px] text-grey-2 whitespace-nowrap">{formatDateDMY(l.capturedOn)}</span></Td>
                        <Td className="text-right">
                          <button
                            onClick={(e) => { e.stopPropagation(); setActive(l); }}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-semibold text-navy hover:border-orange hover:text-orange transition whitespace-nowrap"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>
                            View
                          </button>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollableTable>
            <Pagination state={pg} rowsLabel="leads" />
          </>
        )}
      </Card>

      <LeadMediaDialog lead={active} masters={masters} onClose={() => setActive(null)} />
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-2.5 font-semibold ${className}`}>{children}</th>;
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 text-[13px] ${className}`}>{children}</td>;
}
