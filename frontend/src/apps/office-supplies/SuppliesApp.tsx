import type { ReactNode } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useSession } from "@/core/platform/session";
import { SuppliesStoreProvider, useSuppliesStore } from "./store";
import type { StepKey } from "./lib/steps";
import SuppliesLayout from "./SuppliesLayout";
import Dashboard from "./pages/Dashboard";
import NewRequest from "./pages/requests/NewRequest";
import EditRequest from "./pages/requests/EditRequest";
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
import { B } from "./lib/routes";

/** Gate to admins only (Setup). */
function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAdmin } = useSession();
  if (!isAdmin) return <AccessDenied />;
  return <>{children}</>;
}

/**
 * Gate to the people an admin has named as requesters, in Setup → Raising & Routing
 * (plus admins). Raising used to be open to everyone holding the module grant.
 *
 * ⚠ Not the gate — fms_supplies_submit_request is. This only saves someone a
 *   filled-in form they would be refused at the end of.
 */
function RequireRaise({ children }: { children: ReactNode }) {
  const { canRaise } = useSuppliesStore();
  if (!canRaise) return <AccessDenied />;
  return <>{children}</>;
}

/** Gate to admins + process coordinators (the Control Center). */
function RequireMonitor({ children }: { children: ReactNode }) {
  const { canMonitor } = useSuppliesStore();
  if (!canMonitor) return <AccessDenied />;
  return <>{children}</>;
}

/** Gate to admins + any assigned master owner (the Masters page). */
function RequireMasterAccess({ children }: { children: ReactNode }) {
  const { canSeeMasters } = useSuppliesStore();
  if (!canSeeMasters) return <AccessDenied />;
  return <>{children}</>;
}

/**
 * Gate to one step's queue — its owners, plus the coordinators. First approval is
 * the exception the store's `canSeeQueue` encodes: it belongs to department HODs,
 * who own no step. Same predicate the nav uses, so the two cannot disagree.
 */
function RequireQueue({ step, children }: { step: StepKey; children: ReactNode }) {
  const { canSeeQueue } = useSuppliesStore();
  if (!canSeeQueue(step)) return <AccessDenied />;
  return <>{children}</>;
}

/**
 * Root of the General Purchase FMS. App.tsx already wraps this whole app in
 * <RequireModule appId="office-supplies">, so only admins and users granted the module
 * in Module access reach it — this file adds no further gate of its own. What each
 * person then sees inside is decided by the nav, the store's capability flags and —
 * authoritatively — RLS.
 */
export default function SuppliesApp() {
  return (
    <SuppliesStoreProvider>
      <Routes>
        <Route element={<SuppliesLayout />}>
          <Route index element={<Dashboard />} />
          {/* "new" must come before ":id" or "new" would be read as an id.
              Raising is gated to the configured requesters; "My Requests" is NOT —
              someone dropped from that list must still be able to follow, edit and
              cancel the requests they already raised. */}
          <Route path="requests/new" element={<RequireRaise><NewRequest /></RequireRaise>} />
          <Route path="my-requests" element={<MyRequests />} />
          {/* Gated by RLS, not a route guard: fms_supplies_can_read_request returns zero
              rows to someone with no business here. */}
          <Route path="requests" element={<RequestsList />} />
          <Route path="requests/:id" element={<RequestDetail />} />
          <Route path="requests/:id/edit" element={<EditRequest />} />
          <Route path="queues/first-approval" element={<RequireQueue step="first_approval"><FirstApprovalQueue /></RequireQueue>} />
          <Route path="queues/second-approval" element={<RequireQueue step="second_approval"><SecondApprovalQueue /></RequireQueue>} />
          <Route path="queues/handover" element={<RequireQueue step="handover"><HandoverQueue /></RequireQueue>} />
          <Route path="monitoring" element={<RequireMonitor><ControlCenter /></RequireMonitor>} />
          <Route path="masters" element={<RequireMasterAccess><Masters /></RequireMasterAccess>} />
          <Route path="master-requests" element={<MasterRequests />} />
          <Route path="settings" element={<RequireAdmin><Setup /></RequireAdmin>} />
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route path="*" element={<Navigate to={B} replace />} />
      </Routes>
    </SuppliesStoreProvider>
  );
}
