import { Outlet, useLocation } from "react-router-dom";
import { Radio } from "lucide-react";
import { SidebarProvider, SidebarTrigger } from "@hub/components/ui/sidebar";
import { useAppData } from "@hub/lib/useAppData";
import { FYMultiSelect } from "@hub/components/FYMultiSelect";
import { useFY } from "@hub/lib/fyContext";
import { useLiveMode } from "@hub/lib/liveMode";
import { formatAsOfDateTime } from "@hub/lib/asOfFormat";
import { reportCrumbs } from "@hub/lib/reportCatalog";
import UserMenu from "@/shared/components/layout/UserMenu";
import AnnouncementStrip from "@/core/announcements/AnnouncementStrip";
import Breadcrumbs from "@/shared/components/layout/Breadcrumbs";
import { useSession } from "@/core/platform/session";
import type { AppRole } from "@/core/platform/types";
import { ReportsSidebar } from "./ReportsSidebar";

const ROLE_LABEL: Record<AppRole, string> = { admin: "Admin", hod: "HOD", sub_hod: "Sub-HOD", employee: "Employee" };

/**
 * Chrome for the standalone Reports app.
 *
 * ⚠ NOT the portal's AppShell, unlike the other module promoted out of this hub (Customer
 *   Onboarding took the shell when it moved). These screens need three controls the shell
 *   does not have and could not grow without becoming receivables-aware: the financial-year
 *   multi-select, the Live (Tally) / legacy-pipeline switch, and the "data updated as of"
 *   stamp. So this is the Outstanding Dashboard's own top strip, kept as it was — the
 *   reports did not change, only where they are reached from.
 *
 * What it drops from that strip: the Customer Onboarding bell, which belongs to a module
 * that is neither this one nor the hub any more.
 */

/**
 * Routes that IGNORE the financial-year selector, because the page carries its own period
 * controls or reads the whole book by design. Showing a selector that cannot change the
 * numbers below it is worse than showing none.
 *
 * MOST OF THIS LIST IS THE FIRST KIND — a report with its own company + FY pickers in its
 * header, naming the FY and its prior year on every panel. A topbar selector there would be
 * a second, disagreeing control over the same thing.
 *
 * The whole-book ones are worth reading one by one, because the reason differs per report:
 *
 *  - Overdue Aging: a single financial year cannot contain a 120-day-old invoice until it is
 *    itself 120 days old, so an FY-scoped "overdue > 120 days" silently becomes 100%
 *    brought-forward debt.
 *  - Dormant Debtors: its window is the last N months of the FY-scoped month vocabulary, so
 *    inside a young FY "no sales in 6 months" quietly collapses to "no sales in 3" — and a
 *    customer who last bought in February is reported as having never bought at all.
 *  - DSO: a 12-month lookback, which inside a young FY collapses to the months elapsed so far
 *    and makes every figure wrong.
 *  - Red Mark: its Received / Sales columns are the last three CALENDAR months, which no
 *    financial year can contain — in April a single-FY view keeps the receipts and silently
 *    drops February's and March's sales.
 *  - Disputed Bills / Advances: open bills and ledger balances are not FY-windowed at all, so
 *    a selector would change nothing on the page and read as broken.
 *  - Category: the balance/aging half is a property of the whole book while the
 *    sales/collections half has its own period selector, so a topbar control would claim to
 *    drive both and drive neither.
 *  - The financial statements: the mirror stores exactly ONE statement per company, as at the
 *    connector's last sync. An FY selector would promise a period the data cannot be re-cut to.
 *
 * Each such page enforces this itself (its own nested FYProvider, or its own pickers); hiding
 * the selector here is what stops the topbar from claiming otherwise.
 *
 * Matched by PREFIX, so one entry covers a report's /:id detail sub-route.
 */
const FY_PINNED_ROUTES = [
  "/reports/sales",
  "/reports/purchase",
  "/reports/day-book",
  "/reports/finance-receivables",
  "/reports/finance-payables",
  "/reports/finance-income",
  "/reports/finance-expense",
  "/reports/finance-sales-gain",
  "/reports/sales-dashboard",
  // Currently redundant — the prefix match means "/reports/purchase" above already covers it —
  // but the Purchase Report could move, and a route relying on another route's prefix is not
  // something to leave implicit.
  "/reports/purchase-dashboard",
  "/reports/stock-analysis",
  "/reports/c-level-dashboard",
  "/reports/customer-profile",
  "/reports/red-mark",
  "/reports/disputed-bills",
  "/reports/advances",
  "/reports/overdue",
  "/reports/dormant",
  "/reports/category",
  "/reports/dso",
  "/reports/balance-sheet",
  "/reports/profit-loss",
  "/reports/trial-balance",
  // The list and its /:ledgerId detail both hide the selector — the report has its own "As on"
  // date control, and the mirror holds one snapshot per company.
  "/reports/ledger-outstanding",
  "/reports/sales-register",
  "/reports/stock-summary",
  "/reports/batch-costing",
  "/reports/bushra-sales-register",
  "/reports/bushra-purchase-register",
  // Bushra-Dashboard — every screen on it carries its own company + FY + period pickers.
  // One entry covers the subtree.
  "/reports/bushra-dashboard",
];

export default function ReportsLayout() {
  const { dashboard } = useAppData({});
  const { label: fyLabel } = useFY();
  const { user, role } = useSession();
  const { liveMode, setLiveMode, canUsePipeline } = useLiveMode();
  const { pathname, search } = useLocation();
  const fyPinned = FY_PINNED_ROUTES.some((r) => pathname.startsWith(r));

  // A three-step tail from the catalogue — "Reports → Tally Reports → Balance Sheet". The
  // module step the shared trail adds is also "Reports", and `buildTrail` drops a step that
  // repeats the one before it, so the reader sees the module named once.
  //
  // Null off the catalogue (the landing page with no `?cat=`), and the trail then stops at
  // the module rather than inventing a page name. Unlike the hub's strip there is no
  // menu-label fallback to fall back TO: every page in this app is a catalogue entry.
  const pageLabel = reportCrumbs(pathname, search);

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-surface-alt">
        <ReportsSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className={`h-14 flex items-center gap-3 border-b px-4 ${liveMode ? "border-emerald-300 bg-emerald-50/60" : "border-border bg-surface"}`}>
            <SidebarTrigger className="text-foreground" />
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
                  catalogue between the default Live-Tally view and the legacy pipeline source. One
                  switch instead of duplicating every report (see lib/liveMode). Live is the default;
                  the amber state flags the deviation into the old pipeline. */}
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
              {/* Hidden on the FY-pinned reports — see FY_PINNED_ROUTES. */}
              {!fyPinned && <FYMultiSelect />}
              <div className="h-6 w-px bg-border hidden sm:block" />
              <UserMenu
                user={{ name: user.name, designation: user.designation, color: user.avatarColor, roleLabel: ROLE_LABEL[role] ?? role }}
              />
            </div>
          </header>
          {/* PF-18 · The portal-wide announcement strip. This module has its own shell, so
              AppShell's copy never reaches it — same reason the hub carries its own line. */}
          <AnnouncementStrip />
          <main className="flex-1 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
