import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { appBasePath } from "@/apps/appInfo";
import { Toaster as Sonner } from "@hub/components/ui/sonner";
import { Toaster } from "@hub/components/ui/toaster";
import { TooltipProvider } from "@hub/components/ui/tooltip";
import { FYProvider } from "@hub/lib/fyContext";
import { ReceivablesScopeProvider } from "@hub/lib/scope";
import { ReceivablesSourceProvider } from "@hub/lib/sourceContext";
import { LiveModeProvider, useLiveMode } from "@hub/lib/liveMode";
import RequireHubMenu from "@hub/components/RequireHubMenu";
import RequireReportAccess from "@hub/components/RequireReportAccess";
import UserLayout from "@hub/layouts/UserLayout";
import Dashboard from "@hub/pages/Dashboard";
import AlertsPage from "@hub/pages/Alerts";
import CustomerRiskRegister from "@hub/pages/CustomerRiskRegister";
import FollowupsPage from "@hub/pages/Followups";
import SalespersonAnalysis from "@hub/pages/SalespersonAnalysis";
import SalespersonCollectionReport from "@hub/pages/SalespersonCollectionReport";
import CustomerDetail from "@hub/pages/CustomerDetail";
import DebtorAnalysis from "@hub/pages/DebtorAnalysis";
import ImportDashboard from "@hub/pages/ImportDashboard";
import SavedViews from "@hub/pages/SavedViews";
import Profile from "@hub/pages/Profile";
import Settings from "@hub/pages/Settings";

/**
 * Old /outstanding-dashboard/customer-onboarding/* → the module's new home,
 * path and query string intact.
 *
 * ⚠ THE QUERY STRING MATTERS AS MUCH AS THE PATH. The four back-office queues
 *   are one page keyed by `?step=`, and every "please approve this" link ever
 *   sent carries it. Dropping the search would land the reader on somebody
 *   else's queue.
 */
function CustomerOnboardingRedirect() {
  const { pathname, search } = useLocation();
  const rest = pathname.split("/customer-onboarding/")[1] ?? "";
  return <Navigate to={`/customer-onboarding/${rest}${search}`} replace />;
}

/**
 * Old /outstanding-dashboard/reports/* → the catalogue's new home at /reports/*, path and
 * query string intact.
 *
 * ⚠ THE QUERY STRING IS NOT OPTIONAL. `?below=0` and `?below=30` are two different reports
 *   sharing one page, and `?over=` is the cutoff on the overdue and DSO reports. A redirect
 *   that kept only the path would silently serve a different report than the link named.
 *
 * `slice`, not `split`: the bare "/outstanding-dashboard/reports" is handled by its own
 * route below, but a sub-path has to keep every segment after the prefix — and the prefix
 * is read from `appInfo` rather than retyped, so if either base ever moves again this one
 * line follows it.
 */
function ReportsRedirect() {
  const { pathname, search } = useLocation();
  const rest = pathname.slice(`${appBasePath("outstanding-dashboard")}/reports`.length);
  return <Navigate to={`${appBasePath("reports")}${rest}${search}`} replace />;
}

/**
 * Old /outstanding-dashboard/bushra-dashboard/* → /reports/bushra-dashboard/*.
 *
 * A straight re-parenting: only the app base changes, the "bushra-dashboard" segment and
 * everything after it carry through, query string included (the Sales and Purchase
 * dashboards are one screen per preset and several of them read filters from the query).
 */
function DashboardsRedirect() {
  const { pathname, search } = useLocation();
  const rest = pathname.slice(appBasePath("outstanding-dashboard").length);
  return <Navigate to={`${appBasePath("reports")}${rest}${search}`} replace />;
}

// Customer Creation FMS moved to its own app on 29-07-2026; the hub keeps only
// the redirects above. Its pages are still FILED under this folder — they are
// hub-native components — but apps/customer-onboarding/ is what mounts them now.

/**
 * Root of the Receivables Hub app inside Orange One.
 *
 * Mounted by App.tsx at "/outstanding-dashboard/*" behind RequireAuth +
 * RequireModule, so routes here are RELATIVE to that base (no leading
 * "/dashboard" like the original standalone app had).
 *
 * Orange One's root already provides BrowserRouter + QueryClientProvider, so we
 * only add the Hub-local providers here. The `.hub-root` wrapper scopes the
 * Hub's design tokens (see src/index.css).
 *
 * LIVE (TALLY) MODE: rather than duplicate every screen/menu with a "Live …" copy, an
 * admin-only topbar switch (see UserLayout + lib/liveMode) flips the WHOLE hub's data source to
 * the ConnectWave live-Tally snapshot. Same routes/URLs, different backend — so `HubRoutes`
 * wraps the router in a single <ReceivablesSourceProvider> whose value follows the toggle.
 */
function HubRoutes() {
  const { liveMode } = useLiveMode();
  return (
    <ReceivablesSourceProvider value={liveMode ? "connectwave" : "default"}>
      <Routes>
        <Route element={<UserLayout />}>
          <Route index element={<Dashboard />} />
          {/* Guarded at the ROUTE, not just the nav entry — a hidden sidebar link is not access
              control (see components/RequireHubMenu). */}
          <Route element={<RequireHubMenu menu="alerts" />}>
            <Route path="alerts" element={<AlertsPage />} />
          </Route>
          <Route path="risk-register" element={<CustomerRiskRegister />} />
          {/* Follow-ups force the pipeline source internally — see pages/Followups.tsx. */}
          <Route path="followups" element={<FollowupsPage />} />
          <Route path="salesperson-analysis" element={<SalespersonAnalysis />} />
          <Route path="salesperson-collection" element={<SalespersonCollectionReport />} />
          {/* Retired: "Collection Report (Tally Live)" was a duplicate menu item rendering this very
              report against ConnectWave. Live is now reached the same way as every other screen — the
              topbar toggle. Kept as a redirect so old bookmarks land on the report, not the dashboard. */}
          <Route path="collection-live" element={<Navigate to="../salesperson-collection" replace />} />
          <Route path="customer/:id" element={<CustomerDetail />} />
          <Route path="group/:id" element={<CustomerDetail />} />
          {/* The Debtor Analysis one-pager, per customer / per group. SIBLINGS of the two routes
              above, not children: CustomerDetail is not a layout and renders no <Outlet/>.
              Deliberately outside RequireHubMenu / RequireReportAccess, exactly as its parents
              are — this is a customer page, not a catalogued report, and a fail-closed report
              guard would bounce it to the hub home. Per-salesperson scoping still applies: the
              page reads useAppData, whose chokepoints drop out-of-scope ledgers. */}
          <Route path="customer/:id/analysis" element={<DebtorAnalysis />} />
          <Route path="group/:id/analysis" element={<DebtorAnalysis />} />
          <Route path="import" element={<ImportDashboard />} />
          {/* ── Reports ────────────────────────────────────────────────────────────
              MOVED OUT on 23-09-2026 to its own top-level app at /reports
              (apps/reports/). Everything that was here — the landing page, the forty
              report routes, and both guards around them — went across unchanged; the
              screens themselves are still FILED under this folder, because they are
              hub-native components (see apps/reports/ReportsApp.tsx).

              ⚠ THE REDIRECT IS LOAD-BEARING, NOT A COURTESY, and for two reasons beyond
                bookmarks. Reports are the hub's most-linked pages: a queued email_outbox
                row carries the `ctaPath` it was authored with — frozen at enqueue time,
                not built at render — so every report mail already sent points at the old
                base, and Saved Views written before today hold the old path too.

              `*` carries the rest of the path through, and the QUERY STRING with it. That
              matters as much as the path here: ?below=0 and ?below=30 are two different
              reports on one page, and ?over= is the cutoff on the overdue and DSO reports.
              Dropping the search would land the reader on a different report than the link
              promised — see ReportsRedirect. */}
          <Route path="reports" element={<Navigate to="/reports" replace />} />
          <Route path="reports/*" element={<ReportsRedirect />} />

          {/* ── Bushra-Dashboard ───────────────────────────────────────────────────
              Moved the same day, to the same app, and for the same reason: its screens
              are catalogued as reports (category "bushra-report" in lib/reportCatalog),
              so leaving them behind would have split one section across two modules.
              They keep their own URL segment under the new base — /reports/bushra-dashboard/*
              — because they are a section of the catalogue, not reports in the flat
              /reports/<slug> shape. */}
          <Route path="bushra-dashboard" element={<Navigate to="/reports/bushra-dashboard" replace />} />
          <Route path="bushra-dashboard/*" element={<DashboardsRedirect />} />

          {/* Customer Creation FMS.
              Deliberately NOT wrapped in RequireRole: authorization here is
              per-step, not per-role. Who may verify / approve / create a
              customer comes from the module's step owners and is enforced by
              RLS + the RPCs; a role gate on the route would be both too coarse
              and, on its own, false comfort. */}
          {/* MOVED OUT on 29-07-2026 to its own top-level app at
              /customer-onboarding (apps/customer-onboarding/). These redirects
              are all that remain: months of links live in emails, bell
              notifications and browser bookmarks, and a 404 on an approval link
              is how an approval quietly does not happen. `*` carries the rest of
              the path through, so a deep link to a specific request still lands
              on that request. */}
          <Route path="customer-onboarding" element={<Navigate to="/customer-onboarding" replace />} />
          <Route path="customer-onboarding/*" element={<CustomerOnboardingRedirect />} />
          <Route path="saved-views" element={<SavedViews />} />
          <Route path="profile" element={<Profile />} />
          {/* Settings is per-user in the same way — hiding the menu must hide the page. `full`
              because every tab on it (Masters, and Menu Permissions for admins) is behind the
              grant now that Data Refresh is gone: seeing the menu and being allowed to use it
              are the same thing here. */}
          <Route element={<RequireHubMenu menu="settings" full />}>
            <Route path="settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/outstanding-dashboard" replace />} />
        </Route>
      </Routes>
    </ReceivablesSourceProvider>
  );
}

export default function ReceivablesHubApp() {
  return (
    <div className="hub-root">
      <LiveModeProvider>
        <ReceivablesScopeProvider>
          <FYProvider>
            <TooltipProvider>
              <Toaster />
              <Sonner />
              <HubRoutes />
            </TooltipProvider>
          </FYProvider>
        </ReceivablesScopeProvider>
      </LiveModeProvider>
    </div>
  );
}
