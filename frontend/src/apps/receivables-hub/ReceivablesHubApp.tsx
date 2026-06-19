import { Routes, Route, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@hub/components/ui/sonner";
import { Toaster } from "@hub/components/ui/toaster";
import { TooltipProvider } from "@hub/components/ui/tooltip";
import { FYProvider } from "@hub/lib/fyContext";
import { ReceivablesScopeProvider } from "@hub/lib/scope";
import UserLayout from "@hub/layouts/UserLayout";
import Dashboard from "@hub/pages/Dashboard";
import CustomerRiskRegister from "@hub/pages/CustomerRiskRegister";
import SalespersonAnalysis from "@hub/pages/SalespersonAnalysis";
import SalespersonCollectionReport from "@hub/pages/SalespersonCollectionReport";
import CustomerDetail from "@hub/pages/CustomerDetail";
import ImportDashboard from "@hub/pages/ImportDashboard";
import Reports from "@hub/pages/Reports";
import AgingReport from "@hub/pages/AgingReport";
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
 * Hub's design tokens (see src/index.css). Chat + admin are out of scope for
 * phase 1; EXIM / Alerts are deferred.
 */
export default function ReceivablesHubApp() {
  return (
    <div className="hub-root">
      <ReceivablesScopeProvider>
      <FYProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <Routes>
            <Route element={<UserLayout />}>
              <Route index element={<Dashboard />} />
              <Route path="risk-register" element={<CustomerRiskRegister />} />
              <Route path="salesperson-analysis" element={<SalespersonAnalysis />} />
              <Route path="salesperson-collection" element={<SalespersonCollectionReport />} />
              <Route path="customer/:id" element={<CustomerDetail />} />
              <Route path="group/:id" element={<CustomerDetail />} />
              <Route path="import" element={<ImportDashboard />} />
              <Route path="reports" element={<Reports />} />
              <Route path="reports/aging" element={<AgingReport />} />
              <Route path="saved-views" element={<SavedViews />} />
              <Route path="profile" element={<Profile />} />
              <Route path="settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/outstanding-dashboard" replace />} />
            </Route>
          </Routes>
        </TooltipProvider>
      </FYProvider>
      </ReceivablesScopeProvider>
    </div>
  );
}
