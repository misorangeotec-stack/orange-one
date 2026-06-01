import { BarChart3, Bell, ShieldAlert, FileText, Bookmark, User, Globe, PackageOpen, UserCheck, HandCoins, Settings as SettingsIcon } from "lucide-react";
import { NavLink } from "@hub/components/NavLink";
import { useLocation } from "react-router-dom";
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

// Base path of this app inside Orange One (see meta.tsx).
const BASE = "/outstanding-dashboard";

const navItems = [
  { title: "Dashboard", url: BASE, icon: BarChart3 },
  { title: "Risk Register", url: `${BASE}/risk-register`, icon: ShieldAlert },
  { title: "Salesperson Analysis", url: `${BASE}/salesperson-analysis`, icon: UserCheck },
  { title: "Salesperson Collection Report", url: `${BASE}/salesperson-collection`, icon: HandCoins },
  { title: "Import Data", url: `${BASE}/import`, icon: PackageOpen },
  { title: "Settings", url: `${BASE}/settings`, icon: SettingsIcon },
  // Hidden for client demo — restore when ready:
  // { title: "Alerts", url: `${BASE}/alerts`, icon: Bell },
  // { title: "Export Import Data", url: `${BASE}/exim`, icon: Globe },
  // { title: "Reports", url: `${BASE}/reports`, icon: FileText },
  // { title: "Saved Views", url: `${BASE}/saved-views`, icon: Bookmark },
  // { title: "Profile", url: `${BASE}/profile`, icon: User },
];

export function UserSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

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
