import type { MasterFieldDef } from "@/shared/components/ui/MasterCrud";
import { PRODUCTION_MASTER_TYPES, type ProductionMasterType, type NamedMaster } from "../types";
import type { MasterFieldCtx } from "./useMasterFieldCtx";

export type MasterValues = Record<string, string>;

/** Raw materials, packaging items and FG items each carry their own unit; the
 *  Unit column on a job card is read off the master, never typed. */
const HAS_UNIT: ProductionMasterType[] = ["raw_material", "packaging_item", "fg_item"];
export const carriesUnit = (mt: ProductionMasterType) => HAS_UNIT.includes(mt);

/**
 * THE field schema for every Production master — consumed by the Masters CRUD
 * tabs, the Master Requests approve modal, and the Request-new-master modal.
 *
 * ⚠ WIRE CONTRACT: each `key` is a jsonb key of
 * `fms_production_master_requests.proposed_payload`, read verbatim by the
 * SECURITY DEFINER RPC `fms_production_resolve_master_request`. Adding a field
 * here without adding it to that RPC's insert chain silently drops it on approve.
 */
export function masterFields(mt: ProductionMasterType, ctx: MasterFieldCtx): MasterFieldDef[] {
  const label =
    mt === "category" ? "Category name"
    : mt === "raw_material" ? "Raw material name"
    : mt === "packaging_item" ? "Packaging item name"
    : mt === "fg_item" ? "FG item name"
    : "Unit name";
  const placeholder =
    mt === "unit" ? "e.g. KGS, LTR, PCS"
    : mt === "category" ? "e.g. Ink"
    : mt === "packaging_item" ? "e.g. Carton, Label"
    : "e.g. name";

  const fields: MasterFieldDef[] = [{ key: "name", label, type: "text", required: true, placeholder }];
  if (carriesUnit(mt)) {
    // Optional, matching the Masters tab: an entry can be added now and given
    // its unit later, it just shows "-" on job cards until then.
    fields.push({
      key: "unit_id",
      label: "Unit",
      type: "select",
      options: ctx.unitOptions,
      placeholder: "Select unit",
      hint: "Shown automatically when this item is picked on a job card.",
    });
  }
  return fields;
}

export function emptyValuesFor(mt: ProductionMasterType): MasterValues {
  return carriesUnit(mt) ? { name: "", unit_id: "" } : { name: "" };
}

export function missingRequired(mt: ProductionMasterType, v: MasterValues, ctx: MasterFieldCtx): string | null {
  for (const f of masterFields(mt, ctx)) {
    if (f.required && !v[f.key]?.trim()) return `${f.label} is required.`;
  }
  return null;
}

export function payloadFromValues(mt: ProductionMasterType, v: MasterValues): Record<string, unknown> {
  return {
    name: (v.name ?? "").trim(),
    ...(carriesUnit(mt) ? { unit_id: (v.unit_id ?? "").trim() } : {}),
  };
}

export const masterTypeLabel = (mt: ProductionMasterType) =>
  PRODUCTION_MASTER_TYPES.find((m) => m.value === mt)?.label ?? mt;
export const masterTypePlural = (mt: ProductionMasterType) =>
  PRODUCTION_MASTER_TYPES.find((m) => m.value === mt)?.plural ?? mt;

/** A one-line human summary of a proposed payload: the name, plus the unit it
 *  would be created with — otherwise the queue hides half of what's being added. */
export function describePayload(
  mt: ProductionMasterType,
  payload: Record<string, unknown>,
  ctx: MasterFieldCtx,
): string {
  const name = (typeof payload.name === "string" ? payload.name.trim() : "") || "—";
  if (!carriesUnit(mt)) return name;
  const unitId = typeof payload.unit_id === "string" ? payload.unit_id : "";
  const unit = ctx.unitOptions.find((u) => u.value === unitId)?.label;
  return unit ? `${name} · ${unit}` : name;
}

const eq = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/**
 * Is this proposed entry already in the master? Case-insensitive; matches inactive
 * rows too (they're hidden from dropdowns but the unique index still blocks the
 * insert — those need reactivation, not a new request).
 */
export function findExistingMaster(
  v: MasterValues,
  list: NamedMaster[],
): { id: string; name: string; active: boolean } | undefined {
  const name = v.name ?? "";
  if (!name.trim()) return undefined;
  return list.find((x) => eq(x.name, name));
}
