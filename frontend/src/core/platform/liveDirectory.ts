import { supabase } from "./supabase";
import type { AppRole, Band, Department, Designation, ModuleLevel, Profile, SubDepartment } from "./types";

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
  subDepartments: SubDepartment[];
  designations: Designation[];
  bands: Band[];
}

export async function fetchDirectory(): Promise<DirectoryData> {
  // The profiles select is an EXPLICIT column list — a new profiles column that
  // isn't added here simply never reaches the browser.
  const [profilesRes, deptsRes, subDeptsRes, desigRes, bandsRes, rolesRes, hodsRes, accessRes] = await Promise.all([
    supabase.from("profiles").select("id,name,email,phone,designation,designation_id,avatar_color,department_id,sub_department_id,band_id,employee_code,gender,date_of_birth,receivables_salespersons,receivables_hidden_menus,receivables_admin_menus,receivables_allowed_reports,receivables_allow_pipeline,last_active_at,is_external"),
    supabase.from("departments").select("id,name,description,active,sort_order,source,hr_sheet_name"),
    supabase.from("sub_departments").select("id,department_id,name,active,sort_order"),
    supabase.from("designations").select("id,name,active,sort_order"),
    supabase.from("bands").select("id,band_no,name,description,active,sort_order"),
    supabase.from("user_roles").select("user_id,role"),
    supabase.from("user_hods").select("employee_id,hod_id"),
    supabase.from("app_access").select("user_id,app_id,access_level"),
  ]);

  for (const res of [profilesRes, deptsRes, subDeptsRes, desigRes, bandsRes, rolesRes, hodsRes, accessRes]) {
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

  // Two shapes off one read: the id list every existing consumer asks for, and
  // the level per id for the few that care. `?? "edit"` is load-bearing — a row
  // written before access_level existed, or by a client that doesn't know the
  // column, must read as FULL access. Defaulting to "view" would silently strip
  // rights from people nobody touched.
  const accessByUser = new Map<string, string[]>();
  const levelsByUser = new Map<string, Record<string, ModuleLevel>>();
  for (const a of (accessRes.data ?? []) as { user_id: string; app_id: string; access_level: string | null }[]) {
    const arr = accessByUser.get(a.user_id) ?? [];
    arr.push(a.app_id);
    accessByUser.set(a.user_id, arr);

    const levels = levelsByUser.get(a.user_id) ?? {};
    levels[a.app_id] = a.access_level === "view" ? "view" : "edit";
    levelsByUser.set(a.user_id, levels);
  }

  const departments: Department[] = ((deptsRes.data ?? []) as { id: string; name: string; description: string | null; active: boolean | null; sort_order: number | null; source: string | null; hr_sheet_name: string | null }[])
    .map((d) => ({
      id: d.id,
      name: d.name,
      description: d.description,
      active: d.active ?? true,
      sortOrder: d.sort_order ?? 0,
      source: (d.source ?? "existing") as Department["source"],
      hrSheetName: d.hr_sheet_name,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const subDepartments: SubDepartment[] = ((subDeptsRes.data ?? []) as { id: string; department_id: string; name: string; active: boolean | null; sort_order: number | null }[])
    .map((s) => ({ id: s.id, departmentId: s.department_id, name: s.name, active: s.active ?? true, sortOrder: s.sort_order ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Designations sort by the ladder (sort_order), not alphabetically — the
  // picker reads in seniority order. Name is the tie-break.
  const designations: Designation[] = ((desigRes.data ?? []) as { id: string; name: string; active: boolean | null; sort_order: number | null }[])
    .map((d) => ({ id: d.id, name: d.name, active: d.active ?? true, sortOrder: d.sort_order ?? 0 }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  const bands: Band[] = ((bandsRes.data ?? []) as { id: string; band_no: number; name: string; description: string | null; active: boolean | null; sort_order: number | null }[])
    .map((b) => ({ id: b.id, bandNo: b.band_no, name: b.name, description: b.description, active: b.active ?? true, sortOrder: b.sort_order ?? 0 }))
    .sort((a, b) => a.bandNo - b.bandNo);

  const profiles: Profile[] = ((profilesRes.data ?? []) as {
    id: string; name: string; email: string | null; phone: string | null; designation: string | null; designation_id: string | null; avatar_color: string | null; department_id: string | null; sub_department_id: string | null; band_id: string | null; employee_code: string | null; gender: string | null; date_of_birth: string | null; receivables_salespersons: string[] | null; receivables_hidden_menus: string[] | null; receivables_admin_menus: string[] | null; receivables_allowed_reports: string[] | null; receivables_allow_pipeline: boolean | null; last_active_at: string | null; is_external: boolean | null;
  }[])
    .map((p) => ({
      id: p.id,
      name: p.name,
      email: p.email,
      phone: p.phone,
      designation: p.designation,
      designationId: p.designation_id,
      avatarColor: p.avatar_color ?? "navy",
      departmentId: p.department_id,
      subDepartmentId: p.sub_department_id,
      bandId: p.band_id,
      employeeCode: p.employee_code,
      gender: (p.gender ?? null) as Profile["gender"],
      dateOfBirth: p.date_of_birth ?? null,
      role: roleByUser.get(p.id) ?? "employee",
      hodIds: hodsByUser.get(p.id) ?? [],
      moduleAccess: accessByUser.get(p.id) ?? [],
      moduleLevels: levelsByUser.get(p.id) ?? {},
      receivablesSalespersons: p.receivables_salespersons ?? [],
      receivablesHiddenMenus: p.receivables_hidden_menus ?? [],
      receivablesAdminMenus: p.receivables_admin_menus ?? [],
      // No reports until granted — an absent/NULL column is "nothing", never "everything".
      receivablesAllowedReports: p.receivables_allowed_reports ?? [],
      receivablesAllowPipeline: p.receivables_allow_pipeline ?? false,
      lastActiveAt: p.last_active_at,
      isExternal: p.is_external ?? false,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { profiles, departments, subDepartments, designations, bands };
}
