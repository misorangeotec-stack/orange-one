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
 * Root of the KRA / KPI Scorecard. The app is UNIVERSAL (apps/universal.ts), so every
 * staff login opens it with no grant; the DATA is gated per person inside kpi_report —
 * a report can only ever be the caller's own, their team's, or (for an admin) anyone's.
 *
 * Customer logins (Orange Order Desk) have no place in a staff scorecard, and a
 * universal app would otherwise open for them by URL — so they are sent back to their
 * own app, exactly as the home screen sends them (core/workspace/HomeLayout.tsx).
 */
export default function KraKpiApp() {
  const { isExternal, isAdmin } = useSession();
  if (isExternal && !isAdmin) return <Navigate to={appBasePath("customer-orders")} replace />;
  return (
    <Routes>
      <Route element={<KraKpiLayout />}>
        <Route index element={<Scorecard />} />
        <Route path="*" element={<Navigate to={appBasePath("kra-kpi")} replace />} />
      </Route>
    </Routes>
  );
}
