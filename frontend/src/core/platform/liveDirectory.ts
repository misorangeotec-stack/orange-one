import { supabase } from "./supabase";
import type { AppRole, Department, Profile } from "./types";

/**
 * Live directory loader (Stage B, read-only). Pulls the portal identity tables and
 * maps them to the frontend's denormalised read-model:
 *   role         ← user_roles  (highest-precedence role if a user has several)
 *   hodIds       ← user_hods
 *   moduleAccess ← app_access
 *   avatarColor  ← profiles.avatar_color (raw hex)
 * All reads are gated by RLS for the signed-in user. No writes.
 */

const ROLE_RANK: Record<AppRole, number> = { admin: 4, hod: 3, sub_hod: 2, employee: 1 };

export interface DirectoryData {
  profiles: Profile[];
  departments: Department[];
}

export async function fetchDirectory(): Promise<DirectoryData> {
  const [profilesRes, deptsRes, rolesRes, hodsRes, accessRes] = await Promise.all([
    supabase.from("profiles").select("id,name,email,phone,designation,avatar_color,department_id,receivables_salespersons"),
    supabase.from("departments").select("id,name,description"),
    supabase.from("user_roles").select("user_id,role"),
    supabase.from("user_hods").select("employee_id,hod_id"),
    supabase.from("app_access").select("user_id,app_id"),
  ]);

  for (const res of [profilesRes, deptsRes, rolesRes, hodsRes, accessRes]) {
    if (res.error) throw new Error(res.error.message);
  }

  // Highest-precedence role per user (a user may hold more than one).
  const roleByUser = new Map<string, AppRole>();
  for (const r of (rolesRes.data ?? []) as { user_id: string; role: AppRole }[]) {
    const cur = roleByUser.get(r.user_id);
    if (!cur || ROLE_RANK[r.role] > ROLE_RANK[cur]) roleByUser.set(r.user_id, r.role);
  }

  const hodsByUser = new Map<string, string[]>();
  for (const h of (hodsRes.data ?? []) as { employee_id: string; hod_id: string }[]) {
    const arr = hodsByUser.get(h.employee_id) ?? [];
    arr.push(h.hod_id);
    hodsByUser.set(h.employee_id, arr);
  }

  const accessByUser = new Map<string, string[]>();
  for (const a of (accessRes.data ?? []) as { user_id: string; app_id: string }[]) {
    const arr = accessByUser.get(a.user_id) ?? [];
    arr.push(a.app_id);
    accessByUser.set(a.user_id, arr);
  }

  const departments: Department[] = ((deptsRes.data ?? []) as { id: string; name: string; description: string | null }[])
    .map((d) => ({ id: d.id, name: d.name, description: d.description }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const profiles: Profile[] = ((profilesRes.data ?? []) as {
    id: string; name: string; email: string | null; phone: string | null; designation: string | null; avatar_color: string | null; department_id: string | null; receivables_salespersons: string[] | null;
  }[])
    .map((p) => ({
      id: p.id,
      name: p.name,
      email: p.email,
      phone: p.phone,
      designation: p.designation,
      avatarColor: p.avatar_color ?? "navy",
      departmentId: p.department_id,
      role: roleByUser.get(p.id) ?? "employee",
      hodIds: hodsByUser.get(p.id) ?? [],
      moduleAccess: accessByUser.get(p.id) ?? [],
      receivablesSalespersons: p.receivables_salespersons ?? [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { profiles, departments };
}
