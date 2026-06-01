import { Routes, Route, Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import Landing from "@/core/landing/Landing";
import Login from "@/core/auth/Login";
import WorkspaceHome from "@/core/workspace/WorkspaceHome";
import Account from "@/core/account/Account";
import AdminApp from "@/core/admin/AdminApp";
import RequireRole from "@/core/platform/RequireRole";
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
      {/* ---- Portal core (landing + auth + launcher + account + admin) ---- */}
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/home" element={<WorkspaceHome />} />
      <Route path="/account" element={<Account />} />
      <Route path="/admin/*" element={<RequireRole roles={["admin"]}><AdminApp /></RequireRole>} />

      {/* ---- Registered apps, each owns everything under its basePath, gated by access ---- */}
      {liveApps.map((app) => {
        const Component = app.Component!;
        return (
          <Route
            key={app.id}
            path={`${app.basePath}/*`}
            element={<RequireModule appId={app.id}><Component /></RequireModule>}
          />
        );
      })}

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
