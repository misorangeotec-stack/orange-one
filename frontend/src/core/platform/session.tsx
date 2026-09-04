import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import type { AppRole, ModuleLevel, Profile } from "./types";
import { useAuth } from "./auth";
import { useDirectory } from "./store";
import { isUniversalApp } from "@/apps/universal";

/**
 * Portal session (Stage B). The current user is the signed-in Supabase user,
 * resolved against the live directory; role + module access come from their real
 * profile. Consumers (behind RequireAuth, after the directory has loaded) always
 * see a real user. The dev "view as" role switcher is gone — you are who you log
 * in as.
 */
interface SessionValue {
  user: Profile;
  role: AppRole;
  isAdmin: boolean;
  /** True when this login is a customer, not staff. See Profile.isExternal. */
  isExternal: boolean;
  isHod: boolean; // hod or sub_hod (team-level access)
  isEmployee: boolean;
  moduleAccess: string[];
  hasModule: (appId: string) => boolean;
  /**
   * How much of an app this user gets: "none" | "view" | "edit".
   * Admins are always "edit"; so is a universal app, which carries no grant row.
   */
  moduleLevel: (appId: string) => ModuleLevel | "none";
  /**
   * May this user CHANGE anything in this app? The one question every write
   * affordance should ask.
   *
   * ⚠ This is NOT the opposite of hasModule, and it must never be used to decide
   *   whether to show the app, its menu, or its queues. A view-only user opens
   *   the app normally and reads every screen in it — they simply have no
   *   buttons. If an app card vanishes from the launcher or a queue starts
   *   returning Access Denied, this verdict has leaked into a read gate.
   */
  canEditModule: (appId: string) => boolean;
  /**
   * Is this user a MODULE-WIDE VIEWER of this app?
   *
   * A "View only" grant is a read-the-whole-module grant: every queue, every
   * register, the Control Center. Ownership config — step owners, coordinators,
   * master managers — decides what an EDIT user sees and is left alone, so a
   * viewer deliberately sees MORE screens than an editor who owns no step. That
   * inversion is the design, not a bug: ownership answers "whose work is this",
   * a view grant answers "may this person read the module".
   *
   * ⚠ VISIBILITY ONLY. Never fold this into an action predicate, and never into
   *   a flag that doubles as both — `isProcessCoordinator` is a route guard AND
   *   an authority short-circuit inside every `canActOn`, which is why each app
   *   splits off a separate `canMonitor` instead of widening it. This pairs with
   *   canEditModule, which stays false for exactly these users.
   *
   * Admins are false here: they already pass every gate on their own arm.
   */
  isModuleViewer: (appId: string) => boolean;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const { profiles } = useDirectory();
  const authId = session?.user.id ?? null;

  const value = useMemo<SessionValue>(() => {
    const user = profiles.find((p) => p.id === authId) ?? null;
    const role: AppRole = user?.role ?? "employee";
    const isAdmin = role === "admin";
    // Fails closed: no resolved profile yet means we do not YET know this is staff.
    const isExternal = user?.isExternal ?? false;
    return {
      // Non-null wherever it's read: every consumer is behind RequireAuth and the
      // directory has finished loading, so a matching profile exists.
      user: user as Profile,
      role,
      isAdmin,
      isExternal,
      isHod: role === "hod" || role === "sub_hod",
      isEmployee: role === "employee",
      moduleAccess: user?.moduleAccess ?? [],
      // A universal app needs no grant — see apps/universal.ts. Everything else is
      // opt-in per user, and admins bypass.
      hasModule: (appId: string) =>
        isAdmin || isUniversalApp(appId) || (user?.moduleAccess.includes(appId) ?? false),
      // Admins hold no app_access rows at all, so they can't be read from the map —
      // they are "edit" by definition, which is also why a view-only grant can
      // never land on one. A universal app has no row either and stays fully
      // writable, exactly as it behaved before levels existed.
      moduleLevel: (appId: string) => {
        if (isAdmin || isUniversalApp(appId)) return "edit";
        return user?.moduleLevels[appId] ?? "none";
      },
      canEditModule: (appId: string) =>
        isAdmin || isUniversalApp(appId) || user?.moduleLevels[appId] === "edit",
      // Read-the-whole-module. Not the inverse of canEditModule: a user with no
      // grant at all is false here too, and RequireModule has already turned
      // them away before anything asks.
      isModuleViewer: (appId: string) =>
        !isAdmin && !isUniversalApp(appId) && user?.moduleLevels[appId] === "view",
    };
  }, [authId, profiles]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** Back-compat alias for the previous mock provider name. */
export const MockSessionProvider = SessionProvider;

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}

export const ALL_ROLES: { value: AppRole; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "hod", label: "HOD" },
  { value: "sub_hod", label: "Sub-HOD" },
  { value: "employee", label: "Employee" },
];

/**
 * Human label for a role — what every app layout passes to AppShell as
 * `user.roleLabel`. Lives here beside ALL_ROLES because it was copy-pasted
 * identically into nine layout files, so a new role meant nine edits.
 */
export const roleLabel = (role: string): string => ALL_ROLES.find((r) => r.value === role)?.label ?? role;
