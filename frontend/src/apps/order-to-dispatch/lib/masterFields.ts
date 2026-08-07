import type { MasterFieldDef } from "@/shared/components/ui/MasterCrud";
import type { ComboOption } from "@/shared/components/ui/Combobox";
import { DISPATCH_MASTER_TYPES, type DispatchMasterType } from "../types";

export type MasterValues = Record<string, string>;

/**
 * The option lists the relational masters need. Built ONCE in
 * lib/useMasterFieldCtx.ts and threaded through every screen that renders a
 * master form — the Masters tabs, the Master Requests approve modal and the
 * "request a new entry" modal. Purchase learnt this the hard way: three screens
 * built their own lists independently and one drifted into empty pickers.
 */
export interface MasterFieldCtx {
  companyOptions: ComboOption[];
  customerOptions: ComboOption[];
  itemOptions: ComboOption[];
}

export const EMPTY_MASTER_CTX: MasterFieldCtx = {
  companyOptions: [], customerOptions: [], itemOptions: [],
};

/**
 * Masters whose rows have NO name of their own — they are identified by the
 * parents they join.
 *
 * ⚠ The write layer reads this to leave `name` out of the row entirely:
 *   fms_dispatch_customer_items has no name column, so sending one is a
 *   "column does not exist" on every save.
 */
export const NAMELESS_MASTERS: DispatchMasterType[] = ["customer_item"];
export const isNameless = (mt: DispatchMasterType) => NAMELESS_MASTERS.includes(mt);

/**
 * THE field schema for every Order to Dispatch master.
 *
 * ⚠ WIRE CONTRACT: each `key` is a jsonb key of
 * `fms_dispatch_master_requests.proposed_payload`, read VERBATIM by the SECURITY
 * DEFINER RPC `fms_dispatch_resolve_master_request`. Adding a field here without
 * adding it to that RPC's insert chain silently drops it on approve.
 *
 * `sortOrder` is deliberately in every value bag but NOT a field on most masters —
 * MasterCrud's Excel round trip derives its schema from `Object.keys(emptyValues)`,
 * so a bag key with no visible field still survives export/import.
 */
export function masterFields(mt: DispatchMasterType, ctx: MasterFieldCtx): MasterFieldDef[] {
  const sortField: MasterFieldDef = { key: "sortOrder", label: "Sort order", type: "text", placeholder: "0" };

  switch (mt) {
    case "customer":
      return [
        { key: "name", label: "Customer name", type: "text", required: true },
        { key: "code", label: "Code", type: "text", placeholder: "Tally / ERP code" },
        // Free text, not a picker — there is no location master. It seeds the
        // sales order, which then keeps its own copy, so a rename here cannot
        // rewrite where a consignment that already went out was sent.
        { key: "location", label: "Location", type: "text", placeholder: "where they take delivery" },
        { key: "contact_name", label: "Contact person", type: "text" },
        { key: "phone", label: "Phone", type: "text" },
        { key: "email", label: "Email", type: "text" },
        { key: "gstin", label: "GST TIN", type: "text" },
        sortField,
      ];

    case "item":
      return [
        { key: "name", label: "Item name", type: "text", required: true },
        { key: "code", label: "Code", type: "text", placeholder: "Tally / ERP code" },
        // Free text, not a picker. The unit belongs to the item; a master would
        // only let an order line contradict it.
        { key: "unit", label: "Unit", type: "text", placeholder: "e.g. KGS, LTR, PCS" },
        { key: "hsn_code", label: "HSN code", type: "text" },
        sortField,
      ];

    case "customer_item":
      // THE CUSTOMER↔ITEM MAPPING. A row is what makes an item selectable on
      // that customer's sales order — the pair IS the record, so there is no
      // name field and no sort order worth setting.
      return [
        { key: "customer_id", label: "Customer", type: "select", required: true, options: ctx.customerOptions, placeholder: "Select customer" },
        { key: "item_id", label: "Item", type: "select", required: true, options: ctx.itemOptions, placeholder: "Select item" },
      ];

    case "company":
      return [
        { key: "name", label: "Company name", type: "text", required: true },
        { key: "gstin", label: "GSTIN", type: "text" },
        { key: "address", label: "Address", type: "textarea" },
        // Drives the gate pass series — OTEC-2608-001. Optional: a company left
        // blank falls back to GP rather than blocking the billing clerk, and the
        // server rejects two companies sharing one prefix (case-insensitively),
        // because they would silently interleave into a single series.
        {
          key: "gate_pass_prefix", label: "Gate pass prefix", type: "text",
          placeholder: "e.g. OTEC — blank falls back to GP",
        },
        sortField,
      ];

    case "company_location":
      // OUR site, under one of our companies. The company is required because a
      // location that belongs to nobody cannot be offered on any order — the
      // intake picker filters strictly by the company already chosen.
      return [
        { key: "name", label: "Location name", type: "text", required: true, placeholder: "e.g. Ahmedabad, Unit 2" },
        { key: "company_id", label: "Company", type: "select", required: true, options: ctx.companyOptions, placeholder: "Select company" },
        sortField,
      ];

    // unit, category — name only.
    default:
      return [
        { key: "name", label: `${labelFor(mt)} name`, type: "text", required: true, placeholder: placeholderFor(mt) },
        sortField,
      ];
  }
}

const labelFor = (mt: DispatchMasterType) => DISPATCH_MASTER_TYPES.find((m) => m.value === mt)?.label ?? mt;
/* Every remaining master states its own placeholders in `masterFields`; the
   name-only default arm has none left to offer. */
const placeholderFor = (_mt: DispatchMasterType): string => "";

/**
 * The value bag for a master type. Its KEYS are the Excel export/import schema
 * (MasterCrud derives the round trip from `Object.keys(emptyValues)`), so every
 * persisted attribute must appear here even when it has no visible form field.
 *
 * ⚠ AND its keys are what Masters.tsx writes on save — a key here whose column
 *   was dropped makes EVERY save of that master fail with "column does not
 *   exist". This list and the table must move together.
 */
export function emptyValuesFor(mt: DispatchMasterType): MasterValues {
  const base: MasterValues = { name: "", sortOrder: "0" };
  switch (mt) {
    case "customer":
      return { ...base, code: "", location: "", contact_name: "", phone: "", email: "", gstin: "" };
    case "item":
      return { ...base, code: "", unit: "", hsn_code: "" };
    case "company":
      return { ...base, gstin: "", address: "", gate_pass_prefix: "" };
    case "company_location":
      return { ...base, company_id: "" };
    // No `name` in the bag — the row has none. Including it would put an empty
    // Name column in the Excel round trip and send `name: null` on every save.
    case "customer_item":
      return { customer_id: "", item_id: "" };
    default:
      return base;
  }
}

export function missingRequired(mt: DispatchMasterType, v: MasterValues, ctx: MasterFieldCtx): string | null {
  for (const f of masterFields(mt, ctx)) {
    if (f.required && !String(v[f.key] ?? "").trim()) return `${f.label} is required.`;
  }
  return null;
}

/** The jsonb the master-request RPC will read. Keys must match its insert chain. */
export function payloadFromValues(mt: DispatchMasterType, v: MasterValues): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(emptyValuesFor(mt))) {
    if (key === "sortOrder") continue; // not part of the request payload
    const raw = String(v[key] ?? "").trim();
    if (raw) out[key] = raw;
  }
  // A nameless master must NOT get a name key: the resolve RPC exempts it from
  // the name-is-required check, and an empty string would fail that check anyway.
  if (!isNameless(mt)) out.name = String(v.name ?? "").trim();
  return out;
}

export const masterTypeLabel = (mt: DispatchMasterType) => labelFor(mt);
export const masterTypePlural = (mt: DispatchMasterType) =>
  DISPATCH_MASTER_TYPES.find((m) => m.value === mt)?.plural ?? mt;

/**
 * A one-line human summary of a proposed payload — the name plus its parent.
 *
 * `lookup` is only consulted for the nameless mapping, whose payload is two ids
 * and would otherwise render as a dash on the approve screen.
 */
export function describePayload(
  mt: DispatchMasterType,
  payload: Record<string, unknown>,
  lookup?: {
    customerName: (id: string) => string;
    itemName: (id: string) => string;
    companyName?: (id: string) => string;
  },
): string {
  if (mt === "customer_item") {
    const c = lookup?.customerName(String(payload.customer_id ?? "")) ?? "";
    const i = lookup?.itemName(String(payload.item_id ?? "")) ?? "";
    // Both names or neither — a half-resolved pair reads worse than the label.
    return c && i ? `${c} — ${i}` : "Customer-item mapping";
  }
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  if (mt === "company_location") {
    // A location name alone is ambiguous across companies — "Unit 1" could be
    // anyone's. The parent is the half that makes the request reviewable.
    const co = lookup?.companyName?.(String(payload.company_id ?? "")) ?? "";
    return co ? `${name || "—"} · ${co}` : name || "—";
  }
  const extra = mt === "item" && payload.code ? ` · ${payload.code}` : "";
  return (name || "—") + extra;
}

const eq = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/**
 * Is this proposed entry already in the master? Case-insensitive, and it matches
 * INACTIVE rows too — they are hidden from dropdowns but the unique index still
 * blocks the insert, so "ask an owner to reactivate it" is the honest answer.
 */
export function findExistingMaster<T extends { id: string; name: string; active: boolean }>(
  rows: T[],
  proposedName: string,
): T | undefined {
  return rows.find((r) => eq(r.name, proposedName));
}
