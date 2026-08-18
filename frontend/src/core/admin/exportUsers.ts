import { exportRowsToXlsx, type ExportColumn } from "@/shared/lib/exportXlsx";
import { grantableModules, type GrantableModule } from "@/apps/registry";
import { groupByCategory } from "@/apps/categories";
import { formatDateTime } from "@/shared/lib/time";
import type { AppRole, ModuleLevel, Profile } from "@/core/platform/types";

const ROLE_LABEL: Record<AppRole, string> = { admin: "Admin", hod: "HOD", sub_hod: "Sub-HOD", employee: "Employee" };

/** ✓ if the user can open this module, blank if not — the audit tick. */
const TICK = "✓";

/**
 * Access is the SAME rule the Module Access matrix uses (ModuleAccess.tsx): an
 * admin has every app, a universal app is granted to everyone implicitly, and
 * otherwise the grant lives in the user's `moduleAccess` list. Exporting a
 * different rule than the screen enforces would be worse than no export.
 *
 * EXPORTED because the Master Report's user-access section needs the same
 * verdict (apps/master-report/lib/accessMatrix.ts). It takes the two fields it
 * actually reads rather than a whole `Profile`, so a caller holding rows from
 * `master_report_access_matrix()` — which returns raw grant ids, not Profiles —
 * can use it without fabricating a Profile object.
 *
 * ⚠ The universal-module rule lives HERE and only here. `UNIVERSAL_APP_IDS`
 *   (apps/universal.ts) is frontend-only and empty today, which is exactly why
 *   the server-side matrix RPC returns raw grants and leaves the verdict to
 *   this function — two copies of this rule would drift the first time an app
 *   was made universal.
 */
export const hasModuleAccess = (
  u: { role: AppRole; moduleAccess: string[] },
  m: GrantableModule,
): boolean => u.role === "admin" || !!m.universal || u.moduleAccess.includes(m.id);

/** Back-compat alias for the local call sites below. */
const hasAccess = hasModuleAccess;

/**
 * HOW MUCH of a module the user gets: "none" | "view" | "edit".
 *
 * A companion to `hasModuleAccess`, not a replacement — "can they open it" and
 * "can they change anything in it" are different questions and most callers only
 * ask the first. Built on top of it so the two can never disagree about who is
 * granted; only the depth is decided here.
 *
 * ⚠ `?? "edit"` is deliberate, twice over. Admins and universal apps hold no
 *   app_access row at all, so there is no level to read and full access is the
 *   truth. And a grant whose level is missing predates the column, which means
 *   it was created when every grant meant full — reading it as "view" would
 *   understate rights nobody restricted.
 *
 * `moduleLevels` is optional because the Master Report builds a probe object out
 * of RPC rows rather than holding a whole Profile.
 */
export const moduleAccessLevel = (
  u: { role: AppRole; moduleAccess: string[]; moduleLevels?: Record<string, ModuleLevel> },
  m: GrantableModule,
): ModuleLevel | "none" => {
  if (!hasModuleAccess(u, m)) return "none";
  if (u.role === "admin" || m.universal) return "edit";
  return u.moduleLevels?.[m.id] ?? "edit";
};

/** Cell text for the per-module columns: full, view-only, or nothing. */
const LEVEL_CELL: Record<ModuleLevel | "none", string> = { edit: "✓", view: "View", none: "" };

/**
 * "Users → .xlsx": basic details plus one ✓/blank column per grantable app, so an
 * admin can read every person's access in a single grid and see at a glance who to
 * grant. Columns are grouped in the same category order as the Module Access screen
 * so the two read alike.
 */
export function exportUsersToXlsx(opts: {
  users: Profile[];
  deptName: (id: string | null) => string;
  subDeptName: (id: string | null) => string;
  bandName: (id: string | null) => string;
  hodNames: (u: Profile) => string;
  filters?: string[];
}): void {
  const { users, deptName, subDeptName, bandName, hodNames, filters } = opts;

  // Same grouping/order as the Module Access matrix, flattened to a column list.
  const modules = groupByCategory(grantableModules).flatMap((g) => g.rows);

  const columns: ExportColumn<Profile>[] = [
    { header: "Employee Code", width: 16, value: (u) => u.employeeCode ?? "" },
    { header: "Name", width: 24, value: (u) => u.name },
    { header: "Role", width: 12, value: (u) => ROLE_LABEL[u.role] },
    { header: "Department", width: 20, value: (u) => deptName(u.departmentId) },
    { header: "Sub-department", width: 24, value: (u) => subDeptName(u.subDepartmentId) },
    { header: "Designation", width: 22, value: (u) => u.designation ?? "" },
    { header: "Band", width: 22, value: (u) => bandName(u.bandId) },
    { header: "Email", width: 28, value: (u) => u.email ?? "" },
    { header: "Phone", width: 16, value: (u) => u.phone ?? "" },
    { header: "Reports To", width: 24, value: (u) => hodNames(u) },
    { header: "Last Active", width: 20, value: (u) => formatDateTime(u.lastActiveAt) },
    ...modules.map((m): ExportColumn<Profile> => ({
      header: m.name,
      width: Math.min(28, Math.max(12, m.name.length + 2)),
      value: (u) => LEVEL_CELL[moduleAccessLevel(u, m)],
    })),
  ];

  exportRowsToXlsx({
    fileName: "Users_App_Access",
    sheetName: "Users",
    title: "Users — App Access",
    columns,
    rows: users,
    filters,
    notes: [
      `A ${TICK} means full access — the user can open that app and change things in it.`,
      `"View" means view-only: they can open the app and read every screen in it, but every add, edit, delete and action button is hidden.`,
      "A blank cell means no access at all.",
      "Admins have full access to every app implicitly, so all of their app columns are ticked.",
      "Apps granted to everyone are ticked for all users automatically.",
      "Grant, downgrade or revoke access in Admin → Module Access, or on the user's own form.",
    ],
  });
}
