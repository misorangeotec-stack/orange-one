/**
 * Bushra-Dashboard — the landing page.
 *
 * The Reports landing page, in miniature: a rail of dashboard GROUPS on the left, the screens
 * inside the selected group on the right. Both read lib/bushraDashboards.ts, so a dashboard added
 * to that catalogue appears here, in the sidebar and in the breadcrumb without touching this file.
 *
 * `?group=` picks the group, exactly as `?cat=` does on Reports — a query, not a route, so the
 * sidebar can link straight to a group without inventing a URL per subject.
 */
import { Link, useSearchParams } from "react-router-dom";
import { ChevronRight, LayoutDashboard } from "lucide-react";
import { cn } from "@hub/lib/utils";
import {
  BUSHRA_DASHBOARDS, dashboardGroupById, dashboardHref, type BushraDashboardGroup,
} from "@hub/lib/bushraDashboards";

export default function BushraDashboards() {
  const [params, setParams] = useSearchParams();
  const selected: BushraDashboardGroup =
    dashboardGroupById(params.get("group")) ?? BUSHRA_DASHBOARDS[0];

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <LayoutDashboard className="h-6 w-6 text-primary" /> Bushra-Dashboard
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every dashboard built here, grouped by subject. Pick one to open it.
        </p>
      </div>

      <div className="flex flex-col items-start gap-5 lg:flex-row">
        {/* The rail — one row per GROUP, never per screen. */}
        <nav className="w-full shrink-0 lg:sticky lg:top-4 lg:w-60">
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
            {BUSHRA_DASHBOARDS.map((g) => {
              const active = g.id === selected.id;
              return (
                <li key={g.id}>
                  <button
                    type="button"
                    onClick={() => setParams({ group: g.id })}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors",
                      active ? "bg-primary/10 font-semibold text-primary" : "text-foreground hover:bg-muted/50",
                    )}
                  >
                    <g.icon className={cn("h-4 w-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
                    <span className="flex-1 truncate">{g.title}</span>
                    <span className="text-xs text-muted-foreground">{g.pages.length}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="w-full min-w-0 flex-1 space-y-2">
          <p className="text-sm text-muted-foreground">{selected.blurb}</p>
          <div className="overflow-hidden rounded-lg border border-border bg-surface divide-y divide-border">
            {selected.pages.map((p) => {
              const href = dashboardHref(p);
              const row = (
                <div className="flex items-center gap-3 px-4 py-3">
                  <p.icon className="h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-semibold text-foreground">{p.title}</div>
                    <div className="truncate text-[12px] text-muted-foreground">{p.purpose}</div>
                  </div>
                  {p.status === "soon" ? (
                    <span className="rounded-pill bg-muted px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">
                      Soon
                    </span>
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                </div>
              );
              return href ? (
                <Link key={p.id} to={href} className="block hover:bg-muted/40">{row}</Link>
              ) : (
                <div key={p.id} className="opacity-60">{row}</div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
