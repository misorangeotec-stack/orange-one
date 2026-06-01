import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { AppRole, Profile } from "./types";
import { useDirectory } from "./store";

/**
 * Portal-wide session for the frontend phase. Provides the "current user", a
 * dev-only role switcher (preview each role's UI without real auth), and the
 * user's portal module access. Wraps the WHOLE app (launcher + admin + every
 * business app) so they share one identity. Sits INSIDE the directory provider
 * so the current user reflects live edits (e.g. an admin changing someone's
 * module access). Stage B replaces this with a real AuthProvider backed by
 * Supabase Auth — components keep using useSession() unchanged.
 */

/** Representative user shown for each role when switching. */
const REP: Record<AppRole, string> = {
  admin: "u1", // Yash Agarwal
  hod: "u3", // Karan Toshniwal
  sub_hod: "u5", // Dimple
  employee: "u6", // Aayushi Shah
};

interface SessionValue {
  user: Profile;
  role: AppRole;
  setRole: (r: AppRole) => void;
  isAdmin: boolean;
  isHod: boolean; // hod or sub_hod (team-level access)
  isEmployee: boolean;
  /** Granted portal app ids for the current user (admins implicitly all). */
  moduleAccess: string[];
  /** True if the current user may open the given app (admins → always true). */
  hasModule: (appId: string) => boolean;
}

const SessionContext = createContext<SessionValue | null>(null);

const VALID_ROLES: AppRole[] = ["admin", "hod", "sub_hod", "employee"];

/** Initial role can be seeded via ?role= for quick previews; defaults to admin. */
function initialRole(): AppRole {
  if (typeof window !== "undefined") {
    const q = new URLSearchParams(window.location.search).get("role") as AppRole | null;
    if (q && VALID_ROLES.includes(q)) return q;
  }
  return "admin";
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const { profiles } = useDirectory();
  const [role, setRole] = useState<AppRole>(initialRole);
  const value = useMemo<SessionValue>(() => {
    const user = profiles.find((p) => p.id === REP[role]) ?? profiles[0];
    const isAdmin = role === "admin";
    return {
      user,
      role,
      setRole,
      isAdmin,
      isHod: role === "hod" || role === "sub_hod",
      isEmployee: role === "employee",
      moduleAccess: user.moduleAccess,
      hasModule: (appId: string) => isAdmin || user.moduleAccess.includes(appId),
    };
  }, [role, profiles]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** Back-compat alias — the provider was previously named MockSessionProvider. */
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
