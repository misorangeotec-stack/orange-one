import type { ComboOption } from "@/shared/components/ui/Combobox";
import type { MasterFieldDef } from "@/shared/components/ui/MasterCrud";
import {
  HR_MASTER_TYPES,
  SKILL_CATEGORIES,
  skillCategoryLabel,
  type DisqualificationReason,
  type HrMaster,
  type HrMasterType,
  type HrSkill,
  type JobPlatform,
  type JobTitle,
  type JobType,
  type HrLocation,
  type OnboardingItem,
  type Qualification,
} from "../types";

export type MasterValues = Record<string, string>;

/**
 * Option lists a master form needs but cannot derive from the master itself.
 *
 * Only `job_title` uses it today (its department comes from the portal-wide
 * `departments` table, not from an HR master). It is a ctx rather than an import
 * because `masterFields` must stay a pure function of its inputs — the request
 * modal, the approve modal and the Masters page all call it and must agree.
 * Modelled on `apps/import/lib/useMasterFieldCtx.ts`, which exists because three
 * screens built the same object independently and two of them drifted.
 */
export interface MasterFieldCtx {
  departmentOptions: ComboOption[];
}

const EMPTY_CTX: MasterFieldCtx = { departmentOptions: [] };

/**
 * THE field schema for a requestable HR master — consumed by the
 * Request-new-master modal and the Master Requests approve modal.
 *
 * ⚠ WIRE CONTRACT: each `key` below is a jsonb key of
 * `fms_hr_master_requests.proposed_payload`, read verbatim by the SECURITY
 * DEFINER RPC `fms_hr_resolve_master_request` (migrations 20260713130000 +
 * 20260815120000). Add a field here WITHOUT adding it to that RPC's insert chain
 * and it is silently dropped when the request is approved.
 *
 * `sort_order` is NOT here: it is an owner's concern, set on the Masters page,
 * not something a requester should be asked to invent. Neither is a job title's
 * JD TEMPLATE — someone who just wants "Ink Lab Chemist" on the dropdown must not
 * be asked to author a job description. HR fills the template in afterwards, via
 * MasterCrud's own `fields` prop on the Masters page. `onboarding_item` is absent
 * because it isn't requestable (see REQUESTABLE_MASTER_TYPES).
 */
export function masterFields(mt: HrMasterType, ctx: MasterFieldCtx = EMPTY_CTX): MasterFieldDef[] {
  switch (mt) {
    case "job_platform":
      return [{ key: "name", label: "Platform name", type: "text", required: true, placeholder: "e.g. Indeed" }];
    case "job_type":
      return [{ key: "name", label: "Employment type", type: "text", required: true, placeholder: "e.g. Apprentice" }];
    case "location":
      return [{ key: "name", label: "Location name", type: "text", required: true, placeholder: "e.g. Vapi Plant" }];
    case "disqualification_reason":
      return [{ key: "name", label: "Reason", type: "text", required: true, placeholder: "e.g. Notice period too long" }];
    case "job_title":
      return [
        { key: "name", label: "Job title", type: "text", required: true, placeholder: "e.g. Ink Lab Chemist" },
        {
          key: "department_id",
          label: "Department",
          type: "select",
          options: ctx.departmentOptions,
          hint: "which team it sits in",
        },
      ];
    case "skill":
      return [
        { key: "name", label: "Skill", type: "text", required: true, placeholder: "e.g. Printhead handling - Ricoh" },
        {
          key: "category",
          label: "Category",
          type: "select",
          required: true,
          options: SKILL_CATEGORIES.map((c) => ({ value: c.value, label: c.label })),
          hint: "groups it in the picker",
        },
      ];
    case "qualification":
      return [{ key: "name", label: "Qualification", type: "text", required: true, placeholder: "e.g. Diploma - Plastics" }];
    case "onboarding_item":
      // Not requestable — the Masters page owns this one. Kept exhaustive so a
      // new master type can never be added without the compiler flagging it here.
      return [];
  }
}

/**
 * Every key of `mt`, blank — seeds the request modal.
 *
 * A REQUIRED select seeds to its first legal option rather than "", so the
 * requester never has to open a dropdown just to satisfy a field that has one
 * sensible default. An optional select stays blank (hr-exit does the same).
 */
export function emptyValuesFor(mt: HrMasterType, ctx: MasterFieldCtx = EMPTY_CTX): MasterValues {
  const empty: MasterValues = {};
  for (const f of masterFields(mt, ctx)) {
    empty[f.key] = f.type === "select" && f.required ? f.options?.[0]?.value ?? "" : "";
  }
  return empty;
}

/** The first unmet required field, as a user-facing message. Null when valid. */
export function missingRequired(mt: HrMasterType, v: MasterValues, ctx: MasterFieldCtx = EMPTY_CTX): string | null {
  for (const f of masterFields(mt, ctx)) {
    if (f.required && !v[f.key]?.trim()) return `${f.label} is required.`;
  }
  return null;
}

/** Trim everything, drop empty optionals → the jsonb payload we post. */
export function payloadFromValues(
  mt: HrMasterType,
  v: MasterValues,
  ctx: MasterFieldCtx = EMPTY_CTX
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const f of masterFields(mt, ctx)) {
    const val = (v[f.key] ?? "").trim();
    if (val || f.required) payload[f.key] = val;
  }
  return payload;
}

export const masterTypeLabel = (mt: HrMasterType) => HR_MASTER_TYPES.find((m) => m.value === mt)?.label ?? mt;
export const masterTypePlural = (mt: HrMasterType) => HR_MASTER_TYPES.find((m) => m.value === mt)?.plural ?? mt;

/**
 * A one-line human summary of a proposed payload, for the requests table.
 *
 * A skill's category is the whole difference between two otherwise identical
 * requests, so it rides along with the name; a job title's department needs the
 * ctx to resolve an id to a name, which the table has.
 */
export function describePayload(
  payload: Record<string, unknown>,
  ctx: MasterFieldCtx = EMPTY_CTX
): string {
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const bits: string[] = [];

  const category = typeof payload.category === "string" ? payload.category.trim() : "";
  if (category) bits.push(skillCategoryLabel(category));

  const deptId = typeof payload.department_id === "string" ? payload.department_id.trim() : "";
  if (deptId) {
    const dept = ctx.departmentOptions.find((o) => o.value === deptId)?.label;
    if (dept) bits.push(dept);
  }

  if (!name) return "—";
  return bits.length ? `${name} · ${bits.join(" · ")}` : name;
}

/** The live master rows, for the "does this already exist?" check. */
export interface MasterLists {
  jobPlatforms: JobPlatform[];
  jobTypes: JobType[];
  locations: HrLocation[];
  disqualificationReasons: DisqualificationReason[];
  onboardingItems: OnboardingItem[];
  jobTitles: JobTitle[];
  skills: HrSkill[];
  qualifications: Qualification[];
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
    case "job_title":
      return lists.jobTitles;
    case "skill":
      return lists.skills;
    case "qualification":
      return lists.qualifications;
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
 *
 * Skills match on NAME ALONE, ignoring category — which is why fms_hr_skills is
 * unique(name) and not unique(category, name). One picker shows every category
 * at once, so two rows reading "Excel (advanced)" under different headers would
 * read as a bug however correct the data was.
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
