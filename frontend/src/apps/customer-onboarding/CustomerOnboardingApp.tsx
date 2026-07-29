/**
 * Root of the standalone New Customer Onboarding app.
 *
 * ⚠ THE PAGES LIVE UNDER apps/receivables-hub/ AND STAY THERE.
 *   Every one of them is built from hub-native (shadcn) components. The portal's
 *   own shared/ui hard-codes Orange One's hex tokens, and `.hub-root` does not
 *   remap them — so relocating the files would mean rewriting all forty of them
 *   against a different design system for no user-visible gain. This app is
 *   therefore a SHELL: its own basePath, sidebar and portal chrome, wrapping the
 *   existing subtree in the `.hub-root` div those components need for their CSS
 *   variables to resolve.
 *
 * ⚠ THE `.hub-root` WRAPPER IS LOAD-BEARING, not cosmetic. Drop it and every
 *   shadcn colour token inside falls back to unset — the pages render, but
 *   unreadably.
 *
 * The route table below is a move, not a copy: ReceivablesHubApp no longer
 * serves these paths, it redirects to them.
 */
import { Routes, Route, Navigate } from "react-router-dom";
import { TooltipProvider } from "@hub/components/ui/tooltip";
import { Toaster } from "@hub/components/ui/toaster";
import { CustomerOnboardingProvider } from "@hub/lib/customerOnboarding/store";
import OnboardingLayout from "./OnboardingLayout";
import Home from "@hub/pages/customerOnboarding/Home";
import NewCustomer from "@hub/pages/customerOnboarding/NewCustomer";
import MyRequests from "@hub/pages/customerOnboarding/MyRequests";
import AllRequests from "@hub/pages/customerOnboarding/AllRequests";
import PendingQueue from "@hub/pages/customerOnboarding/PendingQueue";
import RequestDetail from "@hub/pages/customerOnboarding/RequestDetail";
import CustomerSettings from "@hub/pages/customerOnboarding/settings/CustomerSettings";

export default function CustomerOnboardingApp() {
  return (
    <div className="hub-root">
      <CustomerOnboardingProvider>
        <TooltipProvider>
          <Toaster />
          <Routes>
            <Route element={<OnboardingLayout />}>
              <Route index element={<Home />} />
              <Route path="new" element={<NewCustomer />} />
              <Route path="mine" element={<MyRequests />} />
              <Route path="all" element={<AllRequests />} />
              {/* ONE queue page for all four back-office steps, keyed by ?step=.
                  Four routes would be four copies of the same table drifting
                  apart on what a column means. */}
              <Route path="queue" element={<PendingQueue />} />
              <Route path="settings" element={<CustomerSettings />} />
              <Route path="requests/:id" element={<RequestDetail />} />
              <Route path="requests/:id/edit" element={<NewCustomer />} />
              <Route path="*" element={<Navigate to="/customer-onboarding" replace />} />
            </Route>
          </Routes>
        </TooltipProvider>
      </CustomerOnboardingProvider>
    </div>
  );
}
