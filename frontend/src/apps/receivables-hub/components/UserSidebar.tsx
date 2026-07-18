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

export function UserSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { isAdmin, user } = useSession();
  // Admins see every menu; a non-admin sees everything not in their deny-list
  // (profiles.receivables_hidden_menus, set by an admin in Settings → Menu Permissions).
  const navItems = visibleMenusFor(isAdmin, user.receivablesHiddenMenus ?? []);

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
                    className="text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent rounded-button transition-colors"
                    activeClassName="!bg-primary/15 !text-primary font-semibold"
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
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end
                      className="text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent rounded-button transition-colors"
                      activeClassName="!bg-primary/15 !text-primary font-semibold"
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
      </SidebarContent>
    </Sidebar>
  );
}
