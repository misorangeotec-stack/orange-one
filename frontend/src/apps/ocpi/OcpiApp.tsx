import type { ReactNode } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useSession } from "@/core/platform/session";
import { OcpiStoreProvider, useOcpiStore } from "./store";
import type { QueueStep } from "./lib/queues";
import { OCPI_MASTER_TYPES, type OcpiMasterType } from "./types";
import OcpiLayout from "./OcpiLayout";
import Loaded from "./components/Loaded";
import Dashboard from "./pages/Dashboard";
import DealsList from "./pages/deals/DealsList";
import MyDeals from "./pages/deals/MyDeals";
import Drafts from "./pages/deals/Drafts";
import NewDeal from "./pages/deals/NewDeal";
import EditDraft from "./pages/deals/EditDraft";
import DealDetail from "./pages/deals/DealDetail";
import Machines from "./pages/machines/Machines";
import MachineTemplate from "./pages/machines/MachineTemplate";
import QuotationApprovalQueue from "./pages/queues/QuotationApprovalQueue";
import CustomerSignQueue from "./pages/queues/CustomerSignQueue";
import ManagementSignQueue from "./pages/queues/ManagementSignQueue";
import FinanceHandoverQueue from "./pages/queues/FinanceHandoverQueue";
import FinanceReceiptQueue from "./pages/queues/FinanceReceiptQueue";
import ControlCenter from "./pages/monitoring/ControlCenter";
import DealRegister from "./pages/reports/DealRegister";
import Masters from "./pages/masters/Masters";
import MasterRequests from "./pages/MasterRequests";
import Setup from "./pages/settings/Setup";
import AccessDenied from "./pages/system/AccessDenied";
import NotFound from "./pages/system/NotFound";

function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAdmin } = useSession();
  if (!isAdmin) return <AccessDenied />;
  return <>{children}</>;
}

/**
 * One step's queue, for its owners, the coordinators, and any module viewer.
 *
 * Same predicate the nav uses, so the sidebar can never offer a screen that then
 * refuses you, and no screen is reachable that the sidebar deliberately hid.
 *
 * ⚠ Must sit INSIDE <Loaded> — `canSeeQueue` is derived from the module's first
 *   fetch, so gating before it resolves would bounce a legitimate owner to Access
 *   Denied on a slow load.
 */
function RequireQueue({ step, children }: { step: QueueStep; children: ReactNode }) {
  const { canSeeQueue } = useOcpiStore();
  if (!canSeeQueue(step)) return <AccessDenied />;
  return <>{children}</>;
}

/**
 * Writing a quotation needs an edit grant, and ownership of the origin step if
 * anyone owns it. Mirrors fms_ocpi_can_act — a view-only user reads every list
 * here but cannot open the editor, which would otherwise hand them a form whose
 * Save the database refuses.
 */
function RequireRaise({ children }: { children: ReactNode }) {
  const { canRaise } = useOcpiStore();
  if (!canRaise) return <AccessDenied />;
  return <>{children}</>;
}

/**
 * Editing a master needs ownership of it — or of any of them, for the hub.
 *
 * Mirrors `fms_ocpi_is_master_manager` plus the admin bypass every master table
 * policy carries. Deliberately NOT the admin check it replaced: the whole point
 * of naming an owner is that they can act without being made an admin.
 */
function RequireMasterOwner({ type, children }: { type?: OcpiMasterType; children: ReactNode }) {
  const { canManageMaster } = useOcpiStore();
  const ok = type ? canManageMaster(type) : OCPI_MASTER_TYPES.some((m) => canManageMaster(m.value));
  if (!ok) return <AccessDenied />;
  return <>{children}</>;
}

/**
 * Root of the OCPI module. Mounted per-user (App.tsx wraps it in RequireModule);
 * what each person sees is decided by the nav and the store's capability flags,
 * and — authoritatively — by RLS plus the RPCs' own authz.
 *
 * ⚠ ROUTES ARE DECLARED AHEAD OF THEIR SCREENS, and deliberately not. Only the
 *   pages that exist are mounted; the rest arrive with their phase. A route
 *   pointing at a placeholder is worse than a 404, because the sidebar then
 *   offers a working-looking screen that does nothing.
 */
export default function OcpiApp() {
  return (
    <OcpiStoreProvider>
      <Routes>
        <Route element={<OcpiLayout />}>
          <Route index element={<Loaded><Dashboard /></Loaded>} />

          {/*
            ⚠ NO NAV DESTINATION SITS UNDER ANOTHER NAV DESTINATION. My Deals and
              Drafts are /ocpi/mine and /ocpi/drafts, NOT /ocpi/deals/mine and
              /ocpi/deals/drafts, and New Quotation is /ocpi/new.

              The sidebar marks a row active on a PREFIX match (Sidebar.tsx's
              `end={item.to.split("/").length <= 2}`), which is what keeps "All
              Deals" lit while you read one deal — desirable. But it also means a
              nav item nested under another lights BOTH, and the sidebar shows two
              current pages at once. Flattening these three sidesteps it without
              touching shared chrome that fifteen modules depend on.

              The underlying behaviour is portal-wide (asset-maintenance has the
              same collision at /assets vs /assets/new) and is recorded in OCPI.md
              as a separate item.
          */}
          <Route path="new" element={<Loaded><RequireRaise><NewDeal /></RequireRaise></Loaded>} />
          <Route path="mine" element={<Loaded><MyDeals /></Loaded>} />
          <Route path="drafts" element={<Loaded><Drafts /></Loaded>} />
          <Route path="deals" element={<Loaded><DealsList /></Loaded>} />
          {/* ":id/edit" must come before ":id" would swallow "edit". */}
          <Route path="deals/:id/edit" element={<Loaded><RequireRaise><EditDraft /></RequireRaise></Loaded>} />
          <Route path="deals/:id" element={<Loaded><DealDetail /></Loaded>} />

          {/*
            ⚠ NO ROUTE FOR THE TWO RETIRED STEPS. `order_confirmation` and
              `oc_approval` still exist as step keys — deals raised before the
              stage-F cutover are parked at them and must stay countable — but
              the screens that ACTED on them are gone, because the questions they
              asked are on the quotation form now and the approval that used them
              is the Directors' gate. A parked deal is reached from All Deals,
              reads correctly, and a coordinator can cancel it.
          */}
          <Route path="queues/approve-quotation" element={<Loaded><RequireQueue step="quotation_approval"><QuotationApprovalQueue /></RequireQueue></Loaded>} />
          <Route path="queues/customer-signature" element={<Loaded><RequireQueue step="customer_signoff"><CustomerSignQueue /></RequireQueue></Loaded>} />
          <Route path="queues/management-signature" element={<Loaded><RequireQueue step="management_signoff"><ManagementSignQueue /></RequireQueue></Loaded>} />
          <Route path="queues/finance-handover" element={<Loaded><RequireQueue step="finance_handover"><FinanceHandoverQueue /></RequireQueue></Loaded>} />
          <Route path="queues/finance-receipt" element={<Loaded><RequireQueue step="finance_receipt"><FinanceReceiptQueue /></RequireQueue></Loaded>} />
          <Route path="monitoring" element={<Loaded><ControlCenter /></Loaded>} />
          <Route path="reports" element={<Loaded><DealRegister /></Loaded>} />
          <Route path="master-requests" element={<Loaded><MasterRequests /></Loaded>} />
          <Route path="masters" element={<Loaded><RequireMasterOwner><Masters /></RequireMasterOwner></Loaded>} />
          <Route path="settings" element={<Loaded><RequireAdmin><Setup /></RequireAdmin></Loaded>} />

          {/*
            ⚠ MACHINES IS NO LONGER ADMIN-ONLY. Whoever owns the `machine` master
              may edit it and its template sections — that is what the ownership
              grant is FOR, and the database says the same in the tables' write
              policies. Admins still pass by being admins.
          */}
          <Route path="machines" element={<Loaded><RequireMasterOwner type="machine"><Machines /></RequireMasterOwner></Loaded>} />
          <Route path="machines/:id" element={<Loaded><RequireMasterOwner type="machine"><MachineTemplate /></RequireMasterOwner></Loaded>} />

          <Route path="*" element={<NotFound />} />
        </Route>
        <Route path="*" element={<Navigate to="/ocpi" replace />} />
      </Routes>
    </OcpiStoreProvider>
  );
}

// Referenced by the queue routes added in phases 5–8; exported now so the guard
// lives beside the routes it protects rather than being invented twice.
export { RequireAdmin, RequireQueue, RequireMasterOwner };
