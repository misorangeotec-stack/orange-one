/**
 * RM IMS — the app shell.
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
 *
 * THE SHEET IS SHARED, and this shell is what makes that safe. Every screen reads its documents
 * synchronously from localStorage the moment it mounts, so the shared copy has to be in place
 * BEFORE any of them render — otherwise the first paint shows this browser's stale sheet and
 * the first keystroke saves it back over everyone else's. So the routes wait here, once, for
 * `hydrateSharedSheet()`. See lib/sheetStore.ts.
 */
import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import AppShell from "@/shared/components/layout/AppShell";
import type { NavItem } from "@/shared/components/layout/types";
import { roleLabel, useSession } from "@/core/platform/session";
import { appBasePath } from "../appInfo";
import {
  flushPendingDocuments, getSheetStatus, hydrateSharedSheet, setSheetCanEdit,
  subscribeSheetStatus, type SheetStatus,
} from "./lib/sheetStore";
import RmMis from "./pages/RmMis";
import RmItemMaster from "./pages/RmItemMaster";
import RmShipments from "./pages/RmShipments";
import RmGodowns from "./pages/RmGodowns";

const B = appBasePath("rm-mis");

// House icon style: 24-box, no fill, currentColor stroke 2, round caps — matches the other apps.
const ic = {
  dashboard: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>),
  items: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6h13M8 12h13M8 18h13" /><path d="m3 6 1 1 2-2M3 12l1 1 2-2M3 18l1 1 2-2" /></svg>),
  ship: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 20a2.4 2.4 0 0 0 2 1 2.4 2.4 0 0 0 2-1 2.4 2.4 0 0 1 4 0 2.4 2.4 0 0 0 4 0 2.4 2.4 0 0 1 4 0 2.4 2.4 0 0 0 2 1" /><path d="M4 18 3 13h18l-2 5" /><path d="M12 13V3l6 5H12" /></svg>),
  godown: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21V9l9-5 9 5v12" /><path d="M7 21v-7h10v7" /><path d="M7 17h10" /></svg>),
};

const NAV: NavItem[] = [
  { label: "Dashboard", to: `${B}/dashboard`, icon: ic.dashboard, section: "RM IMS" },
  { label: "Item master", to: `${B}/items`, icon: ic.items },
  { label: "ETD / ETA", to: `${B}/pipeline`, icon: ic.ship },
  { label: "Godowns", to: `${B}/godowns`, icon: ic.godown },
];

/** Live view of whether the sheet is shared, saving, or stuck on this browser. */
export function useSheetStatus(): SheetStatus {
  const [s, setS] = useState<SheetStatus>(() => getSheetStatus());
  useEffect(() => subscribeSheetStatus(setS), []);
  return s;
}

function RmMisLayout() {
  const { user, role } = useSession();
  const status = useSheetStatus();
  return (
    <>
      {status.error && (
        <div className="flex items-start gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{status.error}</p>
        </div>
      )}
      {/* Say it plainly rather than letting someone type into a sheet that will refuse the
          save. The database is the real gate; this is so nobody wastes an afternoon on it. */}
      {status.mode === "shared" && !status.canEdit && (
        <div className="border-b bg-muted px-4 py-2 text-sm text-muted-foreground">
          <strong>View only.</strong> You can read the sheet, but changes will not be saved. Ask an
          admin for edit access to RM IMS on the Users screen.
        </div>
      )}
      <AppShell
        nav={NAV}
        role={role}
        user={{ name: user.name, designation: user.designation, color: user.avatarColor, roleLabel: roleLabel(role) }}
        notifications={[]}
      />
    </>
  );
}

/**
 * Pull the shared sheet before the screens read it.
 *
 * The edit right is set FIRST, because `hydrateSharedSheet` consults it: a view-only user must
 * not seed the shared sheet from their own browser, and must not push at all.
 */
function SheetGate({ children }: { children: React.ReactNode }) {
  const { canEditModule } = useSession();
  const canEdit = canEditModule("rm-mis");

  const { isLoading, error } = useQuery({
    queryKey: ["rmMis", "sheet", canEdit],
    queryFn: async () => {
      setSheetCanEdit(canEdit);
      return await hydrateSharedSheet();
    },
    staleTime: Infinity,
    retry: 1,
  });

  // Anything still settling when the tab closes goes now, rather than being lost to the timer.
  useEffect(() => {
    const go = () => void flushPendingDocuments();
    window.addEventListener("pagehide", go);
    return () => {
      window.removeEventListener("pagehide", go);
      void flushPendingDocuments();
    };
  }, []);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading the shared sheet…
      </div>
    );
  }
  // A failed pull is NOT a dead end: sheetStore has already fallen back to this browser's copy
  // and set the banner, so the app opens and says so rather than refusing to start.
  if (error) console.warn("RM IMS: shared sheet unavailable, using this browser's copy", error);
  return <>{children}</>;
}

export default function RmMisApp() {
  return (
    <SheetGate>
      <Routes>
        <Route element={<RmMisLayout />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<RmMis />} />
          <Route path="items" element={<RmItemMaster />} />
          <Route path="pipeline" element={<RmShipments />} />
          <Route path="godowns" element={<RmGodowns />} />
          <Route path="*" element={<Navigate to="dashboard" replace />} />
        </Route>
      </Routes>
    </SheetGate>
  );
}
