import type { ReactNode } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useSession } from "@/core/platform/session";
import { SandboxProvider } from "@/shared/sandbox/SandboxContext";
import { useEffectiveIdentity } from "@/shared/sandbox/useEffectiveIdentity";
import { HrStoreProvider, useHrStore } from "./store";
import HrLayout from "./HrLayout";
import Dashboard from "./pages/Dashboard";
import NewMrf from "./pages/requisitions/NewMrf";
import MrfList from "./pages/requisitions/MrfList";
import MrfDetail from "./pages/requisitions/MrfDetail";
import { MrfApprovalsQueue, JobPostingQueue } from "./pages/queues/RequisitionQueues";
import PipelineQueue from "./pages/queues/PipelineQueue";
import InterviewsQueue from "./pages/queues/InterviewsQueue";
import OnboardingQueue from "./pages/queues/OnboardingQueue";
import ProbationQueue from "./pages/queues/ProbationQueue";
import ControlCenter from "./pages/monitoring/ControlCenter";
import Masters from "./pages/masters/Masters";
import MasterRequests from "./pages/MasterRequests";
import Setup from "./pages/settings/Setup";
import SandboxLauncher from "./sandbox/SandboxLauncher";
import AccessDenied from "./pages/system/AccessDenied";
import NotFound from "./pages/system/NotFound";

/** Gate to admins only (Setup) — persona-aware, so "acting as" a non-admin hides it. */
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
  const { isProcessCoordinator } = useHrStore();
  if (!isProcessCoordinator) return <AccessDenied />;
  return <>{children}</>;
}

/**
 * Gate to admins + any assigned master owner (the Masters page). Deliberately NOT
 * admin-only: the whole point of Master Owners is that, say, a Locations owner can
 * open Masters and edit Locations without being an admin (the other tabs render
 * read-only, and RLS agrees).
 */
function RequireMasterAccess({ children }: { children: ReactNode }) {
  const { isAnyMasterManager } = useHrStore();
  if (!isAnyMasterManager) return <AccessDenied />;
  return <>{children}</>;
}

/**
 * Root of the HR Recruitment FMS. Owns all routing under /hr-recruitment, beneath
 * the live data store. Routes are added stage by stage as each build phase lands
 * (requisitions, the candidate board, onboarding, probation, monitoring).
 */
export default function HrApp() {
  return (
    <SandboxProvider scope="hr" homePath="/hr-recruitment">
      <HrStoreProvider>
        <Routes>
          <Route element={<HrLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="requisitions" element={<MrfList />} />
            <Route path="requisitions/new" element={<NewMrf />} />
            <Route path="requisitions/:id" element={<MrfDetail />} />
            <Route path="queues/approvals" element={<MrfApprovalsQueue />} />
            <Route path="queues/posting" element={<JobPostingQueue />} />
            <Route path="queues/pipeline" element={<PipelineQueue />} />
            <Route path="queues/interviews" element={<InterviewsQueue />} />
            <Route path="queues/onboarding" element={<OnboardingQueue />} />
            <Route path="queues/probation" element={<ProbationQueue />} />
            <Route path="monitoring" element={<RequireMonitor><ControlCenter /></RequireMonitor>} />
            <Route path="masters" element={<RequireMasterAccess><Masters /></RequireMasterAccess>} />
            {/* Open to everyone: owners get the review queue, everyone else gets
                their own requests. The page scopes itself. */}
            <Route path="master-requests" element={<MasterRequests />} />
            <Route path="settings" element={<RequireAdmin><Setup /></RequireAdmin>} />
            <Route path="sandbox" element={<RequireRealAdmin><SandboxLauncher /></RequireRealAdmin>} />
            <Route path="*" element={<NotFound />} />
          </Route>
          <Route path="*" element={<Navigate to="/hr-recruitment" replace />} />
        </Routes>
      </HrStoreProvider>
    </SandboxProvider>
  );
}
