import { supabase } from "./supabase";
import type { AppRole } from "./types";

/**
 * Client for the `admin-users` Edge Function. Creating / hard-deleting a user
 * needs the auth admin API (service role), so it runs server-side; the function
 * re-checks that the caller is an admin. Until the function is deployed and the
 * `canAddUser` / `canDeleteUser` flags are flipped on, these aren't called.
 */

export interface CreateUserInput {
  name: string;
  email: string;
  /**
   * Mobile number — becomes the user's initial login password.
   *
   * ⚠ EXCEPT on an external account, where it is optional and NOT the password.
   *   See `isExternal` / `password` below.
   */
  phone: string;
  /**
   * A login that does NOT belong to staff — today, a customer placing their own
   * orders through the Orange Order Desk (OD-13).
   *
   * Sets `profiles.is_external`, which is the predicate behind every RLS policy in
   * the database (`public.is_staff`). It is written in the same statement that
   * creates the profile, not by a follow-up call: a profile that exists for even a
   * moment without it is one `is_staff()` answers `true` for.
   */
  isExternal?: boolean;
  /**
   * The real password for an external account. **Required when `isExternal`**, and
   * ignored otherwise — a staff password is still the mobile number.
   *
   * "Your password is your phone number" is a reasonable convention inside the
   * company and an indefensible one to hand an outside firm.
   */
  password?: string;
  /** Designation NAME — the legacy mirror list_org_people() returns. Sent with designationId. */
  designation?: string | null;
  designationId?: string | null;
  role: AppRole;
  departmentId?: string | null;
  subDepartmentId?: string | null;
  /** Independent of designation — see the Band type. */
  bandId?: string | null;
  employeeCode?: string | null;
  hodIds?: string[];
  /**
   * App id → level. The keys ARE the granted apps, so there is no separate
   * moduleAccess list to disagree with (see directoryWrites.setUserModules).
   *
   * ⚠ An older deployed function that doesn't know this field creates the user
   *   with NO module grants rather than with wrong ones — visible and fixable by
   *   re-saving. Deploy the function before the frontend anyway; see the plan's
   *   deploy order.
   */
  moduleLevels?: Record<string, "view" | "edit">;
  /** Outstanding Dashboard scope — salesperson names this user may see. */
  receivablesSalespersons?: string[];
  /** Outstanding Dashboard menu deny-list — menu keys this user may NOT see. */
  receivablesHiddenMenus?: string[];
  /** Outstanding Dashboard full-access allow-list — menus used with admin-level depth. */
  receivablesAdminMenus?: string[];
  /** Outstanding Dashboard per-report grants — report ids this user may open (empty = none). */
  receivablesAllowedReports?: string[];
}

/**
 * Invoke the `admin-users` function and surface the REAL error message.
 *
 * When the function returns a non-2xx status, supabase-js sets `error` to a
 * FunctionsHttpError whose `.message` is the useless generic string
 * "Edge Function returned a non-2xx status code" — the actual reason (e.g. "A
 * user with this email address has already been registered") lives in the JSON
 * response body, reachable via `error.context` (the raw Response). Read it so
 * the admin sees what actually went wrong.
 */
async function invokeAdminUsers<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("admin-users", { body });
  if (error) {
    let detail = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const parsed = await ctx.json();
        if (parsed?.error) detail = String(parsed.error);
      } catch {
        /* body wasn't JSON — keep the generic message */
      }
    }
    throw new Error(detail);
  }
  if (data?.error) throw new Error(data.error as string);
  return data as T;
}

export async function createUserViaFunction(input: CreateUserInput): Promise<string> {
  const data = await invokeAdminUsers<{ id: string }>({ action: "create", ...input });
  return data.id;
}

export async function deleteUserViaFunction(userId: string): Promise<void> {
  await invokeAdminUsers({ action: "delete", userId });
}

/**
 * Reset a user's login password (admin only) — used when an admin saves the user
 * form, which re-pins the password to the current mobile number. Setting a
 * password needs the auth admin API (service role), hence the Edge Function.
 */
export async function setUserPasswordViaFunction(userId: string, password: string): Promise<void> {
  await invokeAdminUsers({ action: "set-password", userId, password });
}

/**
 * Change a user's LOGIN email (admin only). `profiles.email` is a read-model copy;
 * the address the login form checks lives in auth.users and needs the auth admin
 * API, hence the Edge Function. Call this whenever the email field changes —
 * writing the profile alone leaves the user signing in with their old address.
 */
export async function setUserEmailViaFunction(userId: string, email: string): Promise<void> {
  await invokeAdminUsers({ action: "set-email", userId, email });
}
