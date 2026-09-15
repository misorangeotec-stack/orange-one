/**
 * INK IMS — the app shell.
 *
 * A STANDALONE APP. It owns everything under its own base path and shares nothing with the
 * Receivables Hub: no routes inside it, no entry in its report catalogue, no link either way.
 * An earlier version of these screens was mounted inside that app; that was wrong and has been
 * reverted, because the ink planner is a different report owned by different people.
 *
 * What it does share is DATA, and only data: the ConnectWave client and the stock loader in
 * `@hub/lib`, which read the same Tally mirror every report reads. That is a read of a common
 * source, not a link between two dashboards — nothing here renders, routes into, or modifies
 * anything belonging to the other app.
 *
 * Three screens:
 *   Dashboard     the planning table — stock, cover, and what to order
 *   Item master   every item in the four books, with the planner's own codes, groups and order
 *   Pipeline      the hand-entered ETD / ETA consignments
 */
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Boxes, ListChecks, Ship } from "lucide-react";
import { appBasePath } from "../appInfo";
import InkMis from "./pages/InkMis";
import InkItemMaster from "./pages/InkItemMaster";
import InkShipments from "./pages/InkShipments";

const BASE = appBasePath("ink-mis");

const TABS = [
  { to: "dashboard", label: "Dashboard", icon: Boxes },
  { to: "items", label: "Item master", icon: ListChecks },
  { to: "pipeline", label: "ETD / ETA", icon: Ship },
];

function InkNav() {
  const { pathname } = useLocation();
  return (
    <nav className="flex flex-wrap items-center gap-1 border-b bg-card px-4">
      <span className="mr-4 py-3 text-sm font-semibold">Ink IMS</span>
      {TABS.map((t) => {
        const to = `${BASE}/${t.to}`;
        const active = pathname === to || pathname.startsWith(`${to}/`);
        const Icon = t.icon;
        return (
          <Link
            key={t.to}
            to={to}
            className={`-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm transition-colors ${
              active
                ? "border-primary font-semibold text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4" />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

export default function InkMisApp() {
  return (
    <div className="min-h-screen bg-background">
      <InkNav />
      <Routes>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<InkMis />} />
        <Route path="items" element={<InkItemMaster />} />
        <Route path="pipeline" element={<InkShipments />} />
        <Route path="*" element={<Navigate to="dashboard" replace />} />
      </Routes>
    </div>
  );
}
