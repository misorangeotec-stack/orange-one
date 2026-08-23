import { supabase } from "@/core/platform/supabase";
import type { OcpiMasterType } from "../types";

const db = supabase as any;

/**
 * The setup masters and their governance.
 *
 * ⚠ THESE ARE PLAIN TABLE WRITES, not RPCs, and that is the deliberate exception
 *   to this module's "every mutation goes through a SECURITY DEFINER function"
 *   rule. The deal tables carry NO write policy at all, so an RPC is their only
 *   door; the masters carry a real policy — admin OR that master's owner — so
 *   the table itself IS the boundary. Wrapping them in a definer function would
 *   only add a second place to keep the same rule.
 *
 *   The one exception to the exception is resolving a request: approving has to
 *   create a row in a table the requester may not be able to write, so that runs
 *   as a definer RPC.
 */

/** Which table backs each vocabulary. `machine` has its own richer writer. */
const TABLE: Record<Exclude<OcpiMasterType, "machine">, string> = {
  head_type: "fms_ocpi_head_types",
  ink_type: "fms_ocpi_ink_types",
  dryer_type: "fms_ocpi_dryer_types",
};

export interface NamedMasterInput {
  name: string;
  active: boolean;
  sortOrder: number;
}

export async function insertNamedMaster(
  type: Exclude<OcpiMasterType, "machine">,
  input: NamedMasterInput,
): Promise<void> {
  const { error } = await db.from(TABLE[type]).insert({
    name: input.name,
    active: input.active,
    sort_order: input.sortOrder,
  });
  if (error) throw new Error(error.message);
}

export async function updateNamedMaster(
  type: Exclude<OcpiMasterType, "machine">,
  id: string,
  input: NamedMasterInput,
): Promise<void> {
  const { error } = await db
    .from(TABLE[type])
    .update({ name: input.name, active: input.active, sort_order: input.sortOrder })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Ask for a new master entry.
 *
 * ⚠ `requested_by` IS STAMPED FROM THE LIVE SESSION, and the insert policy
 *   checks it against the JWT — so a request can never be filed in somebody
 *   else's name, whatever the browser sends.
 */
export async function requestMaster(
  type: OcpiMasterType,
  payload: Record<string, string>,
): Promise<string> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) throw new Error("Not signed in");

  const { data, error } = await db
    .from("fms_ocpi_master_requests")
    .insert({
      master_type: type,
      proposed_payload: payload,
      status: "pending",
      requested_by: uid,
    })
    .select("id")
    .single();
  if (error) {
    // The partial unique index is the real guard; say what it means.
    if ((error.message ?? "").includes("fms_ocpi_master_requests_pending_uniq")) {
      throw new Error("Somebody has already asked for that one — it is waiting to be approved.");
    }
    throw new Error(error.message);
  }
  return data.id as string;
}

/**
 * Approve or reject a request. Approving creates the real master row.
 *
 * `payload` lets the reviewer correct what was asked for before approving — a
 * misspelled head model should be fixed here, not bounced back.
 */
export async function resolveMasterRequest(
  requestId: string,
  approve: boolean,
  payload?: Record<string, string>,
  note?: string,
): Promise<string | null> {
  const { data, error } = await db.rpc("fms_ocpi_resolve_master_request", {
    p_request_id: requestId,
    p_approve: approve,
    p_payload: payload ?? null,
    p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
  return (data as string) ?? null;
}

/** Admin: who owns one master. Replaces the whole list for that type. */
export async function setMasterManagers(
  type: OcpiMasterType,
  userIds: string[],
): Promise<void> {
  const del = await db.from("fms_ocpi_master_managers").delete().eq("master_type", type);
  if (del.error) throw new Error(del.error.message);
  if (userIds.length === 0) return;
  const { error } = await db
    .from("fms_ocpi_master_managers")
    .insert(userIds.map((id) => ({ master_type: type, manager_user_id: id })));
  if (error) throw new Error(error.message);
}
