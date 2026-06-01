import { Routes, Route, Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import Landing from "@/core/landing/Landing";
import Login from "@/core/auth/Login";
import WorkspaceHome from "@/core/workspace/WorkspaceHome";
import Account from "@/core/account/Account";
import AdminApp from "@/core/admin/AdminApp";
import RequireRole from "@/core/platform/RequireRole";
import { RequireAuth } from "@/core/platform/auth";
import { useSession } from "@/core/platform/session";
import { liveApps } from "@/apps/registry";

/** Gate a live app behind the current user's module access (admins bypass). */
function RequireModule({ appId, children }: { appId: string; children: ReactNode }) {
  const { hasModule } = useSession();
  if (!hasModule(appId)) return <Navigate to="/home" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      {/* ---- Public (landing + auth) ---- */}
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />

      {/* ---- Signed-in portal (launcher + account + admin) ---- */}
      <Route path="/home" element={<RequireAuth><WorkspaceHome /></RequireAuth>} />
      <Route path="/account" element={<RequireAuth><Account /></RequireAuth>} />
      <Route path="/admin/*" element={<RequireAuth><RequireRole roles={["admin"]}><AdminApp /></RequireRole></RequireAuth>} />

      {/* ---- Registered apps, each owns everything under its basePath, gated by auth + access ---- */}
      {liveApps.map((app) => {
        const Component = app.Component!;
        return (
          <Route
            key={app.id}
            path={`${app.basePath}/*`}
            element={<RequireAuth><RequireModule appId={app.id}><Component /></RequireModule></RequireAuth>}
          />
        );
      })}

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
