import type { ReactNode } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useSession } from "@/core/platform/session";
import { ImportStoreProvider, useImportStore } from "./store";
import { SandboxProvider } from "@/shared/sandbox/SandboxContext";
import { useEffectiveIdentity } from "@/shared/sandbox/useEffectiveIdentity";
import SandboxLauncher from "./sandbox/SandboxLauncher";
import ImportLayout from "./ImportLayout";
import Dashboard from "./pages/Dashboard";
import Masters from "./pages/masters/Masters";
import MasterRequests from "./pages/MasterRequests";
import Setup from "./pages/settings/Setup";
import ControlCenter from "./pages/monitoring/ControlCenter";
import NewRequest from "./pages/requests/NewRequest";
import RequestsList from "./pages/requests/RequestsList";
import RequestDetail from "./pages/requests/RequestDetail";
import ApprovalsQueue from "./pages/queues/ApprovalsQueue";
import { SharePoQueue, CollectPiQueue, AdvanceQueue, FollowUpQueue, InwardQueue, TallyQueue } from "./pages/queues/PoQueues";
import PoWorkbench from "./pages/po/PoWorkbench";
import PoList from "./pages/po/PoList";
import PoDetail from "./pages/po/PoDetail";
import AccessDenied from "./pages/system/AccessDenied";
import NotFound from "./pages/system/NotFound";

/** Gate to admins + any assigned master manager (masters + master-requests area). */
function RequireMasterAccess({ children }: { children: ReactNode }) {
  const { isAnyManager } = useImportStore();
  if (!isAnyManager) return <AccessDenied />;
  return <>{children}</>;
}

/** Gate to admins only (Setup) — persona-aware so "acting as" a non-admin hides it. */
function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAdmin } = useEffectiveIdentity();
  if (!isAdmin) return <AccessDenied />;
  return <>{children}</>;
}

/** Gate to the REAL signed-in admin (entry into demo mode), ignoring any persona. */
function RequireRealAdmin({ children }: { children: ReactNode }) {
  const { isAdmin } = useSession();
  if (!isAdmin) return <AccessDenied />;
  return <>{children}</>;
}

/** Gate to admins + process coordinators (Control Center). */
function RequireMonitor({ children }: { children: ReactNode }) {
  const { isProcessCoordinator } = useImportStore();
  if (!isProcessCoordinator) return <AccessDenied />;
  return <>{children}</>;
}

/**
 * Root of the Purchase FMS (import) app. Owns all routing under
 * /import, beneath the live data store. Routes are added stage by stage as
 * each build phase lands (requests, queues, PO detail, setup, monitoring).
 */
export default function ImportApp() {
  // scope "proc" keeps the original sessionStorage keys, so a demo session already
  // open across a refresh is not lost.
  return (
    <SandboxProvider scope="import" homePath="/import">
      <ImportStoreProvider>
        <Routes>
          <Route element={<ImportLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="requests" element={<RequestsList />} />
            <Route path="requests/new" element={<NewRequest />} />
            <Route path="requests/:id" element={<RequestDetail />} />
            {/* No Sourcing queue in Import — vendors + pricing are fixed masters. */}
            <Route path="queues/approvals" element={<ApprovalsQueue />} />
            <Route path="queues/share" element={<SharePoQueue />} />
            <Route path="queues/collect-pi" element={<CollectPiQueue />} />
            <Route path="queues/advance" element={<AdvanceQueue />} />
            <Route path="queues/follow-up" element={<FollowUpQueue />} />
            <Route path="queues/inward" element={<InwardQueue />} />
            <Route path="queues/tally" element={<TallyQueue />} />
            <Route path="po/workbench" element={<PoWorkbench />} />
            <Route path="pos" element={<PoList />} />
            <Route path="pos/:id" element={<PoDetail />} />
            <Route path="masters" element={<RequireMasterAccess><Masters /></RequireMasterAccess>} />
            {/* Open to everyone: owners get the review queue, everyone else their
                own requests. The page scopes itself. */}
            <Route path="master-requests" element={<MasterRequests />} />
            <Route path="monitoring" element={<RequireMonitor><ControlCenter /></RequireMonitor>} />
            <Route path="settings" element={<RequireAdmin><Setup /></RequireAdmin>} />
            <Route path="sandbox" element={<RequireRealAdmin><SandboxLauncher /></RequireRealAdmin>} />
            <Route path="*" element={<NotFound />} />
          </Route>
          <Route path="*" element={<Navigate to="/import" replace />} />
        </Routes>
      </ImportStoreProvider>
    </SandboxProvider>
  );
}
