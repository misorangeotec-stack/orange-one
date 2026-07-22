import type { ReactNode } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useSession } from "@/core/platform/session";
import { ProductionStoreProvider, useProductionStore } from "./store";
import ProductionEntryLayout from "./ProductionEntryLayout";
import Dashboard from "./pages/Dashboard";
import NewRequest from "./pages/requests/NewRequest";
import MyRequests from "./pages/requests/MyRequests";
import RequestsList from "./pages/requests/RequestsList";
import RequestDetail from "./pages/requests/RequestDetail";
import MaterialHandoverQueue from "./pages/queues/MaterialHandoverQueue";
import RmTransferQueue from "./pages/queues/RmTransferQueue";
import TransferSlipQueue from "./pages/queues/TransferSlipQueue";
import ProductionQueue from "./pages/queues/ProductionQueue";
import QualityQueue from "./pages/queues/QualityQueue";
import McTestingQueue from "./pages/queues/McTestingQueue";
import PmHandoverQueue from "./pages/queues/PmHandoverQueue";
import PmTransferQueue from "./pages/queues/PmTransferQueue";
import PackingQueue from "./pages/queues/PackingQueue";
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
          <Route path="requests/:id" element={<RequestDetail />} />
          <Route path="queues/material-handover" element={<MaterialHandoverQueue />} />
          <Route path="queues/rm-transfer" element={<RmTransferQueue />} />
          <Route path="queues/transfer-slip" element={<TransferSlipQueue />} />
          <Route path="queues/production" element={<ProductionQueue />} />
          <Route path="queues/quality" element={<QualityQueue />} />
          <Route path="queues/mc-testing" element={<McTestingQueue />} />
          <Route path="queues/pm-handover" element={<PmHandoverQueue />} />
          <Route path="queues/pm-transfer" element={<PmTransferQueue />} />
          <Route path="queues/packing" element={<PackingQueue />} />
          <Route path="queues/fg-transfer" element={<FgTransferQueue />} />
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
