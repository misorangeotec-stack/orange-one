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
}

export async function createUserViaFunction(input: CreateUserInput): Promise<string> {
  const { data, error } = await supabase.functions.invoke("admin-users", {
    body: { action: "create", ...input },
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error as string);
  return data.id as string;
}

export async function deleteUserViaFunction(userId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke("admin-users", {
    body: { action: "delete", userId },
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error as string);
}

/**
 * Reset a user's login password (admin only) — used when an admin saves the user
 * form, which re-pins the password to the current mobile number. Setting a
 * password needs the auth admin API (service role), hence the Edge Function.
 */
export async function setUserPasswordViaFunction(userId: string, password: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke("admin-users", {
    body: { action: "set-password", userId, password },
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error as string);
}
