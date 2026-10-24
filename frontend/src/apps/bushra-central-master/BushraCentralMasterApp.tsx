/**
 * BUSHRA CENTRAL MASTER — the app shell.
 *
 * A STANDALONE APP on the home dashboard, built the same way as Ink IMS: the
 * shared AppShell (left menu, header, breadcrumb), its own routes, and every
 * change kept in this browser only (lib/store.ts). It reads Central Masters and
 * never writes to it.
 */
import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "@/shared/components/layout/AppShell";
import type { NavItem } from "@/shared/components/layout/types";
import { roleLabel, useSession } from "@/core/platform/session";
import { appBasePath, appName } from "../appInfo";
import ItemMaster from "./pages/ItemMaster";
import Settings from "./pages/Settings";

const B = appBasePath("bushra-central-master");

const ic = {
  settings: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>),
  items: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h18M3 12h18M3 17h10" /><circle cx="18" cy="17" r="3" /></svg>),
};

const NAV: NavItem[] = [
  { label: "Item master", to: `${B}/items`, icon: ic.items, section: appName("bushra-central-master") },
];

// Admins only: it edits app_access, which only an admin may write.
const ADMIN_NAV: NavItem[] = [
  ...NAV,
  { label: "Settings", to: `${B}/settings`, icon: ic.settings, section: "Administration" },
];

function BushraCentralMasterLayout() {
  const { user, role, isAdmin } = useSession();
  return (
    <AppShell
      nav={isAdmin ? ADMIN_NAV : NAV}
      role={role}
      user={{ name: user.name, designation: user.designation, color: user.avatarColor, roleLabel: roleLabel(role) }}
      notifications={[]}
    />
  );
}

export default function BushraCentralMasterApp() {
  return (
    <Routes>
      <Route element={<BushraCentralMasterLayout />}>
        <Route index element={<Navigate to="items" replace />} />
        <Route path="items" element={<ItemMaster />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="items" replace />} />
      </Route>
    </Routes>
  );
}
