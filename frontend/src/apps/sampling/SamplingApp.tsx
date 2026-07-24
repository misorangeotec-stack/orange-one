import type { ReactNode } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useSession } from "@/core/platform/session";
import { SamplingStoreProvider, useSamplingStore } from "./store";
import SamplingLayout from "./SamplingLayout";
import Dashboard from "./pages/Dashboard";
import NewRequest from "./pages/requests/NewRequest";
import MyRequests from "./pages/requests/MyRequests";
import RequestsList from "./pages/requests/RequestsList";
import RequestDetail from "./pages/requests/RequestDetail";
import ReceiveQueue from "./pages/queues/ReceiveQueue";
import CollectQueue from "./pages/queues/CollectQueue";
import SampleReceivedQueue from "./pages/queues/SampleReceivedQueue";
import SampleToLabQueue from "./pages/queues/SampleToLabQueue";
import LabProcessQueue from "./pages/queues/LabProcessQueue";
import ResultReceivedQueue from "./pages/queues/ResultReceivedQueue";
import SendQueue from "./pages/queues/SendQueue";
import ConfirmQueue from "./pages/queues/ConfirmQueue";
import TestingQueue from "./pages/queues/TestingQueue";
import ResultQueue from "./pages/queues/ResultQueue";
import HandoverQueue from "./pages/queues/HandoverQueue";
import Masters from "./pages/masters/Masters";
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
  const { isProcessCoordinator } = useSamplingStore();
  if (!isProcessCoordinator) return <AccessDenied />;
  return <>{children}</>;
}

/** Gate to admins + any assigned master owner (the Masters page). */
function RequireMasterAccess({ children }: { children: ReactNode }) {
  const { isAnyMasterManager } = useSamplingStore();
  if (!isAnyMasterManager) return <AccessDenied />;
  return <>{children}</>;
}

/**
 * Root of the Sampling FMS. Mounted per-user (App.tsx wraps it in RequireModule),
 * so what each person can see is decided by the nav, the store's capability flags
 * and — authoritatively — RLS.
 */
export default function SamplingApp() {
  return (
    <SamplingStoreProvider>
      <Routes>
        <Route element={<SamplingLayout />}>
          <Route index element={<Dashboard />} />
          {/* "new" must come before ":id" or "new" would be read as an id. */}
          <Route path="requests/new" element={<NewRequest />} />
          <Route path="my-requests" element={<MyRequests />} />
          {/* The branch lists sit OUTSIDE /requests on purpose: nested under it they
              would keep the "All Requests" link highlighted alongside their own. */}
          <Route path="lab-requests" element={<RequestsList branch="lab" />} />
          <Route path="no-lab-requests" element={<RequestsList branch="no_lab" />} />
          <Route path="outward-requests" element={<RequestsList branch="outward" />} />
          <Route path="requests" element={<RequestsList />} />
          <Route path="requests/:id" element={<RequestDetail />} />
          <Route path="queues/receive" element={<ReceiveQueue />} />
          <Route path="queues/collect" element={<CollectQueue />} />
          <Route path="queues/received" element={<SampleReceivedQueue />} />
          <Route path="queues/to-lab" element={<SampleToLabQueue />} />
          <Route path="queues/lab" element={<LabProcessQueue />} />
          <Route path="queues/result-received" element={<ResultReceivedQueue />} />
          <Route path="queues/send" element={<SendQueue />} />
          <Route path="queues/confirm" element={<ConfirmQueue />} />
          <Route path="queues/testing" element={<TestingQueue />} />
          <Route path="queues/result" element={<ResultQueue />} />
          <Route path="queues/handover" element={<HandoverQueue />} />
          <Route path="monitoring" element={<RequireMonitor><ControlCenter /></RequireMonitor>} />
          <Route path="masters" element={<RequireMasterAccess><Masters /></RequireMasterAccess>} />
          <Route path="settings" element={<RequireAdmin><Setup /></RequireAdmin>} />
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route path="*" element={<Navigate to="/sampling" replace />} />
      </Routes>
    </SamplingStoreProvider>
  );
}
