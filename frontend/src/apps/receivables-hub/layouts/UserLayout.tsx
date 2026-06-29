import { Outlet } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@hub/components/ui/sidebar";
import { UserSidebar } from "@hub/components/UserSidebar";
import { useAppData } from "@hub/lib/useAppData";
import { FYMultiSelect } from "@hub/components/FYMultiSelect";
import { useFY } from "@hub/lib/fyContext";
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

export default function UserLayout() {
  const { dashboard } = useAppData({});
  const { label: fyLabel } = useFY();
  const { user, role } = useSession();

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-surface-alt">
        <UserSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center gap-3 border-b border-border bg-surface px-4">
            <SidebarTrigger className="text-foreground" />
            <span className="text-sm font-semibold text-foreground">Dashboard</span>
            <span className="text-xs text-muted-foreground hidden sm:inline">· {fyLabel}</span>
            <div className="ml-auto flex items-center gap-3">
              {(dashboard?.lastUpdated || dashboard?.asOfDate) && (
                <span className="text-xs text-muted-foreground hidden md:inline whitespace-nowrap">
                  Data updated as of{" "}
                  <span className="font-medium text-foreground">
                    {formatAsOfDateTime(dashboard.lastUpdated || dashboard.asOfDate)}
                  </span>
                </span>
              )}
              <FYMultiSelect />
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
