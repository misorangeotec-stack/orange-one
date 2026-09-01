import type { MasterFieldDef } from "@/shared/components/ui/MasterCrud";
import { OCPI_MASTER_TYPES, type OcpiMasterType, type OcpiNamedMaster } from "../types";

export type MasterValues = Record<string, string>;

/**
 * THE field schema for a requestable OCPI master — read by the "request a new
 * entry" modal and by the approve modal on the Master Requests screen.
 *
 * ⚠⚠ WIRE CONTRACT. Each `key` below is a jsonb key of
 *   `fms_ocpi_master_requests.proposed_payload`, read VERBATIM by the SECURITY
 *   DEFINER RPC `fms_ocpi_resolve_master_request` (migration 20260929121800).
 *   Add a field here without adding it to that RPC and it is SILENTLY DROPPED
 *   on approval.
 *
 *   The contract, all four types: **name**, and nothing else.
 *
 * ⚠ THAT ALL FOUR TAKE ONLY A NAME IS THE POINT, not an oversight. Three of them
 *   are vocabularies. The fourth, a machine, has thirty template fields — but a
 *   REQUEST for one is "this model is missing from the dropdown", raised by a
 *   salesperson who has no way to know the deck's spec rows. It lands with
 *   `has_template = false` and somebody who owns the templates fills it in
 *   afterwards. Asking the requester for the supply description would guarantee
 *   either a blocked request or an invented one.
 */
export function masterFields(mt: OcpiMasterType): MasterFieldDef[] {
  const hint =
    mt === "machine"
      ? "The model name as it should appear in the quotation dropdown. The order-confirmation template is built separately."
      : "Exactly as it should read on the quotation.";
  return [
    {
      key: "name",
      label: masterTypeLabel(mt),
      type: "text",
      required: true,
      hint,
    },
  ];
}

export const masterTypeLabel = (mt: OcpiMasterType): string =>
  OCPI_MASTER_TYPES.find((m) => m.value === mt)?.label ?? mt;

export const masterTypePlural = (mt: OcpiMasterType): string =>
  OCPI_MASTER_TYPES.find((m) => m.value === mt)?.plural ?? mt;

export const emptyValuesFor = (mt: OcpiMasterType): MasterValues =>
  Object.fromEntries(masterFields(mt).map((f) => [f.key, ""]));

/** Which required fields are still blank. Empty means it can be sent. */
export function missingRequired(mt: OcpiMasterType, v: MasterValues): string[] {
  return masterFields(mt)
    .filter((f) => f.required && !(v[f.key] ?? "").trim())
    .map((f) => f.label);
}

/** Trimmed, ready for `proposed_payload`. */
export function payloadFromValues(mt: OcpiMasterType, v: MasterValues): Record<string, string> {
  return Object.fromEntries(masterFields(mt).map((f) => [f.key, (v[f.key] ?? "").trim()]));
}

/**
 * Does this already exist, under any capitalisation?
 *
 * ⚠ CHECKED BEFORE SENDING, NOT AFTER. The database's partial unique index
 *   refuses a second PENDING request for the same name, which is right but
 *   surfaces as a constraint error. Answering "that is already in the list" in
 *   the modal is the difference between a helpful screen and a puzzling one —
 *   and most of the time the requester simply did not scroll.
 */
/*
  ⚠ IT ASKS FOR THE TWO FIELDS IT READS, NOT FOR A NAMED MASTER (OCPI-8). Its
    four callers pass MACHINES as well as name-only vocabularies, and a machine
    is not an `OcpiNamedMaster` — it happened to satisfy that shape until the
    dryer-category marker was added to it, and then this stopped compiling. The
    fix is to say what is actually needed rather than to put a dryer flag on
    machines to keep a structural coincidence alive.
*/
export function findExisting<T extends { name: string; active: boolean }>(
  rows: T[],
  name: string,
): T | undefined {
  const n = name.trim().toLowerCase();
  if (!n) return undefined;
  return rows.find((r) => r.name.trim().toLowerCase() === n);
}
