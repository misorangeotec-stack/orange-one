import { supabase } from "@/core/platform/supabase";
import type { Json } from "@/core/platform/database.types";
import type { MasterType } from "../types";

/**
 * Procurement write layer (masters + governance). Each function performs one
 * mutation under RLS as the signed-in user (masters: admin or that master's
 * manager; master_managers: admin only; master_requests: own insert / RPC
 * resolve). Errors throw so the store/UI can surface them.
 */

/* ------------------------------- companies -------------------------------- */
export interface CompanyInput {
  name: string;
  location: string | null;
  active: boolean;
  sortOrder: number;
}

export async function insertCompany(input: CompanyInput & { createdBy: string }): Promise<string> {
  const { data, error } = await supabase
    .from("fms_purchase_companies")
    .insert({
      name: input.name,
      location: input.location,
      active: input.active,
      sort_order: input.sortOrder,
      created_by: input.createdBy,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function updateCompany(id: string, input: CompanyInput): Promise<void> {
  const { error } = await supabase
    .from("fms_purchase_companies")
    .update({ name: input.name, location: input.location, active: input.active, sort_order: input.sortOrder })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/* ------------------------------- categories ------------------------------- */
export interface CategoryInput {
  name: string;
  active: boolean;
  sortOrder: number;
}

export async function insertCategory(input: CategoryInput & { createdBy: string }): Promise<string> {
  const { data, error } = await supabase
    .from("fms_purchase_categories")
    .insert({ name: input.name, active: input.active, sort_order: input.sortOrder, created_by: input.createdBy })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function updateCategory(id: string, input: CategoryInput): Promise<void> {
  const { error } = await supabase
    .from("fms_purchase_categories")
    .update({ name: input.name, active: input.active, sort_order: input.sortOrder })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/* ------------------------------ item groups ------------------------------- */
export interface ItemGroupInput {
  categoryId: string;
  name: string;
  active: boolean;
  sortOrder: number;
}

export async function insertItemGroup(input: ItemGroupInput & { createdBy: string }): Promise<string> {
  const { data, error } = await supabase
    .from("fms_purchase_item_groups")
    .insert({
      category_id: input.categoryId,
      name: input.name,
      active: input.active,
      sort_order: input.sortOrder,
      created_by: input.createdBy,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function updateItemGroup(id: string, input: ItemGroupInput): Promise<void> {
  const { error } = await supabase
    .from("fms_purchase_item_groups")
    .update({ category_id: input.categoryId, name: input.name, active: input.active, sort_order: input.sortOrder })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/* --------------------------------- items ---------------------------------- */
export interface ItemInput {
  itemGroupId: string;
  name: string;
  unit: string;
  active: boolean;
  sortOrder: number;
}

export async function insertItem(input: ItemInput & { createdBy: string }): Promise<string> {
  const { data, error } = await supabase
    .from("fms_purchase_items")
    .insert({
      item_group_id: input.itemGroupId,
      name: input.name,
      unit: input.unit,
      active: input.active,
      sort_order: input.sortOrder,
      created_by: input.createdBy,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function updateItem(id: string, input: ItemInput): Promise<void> {
  const { error } = await supabase
    .from("fms_purchase_items")
    .update({
      item_group_id: input.itemGroupId,
      name: input.name,
      unit: input.unit,
      active: input.active,
      sort_order: input.sortOrder,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/* -------------------------------- vendors --------------------------------- */
export interface VendorInput {
  name: string;
  gstin: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  active: boolean;
}

export async function insertVendor(input: VendorInput & { createdBy: string }): Promise<string> {
  const { data, error } = await supabase
    .from("fms_purchase_vendors")
    .insert({
      name: input.name,
      gstin: input.gstin,
      contact_name: input.contactName,
      phone: input.phone,
      email: input.email,
      address: input.address,
      active: input.active,
      created_by: input.createdBy,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function updateVendor(id: string, input: VendorInput): Promise<void> {
  const { error } = await supabase
    .from("fms_purchase_vendors")
    .update({
      name: input.name,
      gstin: input.gstin,
      contact_name: input.contactName,
      phone: input.phone,
      email: input.email,
      address: input.address,
      active: input.active,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/* ---------------------------- master managers ----------------------------- */
/**
 * Replace the set of managers for a master type (admin-only under RLS): delete
 * the rows for that type, then insert the chosen user ids. Done as delete+insert
 * (not upsert) so removing a manager actually drops the row.
 */
export async function setMasterManagers(masterType: MasterType, userIds: string[]): Promise<void> {
  const { error: delErr } = await supabase
    .from("fms_purchase_master_managers")
    .delete()
    .eq("master_type", masterType);
  if (delErr) throw new Error(delErr.message);
  if (userIds.length) {
    const { error: insErr } = await supabase
      .from("fms_purchase_master_managers")
      .insert(userIds.map((manager_user_id) => ({ master_type: masterType, manager_user_id })));
    if (insErr) throw new Error(insErr.message);
  }
}

/* ---------------------------- master requests ----------------------------- */
/**
 * Raise a "Request new …" submission. RLS requires requested_by = auth.uid()
 * and status = 'pending'. Returns the new request id.
 */
export async function requestNewMaster(
  masterType: MasterType,
  payload: Record<string, unknown>,
  requestedBy: string
): Promise<string> {
  const { data, error } = await supabase
    .from("fms_purchase_master_requests")
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

/**
 * Resolve a master request via the SECURITY DEFINER RPC: approve (creates the
 * real master row from the payload) or reject. Returns the new master id (or
 * null on reject).
 */
export async function resolveMasterRequest(
  requestId: string,
  approve: boolean,
  payload: Record<string, unknown> | null,
  note: string | null
): Promise<string | null> {
  const { data, error } = await supabase.rpc("fms_purchase_resolve_master_request", {
    p_request_id: requestId,
    p_approve: approve,
    p_payload: payload === null ? undefined : (payload as unknown as Json),
    p_note: note ?? undefined,
  });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

/* ------------------------------ step owners ------------------------------- */
export interface StepOwnerInput {
  /** Departments whose employees may own this step (UI filter; may span several). */
  departmentIds: string[];
  designationId: string | null;
  employeeIds: string[];
}

/** Upsert the owners for a workflow step (admin-only under RLS). */
export async function setStepOwner(stepKey: string, input: StepOwnerInput): Promise<void> {
  const { error } = await supabase.from("fms_purchase_step_owners").upsert(
    {
      step_key: stepKey,
      department_ids: input.departmentIds,
      // Legacy single column kept in sync when exactly one department is chosen.
      department_id: input.departmentIds.length === 1 ? input.departmentIds[0] : null,
      designation_id: input.designationId,
      employee_ids: input.employeeIds,
    },
    { onConflict: "step_key" }
  );
  if (error) throw new Error(error.message);
}

/* ---------------------------- approval matrix ----------------------------- */
export interface ApprovalBandInput {
  tierLabel: string;
  minAmount: number;
  maxAmount: number | null;
  approverUserId: string;
  sortOrder: number;
  active: boolean;
}

export async function insertApprovalBand(input: ApprovalBandInput): Promise<string> {
  const { data, error } = await supabase
    .from("fms_purchase_approval_matrix")
    .insert({
      tier_label: input.tierLabel,
      min_amount: input.minAmount,
      max_amount: input.maxAmount,
      approver_user_id: input.approverUserId,
      sort_order: input.sortOrder,
      active: input.active,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function updateApprovalBand(id: string, input: ApprovalBandInput): Promise<void> {
  const { error } = await supabase
    .from("fms_purchase_approval_matrix")
    .update({
      tier_label: input.tierLabel,
      min_amount: input.minAmount,
      max_amount: input.maxAmount,
      approver_user_id: input.approverUserId,
      sort_order: input.sortOrder,
      active: input.active,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteApprovalBand(id: string): Promise<void> {
  const { error } = await supabase.from("fms_purchase_approval_matrix").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/* -------------------------------- config ---------------------------------- */
/** Upsert a singleton config key (admin-only under RLS). */
export async function setConfig(key: string, value: Record<string, unknown>): Promise<void> {
  const { error } = await supabase
    .from("fms_purchase_config")
    .upsert({ key, value: value as unknown as Json }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

/* ===================== workflow RPCs (Stages 1–4) ======================== */

export interface NewRequestLine {
  itemId: string;
  quantity: number;
  unit: string;
  lineRemark: string | null;
}

/** Stage 1 — submit a request with its item lines. Returns the request id. */
export async function submitRequest(input: {
  companyId: string;
  categoryId: string;
  note: string | null;
  items: NewRequestLine[];
}): Promise<string> {
  const { data, error } = await supabase.rpc("fms_purchase_submit_request", {
    p_company_id: input.companyId,
    p_category_id: input.categoryId,
    p_note: input.note ?? "",
    p_items: input.items.map((l) => ({
      item_id: l.itemId,
      quantity: l.quantity,
      unit: l.unit,
      line_remark: l.lineRemark ?? "",
    })) as unknown as Json,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export interface QuotationInput {
  vendorId: string;
  rate: number;
  gstPct: number | null;
  leadTimeDays: number | null;
  remark: string | null;
}

/** Stage 2 — save sourcing for one line (quotations + recommendation + final qty/rate). */
export async function saveSourcing(input: {
  requestItemId: string;
  quotations: QuotationInput[];
  recommendedVendorId: string;
  finalQty: number;
  finalRate: number;
  gstPct: number | null;
  sourcingReason: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc("fms_purchase_save_sourcing", {
    p_request_item_id: input.requestItemId,
    p_quotations: input.quotations.map((q) => ({
      vendor_id: q.vendorId,
      rate: q.rate,
      gst_pct: q.gstPct ?? "",
      lead_time_days: q.leadTimeDays ?? "",
      remark: q.remark ?? "",
    })) as unknown as Json,
    p_recommended_vendor_id: input.recommendedVendorId,
    p_final_qty: input.finalQty,
    p_final_rate: input.finalRate,
    p_gst_pct: input.gstPct ?? undefined,
    p_sourcing_reason: input.sourcingReason ?? undefined,
  });
  if (error) throw new Error(error.message);
}

export type ApprovalDecision = "approve" | "override" | "reject" | "hold" | "resume";

/** Stage 3 — record an approval decision for one line. */
export async function decideApproval(input: {
  requestItemId: string;
  decision: ApprovalDecision;
  overrideVendorId?: string | null;
  reason?: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc("fms_purchase_decide_approval", {
    p_request_item_id: input.requestItemId,
    p_decision: input.decision,
    p_override_vendor_id: input.overrideVendorId ?? undefined,
    p_reason: input.reason ?? undefined,
  });
  if (error) throw new Error(error.message);
}

/** Stage 4 — generate a vendor × company PO from chosen approved lines. Returns the PO id. */
export async function generatePo(input: {
  vendorId: string;
  companyId: string;
  requestItemIds: string[];
  poNo?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("fms_purchase_generate_po", {
    p_vendor_id: input.vendorId,
    p_company_id: input.companyId,
    p_request_item_ids: input.requestItemIds,
    p_po_no: input.poNo ?? undefined,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Cancel a pool/sourcing/approval line (with reason). */
export async function cancelLine(requestItemId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("fms_purchase_cancel_line", {
    p_request_item_id: requestItemId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

/* ===================== PO lifecycle RPCs (Stages 5–10) =================== */

export async function sharePo(
  poId: string,
  documentPath?: string | null,
  documentName?: string | null,
  tallyPoNo?: string | null,
  remarks?: string | null,
  paymentTerms?: string | null,
  dispatchDate?: string | null,
): Promise<void> {
  const { error } = await supabase.rpc("fms_purchase_share_po", {
    p_po_id: poId,
    p_document_path: documentPath ?? undefined,
    p_document_name: documentName ?? undefined,
    p_tally_po_no: tallyPoNo ?? undefined,
    p_remarks: remarks ?? undefined,
    p_payment_terms: paymentTerms ?? undefined,
    p_dispatch_date: dispatchDate ?? undefined,
  });
  if (error) throw new Error(error.message);
}

export interface PiItemInput {
  poItemId: string;
  qty: number;
}

export async function addPi(input: {
  poId: string;
  vendorPiNo: string;
  piValue: number;
  items: PiItemInput[];
  documentPath?: string | null;
  documentName?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("fms_purchase_add_pi", {
    p_po_id: input.poId,
    p_vendor_pi_no: input.vendorPiNo,
    p_pi_value: input.piValue,
    p_items: input.items.map((i) => ({ po_item_id: i.poItemId, qty: i.qty })) as unknown as Json,
    p_document_path: input.documentPath ?? undefined,
    p_document_name: input.documentName ?? undefined,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

const PI_DOCS_BUCKET = "fms-purchase-docs";

/**
 * Upload a Vendor PI document (PDF or any file) to the private
 * `fms-purchase-docs` bucket. Returns the stored object path + original name
 * to persist on the PI row. Object key is namespaced by PO so a vendor's files
 * stay grouped and never collide.
 */
export async function uploadPiDocument(poId: string, file: File): Promise<{ path: string; name: string }> {
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${poId}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage
    .from(PI_DOCS_BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || undefined });
  if (error) throw new Error(error.message);
  return { path, name: file.name };
}

/** Create a short-lived signed URL to view/download a stored PI document. */
export async function piDocumentUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(PI_DOCS_BUCKET).createSignedUrl(path, 60 * 10);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

/**
 * Upload the PO PDF (generated in the ERP/Tally, sent to the vendor) to the same
 * private `fms-purchase-docs` bucket, under a `po/<poId>/` prefix so PO PDFs stay
 * separate from vendor PI files. Returns the stored path + original name.
 */
export async function uploadPoDocument(poId: string, file: File): Promise<{ path: string; name: string }> {
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `po/${poId}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage
    .from(PI_DOCS_BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || undefined });
  if (error) throw new Error(error.message);
  return { path, name: file.name };
}

/** Create a short-lived signed URL to view/download a stored PO document. */
export async function poDocumentUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(PI_DOCS_BUCKET).createSignedUrl(path, 60 * 10);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

export async function recordPayment(input: {
  poId: string;
  piId: string | null;
  kind: "advance" | "installment";
  amount: number;
  paidOn: string | null;
  utrRef: string | null;
  piRemarks?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("fms_purchase_record_payment", {
    p_po_id: input.poId,
    p_pi_id: input.piId ?? undefined,
    p_kind: input.kind,
    p_amount: input.amount,
    p_paid_on: input.paidOn ?? undefined,
    p_utr: input.utrRef ?? undefined,
    p_pi_remarks: input.piRemarks ?? undefined,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function recordFollowup(input: {
  poId: string;
  dispatchStatus: string;
  actualDispatchDate: string | null;
  lrNo: string | null;
  transportDetails: string | null;
  revisedDispatchDate: string | null;
  remarks: string | null;
  piRemarks?: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc("fms_purchase_record_followup", {
    p_po_id: input.poId,
    p_dispatch_status: input.dispatchStatus,
    p_actual_dispatch_date: input.actualDispatchDate ?? undefined,
    p_lr_no: input.lrNo ?? undefined,
    p_transport: input.transportDetails ?? undefined,
    p_revised_dispatch_date: input.revisedDispatchDate ?? undefined,
    p_remarks: input.remarks ?? undefined,
    p_pi_remarks: input.piRemarks ?? undefined,
  });
  if (error) throw new Error(error.message);
}

export interface GrnItemInput {
  poItemId: string;
  receivedQty: number;
  condition: string;
}

export async function recordGrn(input: {
  poId: string;
  piId: string | null;
  poRef?: string | null;
  piRef?: string | null;
  gateRegisterNo: string | null;
  condition: string;
  note: string | null;
  items: GrnItemInput[];
  photoPath?: string | null;
  photoName?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("fms_purchase_record_grn", {
    p_po_id: input.poId,
    p_pi_id: input.piId ?? undefined,
    p_po_ref: input.poRef ?? undefined,
    p_pi_ref: input.piRef ?? undefined,
    p_gate_register_no: input.gateRegisterNo ?? undefined,
    p_condition: input.condition,
    p_note: input.note ?? undefined,
    p_items: input.items.map((i) => ({ po_item_id: i.poItemId, received_qty: i.receivedQty, condition: i.condition })) as unknown as Json,
    p_photo_path: input.photoPath ?? undefined,
    p_photo_name: input.photoName ?? undefined,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Upload a GRN photo (e.g. of damaged goods) to the shared docs bucket. */
export async function uploadGrnPhoto(poId: string, file: File): Promise<{ path: string; name: string }> {
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${poId}/grn/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage
    .from(PI_DOCS_BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || undefined });
  if (error) throw new Error(error.message);
  return { path, name: file.name };
}

export async function grnPhotoUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(PI_DOCS_BUCKET).createSignedUrl(path, 60 * 10);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

export async function bookTally(input: {
  poId: string;
  grnId: string | null;
  tallyPiNo: string;
  documentPath?: string | null;
  documentName?: string | null;
  remarks?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("fms_purchase_book_tally", {
    p_po_id: input.poId,
    p_grn_id: input.grnId ?? undefined,
    p_tally_pi_no: input.tallyPiNo,
    p_document_path: input.documentPath ?? undefined,
    p_document_name: input.documentName ?? undefined,
    p_remarks: input.remarks ?? undefined,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Upload the Tally invoice document to the shared docs bucket (`tally/<poId>/`). */
export async function uploadTallyDocument(poId: string, file: File): Promise<{ path: string; name: string }> {
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${poId}/tally/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage
    .from(PI_DOCS_BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || undefined });
  if (error) throw new Error(error.message);
  return { path, name: file.name };
}

/** Create a short-lived signed URL to view/download a stored Tally invoice. */
export async function tallyDocumentUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(PI_DOCS_BUCKET).createSignedUrl(path, 60 * 10);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

/* ================= activity + notifications (Phase 5) =================== */

export type ProcEntity = "request" | "line" | "po" | "pi" | "grn" | "payment";

/**
 * Write one activity row (actor = signed-in user) and fan a notification out to
 * `recipients` via the SECURITY DEFINER `fms_purchase_announce` RPC. Recipients
 * equal to the actor are skipped server-side. Best-effort: callers should not
 * let a failure here roll back the workflow action that already succeeded.
 */
export async function announce(input: {
  entityType: ProcEntity;
  entityId: string;
  type: string;
  text: string;
  recipients?: string[];
  meta?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabase.rpc("fms_purchase_announce", {
    p_entity_type: input.entityType,
    p_entity_id: input.entityId,
    p_type: input.type,
    p_text: input.text,
    p_user_ids: input.recipients ?? [],
    p_meta: (input.meta ?? {}) as unknown as Json,
  });
  if (error) throw new Error(error.message);
}

/** Reassign an approval line to a specific approver (coordinator/admin only). */
export async function reassignLine(input: { requestItemId: string; approverId: string; note: string | null }): Promise<void> {
  const { error } = await supabase.rpc("fms_purchase_reassign_line", {
    p_request_item_id: input.requestItemId,
    p_approver_id: input.approverId,
    p_note: input.note ?? undefined,
  });
  if (error) throw new Error(error.message);
}

/** Mark the given notifications read (RLS limits the update to the caller's rows). */
export async function markNotificationsRead(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase
    .from("fms_purchase_notifications")
    .update({ read_at: new Date().toISOString() })
    .in("id", ids);
  if (error) throw new Error(error.message);
}
