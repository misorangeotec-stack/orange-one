import { supabase } from "./supabase";
import type { AppRole } from "./types";

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
  const fields: Record<string, unknown> = {};
  if (patch.name !== undefined) fields.name = patch.name;
  if (patch.description !== undefined) fields.description = patch.description;
  const { error } = await supabase.from("departments").update(fields).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteDepartment(id: string): Promise<void> {
  const { error } = await supabase.from("departments").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/* --------------------------------- users ---------------------------------- */

/** Update an existing user's profile fields (admin-only under RLS). */
export async function updateUserProfile(
  id: string,
  patch: { name?: string; email?: string | null; designation?: string | null; departmentId?: string | null; avatarColor?: string }
): Promise<void> {
  const fields: Record<string, unknown> = {};
  if (patch.name !== undefined) fields.name = patch.name;
  if (patch.email !== undefined) fields.email = patch.email;
  if (patch.designation !== undefined) fields.designation = patch.designation;
  if (patch.departmentId !== undefined) fields.department_id = patch.departmentId;
  if (patch.avatarColor !== undefined) fields.avatar_color = patch.avatarColor;
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

/** Replace a user's app access with the given set of app ids. */
export async function setUserModules(userId: string, appIds: string[]): Promise<void> {
  const { error: delErr } = await supabase.from("app_access").delete().eq("user_id", userId);
  if (delErr) throw new Error(delErr.message);
  if (appIds.length) {
    const rows = appIds.map((app_id) => ({ user_id: userId, app_id }));
    const { error: insErr } = await supabase.from("app_access").insert(rows);
    if (insErr) throw new Error(insErr.message);
  }
}
