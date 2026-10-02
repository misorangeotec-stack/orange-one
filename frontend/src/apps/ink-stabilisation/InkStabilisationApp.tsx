/**
 * INK STABILISATION — the app shell.
 *
 * A standalone app on the home dashboard, built like Bushra Central Master: the shared
 * AppShell (left menu, header, breadcrumb) and its own routes. Three steps:
 *   1 · Main data          — every lot and its 3 / 6 / 9-month tests, live from ConnectWave
 *   2 · Plant testing      — the month's list; remarks + attachment, submit
 *   3 · Management review  — close, or send back to the Plant
 * plus Settings (admins) for who owns steps 2 and 3.
 */
import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "@/shared/components/layout/AppShell";
import type { NavItem } from "@/shared/components/layout/types";
import { roleLabel, useSession } from "@/core/platform/session";
import { appBasePath } from "../appInfo";
import RetestSchedule from "./pages/RetestSchedule";
import PlantTesting from "./pages/PlantTesting";
import ManagementReview from "./pages/ManagementReview";
import Settings from "./pages/Settings";

const B = appBasePath("ink-stabilisation");

const ic = {
  plant: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3h6M10 3v6L5 18a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3" /><path d="M7.5 14h9" /></svg>),
  review: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3 8-8" /><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" /></svg>),
  settings: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>),
  schedule: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4M8 14h3M8 17h6" /></svg>),
};

const NAV: NavItem[] = [
  { label: "1 · Main data", to: `${B}/schedule`, icon: ic.schedule, section: "Retest flow" },
  { label: "2 · Plant testing", to: `${B}/plant`, icon: ic.plant },
  { label: "3 · Management review", to: `${B}/review`, icon: ic.review },
  { label: "Settings", to: `${B}/settings`, icon: ic.settings, section: "Administration", roles: ["admin"] },
];

function InkStabilisationLayout() {
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

export default function InkStabilisationApp() {
  return (
    <Routes>
      <Route element={<InkStabilisationLayout />}>
        <Route index element={<Navigate to="schedule" replace />} />
        <Route path="schedule" element={<RetestSchedule />} />
        <Route path="plant" element={<PlantTesting />} />
        <Route path="review" element={<ManagementReview />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="schedule" replace />} />
      </Route>
    </Routes>
  );
}
