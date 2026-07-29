import { supabase } from "@/core/platform/supabase";
const db = supabase as any;

import type { QueueStep } from "../lib/queues";
import type { AssetMasterType } from "../types";

/**
 * Asset Maintenance FMS write layer.
 *
 * Masters, config and step owners are written DIRECTLY under RLS (admin / master
 * owner). Every workflow mutation goes through a SECURITY DEFINER RPC, because
 * the guards that matter — status, authorization, and the advance of the parent
 * schedule — must be one transaction on the server, not three round trips.
 */

const DOCS_BUCKET = "fms-asset-docs";

/* -------------------------------------------------------------------------- */
/*  Workflow                                                                   */
/* -------------------------------------------------------------------------- */

const RECORD_RPC: Record<QueueStep, string> = {
  schedule: "fms_asset_record_schedule",
  service_done: "fms_asset_record_service_done",
  verify_close: "fms_asset_record_verify_close",
};

const UPDATE_RPC: Record<QueueStep, string> = {
  schedule: "fms_asset_update_schedule",
  service_done: "fms_asset_update_service_done",
  verify_close: "fms_asset_update_verify_close",
};

/**
 * The jsonb a step RPC receives.
 *
 * ⚠ On an edit that KEEPS the existing file, the caller must OMIT
 *   `sd_bill_path` / `sd_bill_name` entirely. The RPCs read them with
 *   `p ? '<key>'`, so an omitted key preserves the stored bill while a blank
 *   string clears it. Sending "" on every edit would wipe the invoice.
 */
export type StepPayload = Record<string, unknown>;

export async function recordStep(step: QueueStep, jobId: string, payload: StepPayload): Promise<void> {
  const { error } = await db.rpc(RECORD_RPC[step], { p_job: jobId, p: payload });
  if (error) throw new Error(error.message);
}

export async function updateStep(step: QueueStep, jobId: string, payload: StepPayload): Promise<void> {
  const { error } = await db.rpc(UPDATE_RPC[step], { p_job: jobId, p: payload });
  if (error) throw new Error(error.message);
}

export async function holdJob(jobId: string, reason: string): Promise<void> {
  const { error } = await db.rpc("fms_asset_hold_job", { p_job: jobId, p_reason: reason });
  if (error) throw new Error(error.message);
}

export async function resumeJob(jobId: string): Promise<void> {
  const { error } = await db.rpc("fms_asset_resume_job", { p_job: jobId });
  if (error) throw new Error(error.message);
}

export async function cancelJob(jobId: string, reason: string): Promise<void> {
  const { error } = await db.rpc("fms_asset_cancel_job", { p_job: jobId, p_reason: reason });
  if (error) throw new Error(error.message);
}

export async function skipJob(jobId: string, reason: string): Promise<void> {
  const { error } = await db.rpc("fms_asset_skip_job", { p_job: jobId, p_reason: reason });
  if (error) throw new Error(error.message);
}

/** "Service needed now" — open a job ahead of its reminder window. */
export async function raiseJobNow(scheduleId: string): Promise<string> {
  const { data, error } = await db.rpc("fms_asset_raise_job_now", { p_schedule: scheduleId });
  if (error) throw new Error(error.message);
  return String(data);
}

/* -------------------------------------------------------------------------- */
/*  The register                                                               */
/* -------------------------------------------------------------------------- */

export async function submitAsset(payload: Record<string, unknown>): Promise<string> {
  const { data, error } = await db.rpc("fms_asset_submit_asset", { p: payload });
  if (error) throw new Error(error.message);
  return String(data);
}

export async function updateAsset(assetId: string, payload: Record<string, unknown>): Promise<void> {
  const { error } = await db.rpc("fms_asset_update_asset", { p_asset: assetId, p: payload });
  if (error) throw new Error(error.message);
}

export async function upsertSchedule(assetId: string, payload: Record<string, unknown>): Promise<string> {
  const { data, error } = await db.rpc("fms_asset_upsert_schedule", { p_asset: assetId, p: payload });
  if (error) throw new Error(error.message);
  return String(data);
}

export async function deleteSchedule(scheduleId: string): Promise<void> {
  const { error } = await db.rpc("fms_asset_delete_schedule", { p_schedule: scheduleId });
  if (error) throw new Error(error.message);
}

/**
 * Log a meter reading. Also the ONLY way a usage-based service is raised — a
 * nightly date job cannot know an odometer, so the server evaluates the usage
 * interval right here.
 */
export async function recordReading(assetId: string, payload: Record<string, unknown>): Promise<void> {
  const { error } = await db.rpc("fms_asset_record_reading", { p_asset: assetId, p: payload });
  if (error) throw new Error(error.message);
}

export async function retireAsset(assetId: string, reason: string, date?: string | null): Promise<void> {
  const { error } = await db.rpc("fms_asset_retire_asset", {
    p_asset: assetId, p_reason: reason, p_date: date ?? null,
  });
  if (error) throw new Error(error.message);
}

/* -------------------------------------------------------------------------- */
/*  Documents                                                                  */
/* -------------------------------------------------------------------------- */

export async function uploadDocument(
  ownerId: string,
  folder: string,
  file: File,
): Promise<{ path: string; name: string }> {
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${ownerId}/${folder}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage
    .from(DOCS_BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false });
  if (error) throw new Error(error.message);
  return { path, name: file.name };
}

export async function signedUrlFor(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(DOCS_BUCKET).createSignedUrl(path, 60 * 10);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

/* -------------------------------------------------------------------------- */
/*  Masters                                                                    */
/* -------------------------------------------------------------------------- */

const MASTER_TABLE: Record<AssetMasterType, string> = {
  schedule_type: "fms_asset_schedule_types",
  category: "fms_asset_categories",
  location: "fms_asset_locations",
  vendor: "fms_asset_vendors",
  make: "fms_asset_makes",
  company: "fms_asset_companies",
  condition: "fms_asset_conditions",
  usage_unit: "fms_asset_usage_units",
  cost_head: "fms_asset_cost_heads",
};

export interface MasterInput {
  name: string;
  active: boolean;
  sortOrder: number;
  extra?: Record<string, unknown>;
}

const masterRow = (i: MasterInput) => ({
  name: i.name,
  active: i.active,
  sort_order: i.sortOrder,
  ...(i.extra ?? {}),
});

export async function insertMaster(mt: AssetMasterType, input: MasterInput): Promise<void> {
  const { error } = await db.from(MASTER_TABLE[mt]).insert(masterRow(input));
  if (error) throw new Error(error.message);
}

export async function updateMaster(mt: AssetMasterType, id: string, input: MasterInput): Promise<void> {
  const { error } = await db.from(MASTER_TABLE[mt]).update(masterRow(input)).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function setMasterActive(mt: AssetMasterType, id: string, active: boolean): Promise<void> {
  const { error } = await db.from(MASTER_TABLE[mt]).update({ active }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Delete-all-then-insert: the owner set is small and the UI submits it whole. */
export async function setMasterManagers(mt: AssetMasterType, userIds: string[]): Promise<void> {
  const del = await db.from("fms_asset_master_managers").delete().eq("master_type", mt);
  if (del.error) throw new Error(del.error.message);
  if (!userIds.length) return;
  const { error } = await db
    .from("fms_asset_master_managers")
    .insert(userIds.map((u) => ({ master_type: mt, manager_user_id: u })));
  if (error) throw new Error(error.message);
}

export async function requestNewMaster(
  mt: AssetMasterType,
  payload: Record<string, unknown>,
  userId: string,
): Promise<void> {
  const { error } = await db.from("fms_asset_master_requests").insert({
    master_type: mt, proposed_payload: payload, status: "pending", requested_by: userId,
  });
  if (error) throw new Error(error.message);
}

export async function resolveMasterRequest(
  requestId: string,
  approve: boolean,
  payload: Record<string, unknown> | null,
  note: string | null,
): Promise<void> {
  const { error } = await db.rpc("fms_asset_resolve_master_request", {
    p_request_id: requestId, p_approve: approve, p_payload: payload, p_note: note,
  });
  if (error) throw new Error(error.message);
}

/* -------------------------------------------------------------------------- */
/*  Settings                                                                   */
/* -------------------------------------------------------------------------- */

export async function setStepOwner(
  stepKey: string,
  input: { departmentIds: string[]; designationId: string | null; employeeIds: string[] },
): Promise<void> {
  const { error } = await db.from("fms_asset_step_owners").upsert(
    {
      step_key: stepKey,
      department_ids: input.departmentIds,
      designation_id: input.designationId,
      employee_ids: input.employeeIds,
    },
    { onConflict: "step_key" },
  );
  if (error) throw new Error(error.message);
}

export async function setConfig(key: string, value: unknown): Promise<void> {
  const { error } = await db.from("fms_asset_config").upsert({ key, value }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

export async function markNotificationsRead(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await db
    .from("fms_asset_notifications")
    .update({ read_at: new Date().toISOString() })
    .in("id", ids);
  if (error) throw new Error(error.message);
}
