import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import type { AppRole, Profile } from "./types";
import { useAuth } from "./auth";
import { useDirectory } from "./store";

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
  isHod: boolean; // hod or sub_hod (team-level access)
  isEmployee: boolean;
  moduleAccess: string[];
  hasModule: (appId: string) => boolean;
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
    return {
      // Non-null wherever it's read: every consumer is behind RequireAuth and the
      // directory has finished loading, so a matching profile exists.
      user: user as Profile,
      role,
      isAdmin,
      isHod: role === "hod" || role === "sub_hod",
      isEmployee: role === "employee",
      moduleAccess: user?.moduleAccess ?? [],
      hasModule: (appId: string) => isAdmin || (user?.moduleAccess.includes(appId) ?? false),
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
