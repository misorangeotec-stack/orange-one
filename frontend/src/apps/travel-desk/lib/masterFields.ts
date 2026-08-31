import type { MasterFieldDef } from "@/shared/components/ui/MasterCrud";
import type { ComboOption } from "@/shared/components/ui/Combobox";
import {
  EXPENSE_KIND_LABEL,
  type TravelMasterType,
  type TravelRequestableMaster,
  type ExpenseCategoryKind,
} from "../types";

/**
 * The schema of every Travel Desk master, in one place.
 *
 * FOUR CONSUMERS READ IT and that is why it exists: the add/edit form, the Excel
 * export, the Excel import, and the "ask for a missing value" modal. A field
 * added here appears in all four; a field added to a screen appears in one and
 * silently drops out of the round trip.
 *
 * ⚠ THIS IS ALSO THE WIRE CONTRACT WITH `fms_travel_resolve_master_request`.
 *   The `key` of each field is the jsonb key the RPC reads out of
 *   `proposed_payload` when it turns an approved request into a master row.
 *   Rename one here without renaming it there and the request approves into a
 *   row with a missing column — silently, because jsonb has no schema.
 */

export interface MasterFieldCtx {
  /** Cities, for the hotel picker. */
  cityOptions: ComboOption[];
}

/** Yes/no rendered as a picker rather than a checkbox, so Excel round-trips it. */
const YES_NO: ComboOption[] = [
  { value: "Yes", label: "Yes" },
  { value: "No", label: "No" },
];

const TIER_OPTIONS: ComboOption[] = [
  { value: "1", label: "Tier 1 — Mumbai, Delhi NCR, Bengaluru, Chennai, Hyderabad, Kolkata, Pune, Ahmedabad" },
  { value: "2", label: "Tier 2 — Surat, Vadodara, Rajkot, Jaipur, Lucknow, Indore, Nagpur, Coimbatore, Chandigarh, Bhubaneswar" },
  { value: "3", label: "Tier 3 — every other city or town" },
];

const KIND_OPTIONS: ComboOption[] = (Object.keys(EXPENSE_KIND_LABEL) as ExpenseCategoryKind[])
  .map((k) => ({ value: k, label: EXPENSE_KIND_LABEL[k] }));

export function masterFields(
  type: Exclude<TravelMasterType, "rate_card">,
  ctx: MasterFieldCtx,
): MasterFieldDef[] {
  const name: MasterFieldDef = { key: "name", label: "Name", type: "text", required: true };

  switch (type) {
    case "city":
      return [
        name,
        { key: "state", label: "State", type: "text" },
        {
          key: "tier",
          label: "Tier",
          type: "select",
          required: true,
          options: TIER_OPTIONS,
          hint:
            "The tier decides the hotel cap, the daily allowance and the local conveyance cap for every trip to this city. Policy §1.3 names the Tier 1 and Tier 2 cities; everything else is Tier 3.",
        },
      ];

    case "purpose":
      return [
        name,
        {
          key: "requires_remarks",
          label: "Needs a written reason",
          type: "select",
          options: YES_NO,
          hint: "Set on Others, so a trip cannot be raised against a purpose that explains nothing.",
        },
      ];

    case "expense_category":
      return [
        name,
        {
          key: "kind",
          label: "Kind",
          type: "select",
          required: true,
          options: KIND_OPTIONS,
          hint:
            "What the claim engine checks this line against — a hotel line is measured against the hotel cap, a conveyance line against the daily conveyance cap, and so on.",
        },
        {
          key: "reimbursable",
          label: "Company pays",
          type: "select",
          options: YES_NO,
          hint:
            "Set to No for everything in Policy §15 — alcohol, fines, personal entertainment. The category then refuses itself, so no approver has to be the one to say no.",
        },
        {
          key: "receipt_required_above",
          label: "Receipt required above (₹)",
          type: "text",
          hint: "Leave empty when a receipt is ALWAYS required — air and train tickets, and the hotel folio.",
        },
        {
          key: "self_declaration_cap",
          label: "Self-declaration limit (₹)",
          type: "text",
          hint:
            "Only for limits that are the same for every band. Local conveyance varies by travel category, so its limit lives on the rate card instead.",
        },
        {
          key: "needs_guest_details",
          label: "Needs guest names",
          type: "select",
          options: YES_NO,
          hint: "§9.1 — a business meal must name the guests and their company on the claim.",
        },
        {
          key: "refusal_note",
          label: "Why not reimbursable",
          type: "textarea",
          hint: "Printed beside the line when somebody tries to claim it. Quote the policy clause.",
        },
      ];

    case "hotel":
      return [
        name,
        {
          key: "city_id",
          label: "City",
          type: "select",
          options: ctx.cityOptions,
          hint: "Optional — it only filters the picker when somebody is booking for that city.",
        },
      ];

    default:
      // Airlines and bus operators are a name and nothing else.
      return [name];
  }
}

/** A blank value bag for the add form. */
export function emptyValuesFor(type: Exclude<TravelMasterType, "rate_card">): Record<string, string> {
  const out: Record<string, string> = { name: "" };
  if (type === "city") { out.state = ""; out.tier = "3"; }
  if (type === "purpose") out.requires_remarks = "No";
  if (type === "expense_category") {
    out.kind = "misc";
    out.reimbursable = "Yes";
    out.receipt_required_above = "";
    out.self_declaration_cap = "";
    out.needs_guest_details = "No";
    out.refusal_note = "";
  }
  if (type === "hotel") out.city_id = "";
  return out;
}

/**
 * What is still missing before this can be saved or requested.
 *
 * Returns the sentence to show, or null when it is complete. One function rather
 * than a per-screen check, so the add form and the request modal refuse for the
 * same reasons and in the same words.
 */
export function missingRequired(
  type: Exclude<TravelMasterType, "rate_card">,
  v: Record<string, string>,
): string | null {
  if (!String(v.name ?? "").trim()) return "Give it a name.";

  if (type === "city") {
    const tier = Number(v.tier);
    if (!Number.isFinite(tier) || tier < 1 || tier > 3) {
      return "Pick a tier — without one the hotel cap and the daily allowance for this city cannot be worked out.";
    }
  }

  if (type === "expense_category") {
    if (!String(v.kind ?? "").trim()) return "Pick what kind of expense this is.";
    if (String(v.reimbursable ?? "").toLowerCase().startsWith("n") && !String(v.refusal_note ?? "").trim()) {
      return "Say why the company will not pay for it — the reason is shown to whoever tries to claim it.";
    }
  }

  return null;
}

/**
 * The jsonb payload a request carries.
 *
 * ⚠ THE KEYS HERE MUST MATCH what `fms_travel_resolve_master_request` reads.
 *   See the note at the top of this file.
 */
export function payloadFromValues(
  type: TravelRequestableMaster,
  v: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { name: String(v.name ?? "").trim() };
  if (type === "city") {
    out.state = String(v.state ?? "").trim() || null;
    out.tier = Number(v.tier) || 3;
  }
  if (type === "purpose") {
    out.requires_remarks = String(v.requires_remarks ?? "").toLowerCase().startsWith("y");
  }
  if (type === "expense_category") {
    out.kind = String(v.kind ?? "misc").trim();
    out.reimbursable = !String(v.reimbursable ?? "Yes").toLowerCase().startsWith("n");
  }
  if (type === "hotel") {
    out.city_id = String(v.city_id ?? "").trim() || null;
  }
  return out;
}

/** Turn a stored request payload back into a value bag the reviewer can correct. */
export function valuesFromPayload(
  type: TravelRequestableMaster,
  payload: Record<string, unknown>,
): Record<string, string> {
  const v = emptyValuesFor(type);
  const s = (k: string) => (payload[k] === null || payload[k] === undefined ? "" : String(payload[k]));
  v.name = s("name");
  if (type === "city") { v.state = s("state"); v.tier = s("tier") || "3"; }
  if (type === "purpose") v.requires_remarks = payload.requires_remarks ? "Yes" : "No";
  if (type === "expense_category") {
    v.kind = s("kind") || "misc";
    v.reimbursable = payload.reimbursable === false ? "No" : "Yes";
  }
  if (type === "hotel") v.city_id = s("city_id");
  return v;
}
