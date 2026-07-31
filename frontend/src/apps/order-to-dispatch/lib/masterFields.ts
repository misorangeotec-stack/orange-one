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
  categoryOptions: ComboOption[];
  unitOptions: ComboOption[];
}

export const EMPTY_MASTER_CTX: MasterFieldCtx = {
  companyOptions: [], categoryOptions: [], unitOptions: [],
};

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
        {
          // THE COMPANY↔CUSTOMER MAPPING. Required, and the reason the sales
          // order no longer asks which company is selling — every order reads it
          // from here. `fms_dispatch_submit_order` refuses to raise without it,
          // so leaving it optional would only move the failure later.
          key: "company_id", label: "Company", type: "select", required: true,
          options: ctx.companyOptions,
        },
        { key: "code", label: "Code", type: "text", placeholder: "Tally / ERP code" },
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
        { key: "category_id", label: "Category", type: "select", options: ctx.categoryOptions },
        { key: "unit_id", label: "Unit", type: "select", options: ctx.unitOptions },
        { key: "hsn_code", label: "HSN code", type: "text" },
        sortField,
      ];

    case "company":
      return [
        { key: "name", label: "Company name", type: "text", required: true },
        { key: "gstin", label: "GSTIN", type: "text" },
        { key: "address", label: "Address", type: "textarea" },
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
const placeholderFor = (mt: DispatchMasterType): string =>
  mt === "unit" ? "e.g. KGS, LTR, PCS"
  : mt === "category" ? "e.g. Ink"
  : "";

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
      return { ...base, company_id: "", code: "", contact_name: "", phone: "", email: "", gstin: "" };
    case "item":
      return { ...base, code: "", category_id: "", unit_id: "", hsn_code: "" };
    case "company":
      return { ...base, gstin: "", address: "" };
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
  out.name = String(v.name ?? "").trim();
  return out;
}

export const masterTypeLabel = (mt: DispatchMasterType) => labelFor(mt);
export const masterTypePlural = (mt: DispatchMasterType) =>
  DISPATCH_MASTER_TYPES.find((m) => m.value === mt)?.plural ?? mt;

/** A one-line human summary of a proposed payload — the name plus its parent. */
export function describePayload(mt: DispatchMasterType, payload: Record<string, unknown>): string {
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
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
