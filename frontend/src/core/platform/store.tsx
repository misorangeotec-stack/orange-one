import { createContext, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { AppRole, AvatarColor, Department, Profile } from "./types";
import { departments as seedDepartments, profiles as seedProfiles } from "./data";

/**
 * In-memory portal directory for the frontend phase — owns people + departments
 * for the WHOLE workspace (mirrors the Supabase `profiles` / `user_roles` /
 * `user_hods` / `departments` / `app_access` tables). Mutations match the shape
 * the backend will use, so Stage B swaps this for live queries / RPCs with the
 * same interface. Both the Admin area and every business app read from here via
 * useDirectory(); the Task store re-exposes these fields so its many existing
 * consumers stay unchanged.
 */

const AVATAR_COLORS: AvatarColor[] = ["blue", "orange", "teal", "violet", "rose", "green", "navy"];

export interface DirectoryValue {
  profiles: Profile[];
  departments: Department[];
  profileById: (id: string | null) => Profile | undefined;
  departmentById: (id: string | null) => Department | undefined;
  directReportIds: (hodId: string) => string[];
  assignableUsers: (role: AppRole, userId: string) => Profile[];
  addDepartment: (input: { name: string; description?: string }) => string;
  updateDepartment: (id: string, patch: { name?: string; description?: string }) => void;
  deleteDepartment: (id: string) => void;
  addUser: (input: { name: string; email?: string; designation?: string; role: AppRole; departmentId: string | null; hodIds?: string[]; moduleAccess?: string[] }) => string;
  updateUser: (id: string, patch: Partial<Pick<Profile, "name" | "email" | "designation" | "role" | "departmentId" | "hodIds" | "avatarColor" | "moduleAccess">>) => void;
  deleteUser: (id: string) => void;
  /** Replace a user's granted portal app ids (→ app_access delete+insert in Stage B). */
  setUserModules: (id: string, appIds: string[]) => void;
}

const DirectoryContext = createContext<DirectoryValue | null>(null);

export function PlatformDirectoryProvider({ children }: { children: ReactNode }) {
  const [profiles, setProfiles] = useState<Profile[]>(() =>
    seedProfiles.map((p) => ({ ...p, hodIds: [...p.hodIds], moduleAccess: [...p.moduleAccess] }))
  );
  const [departments, setDepartments] = useState<Department[]>(() => seedDepartments.map((d) => ({ ...d })));
  const seq = useRef(2000);
  const nextId = (p: string) => `${p}${++seq.current}`;

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

      addDepartment: ({ name, description }) => {
        const id = nextId("d");
        setDepartments((prev) => [...prev, { id, name, description: description ?? null }]);
        return id;
      },
      updateDepartment: (id, p) => setDepartments((prev) => prev.map((d) => (d.id === id ? { ...d, ...p } : d))),
      deleteDepartment: (id) => {
        setDepartments((prev) => prev.filter((d) => d.id !== id));
        setProfiles((prev) => prev.map((p) => (p.departmentId === id ? { ...p, departmentId: null } : p)));
      },

      addUser: ({ name, email, designation, role, departmentId, hodIds, moduleAccess }) => {
        const id = nextId("u");
        setProfiles((prev) => [
          ...prev,
          {
            id, name, email: email ?? null, designation: designation ?? null,
            avatarColor: AVATAR_COLORS[prev.length % AVATAR_COLORS.length],
            departmentId, role, hodIds: hodIds ?? [], moduleAccess: moduleAccess ?? ["task-management"],
          },
        ]);
        return id;
      },
      updateUser: (id, p) => setProfiles((prev) => prev.map((u) => (u.id === id ? { ...u, ...p } : u))),
      deleteUser: (id) =>
        setProfiles((prev) => prev.filter((u) => u.id !== id).map((u) => ({ ...u, hodIds: u.hodIds.filter((h) => h !== id) }))),
      setUserModules: (id, appIds) =>
        setProfiles((prev) => prev.map((u) => (u.id === id ? { ...u, moduleAccess: [...appIds] } : u))),
    };
  }, [profiles, departments]);

  return <DirectoryContext.Provider value={value}>{children}</DirectoryContext.Provider>;
}

export function useDirectory(): DirectoryValue {
  const ctx = useContext(DirectoryContext);
  if (!ctx) throw new Error("useDirectory must be used within PlatformDirectoryProvider");
  return ctx;
}
