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
  /** Mobile number — becomes the user's initial login password. */
  phone: string;
  designation?: string | null;
  role: AppRole;
  departmentId?: string | null;
  hodIds?: string[];
  moduleAccess?: string[];
  /** Outstanding Dashboard scope — salesperson names this user may see. */
  receivablesSalespersons?: string[];
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
