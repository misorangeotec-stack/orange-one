/**
 * The user-access matrix as a workbook.
 *
 * WHY THIS IS NOT core/admin/exportUsers.ts
 *   That exporter produces the same grid, but it takes `Profile[]` — the shape
 *   `useDirectory()` returns. This report's rows come from
 *   `master_report_access_matrix()`, which deliberately returns raw facts rather
 *   than Profiles (see accessMatrix.ts for why RLS forces that). Feeding them to
 *   `exportUsersToXlsx` would mean fabricating Profile objects with a dozen
 *   irrelevant receivables fields just to satisfy a type. So this is a thin
 *   exporter over `AccessRow`, and the ADMIN Users screen keeps its own — where
 *   `useDirectory()` is complete because the viewer is necessarily an admin.
 *
 * The access verdict is not recomputed here: `AccessRow.access` was already
 * decided once by the shared `hasModuleAccess`.
 */

import { exportRowsToXlsx, type ExportColumn } from "@/shared/lib/exportXlsx";
import { lastSeenLabel } from "./accessMatrix";
import type { AccessMatrix, AccessRow } from "./accessMatrix";

const ROLE_LABEL: Record<AccessRow["role"], string> = {
  admin: "Admin",
  hod: "HOD",
  sub_hod: "Sub-HOD",
  employee: "Employee",
};

/** ✓ reads as an audit tick in Excel, which has the glyph — unlike the PDF font. */
const TICK = "✓";

export function exportAccessMatrixToXlsx(matrix: AccessMatrix): void {
  const columns: ExportColumn<AccessRow>[] = [
    { header: "Name", width: 26, value: (u) => u.name },
    { header: "Department", width: 24, value: (u) => u.department || "—" },
    { header: "Designation", width: 22, value: (u) => u.designation || "—" },
    { header: "Role", width: 11, value: (u) => ROLE_LABEL[u.role] },
    { header: "Last sign-in", width: 14, value: (u) => lastSeenLabel(u.lastActiveAt) },
    // Explicit grants: an admin holds none, and reporting 16 for them would
    // misstate what was actually given out.
    { header: "Modules granted", width: 16, value: (u) => (u.isAdmin ? "all (admin)" : u.explicitCount) },
    ...matrix.modules.map<ExportColumn<AccessRow>>((m) => ({
      header: m.name,
      width: Math.max(10, Math.min(18, m.name.length + 2)),
      value: (u) => (u.access[m.id] ? TICK : ""),
    })),
  ];

  // Explicit grants, not the admin-overlaid total — the overlaid figure can
  // never fall below the number of admins, so it hides an unrolled-out module.
  const totalsRow = matrix.modules
    .map((m) => `${m.name}: ${matrix.explicitTotals[m.id] ?? 0}`)
    .join(" · ");

  exportRowsToXlsx<AccessRow>({
    fileName: "Master_Report_User_Access",
    sheetName: "User access",
    title: "Orange One — user access by module",
    columns,
    rows: matrix.rows,
    notes: [
      "One row per user, sorted alphabetically. A tick means the person can open that module.",
      "Admins are ticked for every module: they bypass module checks entirely and hold no explicit grants.",
      `Explicitly granted, per module (admins excluded, since they hold no grants) — ${totalsRow}`,
      `${matrix.neverSignedIn} of ${matrix.rows.length} users have never signed in; ${matrix.grantedButNeverSignedIn} of those already hold module access.`,
      "Granting is done in Admin → Module Access. This export is a snapshot, not a permission record.",
    ],
  });
}
