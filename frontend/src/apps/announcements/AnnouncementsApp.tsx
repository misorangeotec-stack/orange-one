import { Routes, Route, Navigate } from "react-router-dom";
import AppShell from "@/shared/components/layout/AppShell";
import { useSession, roleLabel } from "@/core/platform/session";
import { announcementsNav, B } from "./nav";
import Manage from "./pages/Manage";
import Compose from "./pages/Compose";

/** Wires the portal session into the shared AppShell, as every app does. */
function AnnouncementsLayout() {
  const { user, role } = useSession();
  return (
    <AppShell
      nav={announcementsNav}
      role={role}
      user={{ name: user.name, designation: user.designation, color: user.avatarColor, roleLabel: roleLabel(role) }}
      notifications={[]}
    />
  );
}

/**
 * Root of Announcements (PF-18). Gated upstream by <RequireModule appId="announcements">
 * in App.tsx (admins bypass), and again inside every database function it calls:
 * posting, counting and managing each re-check can_post_announcements(), so the route
 * guard is a courtesy, not the lock.
 */
export default function AnnouncementsApp() {
  return (
    <Routes>
      <Route element={<AnnouncementsLayout />}>
        <Route index element={<Manage />} />
        <Route path="new" element={<Compose />} />
        <Route path="*" element={<Navigate to={B} replace />} />
      </Route>
    </Routes>
  );
}
