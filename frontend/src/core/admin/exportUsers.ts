import { exportRowsToXlsx, type ExportColumn } from "@/shared/lib/exportXlsx";
import { grantableModules, type GrantableModule } from "@/apps/registry";
import { groupByCategory } from "@/apps/categories";
import { formatDateTime } from "@/shared/lib/time";
import type { AppRole, Profile } from "@/core/platform/types";

const ROLE_LABEL: Record<AppRole, string> = { admin: "Admin", hod: "HOD", sub_hod: "Sub-HOD", employee: "Employee" };

/** ✓ if the user can open this module, blank if not — the audit tick. */
const TICK = "✓";

/**
 * Access is the SAME rule the Module Access matrix uses (ModuleAccess.tsx): an
 * admin has every app, a universal app is granted to everyone implicitly, and
 * otherwise the grant lives in the user's `moduleAccess` list. Exporting a
 * different rule than the screen enforces would be worse than no export.
 */
const hasAccess = (u: Profile, m: GrantableModule): boolean =>
  u.role === "admin" || !!m.universal || u.moduleAccess.includes(m.id);

/**
 * "Users → .xlsx": basic details plus one ✓/blank column per grantable app, so an
 * admin can read every person's access in a single grid and see at a glance who to
 * grant. Columns are grouped in the same category order as the Module Access screen
 * so the two read alike.
 */
export function exportUsersToXlsx(opts: {
  users: Profile[];
  deptName: (id: string | null) => string;
  hodNames: (u: Profile) => string;
  filters?: string[];
}): void {
  const { users, deptName, hodNames, filters } = opts;

  // Same grouping/order as the Module Access matrix, flattened to a column list.
  const modules = groupByCategory(grantableModules).flatMap((g) => g.rows);

  const columns: ExportColumn<Profile>[] = [
    { header: "Name", width: 24, value: (u) => u.name },
    { header: "Role", width: 12, value: (u) => ROLE_LABEL[u.role] },
    { header: "Department", width: 20, value: (u) => deptName(u.departmentId) },
    { header: "Designation", width: 22, value: (u) => u.designation ?? "" },
    { header: "Email", width: 28, value: (u) => u.email ?? "" },
    { header: "Phone", width: 16, value: (u) => u.phone ?? "" },
    { header: "Reports To", width: 24, value: (u) => hodNames(u) },
    { header: "Last Active", width: 20, value: (u) => formatDateTime(u.lastActiveAt) },
    ...modules.map((m): ExportColumn<Profile> => ({
      header: m.name,
      width: Math.min(28, Math.max(12, m.name.length + 2)),
      value: (u) => (hasAccess(u, m) ? TICK : ""),
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
      `A ${TICK} means the user can open that app; a blank cell means no access.`,
      "Admins have access to every app implicitly, so all of their app columns are ticked.",
      "Apps granted to everyone are ticked for all users automatically.",
      "Grant or revoke access in Admin → Module Access.",
    ],
  });
}
