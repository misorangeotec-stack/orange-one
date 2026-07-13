import { Outlet, useLocation } from "react-router-dom";
import { Radio } from "lucide-react";
import { SidebarProvider, SidebarTrigger } from "@hub/components/ui/sidebar";
import { UserSidebar } from "@hub/components/UserSidebar";
import { useAppData } from "@hub/lib/useAppData";
import { FYMultiSelect } from "@hub/components/FYMultiSelect";
import { useFY } from "@hub/lib/fyContext";
import { useLiveMode } from "@hub/lib/liveMode";
import UserMenu from "@/shared/components/layout/UserMenu";
import { useSession } from "@/core/platform/session";
import type { AppRole } from "@/core/platform/types";

const ROLE_LABEL: Record<AppRole, string> = { admin: "Admin", hod: "HOD", sub_hod: "Sub-HOD", employee: "Employee" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Format an ISO date ("2026-05-28") as "28 May 2026" without timezone drift. */
function formatAsOf(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${parseInt(m[3], 10)} ${MONTHS[parseInt(m[2], 10) - 1]} ${m[1]}`;
}

/**
 * Format the last-refresh stamp as "28 May 2026, 2:30 PM" (12-hour).
 *
 * The pipeline writes the timestamp as IST wall-clock but tags it "+00:00" (e.g.
 * "2026-06-29T12:55:38+00:00" is actually 12:55 PM IST, not UTC). So we read the date/time
 * components LITERALLY via regex — no `new Date()`, no timezone conversion — which keeps the
 * displayed time identical to the wall clock the pipeline recorded.
 *
 * When the value carries no time component (e.g. a date-only as-of date), falls back to the
 * drift-free date-only `formatAsOf` so we never render a spurious "12:00 AM".
 */
function formatAsOfDateTime(input: string): string {
  if (!input) return "";
  const s = String(input).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(s);
  if (m) {
    const hour = parseInt(m[4], 10);
    const ampm = hour >= 12 ? "PM" : "AM";
    const h12 = hour % 12 || 12;
    return `${parseInt(m[3], 10)} ${MONTHS[parseInt(m[2], 10) - 1]} ${m[1]}, ${h12}:${m[5]} ${ampm}`;
  }
  return formatAsOf(s);
}

/**
 * Routes that IGNORE the financial-year selector because they read the whole book by design.
 *
 * The Overdue Aging report is pinned to Both FYs: a single financial year cannot contain a
 * 120-day-old invoice until it is itself 120 days old, so an FY-scoped view of "overdue > 120
 * days" silently becomes 100% brought-forward debt.
 *
 * The Dormant Debtors report is pinned for the same class of reason: its window is the last N
 * months of the FY-scoped month vocabulary, so inside a young FY "no sales in 6 months" quietly
 * collapses to "no sales in 3" — and a customer who last bought in February gets reported as
 * having never bought at all. Dormancy is a property of the whole book.
 *
 * Each page enforces this with its own nested FYProvider; hiding the selector here is what stops
 * the topbar from claiming otherwise.
 */
const FY_PINNED_ROUTES = [
  "/outstanding-dashboard/reports/overdue",
  "/outstanding-dashboard/reports/dormant",
  // The Category Report's balance/aging half is a property of the whole book, while its
  // sales/collections half has its own period selector on the page. An FY selector in the topbar
  // would be claiming to drive both, and would drive neither.
  "/outstanding-dashboard/reports/category",
];

export default function UserLayout() {
  const { dashboard } = useAppData({});
  const { label: fyLabel } = useFY();
  const { user, role } = useSession();
  const { liveMode, setLiveMode, canUseLive } = useLiveMode();
  const { pathname } = useLocation();
  const fyPinned = FY_PINNED_ROUTES.some((r) => pathname.startsWith(r));

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-surface-alt">
        <UserSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className={`h-14 flex items-center gap-3 border-b px-4 ${liveMode ? "border-emerald-300 bg-emerald-50/60" : "border-border bg-surface"}`}>
            <SidebarTrigger className="text-foreground" />
            <span className="text-sm font-semibold text-foreground">Dashboard</span>
            {liveMode && (
              <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-100 border border-emerald-300 rounded px-1.5 py-0.5">
                Live · Tally
              </span>
            )}
            <span className="text-xs text-muted-foreground hidden sm:inline">
              · {fyPinned ? "Both FYs" : fyLabel}
            </span>
            <div className="ml-auto flex items-center gap-3">
              {/* Admin-only: flip the WHOLE hub between the pipeline source and the ConnectWave
                  live-Tally snapshot. One switch instead of duplicating every menu (see lib/liveMode). */}
              {canUseLive && (
                <button
                  type="button"
                  onClick={() => setLiveMode(!liveMode)}
                  title={liveMode ? "Showing live Tally data — click to return to the standard view" : "Switch to live Tally data"}
                  className={`inline-flex items-center gap-1.5 h-8 rounded-full border px-3 text-xs font-semibold transition-colors ${
                    liveMode
                      ? "bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700"
                      : "bg-transparent border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  }`}
                >
                  <Radio className={`h-3.5 w-3.5 ${liveMode ? "animate-pulse" : ""}`} />
                  {liveMode ? "Live (Tally) ON" : "Live (Tally)"}
                </button>
              )}
              {(dashboard?.lastUpdated || dashboard?.asOfDate) && (
                <span className="text-xs text-muted-foreground hidden md:inline whitespace-nowrap">
                  Data updated as of{" "}
                  <span className="font-medium text-foreground">
                    {formatAsOfDateTime(dashboard.lastUpdated || dashboard.asOfDate)}
                  </span>
                </span>
              )}
              {/* Hidden on the FY-pinned reports — see FY_PINNED_ROUTES. Showing a selector that
                  cannot change the numbers below it is worse than showing none. */}
              {!fyPinned && <FYMultiSelect />}
              <div className="h-6 w-px bg-border hidden sm:block" />
              <UserMenu
                user={{ name: user.name, designation: user.designation, color: user.avatarColor, roleLabel: ROLE_LABEL[role] ?? role }}
              />
            </div>
          </header>
          <main className="flex-1 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
