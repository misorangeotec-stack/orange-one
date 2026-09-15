/**
 * INK IMS — the app shell.
 *
 * A STANDALONE APP, and it renders inside the SAME AppShell every other module uses: left menu,
 * header, breadcrumb and the route home. The first version drew its own bare tab strip instead,
 * which made opening it feel like leaving the portal for a different site. Every module should
 * open the same way, so this one does too.
 *
 * It shares nothing with the Receivables Hub: no routes inside it, no entry in its report
 * catalogue, no link either way. The only thing it takes from that folder is DATA — the
 * ConnectWave client and the stock loader, plain reads of the shared Tally mirror (see
 * lib/inkMis.ts).
 *
 * Three screens:
 *   Dashboard     the planning table — stock, cover, and what to order
 *   Item master   every item in the four books, with the planner's own codes, groups and order
 *   ETD / ETA     the hand-entered consignments
 *
 * No notifications: nothing in this app raises one, and an empty bell is honest.
 */
import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "@/shared/components/layout/AppShell";
import type { NavItem } from "@/shared/components/layout/types";
import { roleLabel, useSession } from "@/core/platform/session";
import { appBasePath } from "../appInfo";
import InkMis from "./pages/InkMis";
import InkItemMaster from "./pages/InkItemMaster";
import InkShipments from "./pages/InkShipments";

const B = appBasePath("ink-mis");

// House icon style: 24-box, no fill, currentColor stroke 2, round caps — matches the other apps.
const ic = {
  dashboard: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>),
  items: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6h13M8 12h13M8 18h13" /><path d="m3 6 1 1 2-2M3 12l1 1 2-2M3 18l1 1 2-2" /></svg>),
  ship: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 20a2.4 2.4 0 0 0 2 1 2.4 2.4 0 0 0 2-1 2.4 2.4 0 0 1 4 0 2.4 2.4 0 0 0 4 0 2.4 2.4 0 0 1 4 0 2.4 2.4 0 0 0 2 1" /><path d="M4 18 3 13h18l-2 5" /><path d="M12 13V3l6 5H12" /></svg>),
};

const NAV: NavItem[] = [
  { label: "Dashboard", to: `${B}/dashboard`, icon: ic.dashboard, section: "Ink IMS" },
  { label: "Item master", to: `${B}/items`, icon: ic.items },
  { label: "ETD / ETA", to: `${B}/pipeline`, icon: ic.ship },
];

function InkMisLayout() {
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

export default function InkMisApp() {
  return (
    <Routes>
      <Route element={<InkMisLayout />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<InkMis />} />
        <Route path="items" element={<InkItemMaster />} />
        <Route path="pipeline" element={<InkShipments />} />
        <Route path="*" element={<Navigate to="dashboard" replace />} />
      </Route>
    </Routes>
  );
}
