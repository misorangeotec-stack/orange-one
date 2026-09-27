import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import EmptyState from "@/shared/components/ui/EmptyState";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { formatDateDMY } from "@/shared/lib/date";
import FilterBar from "../components/FilterBar";
import LeadMediaDialog from "../components/LeadMediaDialog";
import { useLeads } from "../lib/LeadsProvider";
import { labelOf, colorOf, describeFilters } from "../lib/transforms";
import { exportLeadsToXlsx } from "../lib/exportLeads";
import type { Lead } from "../lib/types";

/**
 * Every lead the mobile app has captured.
 *
 * ⚠ ON `QueueTable` SINCE PF-20, and hand-built before that. It had no sort on any column and no
 *   filter under any of them — 188 leads with a filter BAR above and nothing else — which is the
 *   one thing CLAUDE.md says a grid may never ship without. Everything the old table did is still
 *   here: clicking the row opens the lead, the View button opens it too, the media icons, the
 *   category pills, an Excel export carrying the filter description, 25 a page, and the two empty
 *   states (no leads at all, versus none matching).
 *
 * ⚠ THE FILTER BAR ABOVE STAYS, and is not the same thing as the column filters. It holds the date
 *   window and the chips the sales team reads the dashboard by, and it produces `filtered` — which
 *   is where both this table and its export start.
 */
export default function LeadsTable() {
  const { leads, filtered, masters, loading, error, filters, setFilters, resetFilters, activeFilterCount } = useLeads();
  const [active, setActive] = useState<Lead | null>(null);

  const salesName = (id: string) => leads.find((l) => l.userId === id)?.salesperson ?? id;
  /**
   * ⚠ THE APP'S OWN EXPORT IS KEPT, rather than `QueueTable`'s. It writes FIFTEEN columns —
   *   job title, every other contact on the card, every mobile and email, Asked about, the
   *   capture location — and the table shows nine. Handing the export to the table would have
   *   quietly dropped six fields from a sheet the sales team already uses (FIX-4). It exports
   *   what the filter bar selected, as it always did.
   */
  const onExport = () => exportLeadsToXlsx(filtered, masters, describeFilters(filters, masters, salesName));

  const columns = useMemo<QueueColumn<Lead>[]>(() => {
    const catsOf = (l: Lead) => l.categoryIds.map((c) => labelOf(masters, "categories", c)).filter(Boolean);
    /** What the Media column says, in words, so it can be sorted, filtered and exported. */
    const mediaOf = (l: Lead) =>
      l.hasVoice && l.hasPhotos ? "Voice + photos" : l.hasVoice ? "Voice" : l.hasPhotos ? "Photos" : "—";

    return [
      {
        key: "company",
        header: "Company",
        alwaysVisible: true,
        cell: (l) => <span className="font-semibold text-navy">{l.companyName || "—"}</span>,
        sortValue: (l) => l.companyName || "",
        filter: { kind: "text", get: (l) => l.companyName || "" },
        exportValue: (l) => l.companyName || "",
      },
      {
        key: "contact",
        header: "Contact",
        // One line (PF-20): the number follows the name instead of sitting under it, and the
        // "+2" chip for the other people on the same card stays where it was.
        cell: (l) => (
          <span className="block truncate">
            <span className="text-navy">{l.personName || "—"}</span>
            {(l.mobiles[0] || l.emails[0]) && (
              <span className="ml-1.5 text-[11.5px] text-grey-2">{l.mobiles[0] || l.emails[0]}</span>
            )}
            {l.peopleCount > 1 && (
              <span className="ml-1.5 inline-flex items-center rounded-full bg-orange-soft px-1.5 text-[10.5px] font-semibold text-orange">
                +{l.peopleCount - 1}
              </span>
            )}
          </span>
        ),
        sortValue: (l) => l.personName || "",
        filter: { kind: "text", get: (l) => [l.personName, l.mobiles[0], l.emails[0]].filter(Boolean).join(" ") },
        exportValue: (l) => [l.personName, l.mobiles[0] || l.emails[0]].filter(Boolean).join(" · "),
      },
      {
        key: "salesperson",
        header: "Salesperson",
        cell: (l) => <span className="text-navy">{l.salesperson}</span>,
        sortValue: (l) => l.salesperson,
        filter: { kind: "select", get: (l) => l.salesperson },
      },
      {
        key: "source",
        header: "Source",
        cell: (l) => {
          const v = labelOf(masters, "source", l.sourceId);
          return <span className="text-[12.5px] text-navy">{v || <span className="text-grey-2">—</span>}</span>;
        },
        sortValue: (l) => labelOf(masters, "source", l.sourceId) || "",
        filter: { kind: "select", get: (l) => labelOf(masters, "source", l.sourceId) || "—" },
      },
      {
        key: "interest",
        header: "Interest",
        cell: (l) => {
          const v = labelOf(masters, "interestLevels", l.interestLevelId);
          if (!v) return <span className="text-grey-2">—</span>;
          return (
            <span className="inline-flex items-center gap-1.5 text-[12.5px] text-navy">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: colorOf(masters, "interestLevels", l.interestLevelId) || "#94A3B8" }}
              />
              {v}
            </span>
          );
        },
        sortValue: (l) => labelOf(masters, "interestLevels", l.interestLevelId) || "",
        filter: { kind: "select", get: (l) => labelOf(masters, "interestLevels", l.interestLevelId) || "—" },
      },
      {
        key: "followUp",
        header: "Follow-up",
        cell: (l) => {
          const v = labelOf(masters, "followUpActions", l.followUpActionId);
          return <span className="text-[12.5px] text-navy">{v || <span className="text-grey-2">—</span>}</span>;
        },
        sortValue: (l) => labelOf(masters, "followUpActions", l.followUpActionId) || "",
        filter: { kind: "select", get: (l) => labelOf(masters, "followUpActions", l.followUpActionId) || "—" },
      },
      {
        key: "categories",
        header: "Categories",
        // A search box rather than a picker: a lead carries SEVERAL categories at once, so a
        // picker would have to list every combination that occurs rather than the categories
        // themselves. Typing "ink" finds every lead tagged Ink, whatever else it carries.
        cell: (l) => {
          const cats = catsOf(l);
          if (!cats.length) return <span className="text-grey-2">—</span>;
          return (
            <span className="inline-flex items-center gap-1">
              {cats.slice(0, 2).map((c, i) => (
                <span key={i} className="rounded-full border border-line bg-page px-2 py-0.5 text-[11px] text-navy">
                  {c}
                </span>
              ))}
              {cats.length > 2 && <span className="text-[11px] text-grey-2">+{cats.length - 2}</span>}
            </span>
          );
        },
        sortValue: (l) => catsOf(l).join(" · "),
        filter: { kind: "text", get: (l) => catsOf(l).join(" · ") },
        exportValue: (l) => catsOf(l).join(" · "),
      },
      {
        key: "media",
        header: "Media",
        // Two icons — nothing to widen, and never cut.
        resize: false,
        cell: (l) => {
          if (!l.hasVoice && !l.hasPhotos) return <span className="text-grey-2">—</span>;
          return (
            <span className="inline-flex items-center gap-2">
              {l.hasVoice && (
                <svg className="text-orange" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><title>Voice note</title><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M6 11a6 6 0 0 0 12 0M12 17v4" /></svg>
              )}
              {l.hasPhotos && (
                <svg className="text-navy" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><title>Photos / card scan</title><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="10.5" r="1.5" /><path d="M21 16l-5-5-9 8" /></svg>
              )}
            </span>
          );
        },
        sortValue: (l) => mediaOf(l),
        filter: { kind: "select", get: mediaOf },
        exportValue: mediaOf,
      },
      {
        key: "captured",
        header: "Captured",
        // `capturedOn` can be null — a lead saved offline before its clock was read.
        cell: (l) => (
          <span className="whitespace-nowrap text-[12.5px] text-grey-2">
            {l.capturedOn ? formatDateDMY(l.capturedOn) : "—"}
          </span>
        ),
        sortValue: (l) => l.capturedOn ?? "",
        filter: { kind: "date", get: (l) => l.capturedOn?.slice(0, 10) ?? "" },
        exportValue: (l) => (l.capturedOn ? formatDateDMY(l.capturedOn) : ""),
      },
    ];
  }, [masters]);

  if (loading) return <Card className="p-10 text-center text-[13px] text-grey-2">Loading leads…</Card>;
  if (error) return <Card className="p-8 text-center text-[13px] text-rose">Couldn’t load leads: {error}</Card>;
  // Keyed on the UNFILTERED list: a filter matching nothing must still leave the table, and its
  // filter row, on screen (CLAUDE.md).
  if (leads.length === 0)
    return <EmptyState title="No leads captured yet" message="Leads scanned in the Orange One mobile app will appear here." />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-bold text-navy">All Leads</h1>
          <p className="mt-0.5 text-[13px] text-grey-2">
            {filtered.length} of {leads.length} shown
          </p>
        </div>
        <button
          onClick={onExport}
          disabled={filtered.length === 0}
          className="inline-flex items-center gap-2 rounded-xl bg-orange-grad px-4 py-2.5 text-[13px] font-semibold text-white shadow-cta transition hover:-translate-y-0.5 disabled:opacity-40 disabled:hover:translate-y-0"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>
          Export Excel
        </button>
      </div>

      <FilterBar leads={leads} masters={masters} filters={filters} onChange={setFilters} onReset={resetFilters} activeCount={activeFilterCount} />

      <QueueTable<Lead>
        rows={filtered}
        rowKey={(l) => l.id}
        columns={columns}
        onRowClick={setActive}
        actions={(l) => (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setActive(l);
            }}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-semibold text-navy transition hover:border-orange hover:text-orange"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>
            View
          </button>
        )}
        initialSort={{ key: "captured", dir: "desc" }}
        rowsLabel="leads"
        emptyTitle="No leads match these filters"
        emptyMessage="Adjust or clear the filters above."
      />

      <LeadMediaDialog lead={active} masters={masters} onClose={() => setActive(null)} />
    </div>
  );
}
