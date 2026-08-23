import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppRole, Band, Department, Designation, ModuleLevel, Profile, SubDepartment } from "./types";
import { useAuth } from "./auth";
import { fetchDirectory } from "./liveDirectory";
import {
  insertDepartment as insertDepartmentWrite,
  updateDepartment as updateDepartmentWrite,
  setDepartmentActive as setDepartmentActiveWrite,
  insertSubDepartment as insertSubDepartmentWrite,
  updateSubDepartment as updateSubDepartmentWrite,
  insertDesignation as insertDesignationWrite,
  updateDesignation as updateDesignationWrite,
  insertBand as insertBandWrite,
  updateBand as updateBandWrite,
  updateUserProfile as updateUserProfileWrite,
  setUserRole as setUserRoleWrite,
  setUserHods as setUserHodsWrite,
  setUserModules as setUserModulesWrite,
} from "./directoryWrites";
import { createUserViaFunction, deleteUserViaFunction, setUserEmailViaFunction, setUserPasswordViaFunction } from "./adminUserApi";

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
  subDepartments: SubDepartment[];
  designations: Designation[];
  bands: Band[];
  profileById: (id: string | null) => Profile | undefined;
  departmentById: (id: string | null) => Department | undefined;
  subDepartmentById: (id: string | null) => SubDepartment | undefined;
  designationById: (id: string | null) => Designation | undefined;
  bandById: (id: string | null) => Band | undefined;
  /** Active sub-departments under a department, for the dependent picker on the user form. */
  subDepartmentsFor: (departmentId: string | null) => SubDepartment[];
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
  /**
   * Switch a department off/on. There is deliberately no delete: `departments` is
   * the parent of 5k+ tasks and every FMS step-owner list.
   */
  setDepartmentActive: (id: string, active: boolean) => Promise<void>;

  addSubDepartment: (input: { departmentId: string; name: string; active?: boolean; sortOrder?: number }) => Promise<string>;
  updateSubDepartment: (id: string, patch: { departmentId?: string; name?: string; active?: boolean; sortOrder?: number }) => Promise<void>;
  addDesignation: (input: { name: string; active?: boolean; sortOrder?: number }) => Promise<string>;
  updateDesignation: (id: string, patch: { name?: string; active?: boolean; sortOrder?: number }) => Promise<void>;
  addBand: (input: { bandNo: number; name: string; description?: string | null; active?: boolean; sortOrder?: number }) => Promise<string>;
  updateBand: (id: string, patch: { bandNo?: number; name?: string; description?: string | null; active?: boolean; sortOrder?: number }) => Promise<void>;

  addUser: (input: { name: string; email?: string; mobile: string; designation?: string | null; designationId?: string | null; role: AppRole; departmentId: string | null; subDepartmentId?: string | null; bandId?: string | null; employeeCode?: string | null; hodIds?: string[]; moduleLevels?: Record<string, ModuleLevel>; receivablesSalespersons?: string[]; receivablesHiddenMenus?: string[]; receivablesAdminMenus?: string[]; receivablesAllowedReports?: string[] }) => Promise<string>;
  /**
   * ⚠ `moduleLevels` is the whole grant — the ids in it ARE the granted apps.
   *   `moduleAccess` is deliberately NOT accepted here: two ways to say the same
   *   thing is how the id list and the levels drift apart.
   */
  updateUser: (id: string, patch: Partial<Pick<Profile, "name" | "email" | "phone" | "designation" | "designationId" | "role" | "departmentId" | "subDepartmentId" | "bandId" | "employeeCode" | "hodIds" | "avatarColor" | "moduleLevels" | "receivablesSalespersons" | "receivablesHiddenMenus" | "receivablesAdminMenus" | "receivablesAllowedReports" | "receivablesAllowPipeline">>) => Promise<void>;
  deleteUser: (id: string) => Promise<void>;
  setUserModules: (id: string, levels: Record<string, ModuleLevel>) => Promise<void>;
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

/** How many times a directory missing the user's own row is re-read before giving up. */
const SELF_ROW_MAX_RETRIES = 3;

export function PlatformDirectoryProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const authId = session?.user.id ?? null;
  const { data, error } = useQuery({
    queryKey: ["directory", authId],
    queryFn: fetchDirectory,
    enabled: !!session,
  });

  /*
    ⚠ A DIRECTORY WITHOUT YOUR OWN ROW IS A FAILED READ WEARING A SUCCESS'S CLOTHES.

      `profiles` is RLS'd as `(id = auth.uid() OR is_admin(…) OR is_hod_of(…) OR
      same_department(…))`, so the signed-in user's own row is ALWAYS readable —
      it is the first arm of the policy. A read that comes back without it did not
      carry their token, and PostgREST reports that as HTTP 200 with `[]`, not as
      an error: RLS filters rows, it does not raise. So `error` stays null,
      `data` is a perfectly well-formed object, and the gate below used to wave it
      straight through.

      What that produced: SessionProvider resolves `user` to undefined (it casts
      `user as Profile`, so nothing complains), and the first screen to read a
      field off it — `user.name` in HomeLayout, `user.id` in the My Work tasks
      provider — throws during render. With no error boundary in the tree that
      unmounted the whole app, which is the BLANK WHITE /home people were curing
      with a hard refresh: the reload re-read the token from storage cleanly and
      the next fetch went out authenticated.

      Treating it as loaded is therefore never right. Re-read instead — the
      condition is transient — and only after several attempts say so plainly.
  */
  const selfMissing = !!authId && !!data && !data.profiles.some((p) => p.id === authId);
  const [reread, setReread] = useState<{ uid: string | null; attempts: number }>({ uid: null, attempts: 0 });
  const attemptsForUser = reread.uid === authId ? reread.attempts : 0;

  useEffect(() => {
    if (!selfMissing || !authId || attemptsForUser >= SELF_ROW_MAX_RETRIES) return;
    setReread({ uid: authId, attempts: attemptsForUser + 1 });
    /*
      REMOVE, not invalidate. The bad payload is `status: "success"`, so leaving it
      in the cache would (a) keep handing it to children on the very next render,
      before the refetch lands, and (b) let it be dehydrated to IndexedDB by the
      persister — "directory" is in PERSISTED_QUERY_ROOTS — where it would be
      restored for the full 24-hour max age and turn one unlucky read into a blank
      page on every subsequent load.
    */
    queryClient.removeQueries({ queryKey: ["directory", authId], exact: true });
  }, [selfMissing, authId, attemptsForUser, queryClient]);

  /** Re-read the allowed number of times and the row still isn't there. */
  const selfUnreadable = selfMissing && attemptsForUser >= SELF_ROW_MAX_RETRIES;

  const profiles = data?.profiles ?? [];
  const departments = data?.departments ?? [];
  const subDepartments = data?.subDepartments ?? [];
  const designations = data?.designations ?? [];
  const bands = data?.bands ?? [];
  const uid = session?.user.id ?? "";

  const value = useMemo<DirectoryValue>(() => {
    const refresh = () => queryClient.invalidateQueries({ queryKey: ["directory"] });
    const profileById = (id: string | null) => profiles.find((p) => p.id === id);
    const departmentById = (id: string | null) => departments.find((d) => d.id === id);
    const subDepartmentById = (id: string | null) => subDepartments.find((s) => s.id === id);
    const designationById = (id: string | null) => designations.find((d) => d.id === id);
    const bandById = (id: string | null) => bands.find((b) => b.id === id);
    const subDepartmentsFor = (departmentId: string | null) =>
      !departmentId ? [] : subDepartments.filter((s) => s.departmentId === departmentId && s.active);
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
      subDepartments,
      designations,
      bands,
      profileById,
      departmentById,
      subDepartmentById,
      designationById,
      bandById,
      subDepartmentsFor,
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
      setDepartmentActive: async (id, active) => {
        await setDepartmentActiveWrite(id, active);
        await refresh();
      },

      addSubDepartment: async (input) => {
        const id = await insertSubDepartmentWrite({
          departmentId: input.departmentId,
          name: input.name,
          active: input.active ?? true,
          sortOrder: input.sortOrder ?? 0,
          createdBy: uid,
        });
        await refresh();
        return id;
      },
      updateSubDepartment: async (id, patch) => {
        await updateSubDepartmentWrite(id, patch);
        await refresh();
      },
      addDesignation: async (input) => {
        const id = await insertDesignationWrite({ name: input.name, active: input.active ?? true, sortOrder: input.sortOrder ?? 0 });
        await refresh();
        return id;
      },
      updateDesignation: async (id, patch) => {
        await updateDesignationWrite(id, patch);
        await refresh();
      },
      addBand: async (input) => {
        const id = await insertBandWrite({
          bandNo: input.bandNo,
          name: input.name,
          description: input.description ?? null,
          active: input.active ?? true,
          sortOrder: input.sortOrder ?? input.bandNo * 10,
          createdBy: uid,
        });
        await refresh();
        return id;
      },
      updateBand: async (id, patch) => {
        await updateBandWrite(id, patch);
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
          designationId: input.designationId ?? null,
          role: input.role,
          departmentId: input.departmentId,
          subDepartmentId: input.subDepartmentId ?? null,
          bandId: input.bandId ?? null,
          employeeCode: input.employeeCode ?? null,
          hodIds: input.hodIds ?? [],
          moduleLevels: input.moduleLevels ?? {},
          receivablesSalespersons: input.receivablesSalespersons ?? [],
          receivablesHiddenMenus: input.receivablesHiddenMenus ?? [],
          receivablesAdminMenus: input.receivablesAdminMenus ?? [],
          receivablesAllowedReports: input.receivablesAllowedReports ?? [],
        });
        await refresh();
        return id;
      },
      updateUser: async (id, patch) => {
        // The login email lives in auth.users; `profiles.email` is only the copy the
        // Users list, the user form, the export and the Account page all read. Move
        // the auth one FIRST and let a failure (e.g. "already registered") abort the
        // save: writing the profile first would leave every screen showing an address
        // that can't sign in, which is exactly how a corrected typo used to lock a
        // user out with no visible cause. Fires only on an actual change, so ordinary
        // saves don't call the admin function for an untouched field.
        const emailNext = patch.email?.trim();
        const emailPrev = profiles.find((p) => p.id === id)?.email?.trim();
        if (emailNext && emailNext.toLowerCase() !== (emailPrev ?? "").toLowerCase()) {
          await setUserEmailViaFunction(id, emailNext);
        }
        await updateUserProfileWrite(id, {
          name: patch.name,
          email: patch.email,
          phone: patch.phone,
          designation: patch.designation,
          designationId: patch.designationId,
          departmentId: patch.departmentId,
          subDepartmentId: patch.subDepartmentId,
          bandId: patch.bandId,
          employeeCode: patch.employeeCode,
          avatarColor: patch.avatarColor,
          receivablesSalespersons: patch.receivablesSalespersons,
          receivablesHiddenMenus: patch.receivablesHiddenMenus,
          receivablesAdminMenus: patch.receivablesAdminMenus,
          receivablesAllowedReports: patch.receivablesAllowedReports,
          receivablesAllowPipeline: patch.receivablesAllowPipeline,
        });
        if (patch.role !== undefined) await setUserRoleWrite(id, patch.role);
        if (patch.hodIds !== undefined) await setUserHodsWrite(id, patch.hodIds);
        if (patch.moduleLevels !== undefined) await setUserModulesWrite(id, patch.moduleLevels);
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
      setUserModules: async (id, levels) => {
        await setUserModulesWrite(id, levels);
        await refresh();
      },
    };
  }, [profiles, departments, subDepartments, designations, bands, uid, queryClient]);

  // Hold render until the directory is loaded for an authed user, so the session
  // and admin screens never see a half-empty directory. Unauthed (Landing/Login)
  // renders immediately with an empty directory it doesn't use.
  //
  // Gate on `!data` (not just `isLoading`): when a fresh tab restores a session,
  // there's a render where the query is enabled but hasn't flipped to fetching
  // yet — isLoading is still false while data is undefined. Rendering children
  // there lets RequireModule evaluate against an empty directory and wrongly
  // bounce a deep link (e.g. /outstanding-dashboard/customer/...) to /home.
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
  // Re-read exhausted: the directory loads but never contains this user. Say so,
  // rather than rendering children that will dereference a user who isn't there.
  if (selfUnreadable) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-page-grad px-6 text-center">
        <div className="max-w-sm">
          <p className="text-[15px] font-semibold text-navy">Couldn't load your profile</p>
          <p className="text-[13px] text-grey mt-1">
            You're signed in, but your workspace profile didn't come back. Sign out and in again —
            if it persists, ask your admin to check your account.
          </p>
        </div>
      </div>
    );
  }
  // `!data` covers the first load; `selfMissing` holds the same screen across the
  // re-read above, so children never see a directory the user isn't in.
  if (session && (!data || selfMissing)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-page-grad text-grey text-sm">
        Loading your workspace…
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
