import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ORG_PEOPLE_DETAIL_QUERY, type OrgPersonDetail } from "@/core/platform/orgPeople";
import { useOcpiStore } from "../store";

/**
 * Who may be named as the salesperson on a deal.
 *
 * ⚠ THIS REPLACED A LIST BUILT FROM THE DEALS THEMSELVES. The form used to
 *   offer `distinct salesperson_name` over `s.deals`, so the vocabulary was
 *   whatever had been typed before — 19 deals and 2 names, both test data. And
 *   because `fms_ocpi_deals` select is RLS-scoped to admins, coordinators,
 *   module viewers, step owners and `raised_by = auth.uid()`, a plain
 *   salesperson opening the form saw a list of roughly their own name.
 *
 * ⚠ NOT `useDirectory()`, AND NOT PART OF THE MODULE SNAPSHOT. `profiles` is
 *   RLS'd to self + downline + same department, so the directory shows a Sales
 *   roster only to somebody already in Sales — and the two non-admins holding
 *   OCPI access today are in Accounting & Finance and Administration. It reads
 *   the `list_org_people_detail()` definer function instead, exactly as
 *   StepOwnersSection and CoordinatorsSection read `list_org_people`, on the
 *   shared `["orgPeopleDetail"]` cache so the three screens make one request.
 *
 * ⚠ WHICH DEPARTMENTS IS CONFIG, NOT CODE — `fms_ocpi_config`'s
 *   `salesperson_departments`, seeded to Sales and editable in Setup. An empty
 *   list yields an empty roster ON PURPOSE: falling back to "everyone" would
 *   put all 63 users, warehouse included, on a customer's quotation.
 */
export interface OcpiSalesperson {
  id: string;
  name: string;
  designation: string | null;
  /** The heading this person sits under in the picker. */
  group: string;
}

const groupOf = (p: OrgPersonDetail): string =>
  p.subDepartment?.trim() || p.department?.trim() || "Other";

export function useSalespeople(): { people: OcpiSalesperson[]; isLoading: boolean } {
  const s = useOcpiStore();
  const { data, isLoading } = useQuery(ORG_PEOPLE_DETAIL_QUERY);
  const deptIds = s.config.salespersonDepartmentIds;

  const people = useMemo(() => {
    const wanted = new Set(deptIds);
    if (wanted.size === 0) return [];
    return (data ?? [])
      .filter((p) => p.departmentId && wanted.has(p.departmentId))
      // Sub-departments in the ORDER THE ORG MASTER GIVES THEM, not
      // alphabetically — `sort_order` is what the Sub-departments screen shows,
      // and a picker that disagreed with it would read as a different list.
      // Someone with no sub-department sorts last, under their department name.
      .sort(
        (a, b) =>
          (a.subDepartmentSort ?? Number.MAX_SAFE_INTEGER) -
            (b.subDepartmentSort ?? Number.MAX_SAFE_INTEGER) ||
          groupOf(a).localeCompare(groupOf(b)) ||
          a.name.localeCompare(b.name),
      )
      .map((p) => ({ id: p.id, name: p.name, designation: p.designation, group: groupOf(p) }));
  }, [data, deptIds]);

  return { people, isLoading };
}
