import { Routes, Route, Navigate } from "react-router-dom";
import Landing from "@/core/landing/Landing";
import Login from "@/core/auth/Login";
import ForgotPassword from "@/core/auth/ForgotPassword";
import ResetPassword from "@/core/auth/ResetPassword";
import WorkspaceHome from "@/core/workspace/WorkspaceHome";
import { liveApps } from "@/apps/registry";

export default function App() {
  return (
    <Routes>
      {/* ---- Portal core (landing + auth + launcher) ---- */}
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/home" element={<WorkspaceHome />} />

      {/* ---- Registered apps, each owns everything under its basePath ---- */}
      {liveApps.map((app) => {
        const Component = app.Component!;
        return <Route key={app.id} path={`${app.basePath}/*`} element={<Component />} />;
      })}

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
