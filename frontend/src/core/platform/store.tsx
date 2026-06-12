import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppRole, Department, Profile } from "./types";
import { useAuth } from "./auth";
import { fetchDirectory } from "./liveDirectory";
import {
  insertDepartment as insertDepartmentWrite,
  updateDepartment as updateDepartmentWrite,
  deleteDepartment as deleteDepartmentWrite,
  updateUserProfile as updateUserProfileWrite,
  setUserRole as setUserRoleWrite,
  setUserHods as setUserHodsWrite,
  setUserModules as setUserModulesWrite,
} from "./directoryWrites";
import { createUserViaFunction, deleteUserViaFunction, setUserPasswordViaFunction } from "./adminUserApi";

/**
 * Portal directory (Stage B). Loads the workspace people + departments live from
 * Supabase (RLS-gated) for the signed-in user and exposes the same interface the
 * app consumes. B4 wires the admin writes under their RLS: department CRUD, editing
 * an existing user (profile / role / reporting / module access), and self-profile
 * edits — each gated by a granular flag. Creating or hard-deleting a user needs the
 * auth admin API (service role), so `canAddUser`/`canDeleteUser` stay false.
 */

export interface DirectoryValue {
  profiles: Profile[];
  departments: Department[];
  profileById: (id: string | null) => Profile | undefined;
  departmentById: (id: string | null) => Department | undefined;
  directReportIds: (hodId: string) => string[];
  /** Transitive reports (full downline) of `rootId` — used for manager visibility/assignment. */
  downlineIds: (rootId: string) => string[];
  assignableUsers: (role: AppRole, userId: string) => Profile[];
  /** Legacy umbrella flag; superseded by the granular flags below. */
  canWrite: boolean;
  /** B4: department add/edit/delete is live (admin). */
  canManageDepartments: boolean;
  /** B4: editing an existing user (profile/role/reporting/modules) is live (admin). */
  canEditUser: boolean;
  /** B4: the per-user module-access matrix is live (admin). */
  canManageModules: boolean;
  /** B4: a user editing their own profile is live (all users). */
  canEditOwnProfile: boolean;
  /** Creating a brand-new user needs an auth signup (service role) — not client-wireable. */
  canAddUser: boolean;
  /** Hard-deleting a user needs the auth admin API — not client-wireable. */
  canDeleteUser: boolean;

  addDepartment: (input: { name: string; description?: string }) => Promise<string>;
  updateDepartment: (id: string, patch: { name?: string; description?: string }) => Promise<void>;
  deleteDepartment: (id: string) => Promise<void>;
  addUser: (input: { name: string; email?: string; mobile: string; designation?: string; role: AppRole; departmentId: string | null; hodIds?: string[]; moduleAccess?: string[]; receivablesSalespersons?: string[] }) => Promise<string>;
  updateUser: (id: string, patch: Partial<Pick<Profile, "name" | "email" | "phone" | "designation" | "role" | "departmentId" | "hodIds" | "avatarColor" | "moduleAccess" | "receivablesSalespersons">>) => Promise<void>;
  deleteUser: (id: string) => Promise<void>;
  setUserModules: (id: string, appIds: string[]) => Promise<void>;
}

/**
 * Everyone reporting (transitively) to `rootId`: direct reports, their reports, and so on.
 * `directReportIds` is direct-only; this walks the chain via each profile's `hodIds` so a
 * HOD's downline includes the employees nested under her sub-HODs. Cycle-safe (a profile is
 * never revisited); the root itself is excluded.
 */
export function computeDownlineIds(profiles: Profile[], rootId: string): string[] {
  const seen = new Set<string>();
  const queue = [rootId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const p of profiles) {
      if (p.hodIds.includes(current) && !seen.has(p.id) && p.id !== rootId) {
        seen.add(p.id);
        queue.push(p.id);
      }
    }
  }
  return [...seen];
}

const DirectoryContext = createContext<DirectoryValue | null>(null);

export function PlatformDirectoryProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["directory", session?.user.id ?? null],
    queryFn: fetchDirectory,
    enabled: !!session,
  });

  const profiles = data?.profiles ?? [];
  const departments = data?.departments ?? [];
  const uid = session?.user.id ?? "";

  const value = useMemo<DirectoryValue>(() => {
    const refresh = () => queryClient.invalidateQueries({ queryKey: ["directory"] });
    const profileById = (id: string | null) => profiles.find((p) => p.id === id);
    const departmentById = (id: string | null) => departments.find((d) => d.id === id);
    const directReportIds = (hodId: string) => profiles.filter((p) => p.hodIds.includes(hodId)).map((p) => p.id);
    const downlineIds = (rootId: string) => computeDownlineIds(profiles, rootId);
    // You assign tasks DOWN the hierarchy, never to yourself: admins to anyone,
    // HOD/sub-HOD to their full downline (their reports + everyone nested under their
    // sub-HODs), employees to no one.
    const assignableUsers = (role: AppRole, userId: string): Profile[] => {
      if (role === "admin") return profiles.filter((p) => p.id !== userId);
      if (role === "hod" || role === "sub_hod") {
        const ids = new Set(downlineIds(userId)); // full downline — no self
        return profiles.filter((p) => ids.has(p.id) && p.id !== userId);
      }
      return []; // employees have no one to assign to
    };
    return {
      profiles,
      departments,
      profileById,
      departmentById,
      directReportIds,
      downlineIds,
      assignableUsers,

      canWrite: false,
      canManageDepartments: true,
      canEditUser: true,
      canManageModules: true,
      canEditOwnProfile: true,
      // Create / hard-delete go through the deployed admin-users Edge Function.
      canAddUser: true,
      canDeleteUser: true,

      addDepartment: async (input) => {
        const id = await insertDepartmentWrite({ name: input.name, description: input.description ?? null, createdBy: uid });
        await refresh();
        return id;
      },
      updateDepartment: async (id, patch) => {
        await updateDepartmentWrite(id, patch);
        await refresh();
      },
      deleteDepartment: async (id) => {
        await deleteDepartmentWrite(id);
        await refresh();
      },

      // Editing an existing user = profile fields + (optionally) role / reporting /
      // module access, each under its admin RLS. Creating/deleting a user goes
      // through the admin-users Edge Function (auth admin API); gated by
      // canAddUser / canDeleteUser, off until the function is deployed.
      addUser: async (input) => {
        const id = await createUserViaFunction({
          name: input.name,
          email: input.email ?? "",
          phone: input.mobile,
          designation: input.designation ?? null,
          role: input.role,
          departmentId: input.departmentId,
          hodIds: input.hodIds ?? [],
          moduleAccess: input.moduleAccess ?? [],
          receivablesSalespersons: input.receivablesSalespersons ?? [],
        });
        await refresh();
        return id;
      },
      updateUser: async (id, patch) => {
        await updateUserProfileWrite(id, {
          name: patch.name,
          email: patch.email,
          phone: patch.phone,
          designation: patch.designation,
          departmentId: patch.departmentId,
          avatarColor: patch.avatarColor,
          receivablesSalespersons: patch.receivablesSalespersons,
        });
        if (patch.role !== undefined) await setUserRoleWrite(id, patch.role);
        if (patch.hodIds !== undefined) await setUserHodsWrite(id, patch.hodIds);
        if (patch.moduleAccess !== undefined) await setUserModulesWrite(id, patch.moduleAccess);
        // Per workspace policy, saving the user form re-pins the login password to
        // the current mobile number. Only fires when a phone is supplied (the admin
        // user form always does; self-profile saves don't, so they never reset it).
        if (patch.phone) await setUserPasswordViaFunction(id, patch.phone);
        await refresh();
      },
      deleteUser: async (id) => {
        await deleteUserViaFunction(id);
        await refresh();
      },
      setUserModules: async (id, appIds) => {
        await setUserModulesWrite(id, appIds);
        await refresh();
      },
    };
  }, [profiles, departments, uid, queryClient]);

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
