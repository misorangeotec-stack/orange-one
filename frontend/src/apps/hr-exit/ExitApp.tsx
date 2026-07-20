import type { ReactNode } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useSession } from "@/core/platform/session";
import { SandboxProvider } from "@/shared/sandbox/SandboxContext";
import { useEffectiveIdentity } from "@/shared/sandbox/useEffectiveIdentity";
import { ExitStoreProvider, useExitStore } from "./store";
import ExitLayout from "./ExitLayout";
import Dashboard from "./pages/Dashboard";
import ExitDetail from "./pages/cases/ExitDetail";
import ExitList from "./pages/cases/ExitList";
import MyExit from "./pages/cases/MyExit";
import NewExit from "./pages/cases/NewExit";
import ApprovalsQueue from "./pages/queues/ApprovalsQueue";
import ClearanceQueue from "./pages/queues/ClearanceQueue";
import InterviewQueue from "./pages/queues/InterviewQueue";
import SettlementQueue from "./pages/queues/SettlementQueue";
import ClosureQueue from "./pages/queues/ClosureQueue";
import Masters from "./pages/masters/Masters";
import MasterRequests from "./pages/MasterRequests";
import ControlCenter from "./pages/monitoring/ControlCenter";
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

/**
 * Gate to the REAL signed-in admin (entry into demo mode), IGNORING any persona.
 *
 * `useSession`, not `useEffectiveIdentity`: a persona must not be able to re-enter demo
 * mode and nest a demo inside a demo.
 */
function RequireRealAdmin({ children }: { children: ReactNode }) {
  const { isAdmin } = useSession();
  if (!isAdmin) return <AccessDenied />;
  return <>{children}</>;
}

/**
 * Gate to admins + process coordinators (the Control Center).
 *
 * ⭐ It is also the gate on the SHEET-PARITY EXPORT, which lives on that page — and that
 * is not incidental. Two of the export's eleven stages read RLS-gated satellites (the F&F
 * figures and the exit interview); a viewer who may not read them gets ZERO ROWS, which
 * would print as "₹0" and "No" into a spreadsheet that then outlives the screen. Admin ∨
 * coordinator is a clause of BOTH satellites' policies, so whoever passes this gate can
 * read every column in the file. See lib/sheetExport.ts.
 */
function RequireMonitor({ children }: { children: ReactNode }) {
  const { isProcessCoordinator } = useExitStore();
  if (!isProcessCoordinator) return <AccessDenied />;
  return <>{children}</>;
}

/**
 * Gate to admins + ANY ASSIGNED MASTER OWNER (the Masters page). Deliberately NOT
 * admin-only: an Exit Reasons owner opens Masters and edits that one master without
 * being an admin — the other four tabs render read-only (each `MasterCrud` takes its own
 * `canManage(type)`), and RLS agrees, because M8 relaxed each master's write policy to
 * `is_admin OR fms_exit_is_master_manager('<type>')`.
 *
 * `canManageMasters` IS `isAnyMasterManager` now (the store aliases them) — before M8 it
 * was admin-only, which is what RLS said at the time.
 */
function RequireMasterAccess({ children }: { children: ReactNode }) {
  const { isAnyMasterManager } = useExitStore();
  if (!isAnyMasterManager) return <AccessDenied />;
  return <>{children}</>;
}

/**
 * Root of the HR Exit FMS. Owns all routing under /hr-exit, beneath the live data
 * store. Routes are added stage by stage as each build phase lands (the case + the
 * approvals, clearance, the interview, the settlement, closure, monitoring).
 *
 * App.tsx already wraps this whole app in <RequireModule appId="hr-exit">, so only
 * admins and users granted the module in Module access reach it — this file adds no
 * further gate of its own. What each person then sees inside is decided by the nav,
 * the store's capability flags and — authoritatively — RLS.
 */
export default function ExitApp() {
  return (
    <SandboxProvider scope="exit" homePath="/hr-exit">
      <ExitStoreProvider>
        <Routes>
          <Route element={<ExitLayout />}>
            <Route index element={<Dashboard />} />
            {/* The two UNGATED screens — no RequireAnything around them, deliberately.
                An ordinary employee who owns no step, is nobody's manager and works in
                no clearance department must still be able to resign. `exits/new` must
                come BEFORE `exits/:id` or "new" would be read as a case id. */}
            <Route path="exits/new" element={<NewExit />} />
            <Route path="my-exit" element={<MyExit />} />
            {/* Everything below is gated by RLS, not by a route guard: fms_exit_can_read_case()
                simply returns zero rows to someone with no business here, and the list /
                detail pages say so honestly. */}
            <Route path="exits" element={<ExitList />} />
            <Route path="exits/:id" element={<ExitDetail />} />
            <Route path="queues/approvals" element={<ApprovalsQueue />} />
            <Route path="queues/clearance" element={<ClearanceQueue />} />
            {/* ⭐ THE CONFIDENTIAL QUEUE. It guards itself on `canReadConfidential` —
                the same predicate as the RLS policy on fms_exit_interviews — and renders
                AccessDenied for everyone else, including the reporting manager and every
                clearance owner. RLS is the real gate; this is so the page says so. */}
            <Route path="queues/interview" element={<InterviewQueue />} />
            {/* ⭐ THE MONEY QUEUE. It guards itself on `isFinanceStaff ∨ isProcessCoordinator`
                — the RLS predicate on fms_exit_settlements, minus the leaver's own
                after-approval clause (which is one case on My Resignation, not a work
                queue) — and renders AccessDenied for everyone else, the reporting manager
                and every clearance owner included. RLS is the real gate; this is so the
                page says so instead of showing an empty table. */}
            <Route path="queues/settlement" element={<SettlementQueue />} />
            {/* ⭐ CLOSURE. Deliberately UNGATED, unlike the two above: nothing here is a
                rupee or a word of an exit interview. Like Approvals and Clearance, you see
                it if RLS gives you rows in it. */}
            <Route path="queues/closure" element={<ClosureQueue />} />
            {/* ⭐ The coordinator's scoreboard. Same queue entries as every page above —
                one `buildQueueEntries(exitSnapshotFrom(data))`, so its Delayed count is
                identical to the HR Exit row on /fms-control-center by construction. */}
            <Route path="monitoring" element={<RequireMonitor><ControlCenter /></RequireMonitor>} />
            <Route path="masters" element={<RequireMasterAccess><Masters /></RequireMasterAccess>} />
            {/* ⭐ OPEN TO EVERYONE, and that is deliberate: a master's owner gets the
                review queue, and everyone else gets their own requests. A guard here
                would have to be `isAnyMasterManager` — which would lock every ordinary
                employee out of the one screen that tells them what became of the reason
                they asked for. The page scopes ITSELF, and RLS backs it. */}
            <Route path="master-requests" element={<MasterRequests />} />
            <Route path="settings" element={<RequireAdmin><Setup /></RequireAdmin>} />
            {/* Demo mode. Gated on the REAL session admin, never the persona. */}
            <Route path="sandbox" element={<RequireRealAdmin><SandboxLauncher /></RequireRealAdmin>} />
            <Route path="*" element={<NotFound />} />
          </Route>
          <Route path="*" element={<Navigate to="/hr-exit" replace />} />
        </Routes>
      </ExitStoreProvider>
    </SandboxProvider>
  );
}
