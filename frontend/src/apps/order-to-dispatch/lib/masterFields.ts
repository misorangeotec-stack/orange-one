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
  customerOptions: ComboOption[];
  categoryOptions: ComboOption[];
  unitOptions: ComboOption[];
  itemOptions: ComboOption[];
  companyOptions: ComboOption[];
  transporterOptions: ComboOption[];
  userOptions: ComboOption[];
}

export const EMPTY_MASTER_CTX: MasterFieldCtx = {
  customerOptions: [], categoryOptions: [], unitOptions: [], itemOptions: [],
  companyOptions: [], transporterOptions: [], userOptions: [],
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
        { key: "code", label: "Code", type: "text", placeholder: "Tally / ERP code" },
        { key: "gstin", label: "GSTIN", type: "text" },
        { key: "contact_name", label: "Contact person", type: "text" },
        { key: "phone", label: "Phone", type: "text" },
        {
          key: "email", label: "Email", type: "text",
          hint: "where the planned-dispatch mail goes; leave blank to never mail this customer",
        },
        { key: "billing_address", label: "Billing address", type: "textarea" },
        { key: "credit_limit", label: "Credit limit", type: "text", placeholder: "0" },
        { key: "credit_days", label: "Credit days", type: "text", placeholder: "0" },
        {
          key: "default_type", label: "Default dispatch type", type: "select",
          options: [{ value: "local", label: "Local" }, { value: "transport", label: "Transport" }],
        },
        { key: "default_transporter_id", label: "Default transporter", type: "select", options: ctx.transporterOptions },
        sortField,
      ];

    case "ship_to":
      return [
        { key: "customer_id", label: "Customer", type: "select", required: true, options: ctx.customerOptions },
        { key: "name", label: "Address label", type: "text", required: true, placeholder: "e.g. Factory, Head office" },
        { key: "address", label: "Address", type: "textarea" },
        { key: "city", label: "City", type: "text" },
        { key: "state", label: "State", type: "text" },
        { key: "contact_name", label: "Contact person", type: "text" },
        { key: "phone", label: "Phone", type: "text" },
        sortField,
      ];

    case "item":
      return [
        { key: "name", label: "Item name", type: "text", required: true },
        { key: "code", label: "Code", type: "text" },
        { key: "category_id", label: "Category", type: "select", options: ctx.categoryOptions },
        { key: "unit_id", label: "Default unit", type: "select", options: ctx.unitOptions,
          hint: "auto-fills the order line's unit when this item is picked" },
        { key: "hsn_code", label: "HSN code", type: "text" },
        sortField,
      ];

    case "lot":
      return [
        { key: "name", label: "LOT no.", type: "text", required: true },
        { key: "item_id", label: "Item", type: "select", options: ctx.itemOptions,
          hint: "the LOT picker at step 4 is filtered to the line's item" },
        { key: "mfg_date", label: "Mfg date", type: "text", placeholder: "yyyy-mm-dd" },
        { key: "expiry_date", label: "Expiry date", type: "text", placeholder: "yyyy-mm-dd" },
        { key: "available_qty", label: "Available qty", type: "text", placeholder: "0" },
        { key: "unit_id", label: "Unit", type: "select", options: ctx.unitOptions },
        sortField,
      ];

    case "vehicle":
      return [
        { key: "name", label: "Vehicle no.", type: "text", required: true, placeholder: "e.g. GJ-05-AB-1234" },
        { key: "vehicle_type", label: "Type", type: "text", placeholder: "e.g. Tempo, Truck" },
        { key: "transporter_id", label: "Transporter", type: "select", options: ctx.transporterOptions,
          hint: "leave blank for an own vehicle" },
        { key: "capacity", label: "Capacity", type: "text" },
        sortField,
      ];

    case "driver":
      return [
        { key: "name", label: "Driver name", type: "text", required: true },
        { key: "phone", label: "Phone", type: "text" },
        { key: "licence_no", label: "Licence no.", type: "text" },
        { key: "user_id", label: "Portal user", type: "select", options: ctx.userOptions,
          hint: "link a driver who signs in, so they can confirm their own delivery" },
        sortField,
      ];

    case "transporter":
      return [
        { key: "name", label: "Transporter name", type: "text", required: true },
        { key: "gstin", label: "GSTIN", type: "text" },
        { key: "contact_name", label: "Contact person", type: "text" },
        { key: "phone", label: "Phone", type: "text" },
        { key: "email", label: "Email", type: "text" },
        { key: "address", label: "Address", type: "textarea" },
        sortField,
      ];

    case "company":
      return [
        { key: "name", label: "Company name", type: "text", required: true },
        { key: "gstin", label: "GSTIN", type: "text" },
        { key: "address", label: "Address", type: "textarea" },
        sortField,
      ];

    case "godown":
    case "gate":
      return [
        { key: "name", label: mt === "godown" ? "Godown name" : "Gate name", type: "text", required: true },
        { key: "company_id", label: "Company", type: "select", options: ctx.companyOptions },
        { key: "location", label: "Location", type: "text" },
        sortField,
      ];

    case "invoice_series":
      return [
        { key: "name", label: "Series name", type: "text", required: true, placeholder: "e.g. GST SALES" },
        { key: "company_id", label: "Company", type: "select", options: ctx.companyOptions },
        sortField,
      ];

    case "payment_term":
      return [
        { key: "name", label: "Term name", type: "text", required: true, placeholder: "e.g. 30 days credit" },
        { key: "days", label: "Days", type: "text", placeholder: "0" },
        { key: "description", label: "Description", type: "textarea" },
        sortField,
      ];

    case "mail_template":
      return [
        { key: "name", label: "Template name", type: "text", required: true },
        { key: "code", label: "Code", type: "text", required: true, hint: "the stable key the RPC looks it up by" },
        { key: "subject", label: "Subject", type: "text" },
        {
          key: "body", label: "Body", type: "textarea",
          hint: "tokens: {{customer}} {{order_no}} {{order_date}} {{planned_dispatch_date}} {{items}} {{type}}",
        },
        sortField,
      ];

    default:
      // unit · category · order_source · shortfall_reason · packing_type
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
  : mt === "order_source" ? "e.g. Email, WhatsApp, Phone"
  : mt === "shortfall_reason" ? "e.g. Stock short, Under production"
  : mt === "packing_type" ? "e.g. Drum, Carton, Bag"
  : "";

/**
 * The value bag for a master type. Its KEYS are the Excel export/import schema
 * (MasterCrud derives the round trip from `Object.keys(emptyValues)`), so every
 * persisted attribute must appear here even when it has no visible form field.
 */
export function emptyValuesFor(mt: DispatchMasterType): MasterValues {
  const base: MasterValues = { name: "", sortOrder: "0" };
  switch (mt) {
    case "customer":
      return { ...base, code: "", gstin: "", contact_name: "", phone: "", email: "",
               billing_address: "", credit_limit: "", credit_days: "", default_type: "", default_transporter_id: "" };
    case "ship_to":
      return { ...base, customer_id: "", address: "", city: "", state: "", contact_name: "", phone: "" };
    case "item":
      return { ...base, code: "", category_id: "", unit_id: "", hsn_code: "" };
    case "lot":
      return { ...base, item_id: "", mfg_date: "", expiry_date: "", available_qty: "", unit_id: "" };
    case "vehicle":
      return { ...base, vehicle_type: "", transporter_id: "", capacity: "" };
    case "driver":
      return { ...base, phone: "", licence_no: "", user_id: "" };
    case "transporter":
      return { ...base, gstin: "", contact_name: "", phone: "", email: "", address: "" };
    case "company":
      return { ...base, gstin: "", address: "" };
    case "godown":
    case "gate":
      return { ...base, company_id: "", location: "" };
    case "invoice_series":
      return { ...base, company_id: "" };
    case "payment_term":
      return { ...base, days: "", description: "" };
    case "mail_template":
      return { ...base, code: "", subject: "", body: "" };
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
  const extra =
    mt === "lot" && payload.available_qty ? ` · ${payload.available_qty} available`
    : mt === "vehicle" && payload.vehicle_type ? ` · ${payload.vehicle_type}`
    : mt === "payment_term" && payload.days ? ` · ${payload.days} days`
    : "";
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
