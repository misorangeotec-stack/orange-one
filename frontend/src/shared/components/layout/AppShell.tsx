import { useState } from "react";
import type { ReactNode } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { cn } from "@/shared/lib/cn";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import type { NavItem, NotificationItem, ShellUser } from "./types";

/**
 * Generic application shell: dark sidebar + sticky topbar + scrollable content.
 * App-agnostic — an app (e.g. Task Management) passes its nav, user, and
 * notifications. Renders nested routes via <Outlet/>. Responsive: the sidebar
 * collapses to a slide-in drawer below lg.
 */
export default function AppShell({
  nav,
  role,
  user,
  notifications,
  roleSwitcher,
  logoTo = "/home",
}: {
  nav: NavItem[];
  role: string;
  user: ShellUser;
  notifications: NotificationItem[];
  roleSwitcher?: ReactNode;
  logoTo?: string;
}) {
  const [drawer, setDrawer] = useState(false);
  const { pathname } = useLocation();

  // Page title = the deepest matching nav item's label.
  const match = [...nav]
    .filter((i) => pathname === i.to || pathname.startsWith(i.to + "/"))
    .sort((a, b) => b.to.length - a.to.length)[0];
  const title = match?.label ?? "Dashboard";

  return (
    <div className="h-screen flex bg-page-grad overflow-hidden">
      {/* desktop sidebar */}
      <aside className="hidden lg:block shrink-0">
        <Sidebar nav={nav} role={role} logoTo={logoTo} />
      </aside>

      {/* mobile drawer */}
      <div className={cn("lg:hidden fixed inset-0 z-50 transition", drawer ? "visible" : "invisible")}>
        <div
          className={cn("absolute inset-0 bg-navy/40 transition-opacity", drawer ? "opacity-100" : "opacity-0")}
          onClick={() => setDrawer(false)}
        />
        <div
          className={cn(
            "absolute left-0 top-0 h-full transition-transform duration-300",
            drawer ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <Sidebar nav={nav} role={role} logoTo={logoTo} onNavigate={() => setDrawer(false)} />
        </div>
      </div>

      {/* main column */}
      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar
          title={title}
          user={user}
          notifications={notifications}
          roleSwitcher={roleSwitcher}
          onMenu={() => setDrawer(true)}
        />
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-[1180px] mx-auto px-4 sm:px-6 py-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

export type { NavItem, NotificationItem, ShellUser } from "./types";

/** Re-export so apps can type their nav without reaching into ./types. */
export type AppShellProps = { children?: ReactNode };
