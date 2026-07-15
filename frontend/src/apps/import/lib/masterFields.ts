import type { MasterFieldDef } from "@/shared/components/ui/MasterCrud";
import type { ComboOption } from "@/shared/components/ui/Combobox";
import { MASTER_TYPES, type Category, type Company, type Item, type ItemGroup, type MasterType, type Vendor } from "../types";

export type MasterValues = Record<string, string>;

/** Relational dropdown options the item_group / item / price descriptors need. */
export interface MasterFieldCtx {
  categoryOptions: ComboOption[];
  itemGroupOptions: ComboOption[];
  vendorOptions?: ComboOption[];
  itemOptions?: ComboOption[];
}

/** The live master rows, for the "does this already exist?" check. */
export interface MasterLists {
  companies: Company[];
  categories: Category[];
  itemGroups: ItemGroup[];
  items: Item[];
  vendors: Vendor[];
}

/**
 * THE field schema for every import master — consumed by the Masters CRUD
 * tabs, the Master Requests approve modal, and the Request-new-master modal.
 *
 * ⚠ WIRE CONTRACT: each `key` below is a jsonb key of
 * `fms_import_master_requests.proposed_payload`, read verbatim by the
 * SECURITY DEFINER RPC `fms_import_resolve_master_request` (migration
 * 20260630120000). Add a field here WITHOUT adding it to that RPC's insert
 * chain and it is silently dropped when the request is approved.
 */
export function masterFields(mt: MasterType, ctx: MasterFieldCtx): MasterFieldDef[] {
  switch (mt) {
    case "company":
      return [
        { key: "name", label: "Company name", type: "text", required: true, placeholder: "e.g. Orange O Tec Enterprise" },
        { key: "location", label: "Location", type: "text", placeholder: "e.g. Surat (optional)" },
      ];
    case "category":
      return [{ key: "name", label: "Category name", type: "text", required: true, placeholder: "e.g. Raw Material" }];
    case "item_group":
      return [
        { key: "category_id", label: "Category", type: "select", required: true, options: ctx.categoryOptions, placeholder: "Select category" },
        { key: "name", label: "Item group name", type: "text", required: true, placeholder: "e.g. Solvents" },
      ];
    case "item":
      return [
        { key: "item_group_id", label: "Item Group", type: "select", required: true, options: ctx.itemGroupOptions, placeholder: "Select item group" },
        { key: "name", label: "Item name", type: "text", required: true, placeholder: "e.g. Isopropyl Alcohol" },
        { key: "unit", label: "Unit", type: "text", placeholder: "e.g. KGS, PCS, LTR" },
      ];
    case "vendor":
      return [
        { key: "name", label: "Vendor name", type: "text", required: true, placeholder: "e.g. Acme Chemicals Pvt Ltd" },
        { key: "gstin", label: "GSTIN", type: "text", placeholder: "15-digit GSTIN (optional)" },
        { key: "contact_name", label: "Contact person", type: "text" },
        { key: "phone", label: "Phone", type: "text" },
        { key: "email", label: "Email", type: "text" },
        { key: "default_currency", label: "Default currency", type: "text", placeholder: "e.g. USD, EUR" },
        { key: "address", label: "Address", type: "textarea" },
      ];
    case "vendor_item_price":
      return [
        { key: "vendor_id", label: "Vendor", type: "select", required: true, options: ctx.vendorOptions ?? [], placeholder: "Select vendor" },
        { key: "item_id", label: "Item", type: "select", required: true, options: ctx.itemOptions ?? [], placeholder: "Select item" },
        { key: "currency", label: "Currency", type: "text", required: true, placeholder: "e.g. USD" },
        { key: "rate", label: "Rate (per unit, foreign)", type: "text", required: true, placeholder: "e.g. 12.50" },
        { key: "gst_pct", label: "GST %", type: "text", placeholder: "optional, e.g. 18" },
      ];
  }
}

/** Every key of `mt`, blank — feeds MasterCrud's `emptyValues` and the request modal. */
export function emptyValuesFor(mt: MasterType): MasterValues {
  const empty: MasterValues = {};
  for (const f of masterFields(mt, { categoryOptions: [], itemGroupOptions: [] })) empty[f.key] = "";
  return empty;
}

/** The first unmet required field, as a user-facing message. Null when valid. */
export function missingRequired(mt: MasterType, v: MasterValues, ctx: MasterFieldCtx): string | null {
  for (const f of masterFields(mt, ctx)) {
    if (f.required && !v[f.key]?.trim()) return `${f.label} is required.`;
  }
  return null;
}

/** Trim everything, drop empty optionals → the jsonb payload we post. */
export function payloadFromValues(mt: MasterType, v: MasterValues): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const f of masterFields(mt, { categoryOptions: [], itemGroupOptions: [] })) {
    const val = (v[f.key] ?? "").trim();
    if (val || f.required) payload[f.key] = val;
  }
  return payload;
}

export const masterTypeLabel = (mt: MasterType) => MASTER_TYPES.find((m) => m.value === mt)?.label ?? mt;
export const masterTypePlural = (mt: MasterType) => MASTER_TYPES.find((m) => m.value === mt)?.plural ?? mt;

/** A one-line human summary of a proposed payload, e.g. `Solvents (Raw Material)`. */
export function describePayload(
  mt: MasterType,
  payload: Record<string, unknown>,
  lookup: { categoryName: (id: string) => string | undefined; itemGroupName: (id: string) => string | undefined }
): string {
  const s = (k: string) => (typeof payload[k] === "string" ? (payload[k] as string).trim() : "");
  const name = s("name") || "—";
  switch (mt) {
    case "company":
      return s("location") ? `${name} — ${s("location")}` : name;
    case "item_group": {
      const cat = lookup.categoryName(s("category_id"));
      return cat ? `${name} (${cat})` : name;
    }
    case "item": {
      const grp = lookup.itemGroupName(s("item_group_id"));
      const unit = s("unit");
      return `${name}${grp ? ` (${grp})` : ""}${unit ? ` · ${unit}` : ""}`;
    }
    case "vendor":
      return s("gstin") ? `${name} · ${s("gstin")}` : name;
    case "category":
      return name;
    case "vendor_item_price": {
      const rate = s("rate");
      const ccy = s("currency") || "";
      return rate ? `${ccy} ${rate}`.trim() : "Vendor-item price";
    }
  }
}

const eq = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/**
 * Is this proposed entry already in the master? Case-insensitive and scoped to
 * the same parent, mirroring the DB's unique constraints — so it catches the
 * approve-time violation before the request is ever raised.
 *
 * Matches INACTIVE rows too: they're hidden from the dropdowns (so a requester
 * has no idea they exist) but the unique index still blocks the insert. Those
 * need a reactivation, not a new request — the caller says so.
 */
export function findExistingMaster(
  mt: MasterType,
  v: MasterValues,
  lists: MasterLists
): { id: string; name: string; active: boolean } | undefined {
  const name = v.name ?? "";
  if (!name.trim()) return undefined;
  switch (mt) {
    case "company":
      return lists.companies.find((c) => eq(c.name, name) && eq(c.location, v.location));
    case "category":
      return lists.categories.find((c) => eq(c.name, name));
    case "item_group":
      return lists.itemGroups.find((g) => g.categoryId === v.category_id && eq(g.name, name));
    case "item":
      return lists.items.find((i) => i.itemGroupId === v.item_group_id && eq(i.name, name));
    case "vendor":
      return lists.vendors.find((x) => eq(x.name, name));
  }
}

/** The parent id a request hangs off, matching the DB dup-guard index. */
export const parentIdOf = (payload: Record<string, unknown>): string =>
  String(payload.category_id ?? payload.item_group_id ?? payload.vendor_id ?? "");
