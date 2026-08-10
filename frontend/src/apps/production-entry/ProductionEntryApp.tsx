import type { ReactNode } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useSession } from "@/core/platform/session";
import { ProductionStoreProvider, useProductionStore } from "./store";
import type { QueueStep } from "./lib/queues";
import ProductionEntryLayout from "./ProductionEntryLayout";
import Dashboard from "./pages/Dashboard";
import NewRequest from "./pages/requests/NewRequest";
import EditRequest from "./pages/requests/EditRequest";
import MyRequests from "./pages/requests/MyRequests";
import RequestsList from "./pages/requests/RequestsList";
import RequestDetail from "./pages/requests/RequestDetail";
import MaterialHandoverQueue from "./pages/queues/MaterialHandoverQueue";
import RmTransferQueue from "./pages/queues/RmTransferQueue";
import TransferSlipQueue from "./pages/queues/TransferSlipQueue";
import ProductionQueue from "./pages/queues/ProductionQueue";
import QualityQueue from "./pages/queues/QualityQueue";
import AdditionalIssueSlipQueue from "./pages/queues/AdditionalIssueSlipQueue";
import McTestingQueue from "./pages/queues/McTestingQueue";
import PmTransferQueue from "./pages/queues/PmTransferQueue";
import PackingQueue from "./pages/queues/PackingQueue";
import ReadyToDispatchQueue from "./pages/queues/ReadyToDispatchQueue";
import FgTransferQueue from "./pages/queues/FgTransferQueue";
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

function RequireMonitor({ children }: { children: ReactNode }) {
  const { isProcessCoordinator } = useProductionStore();
  if (!isProcessCoordinator) return <AccessDenied />;
  return <>{children}</>;
}

function RequireMasterAccess({ children }: { children: ReactNode }) {
  const { isAnyMasterManager } = useProductionStore();
  if (!isAnyMasterManager) return <AccessDenied />;
  return <>{children}</>;
}

/**
 * One step's queue, for its owners and the coordinators. Same predicate the nav
 * uses, so the sidebar can never offer a screen that then refuses you — and no
 * screen stays reachable that the sidebar deliberately hid.
 */
function RequireQueue({ step, children }: { step: QueueStep; children: ReactNode }) {
  const { canSeeQueue } = useProductionStore();
  if (!canSeeQueue(step)) return <AccessDenied />;
  return <>{children}</>;
}

/**
 * Root of the Production Entry FMS. Mounted per-user (App.tsx wraps it in
 * RequireModule); what each person sees is decided by the nav, the store's
 * capability flags and — authoritatively — RLS.
 */
export default function ProductionEntryApp() {
  return (
    <ProductionStoreProvider>
      <Routes>
        <Route element={<ProductionEntryLayout />}>
          <Route index element={<Dashboard />} />
          {/* "new" must come before ":id" or "new" would be read as an id. */}
          <Route path="requests/new" element={<NewRequest />} />
          <Route path="my-requests" element={<MyRequests />} />
          <Route path="master-requests" element={<MasterRequests />} />
          <Route path="requests" element={<RequestsList />} />
          {/* "requests/:id/edit" must come before ":id" would swallow "edit". */}
          <Route path="requests/:id/edit" element={<EditRequest />} />
          <Route path="requests/:id" element={<RequestDetail />} />
          <Route path="queues/material-handover" element={<RequireQueue step="material_handover"><MaterialHandoverQueue /></RequireQueue>} />
          <Route path="queues/rm-transfer" element={<RequireQueue step="rm_transfer"><RmTransferQueue /></RequireQueue>} />
          <Route path="queues/quality" element={<RequireQueue step="quality_check"><QualityQueue /></RequireQueue>} />
          <Route path="queues/additional-issue-slip" element={<RequireQueue step="additional_issue_slip"><AdditionalIssueSlipQueue /></RequireQueue>} />
          <Route path="queues/transfer-slip" element={<RequireQueue step="transfer_slip"><TransferSlipQueue /></RequireQueue>} />
          <Route path="queues/production" element={<RequireQueue step="production_entry"><ProductionQueue /></RequireQueue>} />
          <Route path="queues/mc-testing" element={<RequireQueue step="mc_testing"><McTestingQueue /></RequireQueue>} />
          <Route path="queues/pm-transfer" element={<RequireQueue step="pm_transfer"><PmTransferQueue /></RequireQueue>} />
          <Route path="queues/packing" element={<RequireQueue step="packing_entry"><PackingQueue /></RequireQueue>} />
          <Route path="queues/ready-to-dispatch" element={<RequireQueue step="ready_to_dispatch"><ReadyToDispatchQueue /></RequireQueue>} />
          <Route path="queues/fg-transfer" element={<RequireQueue step="fg_transfer"><FgTransferQueue /></RequireQueue>} />
          <Route path="monitoring" element={<RequireMonitor><ControlCenter /></RequireMonitor>} />
          <Route path="masters" element={<RequireMasterAccess><Masters /></RequireMasterAccess>} />
          <Route path="settings" element={<RequireAdmin><Setup /></RequireAdmin>} />
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route path="*" element={<Navigate to="/production-entry" replace />} />
      </Routes>
    </ProductionStoreProvider>
  );
}
