import { useQuery } from "@tanstack/react-query";
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

/**
 * Look an actor up by id, org-wide.
 *
 * Every app's own `profileById` reads the RLS-scoped directory, so a colleague
 * in another department resolves to undefined and renders as "Someone". That
 * was survivable while the bell showed grey text; it is not once the name sits
 * next to an avatar. The task app already worked around it by hand (its store's
 * `actorById` falls back to this same list) — this is that fallback, extracted
 * so the five FMS layouts can use it in one line instead of five copies.
 *
 * Same key and staleTime every other consumer uses, so it shares ONE cache
 * entry with the mention picker and the task store: no extra network call.
 */
export function useOrgPersonById(): (id: string | null) => OrgPerson | undefined {
  const { data } = useQuery({
    queryKey: ["orgPeople"],
    queryFn: fetchOrgPeople,
    staleTime: 5 * 60 * 1000,
  });
  const byId = new Map((data ?? []).map((p) => [p.id, p] as const));
  return (id) => (id ? byId.get(id) : undefined);
}

/**
 * The same org-wide directory, carrying the ORG UNIT as well.
 *
 * `list_org_people` returns `department_id` but no sub-department, and a picker
 * that groups people by sub-department needs both names, not just ids. Adding an
 * OUT column to that function would mean dropping and recreating it, and it has
 * four consumers (the task @mention picker, asset-maintenance,
 * useTaskNotifications and every FMS StepOwnersSection) — so this is a second,
 * additive function rather than a widening of the first.
 *
 * ⚠ SAME NON-SENSITIVE COLUMNS. No email and no phone, for the reason given
 *   above: phone doubles as the login password.
 *
 * ⚠ ITS OWN QUERY KEY. Deliberately not sharing `["orgPeople"]` — the two
 *   functions return different shapes, and one cache entry holding either would
 *   be a type lie that only shows up at runtime.
 */
export interface OrgPersonDetail {
  id: string;
  name: string;
  designation: string | null;
  departmentId: string | null;
  department: string | null;
  subDepartmentId: string | null;
  subDepartment: string | null;
  /** `sub_departments.sort_order` — the order the org master says, not alphabetical. */
  subDepartmentSort: number | null;
  employeeCode: string | null;
  avatarColor: string;
  role: string;
}

export async function fetchOrgPeopleDetail(): Promise<OrgPersonDetail[]> {
  const { data, error } = await supabase.rpc("list_org_people_detail");
  if (error) throw new Error(error.message);
  return ((data ?? []) as {
    id: string;
    name: string;
    designation: string | null;
    department_id: string | null;
    department: string | null;
    sub_department_id: string | null;
    sub_department: string | null;
    sub_department_sort: number | null;
    employee_code: string | null;
    avatar_color: string | null;
    role: string | null;
  }[]).map((p) => ({
    id: p.id,
    name: p.name,
    designation: p.designation,
    departmentId: p.department_id,
    department: p.department,
    subDepartmentId: p.sub_department_id,
    subDepartment: p.sub_department,
    subDepartmentSort: p.sub_department_sort,
    employeeCode: p.employee_code,
    avatarColor: p.avatar_color ?? "navy",
    role: p.role ?? "employee",
  }));
}

/** Shared cache key + staleTime for every consumer of the detail list. */
export const ORG_PEOPLE_DETAIL_QUERY = {
  queryKey: ["orgPeopleDetail"] as const,
  queryFn: fetchOrgPeopleDetail,
  staleTime: 5 * 60 * 1000,
};
