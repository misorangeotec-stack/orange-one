import { useMemo } from "react";
import AppShell from "@/shared/components/layout/AppShell";
import { useSession, roleLabel } from "@/core/platform/session";
import { apps } from "@/apps/registry";
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
  const { user, role, isAdmin, hasModule } = useSession();
  const { items: notifications, onMarkRead } = useTaskNotifications();

  // Rebuilt only when the user's access changes, not on every render.
  const nav = useMemo(() => buildHomeNav(apps, { hasModule, isAdmin }), [hasModule, isAdmin]);

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
