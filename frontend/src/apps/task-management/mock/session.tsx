import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { AppRole, Profile } from "../types";
import { profiles } from "./data";

/**
 * Mock session for the frontend phase. Provides a "current user" and a dev-only
 * role switcher so each role's UI (employee / sub-HOD / HOD / admin) can be
 * previewed without real auth. Stage B replaces this with a real AuthProvider
 * backed by Supabase — components keep using useSession() unchanged.
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

export function MockSessionProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<AppRole>(initialRole);
  const value = useMemo<SessionValue>(() => {
    const user = profiles.find((p) => p.id === REP[role]) ?? profiles[0];
    return {
      user,
      role,
      setRole,
      isAdmin: role === "admin",
      isHod: role === "hod" || role === "sub_hod",
      isEmployee: role === "employee",
    };
  }, [role]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within MockSessionProvider");
  return ctx;
}

export const ALL_ROLES: { value: AppRole; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "hod", label: "HOD" },
  { value: "sub_hod", label: "Sub-HOD" },
  { value: "employee", label: "Employee" },
];
