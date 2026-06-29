import { supabase } from "./supabase";

/**
 * Org-wide, name-only people directory for @mention pickers.
 *
 * The normal directory (`fetchDirectory`) is RLS-scoped: a non-admin only sees
 * self + downline + same-department peers, so seniors in another department and
 * cross-department colleagues never reach the browser and can't be @mentioned.
 * This reads the `list_org_people()` SECURITY DEFINER function, which returns
 * every user's NON-sensitive identity fields (no phone/email — phone doubles as
 * the login password) so the whole org is mentionable. Notification fan-out is
 * already org-wide in the add_task_remark RPC.
 */
export interface OrgPerson {
  id: string;
  name: string;
  designation: string | null;
  departmentId: string | null;
  avatarColor: string;
  role: string;
}

export async function fetchOrgPeople(): Promise<OrgPerson[]> {
  const { data, error } = await supabase.rpc("list_org_people");
  if (error) throw new Error(error.message);
  return ((data ?? []) as {
    id: string;
    name: string;
    designation: string | null;
    department_id: string | null;
    avatar_color: string | null;
    role: string | null;
  }[]).map((p) => ({
    id: p.id,
    name: p.name,
    designation: p.designation,
    departmentId: p.department_id,
    avatarColor: p.avatar_color ?? "navy",
    role: p.role ?? "employee",
  }));
}
