import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AppRole, Department, Profile } from "./types";
import { useAuth } from "./auth";
import { fetchDirectory } from "./liveDirectory";

/**
 * Portal directory (Stage B, READ-ONLY). Loads the workspace people + departments
 * live from Supabase (RLS-gated) for the signed-in user, and exposes the same
 * interface the app already consumes. Writes are disabled this phase (`canWrite`
 * is false; mutations are inert no-ops) until a safe write path is agreed — so
 * nothing here can change production data.
 */

export interface DirectoryValue {
  profiles: Profile[];
  departments: Department[];
  profileById: (id: string | null) => Profile | undefined;
  departmentById: (id: string | null) => Department | undefined;
  directReportIds: (hodId: string) => string[];
  assignableUsers: (role: AppRole, userId: string) => Profile[];
  /** False during the read-only phase — UIs disable write controls. */
  canWrite: boolean;
  // Kept for interface compatibility; inert while read-only.
  addDepartment: (input: { name: string; description?: string }) => string;
  updateDepartment: (id: string, patch: { name?: string; description?: string }) => void;
  deleteDepartment: (id: string) => void;
  addUser: (input: { name: string; email?: string; designation?: string; role: AppRole; departmentId: string | null; hodIds?: string[]; moduleAccess?: string[] }) => string;
  updateUser: (id: string, patch: Partial<Pick<Profile, "name" | "email" | "designation" | "role" | "departmentId" | "hodIds" | "avatarColor" | "moduleAccess">>) => void;
  deleteUser: (id: string) => void;
  setUserModules: (id: string, appIds: string[]) => void;
}

const DirectoryContext = createContext<DirectoryValue | null>(null);

const readOnly = () => {
  if (import.meta.env.DEV) console.warn("Directory is read-only in this phase — write ignored.");
};
const readOnlyId = () => {
  readOnly();
  return "";
};

export function PlatformDirectoryProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const { data, isLoading, error } = useQuery({
    queryKey: ["directory", session?.user.id ?? null],
    queryFn: fetchDirectory,
    enabled: !!session,
  });

  const profiles = data?.profiles ?? [];
  const departments = data?.departments ?? [];

  const value = useMemo<DirectoryValue>(() => {
    const profileById = (id: string | null) => profiles.find((p) => p.id === id);
    const departmentById = (id: string | null) => departments.find((d) => d.id === id);
    const directReportIds = (hodId: string) => profiles.filter((p) => p.hodIds.includes(hodId)).map((p) => p.id);
    const assignableUsers = (role: AppRole, userId: string): Profile[] => {
      if (role === "admin") return profiles;
      if (role === "hod" || role === "sub_hod") {
        const ids = new Set([userId, ...directReportIds(userId)]);
        return profiles.filter((p) => ids.has(p.id));
      }
      return profiles.filter((p) => p.id === userId);
    };
    return {
      profiles,
      departments,
      profileById,
      departmentById,
      directReportIds,
      assignableUsers,
      canWrite: false,
      addDepartment: readOnlyId,
      updateDepartment: readOnly,
      deleteDepartment: readOnly,
      addUser: readOnlyId,
      updateUser: readOnly,
      deleteUser: readOnly,
      setUserModules: readOnly,
    };
  }, [profiles, departments]);

  // Hold render until the directory is loaded for an authed user, so the session
  // and admin screens never see a half-empty directory. Unauthed (Landing/Login)
  // renders immediately with an empty directory it doesn't use.
  if (session && isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-page-grad text-grey text-sm">
        Loading your workspace…
      </div>
    );
  }
  if (session && error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-page-grad px-6 text-center">
        <div className="max-w-sm">
          <p className="text-[15px] font-semibold text-navy">Couldn't load your workspace</p>
          <p className="text-[13px] text-grey mt-1">{(error as Error).message}</p>
        </div>
      </div>
    );
  }

  return <DirectoryContext.Provider value={value}>{children}</DirectoryContext.Provider>;
}

export function useDirectory(): DirectoryValue {
  const ctx = useContext(DirectoryContext);
  if (!ctx) throw new Error("useDirectory must be used within PlatformDirectoryProvider");
  return ctx;
}
