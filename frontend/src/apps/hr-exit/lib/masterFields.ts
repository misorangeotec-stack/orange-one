import type { MasterFieldDef } from "@/shared/components/ui/MasterCrud";
import {
  EXIT_MASTER_TYPES,
  type ClearanceItem,
  type ExitAssetType,
  type ExitDocumentType,
  type ExitMaster,
  type ExitMasterType,
  type ExitPayrollHead,
  type ExitReason,
} from "../types";

export type MasterValues = Record<string, string>;

/** The live master rows, for the "does this already exist?" check. */
export interface MasterLists {
  reasons: ExitReason[];
  assetTypes: ExitAssetType[];
  documentTypes: ExitDocumentType[];
  payrollHeads: ExitPayrollHead[];
  clearanceItems: ClearanceItem[];
}

const YES_NO = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

/**
 * THE field schema for a requestable HR Exit master — consumed by the
 * Request-new-master modal and the Master Requests approve modal.
 *
 * ⚠⚠ WIRE CONTRACT. Each `key` below is a jsonb key of
 * `fms_exit_master_requests.proposed_payload`, read **verbatim** by the SECURITY
 * DEFINER RPC `fms_exit_resolve_master_request` (migration 20260714190000). ADD A
 * FIELD HERE WITHOUT ADDING IT TO THAT RPC'S INSERT CHAIN AND IT IS **SILENTLY
 * DROPPED** WHEN THE REQUEST IS APPROVED — no error, just a master row missing the
 * value the requester typed and the approver read. The RPC carries the same warning.
 *
 * The contract, as it stands:
 *   reason         → name
 *   asset_type     → name
 *   document_type  → name, requires_file   ('yes' | 'no')
 *   payroll_head   → name, kind            ('addition' | 'deduction')
 *
 * The two non-name keys travel as the SELECT's own strings, not as booleans — a form
 * value bag is `Record<string, string>` (MasterCrud's own contract), and the RPC
 * interprets them. `kind` is here and not left to a default because a payroll head with
 * the wrong sign is not a cosmetic error: it is money moving the wrong way on someone's
 * final settlement, and 'deduction' is the column default.
 *
 * `sort_order` and `active` are NOT here: they are an owner's concern, set on the
 * Masters page, not something a requester should be asked to invent. `clearance_item` is
 * not here either — it is not requestable (see REQUESTABLE_EXIT_MASTER_TYPES and the
 * CHECK on fms_exit_master_requests, which refuses it at the database).
 */
export function masterFields(mt: ExitMasterType): MasterFieldDef[] {
  switch (mt) {
    case "reason":
      return [
        { key: "name", label: "Reason", type: "text", required: true, placeholder: "e.g. Sabbatical" },
      ];
    case "asset_type":
      return [
        { key: "name", label: "Asset", type: "text", required: true, placeholder: "e.g. Docking station" },
      ];
    case "document_type":
      return [
        { key: "name", label: "Document", type: "text", required: true, placeholder: "e.g. Service Certificate" },
        {
          key: "requires_file",
          label: "Must the signed copy be uploaded?",
          type: "select",
          required: true,
          options: YES_NO,
          hint: "A letter recorded as 'issued' with nothing attached is a promise, not a document.",
        },
      ];
    case "payroll_head":
      return [
        { key: "name", label: "Head", type: "text", required: true, placeholder: "e.g. Retention Bonus" },
        {
          key: "kind",
          label: "Addition or deduction",
          type: "select",
          required: true,
          options: [
            { value: "addition", label: "Addition (paid to them)" },
            { value: "deduction", label: "Deduction (recovered from them)" },
          ],
          hint: "Which way the money moves on the full & final. There is no safe default here.",
        },
      ];
    case "clearance_item":
      // NOT requestable — the Masters page owns this one. Kept exhaustive so a new
      // master type can never be added without the compiler flagging it here.
      return [];
  }
}

/** Every key of `mt`, at its sensible starting value — seeds the request modal. */
export function emptyValuesFor(mt: ExitMasterType): MasterValues {
  const empty: MasterValues = {};
  for (const f of masterFields(mt)) {
    // A select must open on a legal option, not on "" — an empty required select is
    // a form the user cannot submit without touching a field they have no opinion on.
    empty[f.key] = f.type === "select" ? (f.options?.[0]?.value ?? "") : "";
  }
  return empty;
}

/** The first unmet required field, as a user-facing message. Null when valid. */
export function missingRequired(mt: ExitMasterType, v: MasterValues): string | null {
  for (const f of masterFields(mt)) {
    if (f.required && !v[f.key]?.trim()) return `${f.label} is required.`;
  }
  return null;
}

/** Trim everything, drop empty optionals → the jsonb payload we post. */
export function payloadFromValues(mt: ExitMasterType, v: MasterValues): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const f of masterFields(mt)) {
    const val = (v[f.key] ?? "").trim();
    if (val || f.required) payload[f.key] = val;
  }
  return payload;
}

export const masterTypeLabel = (mt: ExitMasterType) =>
  EXIT_MASTER_TYPES.find((m) => m.value === mt)?.label ?? mt;
export const masterTypePlural = (mt: ExitMasterType) =>
  EXIT_MASTER_TYPES.find((m) => m.value === mt)?.plural ?? mt;

/**
 * A one-line human summary of a proposed payload, for the requests table.
 *
 * It reads the wire keys, so the reviewer sees the whole proposal — a payroll head that
 * says "Retention Bonus" and nothing else hides the one thing worth reviewing about it.
 */
export function describePayload(payload: Record<string, unknown>): string {
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const bits: string[] = [];
  if (payload.kind === "addition") bits.push("addition");
  else if (payload.kind === "deduction") bits.push("deduction");
  if (payload.requires_file === "yes") bits.push("needs a file");
  else if (payload.requires_file === "no") bits.push("no file needed");
  const suffix = bits.length ? ` · ${bits.join(" · ")}` : "";
  return name ? `${name}${suffix}` : "—";
}

const eq = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

const listFor = (mt: ExitMasterType, lists: MasterLists): Array<ExitMaster | ClearanceItem> => {
  switch (mt) {
    case "reason":
      return lists.reasons;
    case "asset_type":
      return lists.assetTypes;
    case "document_type":
      return lists.documentTypes;
    case "payroll_head":
      return lists.payrollHeads;
    case "clearance_item":
      return lists.clearanceItems;
  }
};

/**
 * Is this proposed entry already in the master? Case-INSENSITIVE, which is stricter
 * than the DB's case-sensitive unique(name) — deliberately, so we never end up with both
 * "Relocation" and "relocation".
 *
 * ⚠ MATCHES INACTIVE ROWS TOO. They are hidden from the dropdowns (so a requester has no
 *   idea they exist) but the unique index still blocks the insert, so a request for one
 *   would be approved into a 23505 and look like a bug in the app. Those need a
 *   REACTIVATION, not a new row — and the caller says so.
 */
export function findExistingMaster(
  mt: ExitMasterType,
  v: MasterValues,
  lists: MasterLists,
): { id: string; name: string; active: boolean } | undefined {
  const name = v.name ?? "";
  if (!name.trim()) return undefined;
  return listFor(mt, lists).find((row) => eq(row.name, name));
}
