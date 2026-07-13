import type { MasterFieldDef } from "@/shared/components/ui/MasterCrud";
import {
  HR_MASTER_TYPES,
  type DisqualificationReason,
  type HrMaster,
  type HrMasterType,
  type JobPlatform,
  type JobType,
  type HrLocation,
  type OnboardingItem,
} from "../types";

export type MasterValues = Record<string, string>;

/** The live master rows, for the "does this already exist?" check. */
export interface MasterLists {
  jobPlatforms: JobPlatform[];
  jobTypes: JobType[];
  locations: HrLocation[];
  disqualificationReasons: DisqualificationReason[];
  onboardingItems: OnboardingItem[];
}

/**
 * THE field schema for a requestable HR master — consumed by the
 * Request-new-master modal and the Master Requests approve modal.
 *
 * ⚠ WIRE CONTRACT: each `key` below is a jsonb key of
 * `fms_hr_master_requests.proposed_payload`, read verbatim by the SECURITY
 * DEFINER RPC `fms_hr_resolve_master_request` (migration 20260713130000). Add a
 * field here WITHOUT adding it to that RPC's insert chain and it is silently
 * dropped when the request is approved.
 *
 * All four requestable HR masters are name-only, so this is deliberately thin.
 * `sort_order` is NOT here: it is an owner's concern, set on the Masters page,
 * not something a requester should be asked to invent. `onboarding_item` is not
 * here either — it isn't requestable (see REQUESTABLE_MASTER_TYPES).
 */
export function masterFields(mt: HrMasterType): MasterFieldDef[] {
  switch (mt) {
    case "job_platform":
      return [{ key: "name", label: "Platform name", type: "text", required: true, placeholder: "e.g. Indeed" }];
    case "job_type":
      return [{ key: "name", label: "Job type", type: "text", required: true, placeholder: "e.g. Apprentice" }];
    case "location":
      return [{ key: "name", label: "Location name", type: "text", required: true, placeholder: "e.g. Vapi Plant" }];
    case "disqualification_reason":
      return [{ key: "name", label: "Reason", type: "text", required: true, placeholder: "e.g. Notice period too long" }];
    case "onboarding_item":
      // Not requestable — the Masters page owns this one. Kept exhaustive so a
      // new master type can never be added without the compiler flagging it here.
      return [];
  }
}

/** Every key of `mt`, blank — seeds the request modal. */
export function emptyValuesFor(mt: HrMasterType): MasterValues {
  const empty: MasterValues = {};
  for (const f of masterFields(mt)) empty[f.key] = "";
  return empty;
}

/** The first unmet required field, as a user-facing message. Null when valid. */
export function missingRequired(mt: HrMasterType, v: MasterValues): string | null {
  for (const f of masterFields(mt)) {
    if (f.required && !v[f.key]?.trim()) return `${f.label} is required.`;
  }
  return null;
}

/** Trim everything, drop empty optionals → the jsonb payload we post. */
export function payloadFromValues(mt: HrMasterType, v: MasterValues): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const f of masterFields(mt)) {
    const val = (v[f.key] ?? "").trim();
    if (val || f.required) payload[f.key] = val;
  }
  return payload;
}

export const masterTypeLabel = (mt: HrMasterType) => HR_MASTER_TYPES.find((m) => m.value === mt)?.label ?? mt;
export const masterTypePlural = (mt: HrMasterType) => HR_MASTER_TYPES.find((m) => m.value === mt)?.plural ?? mt;

/** A one-line human summary of a proposed payload, for the requests table. */
export function describePayload(payload: Record<string, unknown>): string {
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  return name || "—";
}

const eq = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

const listFor = (mt: HrMasterType, lists: MasterLists): Array<HrMaster | OnboardingItem> => {
  switch (mt) {
    case "job_platform":
      return lists.jobPlatforms;
    case "job_type":
      return lists.jobTypes;
    case "location":
      return lists.locations;
    case "disqualification_reason":
      return lists.disqualificationReasons;
    case "onboarding_item":
      return lists.onboardingItems;
  }
};

/**
 * Is this proposed entry already in the master? Case-INSENSITIVE, which is
 * stricter than the DB's case-sensitive unique(name) — deliberately, so we never
 * end up with both "Naukri" and "naukri".
 *
 * Matches INACTIVE rows too: they're hidden from the dropdowns (so a requester
 * has no idea they exist) but the unique index still blocks the insert. Those
 * need a reactivation, not a new request — the caller says so.
 */
export function findExistingMaster(
  mt: HrMasterType,
  v: MasterValues,
  lists: MasterLists
): { id: string; name: string; active: boolean } | undefined {
  const name = v.name ?? "";
  if (!name.trim()) return undefined;
  return listFor(mt, lists).find((row) => eq(row.name, name));
}
