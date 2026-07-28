import { Routes, Route, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@hub/components/ui/sonner";
import { Toaster } from "@hub/components/ui/toaster";
import { TooltipProvider } from "@hub/components/ui/tooltip";
import { FYProvider } from "@hub/lib/fyContext";
import { ReceivablesScopeProvider } from "@hub/lib/scope";
import { ReceivablesSourceProvider } from "@hub/lib/sourceContext";
import { LiveModeProvider, useLiveMode } from "@hub/lib/liveMode";
import RequireRole from "@/core/platform/RequireRole";
import UserLayout from "@hub/layouts/UserLayout";
import CLevelDashboard from "@hub/pages/CLevelDashboard";
import ExecDashboard from "@hub/pages/ExecDashboard";
import Dashboard from "@hub/pages/Dashboard";
import CustomerRiskRegister from "@hub/pages/CustomerRiskRegister";
import FollowupsPage from "@hub/pages/Followups";
import SalespersonAnalysis from "@hub/pages/SalespersonAnalysis";
import SalespersonCollectionReport from "@hub/pages/SalespersonCollectionReport";
import CustomerDetail from "@hub/pages/CustomerDetail";
import ImportDashboard from "@hub/pages/ImportDashboard";
import Reports from "@hub/pages/Reports";
import SalesReport from "@hub/pages/SalesReport";
import DayBook from "@hub/pages/DayBook";
import PurchaseReport from "@hub/pages/PurchaseReport";
import ReceivablesMasterReport from "@hub/pages/ReceivablesMasterReport";
import PayablesMasterReport from "@hub/pages/PayablesMasterReport";
import IncomeMasterReport from "@hub/pages/IncomeMasterReport";
import ExpenseMasterReport from "@hub/pages/ExpenseMasterReport";
import SalesGainReport from "@hub/pages/SalesGainReport";
import SalesDashboard from "@hub/pages/SalesDashboard";
import PurchaseDashboard from "@hub/pages/PurchaseDashboard";
import StockAnalysis from "@hub/pages/StockAnalysis";
import CustomerProfile from "@hub/pages/CustomerProfile";
import AgingReport from "@hub/pages/AgingReport";
import TopExposureReport from "@hub/pages/TopExposureReport";
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
import SalesRegister from "@hub/pages/SalesRegister";
import SavedViews from "@hub/pages/SavedViews";
import Profile from "@hub/pages/Profile";
import Settings from "@hub/pages/Settings";
// Customer Creation FMS. Its provider is mounted by CustomerOnboardingLayout so
// the module's snapshot loads on these routes only — the hub's other pages must
// not pay for a query they never read.
import CustomerOnboardingLayout from "@hub/pages/customerOnboarding/CustomerOnboardingLayout";
import CustomerOnboardingHome from "@hub/pages/customerOnboarding/Home";
import CustomerAllRequests from "@hub/pages/customerOnboarding/AllRequests";
import CustomerMyRequests from "@hub/pages/customerOnboarding/MyRequests";
import CustomerNew from "@hub/pages/customerOnboarding/NewCustomer";
import CustomerRequestDetail from "@hub/pages/customerOnboarding/RequestDetail";
import CustomerPendingQueue from "@hub/pages/customerOnboarding/PendingQueue";
import CustomerSettings from "@hub/pages/customerOnboarding/settings/CustomerSettings";

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
          {/* Master Reports. Reads the precomputed rpt_sales_* snapshot of the Tally mirror,
              so it is source-agnostic — no Live/pipeline gate, same as the financial
              statements. It carries its own company + FY pickers (see FY_PINNED_ROUTES). */}
          <Route path="reports/sales" element={<SalesReport />} />
          {/* Purchase Report — purchase-side twin of the Sales Report, same source-agnostic
              rpt_purchase_* snapshot, own company + FY pickers (see FY_PINNED_ROUTES). */}
          <Route path="reports/purchase" element={<PurchaseReport />} />
          {/* Day Book — single-company single-day dashboard on the rpt_day_book snapshot;
              source-agnostic, carries its own company + date pickers (see FY_PINNED_ROUTES). */}
          <Route path="reports/day-book" element={<DayBook />} />
          {/* Finance → Receivables — Talligence receivables clone on the rpt_receivables_*
              snapshot; own company + FY pickers. */}
          <Route path="reports/finance-receivables" element={<ReceivablesMasterReport />} />
          {/* Finance → Payables — sign-mirror of Receivables (Sundry Creditors) on the
              rpt_payables_* snapshot; own company + FY pickers, same as Receivables. */}
          <Route path="reports/finance-payables" element={<PayablesMasterReport />} />
          {/* Finance → Income — Talligence income clone on the rpt_income_* P&L-movement snapshot
              (Sales Accounts + Direct/Indirect Incomes); own company + FY pickers (see FY_PINNED_ROUTES). */}
          <Route path="reports/finance-income" element={<IncomeMasterReport />} />
          {/* Finance → Expense — sign-mirror of Income on the rpt_expense_* P&L-movement snapshot
              (Direct/Indirect Expenses + Purchase Accounts, debit-positive); own company + FY
              pickers (see FY_PINNED_ROUTES). */}
          <Route path="reports/finance-expense" element={<ExpenseMasterReport />} />
          {/* Finance → Sales Gain — margin on the sales book, over the rpt_sales_gain_* snapshot.
              Gain is DERIVED (Tally stores no cost): cost is priced per item from that item's own
              VALUATIONMETHOD, so a configured standard price is never mistaken for a cost. Own
              company + FY pickers (see FY_PINNED_ROUTES). */}
          <Route path="reports/finance-sales-gain" element={<SalesGainReport />} />
          {/* Dashboards → Sales Dashboard — the Talligence composite screen. Unlike every master
              report it spans FOUR spines (sales / income / expense / receivables), so its RPC
              returns meta.tie_* and the page warns when two separately-crons'd snapshots drift.
              Own company + FY pickers (see FY_PINNED_ROUTES). */}
          <Route path="reports/sales-dashboard" element={<SalesDashboard />} />
          {/* Dashboards → Purchase Dashboard — the purchase-side twin. Rides rpt_purchase_line for
              KPI / monthly / geography / vendors (ONE spine, so there is no tie_geo to report),
              plus a new rpt_purchase_dashboard_ap ledger walk for month-end payables — the only
              precomputed piece, and the month-end AP source Finance → Payables never had.
              Own company + FY pickers (see FY_PINNED_ROUTES). */}
          <Route path="reports/purchase-dashboard" element={<PurchaseDashboard />} />
          {/* Inventory → Stock Analysis — the Talligence inventory clone, and the FIRST report on
              the inventory spine rather than a ledger one. Rides two new precomputed tables
              (rpt_stock_analysis_item / _move) because nothing existing could answer "when did this
              item last move": rpt_sales_item / rpt_purchase_item / rpt_day_book_item each see one
              family of voucher natures and none sees stock journals, delivery challans, credit
              notes or rejections. Own company + FY pickers (see FY_PINNED_ROUTES). */}
          <Route path="reports/stock-analysis" element={<StockAnalysis />} />
          <Route path="reports/aging" element={<AgingReport />} />
          {/* Live (Tally) only — the page renders a "Not applicable" panel on the default pipeline. */}
          <Route path="reports/top-exposure" element={<TopExposureReport />} />
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
          {/* Admin-only — the Talligence "Insights → Customer Profile" clone, the first report in
              the Insights category. Needed a new table (rpt_customer_profile_year): nothing
              precomputed a per-customer, per-FY sales aggregate, and the lifecycle buckets are a
              year-over-year comparison that on FY-split books has to reach ACROSS tenants (the
              prior year lives in a different book). Own company + FY pickers — see
              FY_PINNED_ROUTES. */}
          <Route
            path="reports/customer-profile"
            element={
              <RequireRole roles={["admin"]}>
                <CustomerProfile />
              </RequireRole>
            }
          />
          {/* Admin-only executive dashboard — the Talligence C-Level clone, 22 panels on the
              nightly rpt_clevel_dashboard_cache snapshot. Own company + FY pickers (see
              FY_PINNED_ROUTES). Guarded here AND hidden from the catalogue/sidebar for
              non-admins — see reportCatalog.ts adminOnly. */}
          <Route
            path="reports/c-level-dashboard"
            element={
              <RequireRole roles={["admin"]}>
                <ExecDashboard />
              </RequireRole>
            }
          />
          {/* The 2026-07-23 original, superseded by the route above. Its clevel_pl_monthly /
              mv_clevel_ledger source has a DISABLED refresh cron, so it reports stale figures;
              routed only until the replacement is signed off, then deleted along with
              supabase/clevel-mirror/. */}
          <Route
            path="reports/c-level"
            element={
              <RequireRole roles={["admin"]}>
                <CLevelDashboard />
              </RequireRole>
            }
          />
          <Route path="reports/balance-sheet" element={<BalanceSheetReport />} />
          <Route path="reports/profit-loss" element={<ProfitLossReport />} />
          <Route path="reports/trial-balance" element={<TrialBalanceReport />} />
          <Route path="reports/ledger-outstanding" element={<LedgerOutstandingList />} />
          <Route path="reports/ledger-outstanding/:ledgerId" element={<LedgerOutstandingBills />} />
          {/* Live (Tally) only — the pages render a "Not applicable" panel on the default pipeline. */}
          <Route path="reports/ledger-voucher" element={<LedgerVoucherList />} />
          <Route path="reports/ledger-voucher/:ledgerId" element={<LedgerVoucherStatement />} />
          {/* Source-agnostic — reads the precomputed rpt_sales_register snapshot, like the Sales Report. */}
          <Route path="reports/sales-register" element={<SalesRegister />} />
          {/* Customer Creation FMS.
              Deliberately NOT wrapped in RequireRole: authorization here is
              per-step, not per-role. Who may verify / approve / create a
              customer comes from the module's step owners and is enforced by
              RLS + the RPCs; a role gate on the route would be both too coarse
              and, on its own, false comfort. */}
          <Route path="customer-onboarding" element={<CustomerOnboardingLayout />}>
            <Route index element={<CustomerOnboardingHome />} />
            <Route path="new" element={<CustomerNew />} />
            <Route path="mine" element={<CustomerMyRequests />} />
            <Route path="all" element={<CustomerAllRequests />} />
            {/* ONE queue page for all four back-office steps, keyed by ?step=.
                Four routes would be four copies of the same table drifting
                apart on what a column means. */}
            <Route path="queue" element={<CustomerPendingQueue />} />
            <Route path="settings" element={<CustomerSettings />} />
            <Route path="requests/:id" element={<CustomerRequestDetail />} />
            <Route path="requests/:id/edit" element={<CustomerNew />} />
          </Route>
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
