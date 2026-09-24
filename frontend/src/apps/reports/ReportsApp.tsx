/**
 * Root of the standalone Reports app — the whole of the Outstanding Dashboard's reporting,
 * promoted onto the main menu as a module of its own.
 *
 * TWO SECTIONS, and they were two menus before the move: the report catalogue at /reports/*
 * and Bushra-Dashboard at /reports/bushra-dashboard/*. They share a shell and nothing else —
 * see the routes below for why their guards stay separate.
 *
 * ⚠ THE PAGES LIVE UNDER apps/receivables-hub/ AND STAY THERE — the same call, for the
 *   same reason, as Customer Onboarding when it was promoted out of the hub on
 *   29-07-2026. Every report is built from hub-native (shadcn) components; the portal's
 *   shared/ui hard-codes Orange One's own hex tokens and `.hub-root` does not remap them,
 *   so relocating forty screens would mean rewriting all of them against a different
 *   design system for no user-visible gain. This app is a SHELL: its own basePath,
 *   sidebar and chrome, wrapping the existing subtree.
 *
 * ⚠ THE `.hub-root` WRAPPER IS LOAD-BEARING, not cosmetic. Drop it and every shadcn
 *   colour token inside falls back to unset — the pages render, but unreadably.
 *
 * ⚠ THE PROVIDER STACK IS THE HUB'S, DELIBERATELY DUPLICATED rather than shared. A report
 *   opened at /reports is not inside ReceivablesHubApp any more, so nothing else would
 *   supply the financial year, the salesperson scope or the Live/pipeline source these
 *   pages read. The order matters and matches the hub's: LiveMode is outermost because
 *   the source provider below reads it, and FY sits inside the scope it is cut by.
 *
 * The route table is a MOVE, not a copy: ReceivablesHubApp no longer serves these paths,
 * it redirects to them. Every guard came across untouched — `RequireHubMenu` still reads
 * profiles.receivables_hidden_menus under the same two keys, and RequireReportAccess still
 * reads profiles.receivables_allowed_reports. Promoting the sections to the main menu was a
 * move of where the screens are reached from, never a change to who may read them.
 */
import { Routes, Route, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@hub/components/ui/sonner";
import { Toaster } from "@hub/components/ui/toaster";
import { TooltipProvider } from "@hub/components/ui/tooltip";
import { FYProvider } from "@hub/lib/fyContext";
import { ReceivablesScopeProvider } from "@hub/lib/scope";
import { ReceivablesSourceProvider } from "@hub/lib/sourceContext";
import { LiveModeProvider, useLiveMode } from "@hub/lib/liveMode";
import RequireHubMenu from "@hub/components/RequireHubMenu";
import RequireReportAccess from "@hub/components/RequireReportAccess";
import ReportsLayout from "./ReportsLayout";
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
import ExecDashboard from "@hub/pages/ExecDashboard";
import CLevelDashboard from "@hub/pages/CLevelDashboard";
import AgingReport from "@hub/pages/AgingReport";
import TopExposureReport from "@hub/pages/TopExposureReport";
import OtherPaymentsReport from "@hub/pages/OtherPaymentsReport";
import RedMarkCustomersReport from "@hub/pages/RedMarkCustomersReport";
import DisputedBillsReport from "@hub/pages/DisputedBillsReport";
import AdvancesReport from "@hub/pages/AdvancesReport";
import CollectionPerformanceReport from "@hub/pages/CollectionPerformanceReport";
import OverdueAgingReport from "@hub/pages/OverdueAgingReport";
import CustomerCategoryReport from "@hub/pages/CustomerCategoryReport";
import DsoReport from "@hub/pages/DsoReport";
import CreditTermsReport from "@hub/pages/CreditTermsReport";
import BalanceSheetReport from "@hub/pages/BalanceSheetReport";
import ProfitLossReport from "@hub/pages/ProfitLossReport";
import TrialBalanceReport from "@hub/pages/TrialBalanceReport";
import LedgerOutstandingList from "@hub/pages/LedgerOutstandingList";
import LedgerOutstandingBills from "@hub/pages/LedgerOutstandingBills";
import LedgerVoucherList from "@hub/pages/LedgerVoucherList";
import LedgerVoucherStatement from "@hub/pages/LedgerVoucherStatement";
import SalesRegister from "@hub/pages/SalesRegister";
import SOARegister from "@hub/pages/SOARegister";
import StockSummary from "@hub/pages/StockSummary";
import BatchCosting from "@hub/pages/BatchCosting";
import BushraSalesRegister from "@hub/pages/BushraSalesRegister";
import BushraPurchaseRegister from "@hub/pages/BushraPurchaseRegister";
import BushraDashboards from "@hub/pages/BushraDashboards";
import ProductionBatchCostingDashboard from "@hub/pages/ProductionBatchCostingDashboard";
import ProductionExpenses from "@hub/pages/ProductionExpenses";
import PackingMaterial from "@hub/pages/PackingMaterial";
import BushraSalesDashboard from "@hub/pages/BushraSalesDashboard";
import BushraPurchaseDashboard from "@hub/pages/BushraPurchaseDashboard";
import { SALES_DASHBOARDS } from "@hub/lib/bushraSalesDashboards";
import { PURCHASE_DASHBOARDS } from "@hub/lib/bushraPurchaseDashboards";

/**
 * LIVE (TALLY) MODE: rather than duplicate every report with a "Live …" copy, a permitted
 * user flips the WHOLE catalogue's data source with the topbar switch (see ReportsLayout +
 * lib/liveMode). Same routes, same URLs, different backend — so one
 * <ReceivablesSourceProvider> wraps the router and follows the toggle.
 */
function ReportRoutes() {
  const { liveMode } = useLiveMode();
  return (
    <ReceivablesSourceProvider value={liveMode ? "connectwave" : "default"}>
      <Routes>
        {/* THE LAYOUT IS OUTERMOST, and the guards sit inside it — the same nesting the hub
            used, and not an arbitrary one. RequireReportAccess renders the ScopeBanner above
            its <Outlet/>; hoisted above the layout, that banner would paint outside the shell
            instead of at the top of the page body. */}
        <Route element={<ReportsLayout />}>
          {/* Alias kept for old bookmarks. Deliberately OUTSIDE the report guard, exactly as
              it was in the hub: it has no catalogue entry of its own, and that guard fails
              CLOSED, so inside it this path would be bounced to the landing page instead of
              reaching the report it names. The target it redirects to is guarded. */}
          <Route path="zero-collections" element={<Navigate to="/reports/collections?below=0" replace />} />
          {/* ── The two guards, carried over unchanged ───────────────────────────────
              EVERY route sits inside them, not just the landing page. A grant that only
              filtered the sidebar would leave /reports/aging reachable by URL.

                RequireHubMenu       may this user see the Reports menu at all?
                                     (profiles.receivables_hidden_menus — the key stays
                                     registered in hub lib/menus.tsx precisely so this
                                     keeps working after the move)
                RequireReportAccess  may they open THIS report?
                                     (profiles.receivables_allowed_reports)

              The inner one resolves the URL against the catalogue rather than wrapping each
              route, so a newly catalogued report is guarded with no edit here. Don't add a
              per-route guard alongside it — that is the pattern that let sales-dashboard and
              purchase-dashboard escape the old `full` wrapper. */}
          <Route element={<RequireHubMenu menu="reports" />}>
            <Route element={<RequireReportAccess />}>
              <Route index element={<Reports />} />
              {/* Master Reports. Reads the precomputed rpt_sales_* snapshot of the Tally mirror,
                  so it is source-agnostic — no Live/pipeline gate, same as the financial
                  statements. It carries its own company + FY pickers (see FY_PINNED_ROUTES). */}
              <Route path="sales" element={<SalesReport />} />
              {/* Purchase Report — purchase-side twin of the Sales Report, same source-agnostic
                  rpt_purchase_* snapshot, own company + FY pickers (see FY_PINNED_ROUTES). */}
              <Route path="purchase" element={<PurchaseReport />} />
              {/* Day Book — single-company single-day dashboard on the rpt_day_book snapshot;
                  source-agnostic, carries its own company + date pickers (see FY_PINNED_ROUTES). */}
              <Route path="day-book" element={<DayBook />} />
              {/* Finance → Receivables — Talligence receivables clone on the rpt_receivables_*
                  snapshot; own company + FY pickers. */}
              <Route path="finance-receivables" element={<ReceivablesMasterReport />} />
              {/* Finance → Payables — sign-mirror of Receivables (Sundry Creditors) on the
                  rpt_payables_* snapshot; own company + FY pickers, same as Receivables. */}
              <Route path="finance-payables" element={<PayablesMasterReport />} />
              {/* Finance → Income — Talligence income clone on the rpt_income_* P&L-movement snapshot
                  (Sales Accounts + Direct/Indirect Incomes); own company + FY pickers. */}
              <Route path="finance-income" element={<IncomeMasterReport />} />
              {/* Finance → Expense — sign-mirror of Income on the rpt_expense_* P&L-movement snapshot
                  (Direct/Indirect Expenses + Purchase Accounts, debit-positive); own company + FY
                  pickers. */}
              <Route path="finance-expense" element={<ExpenseMasterReport />} />
              {/* Finance → Sales Gain — margin on the sales book, over the rpt_sales_gain_* snapshot.
                  Gain is DERIVED (Tally stores no cost): cost is priced per item from that item's own
                  VALUATIONMETHOD, so a configured standard price is never mistaken for a cost. Own
                  company + FY pickers. */}
              <Route path="finance-sales-gain" element={<SalesGainReport />} />
              {/* Dashboards → Sales Dashboard — the Talligence composite screen. Unlike every master
                  report it spans FOUR spines (sales / income / expense / receivables), so its RPC
                  returns meta.tie_* and the page warns when two separately-crons'd snapshots drift.
                  Own company + FY pickers. */}
              <Route path="sales-dashboard" element={<SalesDashboard />} />
              {/* Dashboards → Purchase Dashboard — the purchase-side twin. Rides rpt_purchase_line for
                  KPI / monthly / geography / vendors (ONE spine, so there is no tie_geo to report),
                  plus a new rpt_purchase_dashboard_ap ledger walk for month-end payables — the only
                  precomputed piece, and the month-end AP source Finance → Payables never had.
                  Own company + FY pickers. */}
              <Route path="purchase-dashboard" element={<PurchaseDashboard />} />
              {/* Inventory → Stock Analysis — the Talligence inventory clone, and the FIRST report on
                  the inventory spine rather than a ledger one. Rides two precomputed tables
                  (rpt_stock_analysis_item / _move) because nothing existing could answer "when did this
                  item last move": rpt_sales_item / rpt_purchase_item / rpt_day_book_item each see one
                  family of voucher natures and none sees stock journals, delivery challans, credit
                  notes or rejections. Own company + FY pickers. */}
              <Route path="stock-analysis" element={<StockAnalysis />} />
              <Route path="aging" element={<AgingReport />} />
              {/* Live (Tally) only — the page renders a "Not applicable" panel on the default pipeline. */}
              <Route path="top-exposure" element={<TopExposureReport />} />
              <Route path="other-payments" element={<OtherPaymentsReport />} />
              {/* One page, two reports: ?below=0 is "Zero Collections", ?below=30 is "Below 30%".
                  Zero collection is the 0% case, so they share an engine — see lib/collections.ts.
                  The page pins itself to the pipeline source (the Live/Tally toggle can't reach it). */}
              <Route path="collections" element={<CollectionPerformanceReport />} />
              {/* Same page, third report: customers who owe money and have STOPPED BUYING. It is the
                  exact complement of the other two reports' "Still Buying" lens, so it reuses their
                  engine — but it asks a sales question, not a collections one, so it has no ?below=
                  threshold and arrives by route instead. Pinned to the pipeline source AND to Both
                  FYs (a 6-month window can't live inside a 3-month-old FY) — see the page header. */}
              <Route path="dormant" element={<CollectionPerformanceReport variant="dormant" />} />
              {/* Aged debt: ?over=120 (the card), 90 / 180 / any custom cutoff. Pinned to the pipeline
                  source AND to Both FYs — see the header of pages/OverdueAgingReport.tsx. */}
              <Route path="overdue" element={<OverdueAgingReport />} />
              {/* The book pivoted by the A/B/C/D/E tier, plus the tag-hygiene lens. Pinned to the
                  pipeline source AND to Both FYs — see the header of pages/CustomerCategoryReport.tsx. */}
              <Route path="category" element={<CustomerCategoryReport />} />
              <Route path="red-mark" element={<RedMarkCustomersReport />} />
              <Route path="disputed-bills" element={<DisputedBillsReport />} />
              {/* Money received that no open invoice has absorbed, per salesperson (RC-18). Live (Tally)
                  only; pinned to Both FYs — see the header of pages/AdvancesReport.tsx. */}
              <Route path="advances" element={<AdvancesReport />} />
              {/* How long each customer takes to turn a sale into cash: ?over=90 (the card), 60 / 120 /
                  any custom cutoff. A COUNTBACK, not AR/Sales — and a group's DSO is never the average
                  of its rows. Pinned to the pipeline source AND to Both FYs, the latter load-bearing:
                  a 12-month lookback cannot be read inside a young FY. See pages/DsoReport.tsx. */}
              <Route path="dso" element={<DsoReport />} />
              {/* Which customers carry no credit limit / credit days in Tally, company by company.
                  Live (Tally) only — both fields are ledger master data. Treats a limit of ₹1 as NOT
                  set: it is the legacy "blocked" marker, not a limit. See pages/CreditTermsReport.tsx. */}
              <Route path="credit-terms" element={<CreditTermsReport />} />
              {/* The Talligence "Insights → Customer Profile" clone, the first report in the Insights
                  category. Needed a new table (rpt_customer_profile_year): nothing precomputed a
                  per-customer, per-FY sales aggregate, and the lifecycle buckets are a year-over-year
                  comparison that on FY-split books has to reach ACROSS tenants (the prior year lives in
                  a different book). Own company + FY pickers. */}
              <Route path="customer-profile" element={<CustomerProfile />} />
              {/* The executive dashboard — the Talligence C-Level clone, 22 panels on the nightly
                  rpt_clevel_dashboard_cache snapshot. Own company + FY pickers. */}
              <Route path="c-level-dashboard" element={<ExecDashboard />} />
              {/* The 2026-07-23 original, superseded by the route above. Its clevel_pl_monthly /
                  mv_clevel_ledger source has a DISABLED refresh cron, so it reports stale figures;
                  routed only until the replacement is signed off, then deleted along with
                  supabase/clevel-mirror/. */}
              <Route path="c-level" element={<CLevelDashboard />} />
              <Route path="balance-sheet" element={<BalanceSheetReport />} />
              <Route path="profit-loss" element={<ProfitLossReport />} />
              <Route path="trial-balance" element={<TrialBalanceReport />} />
              <Route path="ledger-outstanding" element={<LedgerOutstandingList />} />
              <Route path="ledger-outstanding/:ledgerId" element={<LedgerOutstandingBills />} />
              {/* Live (Tally) only — the pages render a "Not applicable" panel on the default pipeline. */}
              <Route path="ledger-voucher" element={<LedgerVoucherList />} />
              <Route path="ledger-voucher/:ledgerId" element={<LedgerVoucherStatement />} />
              {/* Source-agnostic — reads the precomputed rpt_sales_register snapshot, like the Sales Report. */}
              <Route path="sales-register" element={<SalesRegister />} />
              {/* Sales on approval, split out of the Sales Register — approval stock is not revenue
                  until it is billed. Reads the precomputed rpt_soa_register snapshot. */}
              <Route path="soa-sales-register" element={<SOARegister />} />
              {/* Tally Reports → Inventory Books. Reads the precomputed rpt_stock_summary_* snapshot
                  through the rpt_stock_summary_window RPC, so it is source-agnostic too. Carries its
                  own company + FY + period pickers — see FY_PINNED_ROUTES in ReportsLayout. */}
              <Route path="stock-summary" element={<StockSummary />} />
              {/* Bushra-Report → Batch Costing. Stock Journal-Production vouchers off ConnectWave
                  rpt_batch_line, classified per batch (lib/batchCostingRules.ts). Source-agnostic;
                  own company + FY + period pickers. */}
              <Route path="batch-costing" element={<BatchCosting />} />
              {/* Bushra-Report → Sales Register. The Tally Sales Register plus Item Type, Group,
                  Category and Colour (lib/bushraSalesRegister.ts). Own From/To window. */}
              <Route path="bushra-sales-register" element={<BushraSalesRegister />} />
              {/* Bushra-Report → Purchase Register. Purchases, returns and purchase debit notes with
                  Purchase-Type, Group, Category and Colour (lib/bushraPurchaseRegister.ts). */}
              <Route path="bushra-purchase-register" element={<BushraPurchaseRegister />} />
            </Route>
          </Route>

          {/* ── Bushra-Dashboard ───────────────────────────────────────────────────
              A SIBLING of the Reports branch above, not a child of it, and that is the
              whole point. It has always been gated by its OWN menu key, so nesting it
              under `RequireHubMenu menu="reports"` would quietly start demanding both —
              and a user granted the dashboards but not the report catalogue would lose
              screens they have today. The move was a move; it changed no grant.

              Its screens keep their own URL segment under this app's base rather than
              flattening into /reports/<slug>: they are a section with a landing page of
              its own, and their paths are shared verbatim with lib/reportCatalog's
              ROUTING table, which is what keeps the two lists agreeing. */}
          <Route element={<RequireHubMenu menu="bushra-dashboard" />}>
            {/* The landing page lists the dashboard groups (lib/bushraDashboards.ts), the way
                /reports lists report categories. Deliberately OUTSIDE RequireReportAccess, like
                the /reports landing: it shows only the screens the viewer holds, or says there
                are none. */}
            <Route path="bushra-dashboard" element={<BushraDashboards />} />
            <Route element={<RequireReportAccess />}>
              <Route path="bushra-dashboard/production-batch-costing" element={<ProductionBatchCostingDashboard />} />
              {/* Sales → every Sales dashboard (pure sales, each product, FOC, SOA, branch &
                  related): one screen, a preset per route (lib/bushraSalesDashboards.ts). The key
                  resets the filters when moving between them.

                  `p.path` is the CATALOGUE path ("bushra-dashboard/…"), which is relative to the
                  portal root — and this app's base is "/reports", so it is also exactly the route
                  path here. That is not a coincidence to rely on silently: see the ROUTING table
                  in lib/reportCatalog.ts, which is what makes both true at once. */}
              {SALES_DASHBOARDS.map((p) => (
                <Route key={p.id} path={p.path} element={<BushraSalesDashboard key={p.id} presetId={p.id} />} />
              ))}
              {/* The overhead half of batch costing: Direct & Indirect Expenses of the same
                  company, and the full cost of a kilogram once they are absorbed. */}
              <Route path="bushra-dashboard/production-expenses" element={<ProductionExpenses />} />
              {/* The third leg of the cost: caps, cans and stickers, which never touch a
                  production voucher. See lib/packingMaterial.ts for outward vs consumed. */}
              <Route path="bushra-dashboard/packing-material" element={<PackingMaterial />} />
              {/* Purchase → Purchase, Machines, Spare Parts, Service, Other: one screen, a preset per
                  route (lib/bushraPurchaseDashboards.ts). The key resets the filters between them. */}
              {PURCHASE_DASHBOARDS.map((p) => (
                <Route key={p.id} path={p.path} element={<BushraPurchaseDashboard key={p.id} presetId={p.id} />} />
              ))}
            </Route>
          </Route>

          {/* Last, so it only catches what neither branch above claimed. */}
          <Route path="*" element={<Navigate to="/reports" replace />} />
        </Route>
      </Routes>
    </ReceivablesSourceProvider>
  );
}

export default function ReportsApp() {
  return (
    <div className="hub-root">
      <LiveModeProvider>
        <ReceivablesScopeProvider>
          <FYProvider>
            <TooltipProvider>
              <Toaster />
              <Sonner />
              <ReportRoutes />
            </TooltipProvider>
          </FYProvider>
        </ReceivablesScopeProvider>
      </LiveModeProvider>
    </div>
  );
}
