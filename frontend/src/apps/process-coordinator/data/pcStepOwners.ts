import { supabase } from "@/core/platform/supabase";
import type { PcStepOwner } from "../types";

const db = supabase as any;

/**
 * Who owns each FMS step, and how to reach them.
 *
 * This has to be an RPC rather than a directory read. `profiles` is RLS'd to
 * self + downline + same-department (a sample non-admin sees 7 of 60 rows), and
 * the org-wide `list_org_people()` strips phone and email deliberately, because
 * a user's phone doubles as their initial login password. So there is no
 * existing client path from a step owner's id to their contact details — which
 * is precisely the gap PC-1 exists to close. `pc_step_owner_contacts()` is
 * SECURITY DEFINER for that reason and re-checks the coordinator grant itself.
 */

interface RawRow {
  app_id: string;
  step_key: string;
  location_id: string | null;
  user_id: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
}

export async function fetchPcStepOwners(): Promise<PcStepOwner[]> {
  const { data, error } = await db.rpc("pc_step_owner_contacts");
  if (error) throw new Error(error.message);
  return ((data ?? []) as RawRow[]).map((r) => ({
    appId: r.app_id,
    stepKey: r.step_key,
    locationId: r.location_id,
    userId: r.user_id,
    name: r.name,
    phone: r.phone,
    email: r.email,
  }));
}

/**
 * Index the flat rows by `${appId}::${stepKey}`.
 *
 * Dispatch contributes SEVERAL rows per step — its owners are scoped by location
 * — so a step maps to a list, and the same person can appear twice under two
 * locations. De-duplicated by user id: the coordinator wants somebody to ring,
 * not a list of the grants that produced them.
 *
 * A step whose only row has a null `userId` yields an EMPTY list, which is what
 * the UI renders as "No owner set". The step still has a key here, so it can be
 * told apart from a step nobody has configured at all (absent entirely).
 */
export function indexStepOwners(rows: PcStepOwner[]): Map<string, PcStepOwner[]> {
  const byStep = new Map<string, PcStepOwner[]>();
  for (const r of rows) {
    const key = `${r.appId}::${r.stepKey}`;
    const list = byStep.get(key) ?? [];
    if (r.userId && !list.some((o) => o.userId === r.userId)) list.push(r);
    byStep.set(key, list);
  }
  return byStep;
}

export const stepOwnerKey = (appId: string, stepKey: string): string => `${appId}::${stepKey}`;
