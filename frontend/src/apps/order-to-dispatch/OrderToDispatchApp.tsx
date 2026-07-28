import type { ReactNode } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useSession } from "@/core/platform/session";
import { DispatchStoreProvider, useDispatchStore } from "./store";
import OrderToDispatchLayout from "./OrderToDispatchLayout";
import Dashboard from "./pages/Dashboard";
import NewOrder from "./pages/orders/NewOrder";
import EditOrder from "./pages/orders/EditOrder";
import MyOrders from "./pages/orders/MyOrders";
import OrdersList from "./pages/orders/OrdersList";
import OrderDetail from "./pages/orders/OrderDetail";
import CreditCheckQueue from "./pages/queues/CreditCheckQueue";
import MaterialStatusQueue from "./pages/queues/MaterialStatusQueue";
import LotConfirmQueue from "./pages/queues/LotConfirmQueue";
import SalesBillQueue from "./pages/queues/SalesBillQueue";
import GateOutQueue from "./pages/queues/GateOutQueue";
import DispatchConfirmQueue from "./pages/queues/DispatchConfirmQueue";
import OrderRegister from "./pages/reports/OrderRegister";
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
  const { isProcessCoordinator } = useDispatchStore();
  if (!isProcessCoordinator) return <AccessDenied />;
  return <>{children}</>;
}

function RequireMasterAccess({ children }: { children: ReactNode }) {
  const { isAnyMasterManager } = useDispatchStore();
  if (!isAnyMasterManager) return <AccessDenied />;
  return <>{children}</>;
}

/**
 * Root of the Order to Dispatch FMS. Mounted per-user (App.tsx wraps it in
 * RequireModule); what each person sees is decided by the nav, the store's
 * capability flags and — authoritatively — RLS plus the RPCs' own authz.
 */
export default function OrderToDispatchApp() {
  return (
    <DispatchStoreProvider>
      <Routes>
        <Route element={<OrderToDispatchLayout />}>
          <Route index element={<Dashboard />} />
          {/* "new" must come before ":id" or "new" would be read as an id. */}
          <Route path="orders/new" element={<NewOrder />} />
          <Route path="my-orders" element={<MyOrders />} />
          <Route path="master-requests" element={<MasterRequests />} />
          <Route path="orders" element={<OrdersList />} />
          {/* "orders/:id/edit" must come before ":id" would swallow "edit". */}
          <Route path="orders/:id/edit" element={<EditOrder />} />
          <Route path="orders/:id" element={<OrderDetail />} />
          <Route path="queues/credit-check" element={<CreditCheckQueue />} />
          <Route path="queues/material-status" element={<MaterialStatusQueue />} />
          <Route path="queues/lot-confirm" element={<LotConfirmQueue />} />
          <Route path="queues/sales-bill" element={<SalesBillQueue />} />
          <Route path="queues/gate-out" element={<GateOutQueue />} />
          <Route path="queues/dispatch-confirm" element={<DispatchConfirmQueue />} />
          <Route path="reports/register" element={<OrderRegister />} />
          <Route path="monitoring" element={<RequireMonitor><ControlCenter /></RequireMonitor>} />
          <Route path="masters" element={<RequireMasterAccess><Masters /></RequireMasterAccess>} />
          <Route path="settings" element={<RequireAdmin><Setup /></RequireAdmin>} />
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route path="*" element={<Navigate to="/order-to-dispatch" replace />} />
      </Routes>
    </DispatchStoreProvider>
  );
}
