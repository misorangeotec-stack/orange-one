import { Routes, Route, Navigate } from "react-router-dom";
import AppShell from "@/shared/components/layout/AppShell";
import { useSession, roleLabel } from "@/core/platform/session";
import { appBasePath } from "../appInfo";
import { kraKpiNav } from "./nav";
import Scorecard from "./pages/Scorecard";

/** Wires the portal session into the shared AppShell, as every app does. */
function KraKpiLayout() {
  const { user, role } = useSession();
  return (
    <AppShell
      nav={kraKpiNav}
      role={role}
      user={{ name: user.name, designation: user.designation, color: user.avatarColor, roleLabel: roleLabel(role) }}
      notifications={[]}
    />
  );
}

/**
 * Root of the KRA / KPI Scorecard. The route is gated upstream by
 * <RequireModule appId="kra-kpi"> in App.tsx; the DATA is gated again, per person,
 * inside kpi_report — a report can only ever be the caller's own, their team's, or
 * (for an admin) anyone's, whatever the route lets through.
 */
export default function KraKpiApp() {
  return (
    <Routes>
      <Route element={<KraKpiLayout />}>
        <Route index element={<Scorecard />} />
        <Route path="*" element={<Navigate to={appBasePath("kra-kpi")} replace />} />
      </Route>
    </Routes>
  );
}
