import { supabase } from "@/core/platform/supabase";
// fms_sampling_* tables/RPCs are not in the generated Database types; route
// through an untyped alias.
const db = supabase as any;
import type { Direction, ReceiveVia, RequirementType, SamplingEntityType, SamplingMasterType, TransportBorne } from "../types";

/**
 * Sampling FMS write layer. The company master + config are written directly under
 * RLS (admin / the company master's owner). Every WORKFLOW mutation goes through a
 * SECURITY DEFINER RPC that re-checks authorization, validates the transition and
 * stamps the step's timestamp. The wrappers are thin: the DATABASE is the gate.
 */

/* --------------------------------- requests ------------------------------- */

export interface RequestInput {
  companyId: string;
  receiveVia: ReceiveVia;
  direction: Direction;
  requirementType: RequirementType | null;
  requesterName: string;
  partyName: string | null;
  productDesc: string;
  colourQty: string | null;
  collectorName: string | null;
  handoverName: string | null;
  transportBorne: TransportBorne | null;
  desiredResult: string | null;
  additionalInfo: string | null;
}

export async function submitRequest(input: RequestInput): Promise<string> {
  const { data, error } = await db.rpc("fms_sampling_submit_request", {
    p: {
      company_id: input.companyId,
      receive_via: input.receiveVia,
      direction: input.direction,
      requirement_type: input.requirementType ?? "",
      requester_name: input.requesterName,
      party_name: input.partyName ?? "",
      product_desc: input.productDesc,
      colour_qty: input.colourQty ?? "",
      collector_name: input.collectorName ?? "",
      handover_name: input.handoverName ?? "",
      transport_borne: input.transportBorne ?? "",
      desired_result: input.desiredResult ?? "",
      additional_info: input.additionalInfo ?? "",
    },
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/* ------------------------------- stage records ---------------------------- */

export interface ReceiptInput {
  receivedDate: string | null;
}
export async function recordReceipt(requestId: string, input: ReceiptInput): Promise<void> {
  const { error } = await db.rpc("fms_sampling_record_receipt", {
    p_req: requestId,
    p: { received_date: input.receivedDate ?? "" },
  });
  if (error) throw new Error(error.message);
}
export async function updateReceipt(requestId: string, input: ReceiptInput): Promise<void> {
  const { error } = await db.rpc("fms_sampling_update_receipt", {
    p_req: requestId,
    p: { received_date: input.receivedDate ?? "" },
  });
  if (error) throw new Error(error.message);
}

export interface SendInput {
  sentDate: string | null;
}
export async function recordSend(requestId: string, input: SendInput): Promise<void> {
  const { error } = await db.rpc("fms_sampling_record_send", {
    p_req: requestId,
    p: { sent_date: input.sentDate ?? "" },
  });
  if (error) throw new Error(error.message);
}
export async function updateSend(requestId: string, input: SendInput): Promise<void> {
  const { error } = await db.rpc("fms_sampling_update_send", {
    p_req: requestId,
    p: { sent_date: input.sentDate ?? "" },
  });
  if (error) throw new Error(error.message);
}

export interface ConfirmInput {
  partyReceivedDate: string | null;
}
export async function recordConfirm(requestId: string, input: ConfirmInput): Promise<void> {
  const { error } = await db.rpc("fms_sampling_record_confirm", {
    p_req: requestId,
    p: { party_received_date: input.partyReceivedDate ?? "" },
  });
  if (error) throw new Error(error.message);
}
export async function updateConfirm(requestId: string, input: ConfirmInput): Promise<void> {
  const { error } = await db.rpc("fms_sampling_update_confirm", {
    p_req: requestId,
    p: { party_received_date: input.partyReceivedDate ?? "" },
  });
  if (error) throw new Error(error.message);
}

export interface TestingInput {
  testingCompletedDate: string | null;
  internalRef: string | null;
  tentativeResultDate: string | null;
}
const testingPayload = (input: TestingInput) => ({
  testing_completed_date: input.testingCompletedDate ?? "",
  internal_ref: input.internalRef ?? "",
  tentative_result_date: input.tentativeResultDate ?? "",
});
export async function recordTesting(requestId: string, input: TestingInput): Promise<void> {
  const { error } = await db.rpc("fms_sampling_record_testing", { p_req: requestId, p: testingPayload(input) });
  if (error) throw new Error(error.message);
}
export async function updateTesting(requestId: string, input: TestingInput): Promise<void> {
  const { error } = await db.rpc("fms_sampling_update_testing", { p_req: requestId, p: testingPayload(input) });
  if (error) throw new Error(error.message);
}

export interface ResultInput {
  resultComment: string;
  resultOwner: string | null;
  /** Pass a key (even null) to REPLACE the attachment; omit both keys to keep it. */
  attachmentPath?: string | null;
  attachmentName?: string | null;
}
const resultPayload = (input: ResultInput) => {
  const p: Record<string, unknown> = {
    result_comment: input.resultComment,
    result_owner: input.resultOwner ?? "",
  };
  // The RPC keys off `p ? 'attachment_path'`: send the key only when replacing.
  if (input.attachmentPath !== undefined) p.attachment_path = input.attachmentPath ?? "";
  if (input.attachmentName !== undefined) p.attachment_name = input.attachmentName ?? "";
  return p;
};
export async function recordResult(requestId: string, input: ResultInput): Promise<void> {
  const { error } = await db.rpc("fms_sampling_record_result", { p_req: requestId, p: resultPayload(input) });
  if (error) throw new Error(error.message);
}
export async function updateResult(requestId: string, input: ResultInput): Promise<void> {
  const { error } = await db.rpc("fms_sampling_update_result", { p_req: requestId, p: resultPayload(input) });
  if (error) throw new Error(error.message);
}

export async function holdRequest(requestId: string, hold: boolean, reason: string): Promise<void> {
  const { error } = await db.rpc("fms_sampling_hold_request", { p_req: requestId, p_hold: hold, p_reason: reason });
  if (error) throw new Error(error.message);
}

export async function cancelRequest(requestId: string, reason: string): Promise<void> {
  const { error } = await db.rpc("fms_sampling_cancel_request", { p_req: requestId, p_reason: reason });
  if (error) throw new Error(error.message);
}

/* ------------------------------- documents -------------------------------- */

const DOCS_BUCKET = "fms-sampling-docs";

/** Upload the result / lab-report attachment; returns the stored path + name. */
export async function uploadResultDocument(requestId: string, file: File): Promise<{ path: string; name: string }> {
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${requestId}/result/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage
    .from(DOCS_BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || undefined });
  if (error) throw new Error(error.message);
  return { path, name: file.name };
}

/** Create a short-lived signed URL to view/download a stored result document. */
export async function resultDocumentUrl(path: string): Promise<string> {
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
  const { error } = await db.from("fms_sampling_step_owners").upsert(
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
  const { error } = await db.from("fms_sampling_config").upsert({ key, value }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

/* --------------------------------- masters -------------------------------- */

export interface CompanyInput {
  name: string;
  active: boolean;
  sortOrder: number;
}
export async function insertCompany(input: CompanyInput): Promise<void> {
  const { error } = await db
    .from("fms_sampling_companies")
    .insert({ name: input.name, active: input.active, sort_order: input.sortOrder });
  if (error) throw new Error(error.message);
}
export async function updateCompany(id: string, input: CompanyInput): Promise<void> {
  const { error } = await db
    .from("fms_sampling_companies")
    .update({ name: input.name, active: input.active, sort_order: input.sortOrder })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/* ============================ MASTER GOVERNANCE ========================== */

export async function setMasterManagers(masterType: SamplingMasterType, userIds: string[]): Promise<void> {
  const { error: delError } = await db
    .from("fms_sampling_master_managers")
    .delete()
    .eq("master_type", masterType);
  if (delError) throw new Error(delError.message);

  if (userIds.length === 0) return;
  const { error } = await db
    .from("fms_sampling_master_managers")
    .insert(userIds.map((id) => ({ master_type: masterType, manager_user_id: id })));
  if (error) throw new Error(error.message);
}

/* --------------------------- activity + bell feed ------------------------- */

export async function announce(input: {
  entityType: SamplingEntityType;
  entityId: string;
  type: string;
  text: string;
  recipients?: string[];
  meta?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await db.rpc("fms_sampling_announce", {
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
    .from("fms_sampling_notifications")
    .update({ read_at: new Date().toISOString() })
    .in("id", ids)
    .is("read_at", null);
  if (error) throw new Error(error.message);
}
