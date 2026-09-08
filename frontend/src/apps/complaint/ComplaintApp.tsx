import type { ReactNode } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useSession } from "@/core/platform/session";
import { ComplaintStoreProvider, useComplaintStore } from "./store";
import type { StepKey } from "./lib/steps";
import { B } from "./lib/routes";
import ComplaintLayout from "./ComplaintLayout";
import Dashboard from "./pages/Dashboard";
import NewRequest from "./pages/requests/NewRequest";
import RequestsList from "./pages/requests/RequestsList";
import RequestDetail from "./pages/requests/RequestDetail";
import PlantQueue from "./pages/queues/PlantQueue";
import ServiceQueue from "./pages/queues/ServiceQueue";
import ApprovalQueue from "./pages/queues/ApprovalQueue";
import ManagementReviewQueue from "./pages/queues/ManagementReviewQueue";
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

/*
  The guards below take the VISIBILITY halves — canMonitor / canSeeMasters — not
  isProcessCoordinator / isAnyMasterManager. They differ by exactly the view-only
  arm, and the authority flags are deliberately left out: isProcessCoordinator is
  also the short-circuit inside canActOn, so guarding on it would mean widening a
  permission in order to open a read-only screen.
*/

/** Gate to admins + process coordinators + view-only readers (the Control Center). */
function RequireMonitor({ children }: { children: ReactNode }) {
  const { canMonitor } = useComplaintStore();
  if (!canMonitor) return <AccessDenied />;
  return <>{children}</>;
}

/** Gate to admins, any assigned master owner, and a view-only reader (the Masters pages). */
function RequireMasterAccess({ children }: { children: ReactNode }) {
  const { canSeeMasters } = useComplaintStore();
  if (!canSeeMasters) return <AccessDenied />;
  return <>{children}</>;
}

/**
 * Gate to raising a complaint.
 *
 * A hidden link is not a guard: `requests/new` is reachable by typing the URL,
 * and it renders a full form with a working Submit. `canRaise` already folds in
 * the write ceiling and the (optional) Setup restriction on who may raise.
 */
function RequireRaise({ children }: { children: ReactNode }) {
  const { canRaise } = useComplaintStore();
  if (!canRaise) return <AccessDenied />;
  return <>{children}</>;
}

/**
 * Gate to one step's queue. `canSeeQueue` carries the whole rule — step owners,
 * coordinators, view-only readers, and the per-request assignees who own no step
 * — so this enforces exactly what ComplaintLayout offers in the sidebar.
 */
function RequireQueue({ step, children }: { step: StepKey; children: ReactNode }) {
  const { canSeeQueue } = useComplaintStore();
  if (!canSeeQueue(step)) return <AccessDenied />;
  return <>{children}</>;
}

/**
 * Root of the Complaint (RM/FG) FMS. Mounted per-user (App.tsx wraps it in
 * RequireModule), so what each person can see is decided by the nav, the store's
 * capability flags and — authoritatively — RLS.
 */
export default function ComplaintApp() {
  return (
    <ComplaintStoreProvider>
      <Routes>
        <Route element={<ComplaintLayout />}>
          <Route index element={<Dashboard />} />
          {/* "new" must come before ":id", or "new" is read as an id. */}
          <Route path="requests/new" element={<RequireRaise><NewRequest /></RequireRaise>} />
          <Route path="requests" element={<RequestsList />} />
          <Route path="requests/:id" element={<RequestDetail />} />
          <Route path="my-requests" element={<RequestsList mine />} />
          <Route path="queues/plant" element={<RequireQueue step="plant"><PlantQueue /></RequireQueue>} />
          <Route path="queues/service" element={<RequireQueue step="service"><ServiceQueue /></RequireQueue>} />
          <Route path="queues/approval" element={<RequireQueue step="approval"><ApprovalQueue /></RequireQueue>} />
          <Route path="queues/management-review" element={<RequireQueue step="management_review"><ManagementReviewQueue /></RequireQueue>} />
          <Route path="master-requests" element={<RequireMasterAccess><MasterRequests /></RequireMasterAccess>} />
          <Route path="monitoring" element={<RequireMonitor><ControlCenter /></RequireMonitor>} />
          <Route path="masters" element={<RequireMasterAccess><Masters /></RequireMasterAccess>} />
          <Route path="settings" element={<RequireAdmin><Setup /></RequireAdmin>} />
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route path="*" element={<Navigate to={B} replace />} />
      </Routes>
    </ComplaintStoreProvider>
  );
}

/*
 * The guards above are exported for the route table that lands with the request,
 * queue, masters and settings pages. They live here, beside the routes they
 * protect, rather than in a lib file: a guard away from its <Route> is a guard
 * somebody forgets to apply.
 */
export { RequireAdmin, RequireMonitor, RequireMasterAccess, RequireRaise, RequireQueue };
