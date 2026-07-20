import { useEffect, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";
import { NavLink } from "@hub/components/NavLink";
import { useSession } from "@/core/platform/session";
import { HOME_LABEL, HOME_PATH } from "@/shared/components/layout/types";
import { BASE, visibleMenusFor, type ReceivablesMenu } from "@hub/lib/menus";
import { REPORT_CATEGORIES, findReport } from "@hub/lib/reportCatalog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@hub/components/ui/collapsible";
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@hub/components/ui/sidebar";

const LINK_CLASS =
  "text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent rounded-button transition-colors";
const ACTIVE_CLASS = "!bg-primary/15 !text-primary font-semibold";

/**
 * A menu with a sub-nav (today: Reports → its categories).
 *
 * Two things this has to get right that a plain NavLink cannot:
 *
 *  1. Every category link points at the SAME path (`/reports`) and differs only by `?cat=`.
 *     React Router's NavLink ignores the query string, so `activeClassName` would light up
 *     every child at once. Active state is therefore computed here and passed to
 *     `SidebarMenuSubButton isActive`.
 *  2. The active category is read from the CATALOGUE, not just the query — so sitting on
 *     /reports/balance-sheet highlights "Tally Reports" rather than nothing.
 *
 * `SidebarMenuSub` already carries `group-data-[collapsible=icon]:hidden`, so the icon-only
 * collapsed sidebar hides the children without anything from us.
 */
function CollapsibleMenu({ item }: { item: ReceivablesMenu }) {
  const { pathname, search } = useLocation();
  const [params] = useSearchParams();

  const inSection = pathname === item.url || pathname.startsWith(`${item.url}/`);
  const [open, setOpen] = useState(inSection);
  // Entering the section opens the group; leaving it does not force it shut, so a user
  // who expanded it deliberately keeps it expanded.
  useEffect(() => {
    if (inSection) setOpen(true);
  }, [inSection]);

  const activeCategory =
    pathname === `${BASE}/reports`
      ? (params.get("cat") ?? REPORT_CATEGORIES[0].id)
      : (findReport(pathname, search)?.category ?? null);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <SidebarMenuItem>
        {/* Deliberately no `end`: the parent should stay lit on /reports/aging too. */}
        <SidebarMenuButton asChild>
          <NavLink to={item.url} className={LINK_CLASS} activeClassName={ACTIVE_CLASS}>
            <item.icon className="h-4 w-4 shrink-0" />
            <span>{item.title}</span>
          </NavLink>
        </SidebarMenuButton>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            aria-label={open ? `Collapse ${item.title}` : `Expand ${item.title}`}
            className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-button text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground group-data-[collapsible=icon]:hidden"
          >
            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {(item.children ?? []).map((child) => (
              <SidebarMenuSubItem key={child.key}>
                <SidebarMenuSubButton
                  asChild
                  isActive={activeCategory === child.key.split(":")[1]}
                  className="text-sidebar-foreground/70 data-[active=true]:!bg-primary/15 data-[active=true]:!text-primary data-[active=true]:font-semibold"
                >
                  <Link to={child.url}>
                    {child.icon && <child.icon className="h-3.5 w-3.5 shrink-0" />}
                    <span>{child.title}</span>
                  </Link>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

export function UserSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { isAdmin, user } = useSession();
  // Admins see every menu; a non-admin sees everything not in their deny-list
  // (profiles.receivables_hidden_menus, set by an admin in Settings → Menu Permissions).
  // Sub-nav children are gated by their PARENT's key — see ReceivablesMenuChild.
  const navItems = visibleMenusFor(isAdmin, user.receivablesHiddenMenus ?? []);
  // Admin-only menus are parked in their own "Hidden" section at the bottom so they read as
  // out-of-the-way tools rather than part of the everyday nav. `visibleMenusFor` already drops them
  // for non-admins, so `hiddenItems` is simply empty for everyone else and the section never renders.
  const regularItems = navItems.filter((m) => !m.adminOnly);
  const hiddenItems = navItems.filter((m) => m.adminOnly);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-button bg-gradient-to-br from-primary to-primary-hover flex items-center justify-center shrink-0">
            <span className="text-primary-foreground font-bold text-sm">RC</span>
          </div>
          {!collapsed && (
            <span className="text-sidebar-foreground font-bold text-base tracking-tight">
              Receivables Control
            </span>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        {/*
          The route back to the portal, deliberately OUTSIDE `visibleMenusFor`.
          That list is filtered by the per-user deny-list an admin edits in
          Settings → Menu Permissions; putting this in it would let an admin hide
          a user's only way out of this app — the Hub does not use the shared
          AppShell, so it has no other home link anywhere.
        */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink
                    to={HOME_PATH}
                    end
                    className={LINK_CLASS}
                    activeClassName={ACTIVE_CLASS}
                  >
                    <Home className="h-4 w-4 shrink-0" />
                    {!collapsed && <span>{HOME_LABEL}</span>}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/50 uppercase text-[11px] tracking-wider font-semibold">
            Navigation
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {regularItems.map((item) =>
                item.children?.length && !collapsed ? (
                  <CollapsibleMenu key={item.key} item={item} />
                ) : (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={item.url}
                        end
                        className={LINK_CLASS}
                        activeClassName={ACTIVE_CLASS}
                      >
                        <item.icon className="h-4 w-4 shrink-0" />
                        {!collapsed && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ),
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/*
          Admin-only "Hidden" tools. Only admins ever reach this (visibleMenusFor drops adminOnly
          menus for everyone else), so the whole group is absent for non-admins. Each entry carries a
          "Hidden" tag so it's clear these are parked, not part of the live nav.
        */}
        {hiddenItems.length > 0 && !collapsed && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-sidebar-foreground/50 uppercase text-[11px] tracking-wider font-semibold">
              Hidden · Admin only
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {hiddenItems.map((item) => (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={item.url}
                        end
                        className={LINK_CLASS}
                        activeClassName={ACTIVE_CLASS}
                      >
                        <item.icon className="h-4 w-4 shrink-0" />
                        <span className="flex-1">{item.title}</span>
                        <span className="ml-auto rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide bg-sidebar-foreground/10 text-sidebar-foreground/60">
                          Hidden
                        </span>
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
    </Sidebar>
  );
}
