import { supabase } from "./supabase";
import type { AppRole, ModuleLevel } from "./types";
import type { Database } from "./database.types";

type DeptUpdate = Database["public"]["Tables"]["departments"]["Update"];
type SubDeptUpdate = Database["public"]["Tables"]["sub_departments"]["Update"];
type DesignationUpdate = Database["public"]["Tables"]["designations"]["Update"];
type BandUpdate = Database["public"]["Tables"]["bands"]["Update"];
type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"];

/**
 * Portal directory writes (Stage B B4, option B = careful live writes). Admin-only
 * mutations to the identity tables, gated by RLS (`is_admin(auth.uid())`). Rolled
 * out one flow at a time; until a flow is wired its store method stays a no-op.
 *
 * NOTE: creating a brand-new user is intentionally absent — profiles.id references
 * auth.users.id (a profile is auto-created by the on_auth_user_created trigger), so
 * onboarding a person requires an auth signup via the admin/service-role API, which
 * the browser client can't (and shouldn't) do. Same for hard-deleting a user.
 */

/* ------------------------------ departments ------------------------------- */

export async function insertDepartment(input: { name: string; description?: string | null; createdBy: string }): Promise<string> {
  const { data, error } = await supabase
    .from("departments")
    .insert({ name: input.name, description: input.description ?? null, created_by: input.createdBy })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function updateDepartment(id: string, patch: { name?: string; description?: string | null }): Promise<void> {
  const fields: DeptUpdate = {};
  if (patch.name !== undefined) fields.name = patch.name;
  if (patch.description !== undefined) fields.description = patch.description;
  const { error } = await supabase.from("departments").update(fields).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function setDepartmentActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase.from("departments").update({ active }).eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * ⚠ DELIBERATELY REMOVED — a department is switched off, never deleted.
 *
 * `departments` is the parent of 5,213 tasks, 195 recurring tasks, 45 HR job
 * titles, 12 requisitions and the `department_ids uuid[]` on nine FMS
 * step-owner tables. The old hard delete had no FK guard at all: it warned
 * "N user(s) will be left without one" and then orphaned five thousand rows of
 * task history. Use `setDepartmentActive(id, false)` — it disappears from every
 * picker that creates NEW references and stays resolvable everywhere it is
 * already referenced.
 */

/* ----------------------------- sub-departments ---------------------------- */

export async function insertSubDepartment(input: { departmentId: string; name: string; active: boolean; sortOrder: number; createdBy: string }): Promise<string> {
  const { data, error } = await supabase
    .from("sub_departments")
    .insert({ department_id: input.departmentId, name: input.name, active: input.active, sort_order: input.sortOrder, created_by: input.createdBy })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function updateSubDepartment(id: string, patch: { departmentId?: string; name?: string; active?: boolean; sortOrder?: number }): Promise<void> {
  const fields: SubDeptUpdate = {};
  if (patch.departmentId !== undefined) fields.department_id = patch.departmentId;
  if (patch.name !== undefined) fields.name = patch.name;
  if (patch.active !== undefined) fields.active = patch.active;
  if (patch.sortOrder !== undefined) fields.sort_order = patch.sortOrder;
  if (Object.keys(fields).length === 0) return;
  const { error } = await supabase.from("sub_departments").update(fields).eq("id", id);
  if (error) throw new Error(error.message);
}

/* ------------------------------- designations ----------------------------- */

export async function insertDesignation(input: { name: string; active: boolean; sortOrder: number }): Promise<string> {
  const { data, error } = await supabase
    .from("designations")
    .insert({ name: input.name, active: input.active, sort_order: input.sortOrder })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function updateDesignation(id: string, patch: { name?: string; active?: boolean; sortOrder?: number }): Promise<void> {
  const fields: DesignationUpdate = {};
  if (patch.name !== undefined) fields.name = patch.name;
  if (patch.active !== undefined) fields.active = patch.active;
  if (patch.sortOrder !== undefined) fields.sort_order = patch.sortOrder;
  if (Object.keys(fields).length === 0) return;
  const { error } = await supabase.from("designations").update(fields).eq("id", id);
  if (error) throw new Error(error.message);
}

/* ---------------------------------- bands --------------------------------- */

export async function insertBand(input: { bandNo: number; name: string; description?: string | null; active: boolean; sortOrder: number; createdBy: string }): Promise<string> {
  const { data, error } = await supabase
    .from("bands")
    .insert({ band_no: input.bandNo, name: input.name, description: input.description ?? null, active: input.active, sort_order: input.sortOrder, created_by: input.createdBy })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function updateBand(id: string, patch: { bandNo?: number; name?: string; description?: string | null; active?: boolean; sortOrder?: number }): Promise<void> {
  const fields: BandUpdate = {};
  if (patch.bandNo !== undefined) fields.band_no = patch.bandNo;
  if (patch.name !== undefined) fields.name = patch.name;
  if (patch.description !== undefined) fields.description = patch.description;
  if (patch.active !== undefined) fields.active = patch.active;
  if (patch.sortOrder !== undefined) fields.sort_order = patch.sortOrder;
  if (Object.keys(fields).length === 0) return;
  const { error } = await supabase.from("bands").update(fields).eq("id", id);
  if (error) throw new Error(error.message);
}

/* --------------------------------- users ---------------------------------- */

/** Update an existing user's profile fields (admin-only under RLS). */
export async function updateUserProfile(
  id: string,
  patch: { name?: string; email?: string | null; phone?: string | null; designation?: string | null; designationId?: string | null; departmentId?: string | null; subDepartmentId?: string | null; bandId?: string | null; employeeCode?: string | null; gender?: "male" | "female" | "other" | null; dateOfBirth?: string | null; avatarColor?: string; receivablesSalespersons?: string[]; receivablesHiddenMenus?: string[]; receivablesAdminMenus?: string[]; receivablesAllowedReports?: string[]; receivablesAllowPipeline?: boolean }
): Promise<void> {
  const fields: ProfileUpdate = {};
  if (patch.name !== undefined) fields.name = patch.name;
  if (patch.email !== undefined) fields.email = patch.email;
  if (patch.phone !== undefined) fields.phone = patch.phone;
  // designation (text) and designation_id travel together — the text is the
  // mirror list_org_people() returns for @mention pickers.
  if (patch.designation !== undefined) fields.designation = patch.designation;
  if (patch.designationId !== undefined) fields.designation_id = patch.designationId;
  if (patch.departmentId !== undefined) fields.department_id = patch.departmentId;
  if (patch.subDepartmentId !== undefined) fields.sub_department_id = patch.subDepartmentId;
  if (patch.bandId !== undefined) fields.band_id = patch.bandId;
  if (patch.employeeCode !== undefined) fields.employee_code = patch.employeeCode;
  // Ticketing details. Not guarded by guard_profile_org_fields() - see the note
  // on Profile.gender: these decide no entitlement, so the person they describe
  // may correct their own.
  if (patch.gender !== undefined) fields.gender = patch.gender;
  if (patch.dateOfBirth !== undefined) fields.date_of_birth = patch.dateOfBirth;
  if (patch.avatarColor !== undefined) fields.avatar_color = patch.avatarColor;
  if (patch.receivablesSalespersons !== undefined) fields.receivables_salespersons = patch.receivablesSalespersons;
  if (patch.receivablesHiddenMenus !== undefined) fields.receivables_hidden_menus = patch.receivablesHiddenMenus;
  if (patch.receivablesAdminMenus !== undefined) fields.receivables_admin_menus = patch.receivablesAdminMenus;
  if (patch.receivablesAllowedReports !== undefined) fields.receivables_allowed_reports = patch.receivablesAllowedReports;
  if (patch.receivablesAllowPipeline !== undefined) fields.receivables_allow_pipeline = patch.receivablesAllowPipeline;
  if (Object.keys(fields).length === 0) return;
  const { error } = await supabase.from("profiles").update(fields).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Set a user's single role: clear existing role rows, insert the new one. */
export async function setUserRole(userId: string, role: AppRole): Promise<void> {
  const { error: delErr } = await supabase.from("user_roles").delete().eq("user_id", userId);
  if (delErr) throw new Error(delErr.message);
  const { error: insErr } = await supabase.from("user_roles").insert({ user_id: userId, role });
  if (insErr) throw new Error(insErr.message);
}

/** Replace a user's reporting HODs with the given set. */
export async function setUserHods(employeeId: string, hodIds: string[]): Promise<void> {
  const { error: delErr } = await supabase.from("user_hods").delete().eq("employee_id", employeeId);
  if (delErr) throw new Error(delErr.message);
  if (hodIds.length) {
    const rows = hodIds.map((hod_id) => ({ employee_id: employeeId, hod_id }));
    const { error: insErr } = await supabase.from("user_hods").insert(rows);
    if (insErr) throw new Error(insErr.message);
  }
}

/**
 * Replace a user's app access with the given app id → level map.
 *
 * ⚠ NOT delete-everything-then-reinsert, which is what this used to be and what
 *   setUserRole/setUserHods above still are. Those two carry no extra columns,
 *   so wiping and rewriting them loses nothing. app_access now carries
 *   `access_level`, and this function is called on EVERY ordinary save from the
 *   admin user form (store.tsx `updateUser`, whenever moduleAccess is in the
 *   patch) — not only from the Module Access matrix. A blanket delete would
 *   therefore have reset every one of that user's view-only grants back to full
 *   the next time an admin corrected their phone number, silently and with no
 *   error to notice.
 *
 *   So: remove only what was actually revoked, and upsert the rest. As a bonus
 *   the surviving rows keep their original `created_at`, which the old wipe
 *   threw away on every save — "granted on" was never true for anyone.
 */
export async function setUserModules(userId: string, levels: Record<string, ModuleLevel>): Promise<void> {
  const appIds = Object.keys(levels);

  // Revoke first. With nothing granted this is the whole operation; otherwise
  // it drops exactly the ids that are no longer in the map. App ids are fixed
  // registry slugs (`task-management`, `outstanding-dashboard`), so the quoted
  // PostgREST list needs no escaping beyond the quotes themselves.
  const revoke = supabase.from("app_access").delete().eq("user_id", userId);
  const { error: delErr } = appIds.length
    ? await revoke.not("app_id", "in", `(${appIds.map((id) => `"${id}"`).join(",")})`)
    : await revoke;
  if (delErr) throw new Error(delErr.message);

  if (!appIds.length) return;

  // Upsert on the (user_id, app_id) unique constraint: a new grant inserts, an
  // existing one has only its level updated.
  const rows = appIds.map((app_id) => ({ user_id: userId, app_id, access_level: levels[app_id] }));
  const { error: upErr } = await supabase.from("app_access").upsert(rows, { onConflict: "user_id,app_id" });
  if (upErr) throw new Error(upErr.message);
}
