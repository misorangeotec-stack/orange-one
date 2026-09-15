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
import { appBasePath } from "../appInfo";
import ItemMaster from "./pages/ItemMaster";

const B = appBasePath("bushra-central-master");

const ic = {
  items: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h18M3 12h18M3 17h10" /><circle cx="18" cy="17" r="3" /></svg>),
};

const NAV: NavItem[] = [
  { label: "Item master", to: `${B}/items`, icon: ic.items, section: "Bushra Central Master" },
];

function BushraCentralMasterLayout() {
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

export default function BushraCentralMasterApp() {
  return (
    <Routes>
      <Route element={<BushraCentralMasterLayout />}>
        <Route index element={<Navigate to="items" replace />} />
        <Route path="items" element={<ItemMaster />} />
        <Route path="*" element={<Navigate to="items" replace />} />
      </Route>
    </Routes>
  );
}
