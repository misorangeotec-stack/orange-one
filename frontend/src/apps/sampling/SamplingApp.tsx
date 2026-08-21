import type { ReactNode } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useSession } from "@/core/platform/session";
import { SamplingStoreProvider, useSamplingStore } from "./store";
import type { StepKey } from "./lib/steps";
import SamplingLayout from "./SamplingLayout";
import Dashboard from "./pages/Dashboard";
import NewRequest from "./pages/requests/NewRequest";
import MyRequests from "./pages/requests/MyRequests";
import RequestsList from "./pages/requests/RequestsList";
import RequestDetail from "./pages/requests/RequestDetail";
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
/*
  Both guards take the VISIBILITY halves — canMonitor / canSeeMasters — not
  isProcessCoordinator / isAnyMasterManager. They differ by exactly the view-only
  arm, and the authority flags are deliberately left out: isProcessCoordinator is
  also the short-circuit inside canActOn, so guarding on it would have meant
  widening a permission in order to open a read-only screen.
*/
function RequireMonitor({ children }: { children: ReactNode }) {
  const { canMonitor } = useSamplingStore();
  if (!canMonitor) return <AccessDenied />;
  return <>{children}</>;
}

/** Gate to admins, any assigned master owner, and a view-only reader (the Masters page). */
function RequireMasterAccess({ children }: { children: ReactNode }) {
  const { canSeeMasters } = useSamplingStore();
  if (!canSeeMasters) return <AccessDenied />;
  return <>{children}</>;
}

/**
 * Gate to anything that CREATES or CHANGES something. A view-only grant hides the
 * links, but a hidden link is not a guard — `requests/new` was reachable by typing
 * the URL, and it renders a full form with a working Submit.
 */
function RequireEdit({ children }: { children: ReactNode }) {
  const { canEdit } = useSamplingStore();
  if (!canEdit) return <AccessDenied />;
  return <>{children}</>;
}

/**
 * Gate to one step's queue. `canSeeQueue` carries the whole rule — step owners,
 * coordinators, and the per-request assignees who own no step — so this enforces
 * exactly what SamplingLayout offers in the sidebar.
 */
function RequireQueue({ step, children }: { step: StepKey; children: ReactNode }) {
  const { canSeeQueue } = useSamplingStore();
  if (!canSeeQueue(step)) return <AccessDenied />;
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
          <Route path="requests/new" element={<RequireEdit><NewRequest /></RequireEdit>} />
          <Route path="my-requests" element={<MyRequests />} />
          {/* The branch lists sit OUTSIDE /requests on purpose: nested under it they
              would keep the "All Requests" link highlighted alongside their own. */}
          <Route path="lab-requests" element={<RequestsList branch="lab" />} />
          <Route path="no-lab-requests" element={<RequestsList branch="no_lab" />} />
          <Route path="outward-requests" element={<RequestsList branch="outward" />} />
          <Route path="requests" element={<RequestsList />} />
          <Route path="requests/:id" element={<RequestDetail />} />
          {/* "Sample Received at Lab" retired 08-08-2026 — its rows moved to collect.
              Kept as a redirect so an old bookmark or email link still lands somewhere. */}
          <Route path="queues/receive" element={<Navigate to="/sampling/queues/collect" replace />} />
          <Route path="queues/collect" element={<RequireQueue step="sample_collect"><CollectQueue /></RequireQueue>} />
          <Route path="queues/received" element={<RequireQueue step="sample_received"><SampleReceivedQueue /></RequireQueue>} />
          <Route path="queues/to-lab" element={<RequireQueue step="sample_to_lab"><SampleToLabQueue /></RequireQueue>} />
          <Route path="queues/lab" element={<RequireQueue step="lab_process"><LabProcessQueue /></RequireQueue>} />
          <Route path="queues/result-received" element={<RequireQueue step="result_received"><ResultReceivedQueue /></RequireQueue>} />
          <Route path="queues/send" element={<RequireQueue step="send_sample"><SendQueue /></RequireQueue>} />
          <Route path="queues/confirm" element={<RequireQueue step="confirm_receipt"><ConfirmQueue /></RequireQueue>} />
          <Route path="queues/testing" element={<RequireQueue step="testing"><TestingQueue /></RequireQueue>} />
          <Route path="queues/result" element={<RequireQueue step="result"><ResultQueue /></RequireQueue>} />
          <Route path="queues/handover" element={<RequireQueue step="result_handover"><HandoverQueue /></RequireQueue>} />
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
