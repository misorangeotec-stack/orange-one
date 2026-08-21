import type { ReactNode } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useSession } from "@/core/platform/session";
import { AssetStoreProvider, useAssetStore } from "./store";
import type { QueueStep } from "./lib/queues";
import AssetMaintenanceLayout from "./AssetMaintenanceLayout";
import Loaded from "./components/Loaded";
import Dashboard from "./pages/Dashboard";
import Calendar from "./pages/Calendar";
import AssetsList from "./pages/assets/AssetsList";
import NewAsset from "./pages/assets/NewAsset";
import EditAsset from "./pages/assets/EditAsset";
import AssetDetail from "./pages/assets/AssetDetail";
import ImportAssets from "./pages/assets/ImportAssets";
import JobsList from "./pages/jobs/JobsList";
import JobDetail from "./pages/jobs/JobDetail";
import ScheduleQueue from "./pages/queues/ScheduleQueue";
import ServiceQueue from "./pages/queues/ServiceQueue";
import VerifyQueue from "./pages/queues/VerifyQueue";
import Reports from "./pages/reports/Reports";
import Masters from "./pages/masters/Masters";
import MasterRequests from "./pages/MasterRequests";
import ControlCenter from "./pages/monitoring/ControlCenter";
import Setup from "./pages/settings/Setup";
import AccessDenied from "./pages/system/AccessDenied";
import NotFound from "./pages/system/NotFound";

function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAdmin } = useSession();
  if (!isAdmin) return <AccessDenied />;
  return <>{children}</>;
}

/*
  Both guards take the VISIBILITY halves — canMonitor / canSeeMasters — not
  isProcessCoordinator / isAnyMasterManager. They differ by exactly the view-only
  arm, and the authority flags stay out: isProcessCoordinator is also the
  short-circuit inside canActOn, so guarding on it would have meant widening a
  permission in order to open a read-only screen.
*/
function RequireMonitor({ children }: { children: ReactNode }) {
  const { canMonitor } = useAssetStore();
  if (!canMonitor) return <AccessDenied />;
  return <>{children}</>;
}

function RequireMasterAccess({ children }: { children: ReactNode }) {
  const { canSeeMasters } = useAssetStore();
  if (!canSeeMasters) return <AccessDenied />;
  return <>{children}</>;
}

/**
 * One step's queue, for its owners, the coordinators, and a custodian with work in
 * it. Same predicate the nav uses, so the sidebar can never offer a screen that then
 * refuses you, and no screen is reachable that the sidebar deliberately hid.
 *
 * ⚠ Must sit INSIDE <Loaded>, like the gates above it — `canSeeQueue` is derived
 *   from the module's first fetch, so gating before it resolves would bounce a
 *   legitimate owner to Access Denied on a slow load.
 */
function RequireQueue({ step, children }: { step: QueueStep; children: ReactNode }) {
  const { canSeeQueue } = useAssetStore();
  if (!canSeeQueue(step)) return <AccessDenied />;
  return <>{children}</>;
}

/**
 * Root of the Asset Maintenance FMS. Mounted per-user (App.tsx wraps it in
 * RequireModule); what each person sees is decided by the nav, the store's
 * capability flags and — authoritatively — RLS plus the RPCs' own authz.
 */
export default function AssetMaintenanceApp() {
  return (
    <AssetStoreProvider>
      <Routes>
        {/*
          Every page is wrapped in <Loaded>: until the module's first fetch
          resolves, a page would otherwise render empty lists and zero counts with
          empty-state copy that reads as fact ("No assets yet", "Nothing overdue").
          The permission gates sit INSIDE it, because `isProcessCoordinator` and
          `isAnyMasterManager` are themselves derived from that same fetch — gating
          first would bounce a legitimate coordinator to Access Denied on a slow load.
        */}
        <Route element={<AssetMaintenanceLayout />}>
          <Route index element={<Loaded><Dashboard /></Loaded>} />
          <Route path="calendar" element={<Loaded><Calendar /></Loaded>} />

          {/* "new" and "import" must come before ":id" or they'd be read as ids. */}
          <Route path="assets/new" element={<Loaded><NewAsset /></Loaded>} />
          <Route path="assets/import" element={<Loaded><ImportAssets /></Loaded>} />
          <Route path="assets" element={<Loaded><AssetsList /></Loaded>} />
          {/* ":id/edit" must come before ":id" would swallow "edit". */}
          <Route path="assets/:id/edit" element={<Loaded><EditAsset /></Loaded>} />
          <Route path="assets/:id" element={<Loaded><AssetDetail /></Loaded>} />

          <Route path="jobs" element={<Loaded><JobsList /></Loaded>} />
          <Route path="jobs/:id" element={<Loaded><JobDetail /></Loaded>} />

          <Route path="queues/schedule" element={<Loaded><RequireQueue step="schedule"><ScheduleQueue /></RequireQueue></Loaded>} />
          <Route path="queues/service" element={<Loaded><RequireQueue step="service_done"><ServiceQueue /></RequireQueue></Loaded>} />
          <Route path="queues/verify" element={<Loaded><RequireQueue step="verify_close"><VerifyQueue /></RequireQueue></Loaded>} />

          <Route path="master-requests" element={<Loaded><MasterRequests /></Loaded>} />
          <Route path="reports" element={<Loaded><Reports /></Loaded>} />
          <Route path="monitoring" element={<Loaded><RequireMonitor><ControlCenter /></RequireMonitor></Loaded>} />
          <Route path="masters" element={<Loaded><RequireMasterAccess><Masters /></RequireMasterAccess></Loaded>} />
          <Route path="settings" element={<Loaded><RequireAdmin><Setup /></RequireAdmin></Loaded>} />
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route path="*" element={<Navigate to="/asset-maintenance" replace />} />
      </Routes>
    </AssetStoreProvider>
  );
}
