import { Outlet, useLocation } from "react-router-dom";
import { Radio } from "lucide-react";
import { SidebarProvider, SidebarTrigger } from "@hub/components/ui/sidebar";
import { UserSidebar } from "@hub/components/UserSidebar";
import { useAppData } from "@hub/lib/useAppData";
import { FYMultiSelect } from "@hub/components/FYMultiSelect";
import { useFY } from "@hub/lib/fyContext";
import { useLiveMode } from "@hub/lib/liveMode";
import UserMenu from "@/shared/components/layout/UserMenu";
import AnnouncementStrip from "@/core/announcements/AnnouncementStrip";
import Breadcrumbs from "@/shared/components/layout/Breadcrumbs";
import CustomerBell from "@hub/components/customerOnboarding/CustomerBell";
import { RECEIVABLES_MENUS } from "@hub/lib/menus";
import { reportCrumbs } from "@hub/lib/reportCatalog";
import { formatAsOfDateTime } from "@hub/lib/asOfFormat";
import { pageLabelFor } from "@/apps/currentApp";
import { useSession } from "@/core/platform/session";
import type { AppRole } from "@/core/platform/types";

const ROLE_LABEL: Record<AppRole, string> = { admin: "Admin", hod: "HOD", sub_hod: "Sub-HOD", employee: "Employee" };

/**
 * Routes that IGNORE the financial-year selector, because the screen either reads the whole
 * book by design or carries a period control of its own. Showing a selector that cannot
 * change the numbers below it is worse than showing none.
 *
 * Each such page enforces the period itself (its own nested FYProvider, or its own pickers);
 * hiding the selector here is what stops the topbar from claiming otherwise.
 */
const FY_PINNED_ROUTES = [
  // Customer Onboarding reads the IDENTITY project, not the receivables data the
  // FY selector scopes — a financial year means nothing to a customer's KYC form,
  // and a control that cannot change what is below it is worse than no control.
  // One entry covers the subtree (the match is a prefix test).
  "/outstanding-dashboard/customer-onboarding",
];

/*
 * ONE ENTRY IS ALL THAT IS LEFT. The other twenty-six — every report, and Bushra-Dashboard —
 * moved with their screens to apps/reports/ReportsLayout.tsx. Each of them named an
 * /outstanding-dashboard/… path this app no longer serves, so keeping them would have left a
 * list of prefixes that can never match, read by the next editor as if it still meant
 * something.
 */

export default function UserLayout() {
  const { dashboard } = useAppData({});
  const { label: fyLabel } = useFY();
  const { user, role } = useSession();
  const { liveMode, setLiveMode, canUsePipeline } = useLiveMode();
  const { pathname, search } = useLocation();
  const fyPinned = FY_PINNED_ROUTES.some((r) => pathname.startsWith(r));

  // Page step(s) for the breadcrumb.
  //
  // Reports get a THREE-step tail from the catalogue ("Reports → Tally Reports → Balance
  // Sheet"); a single menu label could only ever say "Reports", which is what every
  // /reports/* page used to read as. `reportCrumbs` returns null off the catalogue, and
  // we fall back to the same longest-match the rest of the portal uses.
  //
  // That fallback deliberately reads the UNFILTERED menu list: menus can be hidden per
  // user, and matching the filtered list would blank the trail for someone sitting on a
  // page whose menu entry is hidden from them.
  //
  // Null when nothing matches (a customer, a group, Saved Views, Profile) — the trail
  // then stops at the module rather than inventing a page name.
  const pageLabel =
    reportCrumbs(pathname, search) ??
    pageLabelFor(
      pathname,
      RECEIVABLES_MENUS.map((m) => ({ label: m.title, to: m.url }))
    );

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-surface-alt">
        <UserSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className={`h-14 flex items-center gap-3 border-b px-4 ${liveMode ? "border-emerald-300 bg-emerald-50/60" : "border-border bg-surface"}`}>
            <SidebarTrigger className="text-foreground" />
            {/* This used to be a hard-typed "Dashboard", shown on every page — so the
                Risk Register, Reports and Settings all claimed to be the Dashboard. */}
            <Breadcrumbs pageLabel={pageLabel} />
            {liveMode && (
              <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-100 border border-emerald-300 rounded px-1.5 py-0.5">
                Live · Tally
              </span>
            )}
            <span className="text-xs text-muted-foreground hidden sm:inline">
              · {fyPinned ? "Both FYs" : fyLabel}
            </span>
            <div className="ml-auto flex items-center gap-3">
              {/* Permitted users only (admins + profiles.receivables_allow_pipeline): flip the WHOLE
                  hub between the default Live-Tally view and the legacy pipeline source. One switch
                  instead of duplicating every menu (see lib/liveMode). Live is the default; the amber
                  state flags the deviation into the old pipeline. */}
              {canUsePipeline && (
                <button
                  type="button"
                  onClick={() => setLiveMode(!liveMode)}
                  title={liveMode ? "Showing live Tally data — click to view the legacy pipeline" : "Showing legacy pipeline data — click to return to Live (Tally)"}
                  className={`inline-flex items-center gap-1.5 h-8 rounded-full border px-3 text-xs font-semibold transition-colors ${
                    liveMode
                      ? "bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700"
                      : "bg-amber-500 border-amber-500 text-white hover:bg-amber-600"
                  }`}
                >
                  <Radio className={`h-3.5 w-3.5 ${liveMode ? "animate-pulse" : ""}`} />
                  {liveMode ? "Live (Tally)" : "Legacy pipeline"}
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
              {/* Customer Onboarding's bell. Renders NOTHING for the many hub
                  users who take no part in onboarding, so this is not a
                  permanently-empty control — see CustomerBell's header for why
                  it reads its own small query rather than the module store. */}
              <CustomerBell />
              <UserMenu
                user={{ name: user.name, designation: user.designation, color: user.avatarColor, roleLabel: ROLE_LABEL[role] ?? role }}
              />
            </div>
          </header>
          {/* PF-18 · The hub-wide announcement strip. This module has its own shell,
              so AppShell's copy never reaches it; without this line the Outstanding
              Dashboard would be the one app nobody saw announcements in. */}
          <AnnouncementStrip />
          <main className="flex-1 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
