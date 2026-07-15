import type { ReactNode } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useSession } from "@/core/platform/session";
import { SuppliesStoreProvider, useSuppliesStore } from "./store";
import SuppliesLayout from "./SuppliesLayout";
import Dashboard from "./pages/Dashboard";
import NewRequest from "./pages/requests/NewRequest";
import MyRequests from "./pages/requests/MyRequests";
import RequestsList from "./pages/requests/RequestsList";
import RequestDetail from "./pages/requests/RequestDetail";
import FirstApprovalQueue from "./pages/queues/FirstApprovalQueue";
import SecondApprovalQueue from "./pages/queues/SecondApprovalQueue";
import HandoverQueue from "./pages/queues/HandoverQueue";
import Masters from "./pages/masters/Masters";
import MasterRequests from "./pages/MasterRequests";
import ControlCenter from "./pages/monitoring/ControlCenter";
import Setup from "./pages/settings/Setup";
import AccessDenied from "./pages/system/AccessDenied";
import NotFound from "./pages/system/NotFound";

/** Gate to admins only (Setup). */
function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAdmin } = useSession();
  if (!isAdmin) return <AccessDenied />;
  return <>{children}</>;
}

/** Gate to admins + process coordinators (the Control Center). */
function RequireMonitor({ children }: { children: ReactNode }) {
  const { isProcessCoordinator } = useSuppliesStore();
  if (!isProcessCoordinator) return <AccessDenied />;
  return <>{children}</>;
}

/** Gate to admins + any assigned master owner (the Masters page). */
function RequireMasterAccess({ children }: { children: ReactNode }) {
  const { isAnyMasterManager } = useSuppliesStore();
  if (!isAnyMasterManager) return <AccessDenied />;
  return <>{children}</>;
}

/**
 * Root of the Office Supplies FMS. There is no <RequireModule> and no per-user grant:
 * this is a universal app (apps/universal.ts), so App.tsx mounts it for every signed-in
 * user. What each person can see is decided by the nav, the store's capability flags
 * and — authoritatively — RLS.
 */
export default function SuppliesApp() {
  return (
    <SuppliesStoreProvider>
      <Routes>
        <Route element={<SuppliesLayout />}>
          <Route index element={<Dashboard />} />
          {/* The two ungated screens — every employee can raise a request. "new" must
              come before ":id" or "new" would be read as an id. */}
          <Route path="requests/new" element={<NewRequest />} />
          <Route path="my-requests" element={<MyRequests />} />
          {/* Gated by RLS, not a route guard: fms_supplies_can_read_request returns zero
              rows to someone with no business here. */}
          <Route path="requests" element={<RequestsList />} />
          <Route path="requests/:id" element={<RequestDetail />} />
          <Route path="queues/first-approval" element={<FirstApprovalQueue />} />
          <Route path="queues/second-approval" element={<SecondApprovalQueue />} />
          <Route path="queues/handover" element={<HandoverQueue />} />
          <Route path="monitoring" element={<RequireMonitor><ControlCenter /></RequireMonitor>} />
          <Route path="masters" element={<RequireMasterAccess><Masters /></RequireMasterAccess>} />
          <Route path="master-requests" element={<MasterRequests />} />
          <Route path="settings" element={<RequireAdmin><Setup /></RequireAdmin>} />
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route path="*" element={<Navigate to="/office-supplies" replace />} />
      </Routes>
    </SuppliesStoreProvider>
  );
}
