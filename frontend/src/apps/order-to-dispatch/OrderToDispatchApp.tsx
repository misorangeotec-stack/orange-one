import type { ReactNode } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useSession } from "@/core/platform/session";
import { DispatchStoreProvider, useDispatchStore } from "./store";
import type { OwnerStepKey } from "./lib/steps";
import OrderToDispatchLayout from "./OrderToDispatchLayout";
import Dashboard from "./pages/Dashboard";
import NewOrder from "./pages/orders/NewOrder";
import EditOrder from "./pages/orders/EditOrder";
import MyOrders from "./pages/orders/MyOrders";
import OrdersList from "./pages/orders/OrdersList";
import OrderDetail from "./pages/orders/OrderDetail";
import CreditCheckQueue from "./pages/queues/CreditCheckQueue";
import MaterialStatusQueue from "./pages/queues/MaterialStatusQueue";
import SalesBillQueue from "./pages/queues/SalesBillQueue";
import GateOutQueue from "./pages/queues/GateOutQueue";
import DispatchConfirmQueue from "./pages/queues/DispatchConfirmQueue";
import SalesReturnQueue from "./pages/queues/SalesReturnQueue";
import OrderRegister from "./pages/reports/OrderRegister";
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

/**
 * One step's queue, for its owners only. Same predicate the nav uses, so the sidebar
 * can never offer a screen that then refuses you, and no screen is reachable that the
 * sidebar deliberately hid.
 *
 * ⚠ Hiding the nav link is NOT the gate — the five queue routes were reachable by
 *   typing the URL for as long as they existed. RLS and the RPCs' own authz are the
 *   real boundary; this is so the page says so instead of opening on work that is
 *   none of the reader's business.
 */
function RequireQueue({ step, children }: { step: OwnerStepKey; children: ReactNode }) {
  const { canSeeQueue } = useDispatchStore();
  if (!canSeeQueue(step)) return <AccessDenied />;
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
          <Route path="queues/credit-check" element={<RequireQueue step="credit_check"><CreditCheckQueue /></RequireQueue>} />
          <Route path="queues/material-status" element={<RequireQueue step="material_status"><MaterialStatusQueue /></RequireQueue>} />
          <Route path="queues/sales-bill" element={<RequireQueue step="sales_bill"><SalesBillQueue /></RequireQueue>} />
          <Route path="queues/gate-out" element={<RequireQueue step="gate_out"><GateOutQueue /></RequireQueue>} />
          <Route path="queues/dispatch-confirm" element={<RequireQueue step="dispatch_confirm"><DispatchConfirmQueue /></RequireQueue>} />
          {/* Off the six-step chain, but gated by the same predicate as the rest,
              so the sidebar and the router can never disagree about it. */}
          <Route path="queues/sales-return" element={<RequireQueue step="sales_return"><SalesReturnQueue /></RequireQueue>} />
          <Route path="reports/register" element={<OrderRegister />} />
          <Route path="monitoring" element={<RequireMonitor><ControlCenter /></RequireMonitor>} />
          {/* MASTERS MOVED TO CENTRAL MASTERS (/admin/masters).
              Customers and items are now shared with every module, so editing
              them from inside one module would rename them for all of the
              others — and the next Tally sync would revert it 15 minutes later.
              Kept as a redirect, not deleted: the old URL is bookmarked, and a
              404 would read as "broken" rather than "moved".
              Master Requests stays where it was — raising and approving a new
              master is still a Dispatch job. */}
          <Route path="masters" element={<Navigate to="/admin/masters" replace />} />
          <Route path="settings" element={<RequireAdmin><Setup /></RequireAdmin>} />
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route path="*" element={<Navigate to="/order-to-dispatch" replace />} />
      </Routes>
    </DispatchStoreProvider>
  );
}
