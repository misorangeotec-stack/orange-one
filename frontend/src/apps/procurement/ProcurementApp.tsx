import type { ReactNode } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useSession } from "@/core/platform/session";
import { ProcurementStoreProvider, useProcurementStore } from "./store";
import { SandboxProvider } from "@/shared/sandbox/SandboxContext";
import { useEffectiveIdentity } from "@/shared/sandbox/useEffectiveIdentity";
import SandboxLauncher from "./sandbox/SandboxLauncher";
import ProcurementLayout from "./ProcurementLayout";
import Dashboard from "./pages/Dashboard";
import Masters from "./pages/masters/Masters";
import MasterRequests from "./pages/MasterRequests";
import Setup from "./pages/settings/Setup";
import ControlCenter from "./pages/monitoring/ControlCenter";
import NewRequest from "./pages/requests/NewRequest";
import EditRequest from "./pages/requests/EditRequest";
import RequestsList from "./pages/requests/RequestsList";
import MyRequests from "./pages/requests/MyRequests";
import RequestDetail from "./pages/requests/RequestDetail";
import SourcingQueue from "./pages/queues/SourcingQueue";
import ApprovalsQueue from "./pages/queues/ApprovalsQueue";
import { SharePoQueue, CollectPiQueue, AdvanceQueue, FollowUpQueue, InwardQueue, TallyQueue, QcQueue, PurchaseReturnQueue, GateOutwardQueue } from "./pages/queues/PoQueues";
import PoWorkbench from "./pages/po/PoWorkbench";
import PoList from "./pages/po/PoList";
import PoDetail from "./pages/po/PoDetail";
import AccessDenied from "./pages/system/AccessDenied";
import NotFound from "./pages/system/NotFound";

/** Gate to admins + any assigned master manager (masters + master-requests area). */
function RequireMasterAccess({ children }: { children: ReactNode }) {
  const { isAnyManager } = useProcurementStore();
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
  const { isProcessCoordinator } = useProcurementStore();
  if (!isProcessCoordinator) return <AccessDenied />;
  return <>{children}</>;
}

/**
 * Gate to one step's queue. Takes the SAME store flag `nav.tsx` uses to decide
 * whether to show the link, so the sidebar and the URL can never disagree.
 *
 * ⚠ Purchase has no `canSeeQueue`, deliberately: ownership here is a flat set of
 *   capability booleans (`canInward`, `canQc`, …), and approval is a VALUE BAND
 *   rather than an owner list — `isApprover` asks "are you on any band", which is
 *   exactly the question the sidebar asks.
 */
function RequireCap({ when, children }: { when: boolean; children: ReactNode }) {
  if (!when) return <AccessDenied />;
  return <>{children}</>;
}

/** One `useProcurementStore()` for the whole route table, rather than eleven. */
function ProcurementQueueRoutes() {
  const s = useProcurementStore();
  return (
    <Routes>
      <Route path="sourcing" element={<RequireCap when={s.canSource}><SourcingQueue /></RequireCap>} />
      <Route path="approvals" element={<RequireCap when={s.isApprover}><ApprovalsQueue /></RequireCap>} />
      <Route path="share" element={<RequireCap when={s.canSharePo}><SharePoQueue /></RequireCap>} />
      <Route path="collect-pi" element={<RequireCap when={s.canCollectPi}><CollectPiQueue /></RequireCap>} />
      <Route path="advance" element={<RequireCap when={s.canAdvancePayment}><AdvanceQueue /></RequireCap>} />
      <Route path="follow-up" element={<RequireCap when={s.canFollowup}><FollowUpQueue /></RequireCap>} />
      <Route path="inward" element={<RequireCap when={s.canInward}><InwardQueue /></RequireCap>} />
      <Route path="tally" element={<RequireCap when={s.canTally}><TallyQueue /></RequireCap>} />
      <Route path="qc" element={<RequireCap when={s.canQc}><QcQueue /></RequireCap>} />
      <Route path="purchase-return" element={<RequireCap when={s.canPurchaseReturn}><PurchaseReturnQueue /></RequireCap>} />
      <Route path="gate-outward" element={<RequireCap when={s.canGateOutward}><GateOutwardQueue /></RequireCap>} />
      {/* `queues/*` swallows the parent's catch-all, so an unknown queue path must
          land on Not Found here or it renders a blank page. */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

/**
 * Root of the Purchase FMS (procurement) app. Owns all routing under
 * /procurement, beneath the live data store. Routes are added stage by stage as
 * each build phase lands (requests, queues, PO detail, setup, monitoring).
 */
export default function ProcurementApp() {
  // scope "proc" keeps the original sessionStorage keys, so a demo session already
  // open across a refresh is not lost.
  return (
    <SandboxProvider scope="proc" homePath="/procurement">
      <ProcurementStoreProvider>
        <Routes>
          <Route element={<ProcurementLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="requests" element={<RequestsList />} />
            {/* Distinct segment, so it never shadows requests/new or requests/:id. */}
            <Route path="my-requests" element={<MyRequests />} />
            <Route path="requests/new" element={<NewRequest />} />
            <Route path="requests/:id" element={<RequestDetail />} />
            <Route path="requests/:id/edit" element={<EditRequest />} />
            {/* Each queue is gated on its own capability flag — see ProcurementQueueRoutes. */}
            <Route path="queues/*" element={<ProcurementQueueRoutes />} />
            {/* ⚠ DELIBERATELY UNGATED, unlike the queues above. The workbench has a
                read-only mode for non-PO-desk readers, and an email CTA ("Open PO
                desk") lands here. Gating it would turn a documented affordance into
                an Access Denied. */}
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
          <Route path="*" element={<Navigate to="/procurement" replace />} />
        </Routes>
      </ProcurementStoreProvider>
    </SandboxProvider>
  );
}
