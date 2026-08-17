/**
 * Who has access to what — the Master Report's second section.
 *
 * ONE BUILDER, THREE CONSUMERS (screen, PDF, Excel) so the three cannot disagree
 * about who can open what.
 *
 * ⚠ WHY THE DATA COMES FROM AN RPC AND NOT FROM useDirectory().
 *   The browser already holds a directory, so rendering this from `useDirectory()`
 *   looks free. It is not: RLS on the three tables involved is restrictive —
 *   `app_access` and `user_roles` are `user_id = auth.uid() OR is_admin()`, and
 *   `profiles` is self / downline / same-department. A director holding
 *   `master-report` but NOT admin would therefore see their own grants, their own
 *   role, and only their own department's people — a nearly blank report for
 *   exactly the person it was built for. `master_report_access_matrix()` reads
 *   past those policies deliberately, gated by the same check the snapshot uses.
 *
 * ⚠ THE RPC RETURNS FACTS, NOT VERDICTS. It hands back raw granted app ids and
 *   the role; whether that means "can open it" is decided here by the shared
 *   `hasModuleAccess`, because the universal-module rule is frontend-only
 *   knowledge (apps/universal.ts). Deciding it twice would guarantee drift.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/core/platform/supabase";
import { grantableModules, type GrantableModule } from "@/apps/registry";
import { groupByCategory } from "@/apps/categories";
import { hasModuleAccess } from "@/core/admin/exportUsers";
import type { AppRole } from "@/core/platform/types";

export interface AccessRow {
  userId: string;
  name: string;
  /** Empty string when the user has no department — 2 users are in that state. */
  department: string;
  designation: string;
  role: AppRole;
  /** Admins bypass module checks entirely; the row renders as one banded span. */
  isAdmin: boolean;
  /** Keyed by module id, AFTER the admin / universal overlay. */
  access: Record<string, boolean>;
  /** Counts what they can actually open, so an admin reports the full set. */
  grantedCount: number;
  /**
   * Modules EXPLICITLY granted in app_access, before the admin/universal
   * overlay. Kept separate because the overlay hides the two questions an admin
   * actually asks: "has this person been given anything?" (an admin shows the
   * full set either way) and "has this module been rolled out to anyone?"
   * (5 admins would otherwise floor every column at 5).
   */
  explicitCount: number;
  /** Raw granted ids, kept so per-module explicit totals can be counted. */
  explicitIds: string[];
  /** null = has never signed in. 9 users are in that state, 8 of them granted. */
  lastActiveAt: string | null;
}

export interface AccessMatrix {
  generatedAt: string;
  /** Alphabetical, case-insensitively — sorted server-side by lower(name). */
  rows: AccessRow[];
  /** Column order, matching the Module Access screen and the Users export. */
  modules: GrantableModule[];
  /** Per-module count of everyone who can OPEN it — admins included. */
  totals: Record<string, number>;
  /**
   * Per-module count of EXPLICIT grants only. A zero here means the module has
   * never been rolled out to anyone outside the admin team, which `totals` can
   * never show because the five admins floor every column at five.
   */
  explicitTotals: Record<string, number>;
  neverSignedIn: number;
  /** Explicitly granted something, yet never once signed in — the headline. */
  grantedButNeverSignedIn: number;
}

const ROLES: AppRole[] = ["admin", "hod", "sub_hod", "employee"];
const asRole = (v: unknown): AppRole =>
  ROLES.includes(v as AppRole) ? (v as AppRole) : "employee";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * Same flattening as `exportUsersToXlsx` and `ModuleAccess.tsx`: category order,
 * then registry order within a category. Kept as one call so all three screens
 * put the columns in the same places.
 */
export const orderedModules = (): GrantableModule[] =>
  groupByCategory(grantableModules).flatMap((g) => g.rows);

export function buildAccessMatrix(raw: unknown): AccessMatrix {
  const root = (raw ?? {}) as Record<string, unknown>;
  const users = Array.isArray(root.users) ? (root.users as Record<string, unknown>[]) : [];
  const modules = orderedModules();

  const rows: AccessRow[] = users.map((u) => {
    const role = asRole(u.role);
    const granted = Array.isArray(u.app_ids) ? (u.app_ids as unknown[]).map(String) : [];
    const probe = { role, moduleAccess: granted };

    const access: Record<string, boolean> = {};
    let grantedCount = 0;
    let explicitCount = 0;
    for (const m of modules) {
      const on = hasModuleAccess(probe, m);
      access[m.id] = on;
      if (on) grantedCount += 1;
      // Counted against the module list, so a stale grant for an app id no
      // longer in the registry (there is one: `purchase-fms`) is not counted as
      // access the person actually has.
      if (granted.includes(m.id)) explicitCount += 1;
    }

    return {
      userId: str(u.id),
      name: str(u.name) || "(unnamed)",
      department: str(u.department),
      designation: str(u.designation),
      role,
      isAdmin: role === "admin",
      access,
      grantedCount,
      explicitCount,
      lastActiveAt: str(u.last_active_at) || null,
      explicitIds: granted,
    };
  });

  const totals: Record<string, number> = {};
  const explicitTotals: Record<string, number> = {};
  for (const m of modules) {
    totals[m.id] = rows.filter((r) => r.access[m.id]).length;
    explicitTotals[m.id] = rows.filter((r) => r.explicitIds.includes(m.id)).length;
  }

  return {
    generatedAt: str(root.generated_at),
    rows,
    modules,
    totals,
    explicitTotals,
    neverSignedIn: rows.filter((r) => !r.lastActiveAt).length,
    // Explicit, not overlaid: a never-signed-in ADMIN would otherwise be counted
    // here as "granted access", which is not what the number is asking.
    grantedButNeverSignedIn: rows.filter((r) => !r.lastActiveAt && r.explicitCount > 0).length,
  };
}

export async function fetchAccessMatrix(): Promise<AccessMatrix> {
  const { data, error } = await supabase.rpc("master_report_access_matrix");
  if (error) throw new Error(error.message);
  return buildAccessMatrix(data);
}

export const accessMatrixKey = ["master-report", "access-matrix"] as const;

export function useAccessMatrix(enabled = true) {
  return useQuery({
    queryKey: accessMatrixKey,
    queryFn: fetchAccessMatrix,
    // Grants change rarely; no reason to refetch on every tab switch.
    staleTime: 5 * 60_000,
    enabled,
  });
}

/** "12 Aug 2026" or "Never" — the sign-in column reads as a fact, not a gap. */
export function lastSeenLabel(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "Never";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
