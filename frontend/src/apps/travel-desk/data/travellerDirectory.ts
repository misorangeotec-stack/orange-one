import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/core/platform/supabase";
import { useDirectory } from "@/core/platform/store";
import type { Profile } from "@/core/platform/types";
import { TRAVEL_QK } from "./travelFetch";
import { useTravelStore } from "../store";

const db = supabase as any;

/**
 * The people a trip can be raised for: the directory, plus — for a coordinator —
 * everybody on the Settings "Can raise for" list.
 *
 * ⚠ THE DIRECTORY ALONE IS NOT ENOUGH FOR A COORDINATOR WHO IS NOT AN ADMIN.
 *   `profiles` is RLS'd to self + downline + same department, so the senior
 *   people she actually files for never reach the browser. The list comes back
 *   through fms_travel_raise_for_people(), which returns only the travel fields
 *   and only to a coordinator.
 *
 * The directory row wins where both have a person: it is the complete Profile,
 * and the RPC row only fills the fields the trip form and passenger rows read.
 */
export function useTravellerProfiles(): Profile[] {
  const s = useTravelStore();
  const { profiles } = useDirectory();

  const { data: extra } = useQuery({
    queryKey: [...TRAVEL_QK, "raiseFor", s.userId, s.config.raiseFor.join(",")],
    queryFn: fetchRaiseForPeople,
    enabled: s.isProcessCoordinator && s.config.raiseFor.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  return useMemo(() => {
    if (!extra || extra.length === 0) return profiles;
    const have = new Set(profiles.map((p) => p.id));
    return [...profiles, ...extra.filter((p) => !have.has(p.id))].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [profiles, extra]);
}

async function fetchRaiseForPeople(): Promise<Profile[]> {
  const { data, error } = await db.rpc("fms_travel_raise_for_people");
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map(
    (r): Profile => ({
      id: r.id,
      name: r.name,
      email: r.email ?? null,
      phone: r.phone ?? null,
      designation: r.designation ?? null,
      avatarColor: "navy",
      departmentId: r.department_id ?? null,
      subDepartmentId: null,
      designationId: null,
      bandId: r.band_id ?? null,
      employeeCode: r.employee_code ?? null,
      gender: r.gender ?? null,
      dateOfBirth: r.date_of_birth ?? null,
      role: "employee",
      hodIds: (r.hod_ids as string[] | null) ?? [],
      // A traveller on the list needs no portal access of their own, and the
      // receivables scope is irrelevant here: blank, never guessed.
      moduleAccess: [],
      moduleLevels: {},
      receivablesSalespersons: [],
      receivablesCollectionTeams: [],
      receivablesHiddenMenus: [],
      receivablesAdminMenus: [],
      receivablesAllowedReports: [],
      receivablesAllowPipeline: false,
      lastActiveAt: null,
      isExternal: false,
    }),
  );
}
