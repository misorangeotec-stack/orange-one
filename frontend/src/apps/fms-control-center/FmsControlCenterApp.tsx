import { Routes, Route, Navigate } from "react-router-dom";
import FmsControlCenterLayout from "./FmsControlCenterLayout";
import MasterControlCenter from "./pages/MasterControlCenter";

/**
 * Root of the FMS Control Center — the cross-process scoreboard a process
 * coordinator lands on. Access is gated upstream by
 * <RequireModule appId="fms-control-center"> in App.tsx (admins bypass).
 *
 * Each FMS supplies its own counts through an adapter (see adapters/registry.ts);
 * this app holds no data layer of its own.
 */
export default function FmsControlCenterApp() {
  return (
    <Routes>
      <Route element={<FmsControlCenterLayout />}>
        <Route index element={<MasterControlCenter />} />
        <Route path="*" element={<Navigate to="/fms-control-center" replace />} />
      </Route>
    </Routes>
  );
}
