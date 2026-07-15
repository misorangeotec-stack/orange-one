import type { MasterFieldDef } from "@/shared/components/ui/MasterCrud";
import type { ComboOption } from "@/shared/components/ui/Combobox";
import { SUPPLY_MASTER_TYPES, type Category, type Item, type ServiceType, type SupplyMasterType } from "../types";

export type MasterValues = Record<string, string>;

/** Extra context masterFields needs — the item type needs the live category list. */
export interface MasterFieldContext {
  categories: Category[];
}

/** The live master rows, for the "does this already exist?" check. */
export interface MasterLists {
  items: Item[];
  serviceTypes: ServiceType[];
}

/**
 * THE field schema for a requestable Office Supplies master — consumed by the
 * Request-new-master modal and the Master Requests approve modal.
 *
 * ⚠⚠ WIRE CONTRACT. Each `key` below is a jsonb key of
 * `fms_supplies_master_requests.proposed_payload`, read VERBATIM by the SECURITY
 * DEFINER RPC `fms_supplies_resolve_master_request` (migration 20260715180000). Add a
 * field here without adding it to that RPC's insert chain and it is SILENTLY DROPPED.
 *
 * The contract:
 *   item          → name, category_id
 *   service_type  → name
 */
export function masterFields(mt: SupplyMasterType, ctx?: MasterFieldContext): MasterFieldDef[] {
  switch (mt) {
    case "item": {
      const options: ComboOption[] = (ctx?.categories ?? [])
        .filter((c) => c.active)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
        .map((c) => ({ value: c.id, label: c.name }));
      return [
        {
          key: "category_id",
          label: "Category",
          type: "select",
          required: true,
          options,
          hint: "Which office-supply category this item belongs under.",
        },
        { key: "name", label: "Item", type: "text", required: true, placeholder: "e.g. Wireless presenter" },
      ];
    }
    case "service_type":
      return [
        { key: "name", label: "Service", type: "text", required: true, placeholder: "e.g. CCTV maintenance" },
      ];
    case "company":
    case "department":
    case "category":
      // Not requestable — edited on the Masters page.
      return [];
  }
}

/** Every key of `mt`, at its sensible starting value — seeds the request modal. */
export function emptyValuesFor(mt: SupplyMasterType, ctx?: MasterFieldContext): MasterValues {
  const empty: MasterValues = {};
  for (const f of masterFields(mt, ctx)) {
    empty[f.key] = f.type === "select" ? (f.options?.[0]?.value ?? "") : "";
  }
  return empty;
}

/** The first unmet required field, as a user-facing message. Null when valid. */
export function missingRequired(mt: SupplyMasterType, v: MasterValues, ctx?: MasterFieldContext): string | null {
  for (const f of masterFields(mt, ctx)) {
    if (f.required && !v[f.key]?.trim()) return `${f.label} is required.`;
  }
  return null;
}

/** Trim everything, drop empty optionals → the jsonb payload we post. */
export function payloadFromValues(mt: SupplyMasterType, v: MasterValues, ctx?: MasterFieldContext): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const f of masterFields(mt, ctx)) {
    const val = (v[f.key] ?? "").trim();
    if (val || f.required) payload[f.key] = val;
  }
  return payload;
}

export const masterTypeLabel = (mt: SupplyMasterType) =>
  SUPPLY_MASTER_TYPES.find((m) => m.value === mt)?.label ?? mt;
export const masterTypePlural = (mt: SupplyMasterType) =>
  SUPPLY_MASTER_TYPES.find((m) => m.value === mt)?.plural ?? mt;

/** A one-line human summary of a proposed payload, for the requests table. */
export function describePayload(mt: SupplyMasterType, payload: Record<string, unknown>, categoryName?: (id: string) => string): string {
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  if (mt === "item" && typeof payload.category_id === "string" && payload.category_id) {
    const cat = categoryName?.(payload.category_id);
    return name ? `${name}${cat ? ` · ${cat}` : ""}` : "—";
  }
  return name || "—";
}

const eq = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/**
 * Is this proposed entry already in the master? Case-INSENSITIVE (stricter than the
 * DB's case-sensitive unique). Item matches are scoped to the chosen category.
 */
export function findExistingMaster(
  mt: SupplyMasterType,
  v: MasterValues,
  lists: MasterLists,
): { id: string; name: string; active: boolean } | undefined {
  const name = v.name ?? "";
  if (!name.trim()) return undefined;
  if (mt === "item") {
    return lists.items.find((row) => row.categoryId === v.category_id && eq(row.name, name));
  }
  if (mt === "service_type") {
    return lists.serviceTypes.find((row) => eq(row.name, name));
  }
  return undefined;
}
