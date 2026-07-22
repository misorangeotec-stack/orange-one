import { supabase } from "@/core/platform/supabase";
// fms_production_* tables/RPCs are not in the generated Database types; route
// through an untyped alias.
const db = supabase as any;
import type { ProductionEntityType, ProductionMasterType } from "../types";
import type { QueueStep } from "../lib/queues";

/**
 * Production Entry FMS write layer. The masters + config are written directly
 * under RLS (admin / the master's owner). Every WORKFLOW mutation goes through a
 * SECURITY DEFINER RPC that re-checks authorization, validates the transition and
 * stamps the step's timestamp. The wrappers are thin: the DATABASE is the gate.
 */

/* --------------------------------- requests ------------------------------- */

/** One raw-material line of the intake BOM. */
export interface RequestLineInput {
  rawMaterialId: string;
  qty: string;
  unitId: string | null;
}

export interface RequestInput {
  jobcardNo: string;
  bomLines: RequestLineInput[];
  fgItemId: string;
  issueRemarks: string | null;
  requesterName: string;
}

export async function submitRequest(input: RequestInput): Promise<string> {
  const { data, error } = await db.rpc("fms_production_submit_request", {
    p: {
      jobcard_no: input.jobcardNo,
      bom_lines: input.bomLines.map((l) => ({
        raw_material_id: l.rawMaterialId,
        required_qty: l.qty ?? "",
        unit_id: l.unitId ?? "",
      })),
      fg_item_id: input.fgItemId,
      issue_remarks: input.issueRemarks ?? "",
      requester_name: input.requesterName,
    },
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/* ------------------------------- stage records ---------------------------- */

/** payload keys are the jsonb keys the matching RPC reads (see lib/stepConfig.ts).
 *  Values are usually strings, but a step may send structured data (e.g. the
 *  material handover's `mh_bom_lines` array), so the value type is unknown. */
export type StepPayload = Record<string, unknown>;

const RECORD_RPC: Record<QueueStep, string> = {
  material_handover: "fms_production_record_material_handover",
  rm_transfer: "fms_production_record_rm_transfer",
  transfer_slip: "fms_production_record_transfer_slip",
  production_entry: "fms_production_record_production",
  quality_check: "fms_production_record_quality",
  mc_testing: "fms_production_record_mc_testing",
  pm_handover: "fms_production_record_pm_handover",
  pm_transfer: "fms_production_record_pm_transfer",
  packing_entry: "fms_production_record_packing",
  fg_transfer: "fms_production_record_fg_transfer",
};

const UPDATE_RPC: Record<QueueStep, string> = {
  material_handover: "fms_production_update_material_handover",
  rm_transfer: "fms_production_update_rm_transfer",
  transfer_slip: "fms_production_update_transfer_slip",
  production_entry: "fms_production_update_production",
  quality_check: "fms_production_update_quality",
  mc_testing: "fms_production_update_mc_testing",
  pm_handover: "fms_production_update_pm_handover",
  pm_transfer: "fms_production_update_pm_transfer",
  packing_entry: "fms_production_update_packing",
  fg_transfer: "fms_production_update_fg_transfer",
};

export async function recordStep(step: QueueStep, requestId: string, payload: StepPayload): Promise<void> {
  const { error } = await db.rpc(RECORD_RPC[step], { p_req: requestId, p: payload });
  if (error) throw new Error(error.message);
}

export async function updateStep(step: QueueStep, requestId: string, payload: StepPayload): Promise<void> {
  const { error } = await db.rpc(UPDATE_RPC[step], { p_req: requestId, p: payload });
  if (error) throw new Error(error.message);
}

export async function holdRequest(requestId: string, hold: boolean, reason: string): Promise<void> {
  const { error } = await db.rpc("fms_production_hold_request", { p_req: requestId, p_hold: hold, p_reason: reason });
  if (error) throw new Error(error.message);
}

export async function cancelRequest(requestId: string, reason: string): Promise<void> {
  const { error } = await db.rpc("fms_production_cancel_request", { p_req: requestId, p_reason: reason });
  if (error) throw new Error(error.message);
}

/* ------------------------------- documents -------------------------------- */

const DOCS_BUCKET = "fms-production-docs";

/** Upload a step attachment into a per-step folder; returns the stored path + name. */
export async function uploadStepDocument(requestId: string, folder: string, file: File): Promise<{ path: string; name: string }> {
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${requestId}/${folder}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage
    .from(DOCS_BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || undefined });
  if (error) throw new Error(error.message);
  return { path, name: file.name };
}

/** Upload the quality-checking test-report attachment; returns the stored path + name. */
export async function uploadQualityDocument(requestId: string, file: File): Promise<{ path: string; name: string }> {
  return uploadStepDocument(requestId, "quality", file);
}

/** Create a short-lived signed URL to view/download a stored quality document. */
export async function qualityDocumentUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(DOCS_BUCKET).createSignedUrl(path, 60 * 10);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

/* ------------------------------- step owners ------------------------------ */

export interface StepOwnerInput {
  departmentIds: string[];
  designationId: string | null;
  employeeIds: string[];
}

export async function setStepOwner(stepKey: string, input: StepOwnerInput): Promise<void> {
  const { error } = await db.from("fms_production_step_owners").upsert(
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

/* --------------------------------- config --------------------------------- */

export async function setConfig(key: string, value: Record<string, unknown>): Promise<void> {
  const { error } = await db.from("fms_production_config").upsert({ key, value }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

/* --------------------------------- masters -------------------------------- */

const MASTER_TABLE: Record<ProductionMasterType, string> = {
  category: "fms_production_categories",
  raw_material: "fms_production_raw_materials",
  fg_item: "fms_production_fg_items",
  unit: "fms_production_units",
};

export interface MasterInput {
  name: string;
  active: boolean;
  sortOrder: number;
  /** Raw materials only: the material's own unit (fms_production_units id). */
  unitId?: string | null;
}

/** Base columns + the raw-material-only unit_id when supplied. */
const masterRow = (input: MasterInput) => ({
  name: input.name,
  active: input.active,
  sort_order: input.sortOrder,
  ...(input.unitId !== undefined ? { unit_id: input.unitId || null } : {}),
});

export async function insertMaster(mt: ProductionMasterType, input: MasterInput): Promise<void> {
  const { error } = await db.from(MASTER_TABLE[mt]).insert(masterRow(input));
  if (error) throw new Error(error.message);
}

export async function updateMaster(mt: ProductionMasterType, id: string, input: MasterInput): Promise<void> {
  const { error } = await db.from(MASTER_TABLE[mt]).update(masterRow(input)).eq("id", id);
  if (error) throw new Error(error.message);
}

/* ============================ MASTER GOVERNANCE ========================== */

export async function setMasterManagers(masterType: ProductionMasterType, userIds: string[]): Promise<void> {
  const { error: delError } = await db
    .from("fms_production_master_managers")
    .delete()
    .eq("master_type", masterType);
  if (delError) throw new Error(delError.message);

  if (userIds.length === 0) return;
  const { error } = await db
    .from("fms_production_master_managers")
    .insert(userIds.map((id) => ({ master_type: masterType, manager_user_id: id })));
  if (error) throw new Error(error.message);
}

/** Raise a "Request new …" submission. RLS requires requested_by = auth.uid(). */
export async function requestNewMaster(
  masterType: ProductionMasterType,
  payload: Record<string, unknown>,
  requestedBy: string,
): Promise<string> {
  const { data, error } = await db
    .from("fms_production_master_requests")
    .insert({ master_type: masterType, proposed_payload: payload, requested_by: requestedBy, status: "pending" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function resolveMasterRequest(
  requestId: string,
  approve: boolean,
  payload: Record<string, unknown> | null,
  note: string | null,
): Promise<string | null> {
  const { data, error } = await db.rpc("fms_production_resolve_master_request", {
    p_request_id: requestId,
    p_approve: approve,
    p_payload: payload === null ? undefined : payload,
    p_note: note ?? undefined,
  });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

/* --------------------------- activity + bell feed ------------------------- */

export async function announce(input: {
  entityType: ProductionEntityType;
  entityId: string;
  type: string;
  text: string;
  recipients?: string[];
  meta?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await db.rpc("fms_production_announce", {
    p_entity_type: input.entityType,
    p_entity_id: input.entityId,
    p_type: input.type,
    p_text: input.text,
    p_user_ids: input.recipients ?? [],
    p_meta: input.meta ?? {},
  });
  if (error) throw new Error(error.message);
}

export async function markNotificationsRead(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await db
    .from("fms_production_notifications")
    .update({ read_at: new Date().toISOString() })
    .in("id", ids)
    .is("read_at", null);
  if (error) throw new Error(error.message);
}
