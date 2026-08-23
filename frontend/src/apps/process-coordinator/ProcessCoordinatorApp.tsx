import { Routes, Route, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import AppShell from "@/shared/components/layout/AppShell";
import { useSession, roleLabel } from "@/core/platform/session";
import { processCoordinatorNav } from "./nav";
import { fetchPcMasterRequests } from "./data/pcApprovals";
import Approvals, { PC_REQUESTS_QK } from "./pages/Approvals";
import Processes from "./pages/Processes";

/**
 * Wires the portal session into the shared AppShell, as every app does.
 *
 * The pending count is read here rather than in the page so the nav badge is
 * right whichever screen you are on. It shares the Approvals page's query key,
 * so the two are one fetch and one cache entry — opening Approvals costs nothing
 * extra, and approving something updates the badge without a second round trip.
 */
function ProcessCoordinatorLayout() {
  const { user, role } = useSession();
  const { data } = useQuery({
    queryKey: PC_REQUESTS_QK,
    queryFn: fetchPcMasterRequests,
    staleTime: 60_000,
  });
  const pendingApprovals = (data ?? []).filter((r) => r.status === "pending").length;

  return (
    <AppShell
      nav={processCoordinatorNav({ pendingApprovals })}
      role={role}
      user={{ name: user.name, designation: user.designation, color: user.avatarColor, roleLabel: roleLabel(role) }}
      notifications={[]}
    />
  );
}

/**
 * Root of the Process Coordinator dashboard.
 *
 * Access is gated upstream by <RequireModule appId="process-coordinator"> in
 * App.tsx (admins bypass), and AGAIN server-side inside pc_master_requests() and
 * pc_step_owner_contacts(). The second check is not belt-and-braces: both RPCs
 * are SECURITY DEFINER and deliberately read past the RLS of ten modules and of
 * `profiles`, so they cannot afford to trust the route that called them. Same
 * reasoning as master_report_snapshot().
 *
 * Lands on Approvals, because "what is waiting on me" is why the coordinator
 * opened the module.
 */
export default function ProcessCoordinatorApp() {
  return (
    <Routes>
      <Route element={<ProcessCoordinatorLayout />}>
        <Route index element={<Navigate to="/process-coordinator/approvals" replace />} />
        <Route path="approvals" element={<Approvals />} />
        <Route path="processes" element={<Processes />} />
        <Route path="*" element={<Navigate to="/process-coordinator/approvals" replace />} />
      </Route>
    </Routes>
  );
}
