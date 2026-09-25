import { Home } from "lucide-react";
import { NavLink } from "@hub/components/NavLink";
import { useSession } from "@/core/platform/session";
import { HOME_LABEL, HOME_PATH } from "@/shared/components/layout/types";
import { visibleMenusFor } from "@hub/lib/menus";
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

/*
 * THE SUB-NAV COMPONENT THAT USED TO BE HERE went with the two menus that used it. Reports and
 * Bushra-Dashboard both moved to apps/reports/, which draws their tiers in its own sidebar —
 * and draws them better, since the section it used to be a tier UNDER is now the app itself.
 * Nothing left in this app's nav is more than one level deep, so the collapsible is gone
 * rather than kept warm: a generic component with no caller drifts out of date unnoticed.
 */

export function UserSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { isAdmin, user } = useSession();
  // Admins see every menu; a non-admin sees everything not in their deny-list
  // (profiles.receivables_hidden_menus, set by an admin in Admin → Users or in
  // Settings → Permissions). The second list is the full-access allow-list, which now only
  // decides whether Settings is worth showing at all.
  //
  // The per-report grants used to be a third input here, shaping the Reports and
  // Bushra-Dashboard sub-navs. Both menus moved to apps/reports/ and took that rule with
  // them, so this list is back to being decided by the two menu columns alone.
  const navItems = visibleMenusFor(
    isAdmin,
    user.receivablesHiddenMenus ?? [],
    user.receivablesAdminMenus ?? [],
  );
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
              {regularItems.map((item) => (
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
              ))}
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
