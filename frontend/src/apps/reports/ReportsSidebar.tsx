import { Link, useLocation, useSearchParams } from "react-router-dom";
import { Home, LayoutGrid } from "lucide-react";
import { NavLink } from "@hub/components/NavLink";
import { HOME_LABEL, HOME_PATH } from "@/shared/components/layout/types";
import { useSession } from "@/core/platform/session";
import { canSeeMenu } from "@hub/lib/menus";
import { useReportAccess } from "@hub/lib/reportAccess";
import {
  REPORT_CATEGORIES,
  categoryHref,
  findReport,
  reportCategoriesFor,
} from "@hub/lib/reportCatalog";
import {
  BUSHRA_DASHBOARDS,
  dashboardGroupHref,
  groupPageIds,
  groupPaths,
  type BushraDashboardGroup,
} from "@hub/lib/bushraDashboards";
import { appBasePath } from "@/apps/appInfo";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@hub/components/ui/sidebar";

const LINK_CLASS =
  "text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent rounded-button transition-colors";
const ACTIVE_CLASS = "!bg-primary/15 !text-primary font-semibold";
const ACTIVE_ROW_CLASS = "bg-primary/15 text-primary font-semibold";

const BASE = appBasePath("reports");
const DASHBOARDS_HOME = `${BASE}/bushra-dashboard`;

/**
 * Left nav for the standalone Reports app.
 *
 * This is what the Outstanding Dashboard's "Reports" and "Bushra-Dashboard" menus used to
 * be, with one tier removed from each: the sections that were children of a collapsible
 * parent are now top-level rows, because the app itself is the parent. Nothing else about
 * them changed — same order, same icons, same per-report grants deciding what appears.
 *
 * TWO THINGS A PLAIN NavLink CANNOT DO HERE, both inherited from the menus this replaced:
 *
 *  1. Several rows point at the SAME path and differ only by a query string — every report
 *     category is `/reports?cat=…`, every dashboard group is
 *     `/reports/bushra-dashboard?group=…`. React Router's NavLink ignores the query, so
 *     `activeClassName` would light up every row in the set at once.
 *  2. The active row is read from the CATALOGUES, not just the query — so sitting on
 *     /reports/balance-sheet highlights "Tally Reports", and sitting on a Sales dashboard
 *     highlights its "Sales" group, rather than nothing.
 */
export function ReportsSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { pathname, search } = useLocation();
  const [params] = useSearchParams();
  const { isAdmin, user } = useSession();
  const { allowedIds } = useReportAccess();

  // ── Reports: the catalogue's sections ──────────────────────────────────────────────────
  // A section the viewer holds no report in is dropped, exactly as the sub-nav dropped it —
  // the sidebar never offers a section that opens on an empty list.
  const categories = reportCategoriesFor(allowedIds);
  const activeCategory =
    pathname === BASE
      ? (params.get("cat") ?? REPORT_CATEGORIES[0].id)
      : (findReport(pathname, search)?.category ?? null);

  // ── Bushra-Dashboard: its own menu key, and its own grants ─────────────────────────────
  // Both gates are the ones it had in the hub. The key is still registered over there
  // (lib/menus.tsx, flagged `externalApp`) precisely so an admin's existing setting keeps
  // applying after the move.
  const holdsGroup = (g: BushraDashboardGroup) => groupPageIds(g).some((id) => allowedIds.has(id));
  const dashboardGroups =
    canSeeMenu(isAdmin, user.receivablesHiddenMenus ?? [], "bushra-dashboard")
      ? BUSHRA_DASHBOARDS.filter(holdsGroup)
      : [];
  // A group is active while the reader is on any of ITS pages — the group's own link carries
  // a `?group=`, so path equality alone would leave it dark the moment a dashboard opened.
  const activeGroup =
    BUSHRA_DASHBOARDS.find((g) => groupPaths(g).some((p) => pathname === p || pathname.startsWith(`${p}/`)))
      ?.id ?? (pathname === DASHBOARDS_HOME ? params.get("group") : null);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-button bg-gradient-to-br from-primary to-primary-hover flex items-center justify-center shrink-0">
            <span className="text-primary-foreground font-bold text-sm">RP</span>
          </div>
          {!collapsed && (
            <span className="text-sidebar-foreground font-bold text-base tracking-tight">Reports</span>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        {/*
          The route back to the portal. Deliberately outside the grant-filtered lists below,
          for the same reason the hub keeps its own copy outside `visibleMenusFor`: this app
          does not use the shared AppShell, so this is the reader's only way out of it — and a
          user granted nothing would otherwise be left on a sidebar with no links at all.
        */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink to={HOME_PATH} end className={LINK_CLASS} activeClassName={ACTIVE_CLASS}>
                    <Home className="h-4 w-4 shrink-0" />
                    {!collapsed && <span>{HOME_LABEL}</span>}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {categories.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-sidebar-foreground/50 uppercase text-[11px] tracking-wider font-semibold">
              Reports
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {/* The unfiltered catalogue, which the collapsible parent used to be. Active only
                    on a bare /reports — with a `?cat=` the section below owns the highlight, which
                    is why this cannot be a NavLink either. */}
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    className={`${LINK_CLASS} ${pathname === BASE && !params.get("cat") ? ACTIVE_ROW_CLASS : ""}`}
                  >
                    <Link to={BASE}>
                      <LayoutGrid className="h-4 w-4 shrink-0" />
                      {!collapsed && <span>All Reports</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>

                {categories.map((c) => (
                  <SidebarMenuItem key={c.id}>
                    <SidebarMenuButton
                      asChild
                      className={`${LINK_CLASS} ${activeCategory === c.id ? ACTIVE_ROW_CLASS : ""}`}
                    >
                      <Link to={categoryHref(c.id)}>
                        <c.icon className="h-4 w-4 shrink-0" />
                        {!collapsed && <span>{c.title}</span>}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {dashboardGroups.length > 0 && !collapsed && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-sidebar-foreground/50 uppercase text-[11px] tracking-wider font-semibold">
              Bushra-Dashboard
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {dashboardGroups.map((g) => {
                  const on = activeGroup === g.id;
                  // The screens inside the open group, so a reader can hop between them
                  // (Sales → Ink → FOC …) without going back through the landing page. Only the
                  // ones they hold: `groupPageIds` is filtered by the same grants as the group.
                  const pages = on
                    ? g.pages.filter((p) => p.status === "live" && p.path && allowedIds.has(p.id))
                    : [];
                  return (
                    <SidebarMenuItem key={g.id} className="flex-col items-stretch">
                      <SidebarMenuButton
                        asChild
                        // A group showing its pages does not light up itself, so exactly one row —
                        // the page you are on — carries the highlight.
                        className={`${LINK_CLASS} ${on && !pages.some((p) => pathname === `${BASE}/${p.path}`) ? ACTIVE_ROW_CLASS : ""}`}
                      >
                        <Link to={dashboardGroupHref(g.id)}>
                          <g.icon className="h-4 w-4 shrink-0" />
                          <span className="truncate">{g.title}</span>
                        </Link>
                      </SidebarMenuButton>
                      {pages.length > 0 && (
                        <ul className="ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-sidebar-border pl-2">
                          {pages.map((p) => {
                            const url = `${BASE}/${p.path}`;
                            const here = pathname === url || pathname.startsWith(`${url}/`);
                            return (
                              <li key={p.id}>
                                <Link
                                  to={url}
                                  className={`block truncate rounded-button px-2 py-1 text-[12px] transition-colors ${
                                    here
                                      ? "bg-primary/15 font-semibold text-primary"
                                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                                  }`}
                                >
                                  {p.title}
                                </Link>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
    </Sidebar>
  );
}
