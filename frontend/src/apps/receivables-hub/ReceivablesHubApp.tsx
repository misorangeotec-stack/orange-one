import { Routes, Route, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@hub/components/ui/sonner";
import { Toaster } from "@hub/components/ui/toaster";
import { TooltipProvider } from "@hub/components/ui/tooltip";
import { FYProvider } from "@hub/lib/fyContext";
import { ReceivablesScopeProvider } from "@hub/lib/scope";
import { ReceivablesSourceProvider } from "@hub/lib/sourceContext";
import { LiveModeProvider, useLiveMode } from "@hub/lib/liveMode";
import UserLayout from "@hub/layouts/UserLayout";
import Dashboard from "@hub/pages/Dashboard";
import CustomerRiskRegister from "@hub/pages/CustomerRiskRegister";
import FollowupsPage from "@hub/pages/Followups";
import SalespersonAnalysis from "@hub/pages/SalespersonAnalysis";
import SalespersonCollectionReport from "@hub/pages/SalespersonCollectionReport";
import CustomerDetail from "@hub/pages/CustomerDetail";
import ImportDashboard from "@hub/pages/ImportDashboard";
import Reports from "@hub/pages/Reports";
import AgingReport from "@hub/pages/AgingReport";
import OtherPaymentsReport from "@hub/pages/OtherPaymentsReport";
import RedMarkCustomersReport from "@hub/pages/RedMarkCustomersReport";
import CollectionPerformanceReport from "@hub/pages/CollectionPerformanceReport";
import OverdueAgingReport from "@hub/pages/OverdueAgingReport";
import CustomerCategoryReport from "@hub/pages/CustomerCategoryReport";
import DsoReport from "@hub/pages/DsoReport";
import BalanceSheetReport from "@hub/pages/BalanceSheetReport";
import ProfitLossReport from "@hub/pages/ProfitLossReport";
import TrialBalanceReport from "@hub/pages/TrialBalanceReport";
import LedgerOutstandingList from "@hub/pages/LedgerOutstandingList";
import LedgerOutstandingBills from "@hub/pages/LedgerOutstandingBills";
import LedgerVoucherList from "@hub/pages/LedgerVoucherList";
import LedgerVoucherStatement from "@hub/pages/LedgerVoucherStatement";
import SavedViews from "@hub/pages/SavedViews";
import Profile from "@hub/pages/Profile";
import Settings from "@hub/pages/Settings";

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
          <Route path="import" element={<ImportDashboard />} />
          <Route path="reports" element={<Reports />} />
          <Route path="reports/aging" element={<AgingReport />} />
          <Route path="reports/other-payments" element={<OtherPaymentsReport />} />
          {/* One page, two reports: ?below=0 is "Zero Collections", ?below=30 is "Below 30%".
              Zero collection is the 0% case, so they share an engine — see lib/collections.ts.
              The page pins itself to the pipeline source (the Live/Tally toggle can't reach it). */}
          <Route path="reports/collections" element={<CollectionPerformanceReport />} />
          {/* The zero report shipped at its own URL first. Keep the bookmark working. */}
          <Route
            path="reports/zero-collections"
            element={<Navigate to="/outstanding-dashboard/reports/collections?below=0" replace />}
          />
          {/* Same page, third report: customers who owe money and have STOPPED BUYING. It is the
              exact complement of the other two reports' "Still Buying" lens, so it reuses their
              engine — but it asks a sales question, not a collections one, so it has no ?below=
              threshold and arrives by route instead. Pinned to the pipeline source AND to Both
              FYs (a 6-month window can't live inside a 3-month-old FY) — see the page header. */}
          <Route path="reports/dormant" element={<CollectionPerformanceReport variant="dormant" />} />
          {/* Aged debt: ?over=120 (the card), 90 / 180 / any custom cutoff. Pinned to the pipeline
              source AND to Both FYs — see the header of pages/OverdueAgingReport.tsx. */}
          <Route path="reports/overdue" element={<OverdueAgingReport />} />
          {/* The book pivoted by the A/B/C/D/E tier, plus the tag-hygiene lens. Pinned to the
              pipeline source AND to Both FYs — see the header of pages/CustomerCategoryReport.tsx. */}
          <Route path="reports/category" element={<CustomerCategoryReport />} />
          <Route path="reports/red-mark" element={<RedMarkCustomersReport />} />
          {/* How long each customer takes to turn a sale into cash: ?over=90 (the card), 60 / 120 /
              any custom cutoff. A COUNTBACK, not AR/Sales — and a group's DSO is never the average
              of its rows. Pinned to the pipeline source AND to Both FYs, the latter load-bearing:
              a 12-month lookback cannot be read inside a young FY. See pages/DsoReport.tsx. */}
          <Route path="reports/dso" element={<DsoReport />} />
          <Route path="reports/balance-sheet" element={<BalanceSheetReport />} />
          <Route path="reports/profit-loss" element={<ProfitLossReport />} />
          <Route path="reports/trial-balance" element={<TrialBalanceReport />} />
          <Route path="reports/ledger-outstanding" element={<LedgerOutstandingList />} />
          <Route path="reports/ledger-outstanding/:ledgerId" element={<LedgerOutstandingBills />} />
          {/* Live (Tally) only — the pages render a "Not applicable" panel on the default pipeline. */}
          <Route path="reports/ledger-voucher" element={<LedgerVoucherList />} />
          <Route path="reports/ledger-voucher/:ledgerId" element={<LedgerVoucherStatement />} />
          <Route path="saved-views" element={<SavedViews />} />
          <Route path="profile" element={<Profile />} />
          <Route path="settings" element={<Settings />} />
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
