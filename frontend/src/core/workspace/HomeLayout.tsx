import { useMemo } from "react";
import { Navigate } from "react-router-dom";
import AppShell from "@/shared/components/layout/AppShell";
import { useSession, roleLabel } from "@/core/platform/session";
import { apps } from "@/apps/registry";
import { appBasePath } from "@/apps/appInfo";
import { buildHomeNav } from "./homeNav";
import { useTaskNotifications } from "./useTaskNotifications";

/**
 * The portal shell for `/home`.
 *
 * The home screen used to be a standalone page with its own header, avatar and
 * sign-out button. It now uses the same AppShell every app uses, so the chrome is
 * identical whether you are on the home screen or inside a module — the menu no
 * longer appears and disappears as you move around.
 *
 * The bell carries TASK notifications (assignments + @mentions). It is not yet a
 * cross-app feed — the other apps still have their own per-app bells — but being
 * assigned a task is the one notice people need before they've picked an app to
 * open, so it earns the spot. See useTaskNotifications for why this reads the
 * task app's data modules without mounting its store.
 */
export default function HomeLayout() {
  const { user, role, isAdmin, isExternal, hasModule } = useSession();
  const { items: notifications, onMarkRead } = useTaskNotifications();

  // Rebuilt only when the user's access changes, not on every render.
  const nav = useMemo(() => buildHomeNav(apps, { hasModule, isAdmin }), [hasModule, isAdmin]);

  /**
   * A customer never sees the staff portal — not even for a frame.
   *
   * ⚠ THIS BELONGS HERE AND NOT IN `Login.tsx`. Signing in resolves the AUTH
   *   session only; the directory that carries `isExternal` has not loaded by the
   *   time the login screen navigates, so a guard there would read `false` and let
   *   the customer straight through. This component already has the profile in
   *   scope. Redirecting from `MyWorkToday` instead would be one level too late —
   *   the shell renders first, so the customer would see the sidebar of every
   *   module in the company flash past on the way out.
   *
   * `RequireModule` already keeps them out of every other app, and its own
   * fallback sends them to `/home` — which lands here and bounces onward, so the
   * two guards compose instead of trapping anyone in a loop.
   *
   * Placed AFTER the hooks above deliberately: an early return before them would
   * change the hook count between renders (the directory arrives a beat after the
   * first paint) and React would throw.
   */
  if (isExternal && !isAdmin) return <Navigate to={appBasePath("customer-orders")} replace />;

  return (
    <AppShell
      nav={nav}
      role={role}
      user={{ name: user.name, designation: user.designation, color: user.avatarColor, roleLabel: roleLabel(role) }}
      notifications={notifications}
      onMarkRead={onMarkRead}
      // This screen IS the destination — the shell's automatic link would point here.
      showHomeLink={false}
    />
  );
}
