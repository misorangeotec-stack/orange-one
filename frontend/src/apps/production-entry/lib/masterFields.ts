import type { MasterFieldDef } from "@/shared/components/ui/MasterCrud";
import { PRODUCTION_MASTER_TYPES, type ProductionMasterType, type NamedMaster } from "../types";

export type MasterValues = Record<string, string>;

/**
 * THE field schema for every Production master — consumed by the Masters CRUD
 * tabs, the Master Requests approve modal, and the Request-new-master modal.
 * All four masters are simple name lists, so the schema is just `name`.
 *
 * ⚠ WIRE CONTRACT: each `key` is a jsonb key of
 * `fms_production_master_requests.proposed_payload`, read verbatim by the
 * SECURITY DEFINER RPC `fms_production_resolve_master_request`.
 */
export function masterFields(mt: ProductionMasterType): MasterFieldDef[] {
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
  return [{ key: "name", label, type: "text", required: true, placeholder }];
}

export function emptyValuesFor(_mt: ProductionMasterType): MasterValues {
  return { name: "" };
}

export function missingRequired(mt: ProductionMasterType, v: MasterValues): string | null {
  for (const f of masterFields(mt)) {
    if (f.required && !v[f.key]?.trim()) return `${f.label} is required.`;
  }
  return null;
}

export function payloadFromValues(_mt: ProductionMasterType, v: MasterValues): Record<string, unknown> {
  return { name: (v.name ?? "").trim() };
}

export const masterTypeLabel = (mt: ProductionMasterType) =>
  PRODUCTION_MASTER_TYPES.find((m) => m.value === mt)?.label ?? mt;
export const masterTypePlural = (mt: ProductionMasterType) =>
  PRODUCTION_MASTER_TYPES.find((m) => m.value === mt)?.plural ?? mt;

/** A one-line human summary of a proposed payload — just the name. */
export function describePayload(_mt: ProductionMasterType, payload: Record<string, unknown>): string {
  return (typeof payload.name === "string" ? payload.name.trim() : "") || "—";
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
