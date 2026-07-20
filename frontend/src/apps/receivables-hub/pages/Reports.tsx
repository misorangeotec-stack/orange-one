import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronRight, FileText, Search } from "lucide-react";
import { Badge } from "@hub/components/ui/badge";
import { Input } from "@hub/components/ui/input";
import {
  REPORT_CATEGORIES,
  categoryById,
  reportHref,
  reportsInCategory,
  searchReports,
  subcategoriesInCategory,
  type ReportCategoryId,
  type ReportEntry,
} from "@hub/lib/reportCatalog";

/**
 * The report catalogue.
 *
 * A category rail beside a dense list, not a grid of cards. The card grid this replaced
 * carried a 3–6 line description per report, which at ten reports already read as a wall
 * of boxes and would not have survived the twenty this app is heading for. The long copy
 * now lives on each report's own page, where it is read in context.
 *
 * Every row comes from lib/reportCatalog — the same list that builds the sidebar sub-nav
 * and the breadcrumb trail, so the three can never disagree about what exists.
 */

/** Which pipeline the numbers come from. Flipping a catalogue field flips this pill. */
function SourcePill({ source }: { source: ReportEntry["source"] }) {
  const tally = source === "tally";
  return (
    <Badge
      variant="outline"
      className={`text-[10px] px-1.5 py-0 rounded-button uppercase tracking-wide shrink-0 ${
        tally
          ? "text-emerald-700 border-emerald-300 bg-emerald-50"
          : "text-muted-foreground border-border bg-muted/50"
      }`}
    >
      {tally ? "Tally" : "Pipeline"}
    </Badge>
  );
}

function ReportRow({ report, categoryLabel }: { report: ReportEntry; categoryLabel?: string }) {
  const live = report.status === "live" && report.path;

  const body = (
    <>
      <div
        className={`w-9 h-9 rounded-button flex items-center justify-center shrink-0 ${
          live ? "bg-primary/15" : "bg-muted"
        }`}
      >
        <report.icon className={`h-4 w-4 ${live ? "text-primary" : "text-muted-foreground"}`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground truncate">{report.title}</span>
          {categoryLabel && (
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">
              {categoryLabel}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate mt-0.5">{report.purpose}</p>
      </div>
      <SourcePill source={report.source} />
      {live ? (
        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
      ) : (
        <Badge
          variant="outline"
          className="text-[10px] px-1.5 py-0 rounded-button uppercase bg-muted text-muted-foreground border-border shrink-0"
        >
          Coming soon
        </Badge>
      )}
    </>
  );

  const className = "flex items-center gap-3 px-4 py-3 min-h-14";

  return live ? (
    <Link to={reportHref(report)} className={`${className} hover:bg-muted/50 transition-colors`}>
      {body}
    </Link>
  ) : (
    <div className={`${className} opacity-60`}>{body}</div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 py-2 bg-muted/30 border-b border-border text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}

export default function Reports() {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");

  const selected: ReportCategoryId =
    (categoryById(params.get("cat") ?? "")?.id as ReportCategoryId) ?? REPORT_CATEGORIES[0].id;

  const searching = query.trim().length > 0;
  const matches = useMemo(() => searchReports(query), [query]);

  const pick = (id: ReportCategoryId) => {
    setQuery("");
    setParams({ cat: id });
  };

  const category = categoryById(selected)!;
  const rows = reportsInCategory(selected);
  const subcategories = subcategoriesInCategory(selected);

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <FileText className="h-6 w-6 text-primary" /> Reports
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every report in the dashboard, grouped by what it answers. Pick one to open it.
        </p>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search reports…"
          className="pl-9 h-9 rounded-input"
        />
      </div>

      <div className="flex flex-col lg:flex-row gap-5 items-start">
        {/* Category rail. Hidden while searching — results deliberately cut across
            categories, so a highlighted rail item would be claiming otherwise. */}
        {!searching && (
          <nav className="w-full lg:w-52 shrink-0 lg:sticky lg:top-4">
            <ul className="rounded-lg border border-border bg-surface overflow-hidden divide-y divide-border">
              {REPORT_CATEGORIES.map((c) => {
                const active = c.id === selected;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => pick(c.id)}
                      className={`w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors ${
                        active
                          ? "bg-primary/10 text-primary font-semibold"
                          : "text-foreground hover:bg-muted/50"
                      }`}
                    >
                      <c.icon className={`h-4 w-4 shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`} />
                      <span className="flex-1 truncate">{c.title}</span>
                      <span className="text-xs text-muted-foreground">{reportsInCategory(c.id).length}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}

        <div className="flex-1 min-w-0 w-full">
          {searching ? (
            <div className="rounded-lg border border-border bg-surface overflow-hidden">
              <SectionHeading>
                {matches.length} {matches.length === 1 ? "report" : "reports"} matching “{query.trim()}”
              </SectionHeading>
              {matches.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  Nothing matches that. Try a customer term like “overdue”, “DSO” or “balance sheet”.
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {matches.map((r) => (
                    <ReportRow key={r.id} report={r} categoryLabel={categoryById(r.category)?.title} />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">{category.blurb}</p>
              <div className="rounded-lg border border-border bg-surface overflow-hidden">
                {subcategories.length > 0 ? (
                  subcategories.map((s) => (
                    <div key={s.id}>
                      <SectionHeading>{s.title}</SectionHeading>
                      <div className="divide-y divide-border">
                        {rows
                          .filter((r) => r.subcategory === s.id)
                          .map((r) => (
                            <ReportRow key={r.id} report={r} />
                          ))}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="divide-y divide-border">
                    {rows.map((r) => (
                      <ReportRow key={r.id} report={r} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
