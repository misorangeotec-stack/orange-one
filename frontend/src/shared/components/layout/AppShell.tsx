import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { cn } from "@/shared/lib/cn";
import { pageLabelFor } from "@/apps/currentApp";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import { HOME_LABEL, HOME_PATH, type NavItem, type NotificationItem, type ShellUser } from "./types";

/** Route back to the portal home, first item in every app's menu. */
const homeIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
    <path d="M9.5 21v-6h5v6" />
  </svg>
);
const HOME_ITEM: NavItem = { label: HOME_LABEL, to: HOME_PATH, icon: homeIcon };

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
  onMarkRead,
  roleSwitcher,
  banner,
  logoTo = HOME_PATH,
  showHomeLink = true,
}: {
  nav: NavItem[];
  role: string;
  user: ShellUser;
  notifications: NotificationItem[];
  /** Mark the given notification ids read (omit if the shell has no live notifications). */
  onMarkRead?: (ids: string[]) => void;
  roleSwitcher?: ReactNode;
  /** Optional banner rendered above the page content (e.g. a read-only notice). */
  banner?: ReactNode;
  logoTo?: string;
  /**
   * The home screen sets this false — it would otherwise link to itself. Every
   * other app leaves it on, which is the point: adding the route home HERE means
   * all eleven apps get it at once and a twelfth cannot forget it.
   */
  showHomeLink?: boolean;
}) {
  const [drawer, setDrawer] = useState(false);
  const { pathname } = useLocation();

  const items = useMemo(() => (showHomeLink ? [HOME_ITEM, ...nav] : nav), [showHomeLink, nav]);

  // Name of the current page — the breadcrumb's last step. Shared with the
  // Outstanding Dashboard's separate top strip so the two can't disagree.
  //
  // NULL when no menu item owns the page, and that matters: this used to fall
  // back to the literal "Dashboard", so a user without the Exit Cases menu who
  // opened an exit case read "Dashboard" at the top of the screen. The trail now
  // stops at the module rather than naming the page wrongly.
  const pageLabel = useMemo(() => pageLabelFor(pathname, items), [pathname, items]);

  return (
    <div className="h-screen flex bg-page-grad overflow-hidden">
      {/* desktop sidebar — owns its own width (resizable / collapsible to a rail) */}
      <aside className="hidden lg:block shrink-0 h-full">
        <Sidebar nav={items} role={role} logoTo={logoTo} />
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
          <Sidebar nav={items} role={role} logoTo={logoTo} onNavigate={() => setDrawer(false)} variant="drawer" />
        </div>
      </div>

      {/* main column */}
      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar
          pageLabel={pageLabel}
          user={user}
          notifications={notifications}
          onMarkRead={onMarkRead}
          roleSwitcher={roleSwitcher}
          onMenu={() => setDrawer(true)}
        />
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-[1180px] mx-auto px-4 sm:px-6 py-6">
            {banner}
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
