/**
 * The ONE schema for every Asset Maintenance master: which fields it has, what an
 * empty value bag looks like, and how a bag becomes a request payload.
 *
 * ⚠ WIRE CONTRACT: the keys below are read VERBATIM by
 *   public.fms_asset_resolve_master_request (20260805120000). Adding a field here
 *   without adding it there silently drops it when a request is approved.
 *
 * ⚠ `emptyValuesFor` IS THE EXCEL SCHEMA. MasterCrud's export/import derives its
 *   columns from `Object.keys(emptyValues)`, so a key present in the bag but with
 *   no visible field still survives the round trip — which is why `sortOrder` is
 *   in every bag but a field on none.
 */
import type { ReactNode } from "react";
import type { MasterFieldDef } from "@/shared/components/ui/MasterCrud";
import type { ComboOption } from "@/shared/components/ui/Combobox";
import { ASSET_MASTER_TYPES, FREQUENCY_UNITS, type AssetMasterType, type NamedMaster } from "../types";

export type MasterValues = Record<string, string>;

/** "schedule_type" → "Schedule type". Never spell a master's name in a component. */
export const masterTypeLabel = (mt: AssetMasterType): string =>
  ASSET_MASTER_TYPES.find((m) => m.value === mt)?.label ?? mt.replace(/_/g, " ");

export const masterTypePlural = (mt: AssetMasterType): string =>
  ASSET_MASTER_TYPES.find((m) => m.value === mt)?.plural ?? masterTypeLabel(mt);

export interface MasterFieldCtx {
  /**
   * Renders the "which tracks does this category pre-offer" picker. Supplied by
   * the Masters page because it is JSX and this module is deliberately pure.
   */
  renderScheduleTypePicker?: (value: string, onChange: (next: string) => void) => ReactNode;
}

const KIND_OPTIONS: ComboOption[] = [
  { value: "service", label: "Service — work performed on the asset" },
  { value: "renewal", label: "Renewal — a document that lapses and is replaced" },
];

const FREQ_OPTIONS: ComboOption[] = FREQUENCY_UNITS.map((u) => ({ value: u.value, label: u.label }));

/** Bag keys that must be coerced to a number before they reach Postgres. */
const NUMERIC_KEYS = new Set(["default_frequency_value", "default_lead_days", "sortOrder"]);

export function masterFields(mt: AssetMasterType, ctx: MasterFieldCtx = {}): MasterFieldDef[] {
  switch (mt) {
    case "schedule_type":
      return [
        { key: "name", label: "Name", type: "text", required: true, placeholder: "e.g. Lift Licence" },
        {
          key: "kind", label: "Kind", type: "select", required: true, options: KIND_OPTIONS,
          hint: "Renewal tracks ask for the new expiry date off the renewed document when the job is closed. Service tracks compute the next date from the frequency.",
        },
        { key: "default_frequency_value", label: "Default frequency", type: "text", placeholder: "6" },
        { key: "default_frequency_unit", label: "Frequency unit", type: "select", options: FREQ_OPTIONS,
          hint: "Use One time only for something that genuinely never repeats — it parks the track once it fires." },
        { key: "default_lead_days", label: "Default reminder lead (days)", type: "text", placeholder: "15",
          hint: "How far ahead the service job opens. Insurance wants 45; a routine service 15." },
      ];

    case "category":
      return [
        { key: "name", label: "Name", type: "text", required: true, placeholder: "e.g. Vehicle" },
        { key: "default_lead_days", label: "Default reminder lead (days)", type: "text", placeholder: "15" },
        {
          key: "default_schedule_type_ids",
          label: "Pre-offer these tracks",
          type: "custom",
          hint: "A new asset in this category starts with these tracks ticked. Always overridable per asset.",
          render: ctx.renderScheduleTypePicker,
        },
      ];

    case "location":
      return [
        { key: "name", label: "Name", type: "text", required: true, placeholder: "e.g. Plant 1" },
        { key: "address", label: "Address", type: "textarea" },
      ];

    case "vendor":
      return [
        { key: "name", label: "Name", type: "text", required: true },
        { key: "contact_person", label: "Contact person", type: "text" },
        { key: "phone", label: "Phone", type: "text" },
        { key: "email", label: "Email", type: "text" },
        { key: "gstin", label: "GSTIN", type: "text" },
        { key: "address", label: "Address", type: "textarea" },
      ];

    case "company":
      return [
        { key: "name", label: "Name", type: "text", required: true },
        { key: "gstin", label: "GSTIN", type: "text" },
        { key: "address", label: "Address", type: "textarea" },
      ];

    case "make":
    case "condition":
    case "usage_unit":
    case "cost_head":
    default:
      return [{ key: "name", label: "Name", type: "text", required: true }];
  }
}

/** The value bag — and therefore the Excel column set — for one master type. */
export function emptyValuesFor(mt: AssetMasterType): MasterValues {
  const base: MasterValues = { name: "", sortOrder: "0" };
  switch (mt) {
    case "schedule_type":
      return { ...base, kind: "service", default_frequency_value: "", default_frequency_unit: "", default_lead_days: "15" };
    case "category":
      return { ...base, default_lead_days: "", default_schedule_type_ids: "" };
    case "location":
      return { ...base, address: "" };
    case "vendor":
      return { ...base, contact_person: "", phone: "", email: "", gstin: "", address: "" };
    case "company":
      return { ...base, gstin: "", address: "" };
    default:
      return base;
  }
}

/** Bag → the `proposed_payload` jsonb. Drops blanks and the display-only sortOrder. */
export function payloadFromValues(mt: AssetMasterType, v: MasterValues): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const keys = Object.keys(emptyValuesFor(mt));
  for (const k of keys) {
    if (k === "sortOrder") continue;
    const raw = (v[k] ?? "").trim();
    if (!raw) continue;
    out[k] = NUMERIC_KEYS.has(k) ? Number(raw) : raw;
  }
  return out;
}

/** Which required fields are still blank — the label list a form shows. */
export function missingRequired(mt: AssetMasterType, v: MasterValues, ctx: MasterFieldCtx = {}): string[] {
  return masterFields(mt, ctx)
    .filter((f) => f.required && !(v[f.key] ?? "").trim())
    .map((f) => f.label);
}

/** A one-line summary of a request payload, for the review list. */
export function describePayload(mt: AssetMasterType, payload: Record<string, unknown>): string {
  const name = String(payload.name ?? "").trim() || "(no name)";
  const extras = Object.keys(payload)
    .filter((k) => k !== "name")
    .map((k) => `${k.replace(/_/g, " ")}: ${String(payload[k])}`)
    .join(" · ");
  return extras ? `${name} — ${extras}` : name;
}

/**
 * Does a master with this name already exist?
 *
 * ⚠ Matches INACTIVE rows too. The unique index does not care whether a row is
 *   active, so approving a request that duplicates a deactivated row would fail
 *   with a constraint error rather than a sentence. Better to say so first.
 */
export function findExistingMaster<T extends NamedMaster>(rows: T[], name: string): T | undefined {
  const needle = name.trim().toLowerCase();
  if (!needle) return undefined;
  return rows.find((r) => r.name.trim().toLowerCase() === needle);
}

export { NUMERIC_KEYS };
