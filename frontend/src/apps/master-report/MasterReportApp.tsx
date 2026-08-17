import { Routes, Route, Navigate } from "react-router-dom";
import AppShell from "@/shared/components/layout/AppShell";
import { useSession, roleLabel } from "@/core/platform/session";
import { masterReportNav } from "./nav";
import MasterReport from "./pages/MasterReport";

/** Wires the portal session into the shared AppShell, as every app does. */
function MasterReportLayout() {
  const { user, role } = useSession();
  return (
    <AppShell
      nav={masterReportNav}
      role={role}
      user={{ name: user.name, designation: user.designation, color: user.avatarColor, roleLabel: roleLabel(role) }}
      notifications={[]}
    />
  );
}

/**
 * Root of the Master Report. Access is gated upstream by
 * <RequireModule appId="master-report"> in App.tsx (admins bypass), and again
 * server-side inside master_report_snapshot() — the counts span modules the
 * viewer may not otherwise hold, so the RPC re-checks rather than trusting the
 * route.
 */
export default function MasterReportApp() {
  return (
    <Routes>
      <Route element={<MasterReportLayout />}>
        <Route index element={<MasterReport />} />
        <Route path="*" element={<Navigate to="/master-report" replace />} />
      </Route>
    </Routes>
  );
}
