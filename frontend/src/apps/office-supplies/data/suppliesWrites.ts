import { supabase } from "@/core/platform/supabase";
import type { Json } from "@/core/platform/database.types";
import type { RequestType, SupplyEntityType, SupplyMasterType } from "../types";

/**
 * Office Supplies FMS write layer. Masters + config are written directly under RLS
 * (admin / the master's owner). Every WORKFLOW mutation goes through a SECURITY
 * DEFINER RPC that re-checks authorization, validates the transition and stamps the
 * step's timestamp. The wrappers are thin: the DATABASE is the gate.
 */

/* --------------------------------- requests ------------------------------- */

export interface RequestInput {
  companyId: string;
  location: "Plant" | "Office";
  departmentId: string;
  requestedForName: string;
  requestedForUserId: string | null;
  requestType: RequestType;
  categoryId: string | null;
  serviceTypeId: string | null;
  itemName: string | null;
  quantity: string;
  reason: string | null;
}

export async function submitRequest(input: RequestInput): Promise<string> {
  const { data, error } = await supabase.rpc("fms_supplies_submit_request", {
    p: {
      company_id: input.companyId,
      location: input.location,
      department_id: input.departmentId,
      requested_for_name: input.requestedForName,
      requested_for_user_id: input.requestedForUserId ?? "",
      request_type: input.requestType,
      category_id: input.categoryId ?? "",
      service_type_id: input.serviceTypeId ?? "",
      item_name: input.itemName ?? "",
      quantity: input.quantity,
      reason: input.reason ?? "",
    } as unknown as Json,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/**
 * Correct a submitted request — legal only while nobody has acted (awaiting first
 * approval, or a no-approval request still awaiting handover). The RPC re-checks
 * the gate and recomputes the route, since editing the category can flip whether
 * the request needs approval at all.
 */
export async function updateRequest(requestId: string, input: RequestInput): Promise<void> {
  const { error } = await supabase.rpc("fms_supplies_update_request", {
    p: {
      id: requestId,
      company_id: input.companyId,
      location: input.location,
      department_id: input.departmentId,
      requested_for_name: input.requestedForName,
      requested_for_user_id: input.requestedForUserId ?? "",
      request_type: input.requestType,
      category_id: input.categoryId ?? "",
      service_type_id: input.serviceTypeId ?? "",
      item_name: input.itemName ?? "",
      quantity: input.quantity,
      reason: input.reason ?? "",
    } as unknown as Json,
  });
  if (error) throw new Error(error.message);
}

export async function decideFirstApproval(requestId: string, approve: boolean, remarks: string): Promise<void> {
  const { error } = await supabase.rpc("fms_supplies_decide_first_approval", {
    p_req: requestId,
    p_approve: approve,
    p_remarks: remarks,
  });
  if (error) throw new Error(error.message);
}

export async function decideSecondApproval(requestId: string, approve: boolean, remarks: string): Promise<void> {
  const { error } = await supabase.rpc("fms_supplies_decide_second_approval", {
    p_req: requestId,
    p_approve: approve,
    p_remarks: remarks,
  });
  if (error) throw new Error(error.message);
}

export interface HandoverInput {
  handoverRemarks: string | null;
  tentativeDeliveryDate: string | null;
  actualDeliveryDate: string | null;
}

export async function recordHandover(requestId: string, input: HandoverInput): Promise<void> {
  const { error } = await supabase.rpc("fms_supplies_record_handover", {
    p_req: requestId,
    p: {
      handover_remarks: input.handoverRemarks ?? "",
      tentative_delivery_date: input.tentativeDeliveryDate ?? "",
      actual_delivery_date: input.actualDeliveryDate ?? "",
    } as unknown as Json,
  });
  if (error) throw new Error(error.message);
}

/* ------------------------- stage edits (update_*) -------------------------- */
/**
 * Correcting an entry at a stage, until the next step is done.
 *
 * Each mirrors a `fms_supplies_update_<step>` RPC (20260719130000) that re-checks
 * the lock server-side, refuses while the request is held / rejected / cancelled,
 * and writes its activity row in the same transaction.
 *
 * A note on `update_handover`: it exists because `record_handover` hard-refuses
 * once the request is delivered, and a delivered request's handover is
 * deliberately still correctable — handover is the last step and nothing is
 * derived from it.
 */

export async function updateFirstApproval(requestId: string, approve: boolean, remarks: string): Promise<void> {
  const { error } = await supabase.rpc("fms_supplies_update_first_approval", {
    p_req: requestId,
    p_approve: approve,
    p_remarks: remarks,
  });
  if (error) throw new Error(error.message);
}

export async function updateSecondApproval(requestId: string, approve: boolean, remarks: string): Promise<void> {
  const { error } = await supabase.rpc("fms_supplies_update_second_approval", {
    p_req: requestId,
    p_approve: approve,
    p_remarks: remarks,
  });
  if (error) throw new Error(error.message);
}

export async function updateHandover(requestId: string, input: HandoverInput): Promise<void> {
  const { error } = await supabase.rpc("fms_supplies_update_handover", {
    p_req: requestId,
    p: {
      handover_remarks: input.handoverRemarks ?? "",
      tentative_delivery_date: input.tentativeDeliveryDate ?? "",
      actual_delivery_date: input.actualDeliveryDate ?? "",
    } as unknown as Json,
  });
  if (error) throw new Error(error.message);
}

export async function holdRequest(requestId: string, hold: boolean, reason: string): Promise<void> {
  const { error } = await supabase.rpc("fms_supplies_hold_request", {
    p_req: requestId,
    p_hold: hold,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

export async function cancelRequest(requestId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("fms_supplies_cancel_request", { p_req: requestId, p_reason: reason });
  if (error) throw new Error(error.message);
}

/* ------------------------------- step owners ------------------------------ */

export interface StepOwnerInput {
  departmentIds: string[];
  designationId: string | null;
  employeeIds: string[];
}

export async function setStepOwner(stepKey: string, input: StepOwnerInput): Promise<void> {
  const { error } = await supabase.from("fms_supplies_step_owners").upsert(
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
  const { error } = await supabase
    .from("fms_supplies_config")
    .upsert({ key, value: value as unknown as Json }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

/* --------------------------------- masters -------------------------------- */

export interface CompanyInput {
  name: string;
  active: boolean;
  sortOrder: number;
}
export async function insertCompany(input: CompanyInput): Promise<void> {
  const { error } = await supabase
    .from("fms_supplies_companies")
    .insert({ name: input.name, active: input.active, sort_order: input.sortOrder });
  if (error) throw new Error(error.message);
}
export async function updateCompany(id: string, input: CompanyInput): Promise<void> {
  const { error } = await supabase
    .from("fms_supplies_companies")
    .update({ name: input.name, active: input.active, sort_order: input.sortOrder })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export interface DepartmentInput {
  name: string;
  hodUserId: string | null;
  active: boolean;
  sortOrder: number;
}
export async function insertDepartment(input: DepartmentInput): Promise<void> {
  const { error } = await supabase.from("fms_supplies_departments").insert({
    name: input.name,
    hod_user_id: input.hodUserId,
    active: input.active,
    sort_order: input.sortOrder,
  });
  if (error) throw new Error(error.message);
}
export async function updateDepartment(id: string, input: DepartmentInput): Promise<void> {
  const { error } = await supabase
    .from("fms_supplies_departments")
    .update({ name: input.name, hod_user_id: input.hodUserId, active: input.active, sort_order: input.sortOrder })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export interface CategoryInput {
  name: string;
  requiresApproval: boolean;
  active: boolean;
  sortOrder: number;
}
export async function insertCategory(input: CategoryInput): Promise<void> {
  const { error } = await supabase.from("fms_supplies_categories").insert({
    name: input.name,
    requires_approval: input.requiresApproval,
    active: input.active,
    sort_order: input.sortOrder,
  });
  if (error) throw new Error(error.message);
}
export async function updateCategory(id: string, input: CategoryInput): Promise<void> {
  const { error } = await supabase
    .from("fms_supplies_categories")
    .update({
      name: input.name,
      requires_approval: input.requiresApproval,
      active: input.active,
      sort_order: input.sortOrder,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export interface ItemInput {
  categoryId: string;
  name: string;
  unit: string | null;
  active: boolean;
  sortOrder: number;
}
export async function insertItem(input: ItemInput): Promise<void> {
  const { error } = await supabase.from("fms_supplies_items").insert({
    category_id: input.categoryId,
    name: input.name,
    unit: input.unit,
    active: input.active,
    sort_order: input.sortOrder,
  });
  if (error) throw new Error(error.message);
}
export async function updateItem(id: string, input: ItemInput): Promise<void> {
  const { error } = await supabase
    .from("fms_supplies_items")
    .update({
      category_id: input.categoryId,
      name: input.name,
      unit: input.unit,
      active: input.active,
      sort_order: input.sortOrder,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export interface ServiceTypeInput {
  name: string;
  active: boolean;
  sortOrder: number;
}
export async function insertServiceType(input: ServiceTypeInput): Promise<void> {
  const { error } = await supabase
    .from("fms_supplies_service_types")
    .insert({ name: input.name, active: input.active, sort_order: input.sortOrder });
  if (error) throw new Error(error.message);
}
export async function updateServiceType(id: string, input: ServiceTypeInput): Promise<void> {
  const { error } = await supabase
    .from("fms_supplies_service_types")
    .update({ name: input.name, active: input.active, sort_order: input.sortOrder })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/* ============================ MASTER GOVERNANCE ========================== */

export async function setMasterManagers(masterType: SupplyMasterType, userIds: string[]): Promise<void> {
  const { error: delError } = await supabase
    .from("fms_supplies_master_managers")
    .delete()
    .eq("master_type", masterType);
  if (delError) throw new Error(delError.message);

  if (userIds.length === 0) return;
  const { error } = await supabase
    .from("fms_supplies_master_managers")
    .insert(userIds.map((id) => ({ master_type: masterType, manager_user_id: id })));
  if (error) throw new Error(error.message);
}

/**
 * Raise a "Request new …" submission.
 *
 * ⚠ `requestedBy` MUST be the REAL session user id, never a demo persona — the insert
 *   policy checks `requested_by = auth.uid()` against the JWT.
 */
export async function requestNewMaster(
  masterType: SupplyMasterType,
  payload: Record<string, unknown>,
  requestedBy: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("fms_supplies_master_requests")
    .insert({
      master_type: masterType,
      proposed_payload: payload as unknown as Json,
      requested_by: requestedBy,
      status: "pending",
    })
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
  const { data, error } = await supabase.rpc("fms_supplies_resolve_master_request", {
    p_request_id: requestId,
    p_approve: approve,
    p_payload: (payload ?? null) as unknown as Json,
    p_note: note ?? undefined,
  });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

/* --------------------------- activity + bell feed ------------------------- */

export async function announce(input: {
  entityType: SupplyEntityType;
  entityId: string;
  type: string;
  text: string;
  recipients?: string[];
  meta?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabase.rpc("fms_supplies_announce", {
    p_entity_type: input.entityType,
    p_entity_id: input.entityId,
    p_type: input.type,
    p_text: input.text,
    p_user_ids: input.recipients ?? [],
    p_meta: (input.meta ?? {}) as unknown as Json,
  });
  if (error) throw new Error(error.message);
}

export async function markNotificationsRead(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase
    .from("fms_supplies_notifications")
    .update({ read_at: new Date().toISOString() })
    .in("id", ids)
    .is("read_at", null);
  if (error) throw new Error(error.message);
}
