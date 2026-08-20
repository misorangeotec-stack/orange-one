import type { ReactNode } from "react";
import { Routes, Route, Navigate, Link } from "react-router-dom";
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

/**
 * What the old Dispatch Masters URL now says.
 *
 * Customers, items and the customer-item mapping are no longer this module's to
 * keep — they are the company's, held once in Central Masters and fed from
 * Tally. The tables this page used to edit still exist as the cutover's rollback
 * copy and NOTHING READS THEM, which is exactly the confusion worth heading off:
 * a row saved into them saves cleanly, reports success, and is then invisible
 * everywhere. That has already happened once, to a real customer, on the day of
 * the cutover.
 *
 * ⚠ A PAGE, NOT A REDIRECT. This route used to `<Navigate>` to /admin/masters.
 *   Two problems with that. Anyone who had bookmarked the old URL was thrown onto
 *   a different screen with no explanation, which reads as a glitch rather than a
 *   move. And /admin/masters is admin-gated, so for everyone else the redirect
 *   landed on "access denied" — answering a question they had not asked, while
 *   the real answer is "this moved, and here is what to use instead".
 *
 * Deliberately NOT gated for the same reason: the people most likely to arrive
 * here are the ones who cannot open Central Masters, and Master Requests — which
 * is theirs — is the thing they actually need.
 */
function MastersMoved() {
  const { isAdmin } = useSession();
  return (
    <div className="mx-auto max-w-2xl px-4 py-14 text-center">
      <span className="inline-flex items-center rounded-full bg-orange/10 px-3 py-1 text-[12px] font-semibold uppercase tracking-wide text-orange">
        No longer in use here
      </span>
      <h1 className="mt-4 text-[19px] font-semibold text-navy">
        Customers and items moved to Central Masters
      </h1>
      <p className="mt-3 text-[13.5px] leading-relaxed text-grey">
        They are shared with every module now and come from Tally automatically, so
        they are kept in one place instead of a copy per module. Editing them here
        would have renamed them for everyone — and the next sync would have undone
        it a few minutes later.
      </p>
      <p className="mt-3 text-[13.5px] leading-relaxed text-grey">
        <strong className="text-navy">Need a customer, an item, or a new
        customer-item mapping?</strong> Raise it under Master Requests, exactly as
        before. An owner approves it and it lands in the shared master.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Link
          to="/order-to-dispatch/master-requests"
          className="rounded-lg bg-orange px-4 py-2 text-[13px] font-medium text-white transition hover:opacity-90"
        >
          Go to Master Requests
        </Link>
        {isAdmin && (
          <Link
            to="/admin/masters"
            className="rounded-lg border border-line px-4 py-2 text-[13px] font-medium text-navy transition hover:border-orange hover:text-orange"
          >
            Open Central Masters
          </Link>
        )}
      </div>
    </div>
  );
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
              Kept as an explaining page, not deleted and not a bare redirect —
              see MastersMoved above for why.
              Master Requests stays where it was — raising and approving a new
              master is still a Dispatch job. */}
          <Route path="masters" element={<MastersMoved />} />
          <Route path="settings" element={<RequireAdmin><Setup /></RequireAdmin>} />
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route path="*" element={<Navigate to="/order-to-dispatch" replace />} />
      </Routes>
    </DispatchStoreProvider>
  );
}
