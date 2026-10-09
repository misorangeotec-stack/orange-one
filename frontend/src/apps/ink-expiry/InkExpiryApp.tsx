/**
 * INK EXPIRY — the app shell.
 *
 * A standalone app on the home dashboard, built like Ink Stabilisation: the shared AppShell
 * (left menu, header, breadcrumb) and one page, read-only from ConnectWave.
 */
import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "@/shared/components/layout/AppShell";
import type { NavItem } from "@/shared/components/layout/types";
import { roleLabel, useSession } from "@/core/platform/session";
import { appBasePath } from "../appInfo";
import ExpiryStatus from "./pages/ExpiryStatus";
import Dashboard from "./pages/Dashboard";

const B = appBasePath("ink-expiry");

const NAV: NavItem[] = [
  {
    label: "Dashboard",
    to: `${B}/dashboard`,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      </svg>
    ),
  },
  {
    label: "Expiry status",
    to: `${B}/status`,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4M9 15l2 2 4-4" />
      </svg>
    ),
  },
];

function InkExpiryLayout() {
  const { user, role } = useSession();
  return (
    <AppShell
      nav={NAV}
      role={role}
      user={{ name: user.name, designation: user.designation, color: user.avatarColor, roleLabel: roleLabel(role) }}
      notifications={[]}
    />
  );
}

export default function InkExpiryApp() {
  return (
    <Routes>
      <Route element={<InkExpiryLayout />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="status" element={<ExpiryStatus />} />
        <Route path="*" element={<Navigate to="dashboard" replace />} />
      </Route>
    </Routes>
  );
}
