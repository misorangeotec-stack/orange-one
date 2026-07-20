import { supabase } from "@/core/platform/supabase";
// fms_import_* tables are not yet in the generated Database types; route table/rpc
// calls through an untyped alias (the row mappers below already treat rows as any).
/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabase as any;
import type { Json } from "@/core/platform/database.types";
import type { MasterType } from "../types";

/**
 * Import write layer (masters + governance). Each function performs one
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
  const { data, error } = await db
    .from("fms_import_companies")
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
  const { error } = await db
    .from("fms_import_companies")
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
  const { data, error } = await db
    .from("fms_import_categories")
    .insert({ name: input.name, active: input.active, sort_order: input.sortOrder, created_by: input.createdBy })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function updateCategory(id: string, input: CategoryInput): Promise<void> {
  const { error } = await db
    .from("fms_import_categories")
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
  const { data, error } = await db
    .from("fms_import_item_groups")
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
  const { error } = await db
    .from("fms_import_item_groups")
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
  const { data, error } = await db
    .from("fms_import_items")
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
  const { error } = await db
    .from("fms_import_items")
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
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  defaultCurrency: string | null;
  active: boolean;
}

export async function insertVendor(input: VendorInput & { createdBy: string }): Promise<string> {
  const { data, error } = await db
    .from("fms_import_vendors")
    .insert({
      name: input.name,
      contact_name: input.contactName,
      phone: input.phone,
      email: input.email,
      address: input.address,
      default_currency: input.defaultCurrency,
      active: input.active,
      created_by: input.createdBy,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function updateVendor(id: string, input: VendorInput): Promise<void> {
  const { error } = await db
    .from("fms_import_vendors")
    .update({
      name: input.name,
      contact_name: input.contactName,
      phone: input.phone,
      email: input.email,
      address: input.address,
      default_currency: input.defaultCurrency,
      active: input.active,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/* -------------------------- vendor-item prices ---------------------------- */
export interface VendorItemPriceInput {
  vendorId: string;
  itemId: string;
  currency: string;
  rate: number;
  active: boolean;
  sortOrder: number;
}

export async function insertVendorItemPrice(input: VendorItemPriceInput & { createdBy: string }): Promise<string> {
  const { data, error } = await db
    .from("fms_import_vendor_item_prices")
    .insert({
      vendor_id: input.vendorId,
      item_id: input.itemId,
      currency: input.currency,
      rate: input.rate,
      active: input.active,
      sort_order: input.sortOrder,
      created_by: input.createdBy,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

/**
 * Save a price straight from the New Request grid ("save to price list").
 * The table is unique (vendor_id, item_id), so a plain insert would 23505 the
 * moment someone re-prices an item — upsert instead. sort_order is deliberately
 * left untouched so an existing row keeps its place in the Masters list.
 * RLS restricts this to admins and vendor_item_price managers.
 */
export async function upsertVendorItemPrice(input: {
  vendorId: string;
  itemId: string;
  currency: string;
  rate: number;
  createdBy: string;
}): Promise<void> {
  const { error } = await db.from("fms_import_vendor_item_prices").upsert(
    {
      vendor_id: input.vendorId,
      item_id: input.itemId,
      currency: input.currency,
      rate: input.rate,
      active: true,
      created_by: input.createdBy,
    },
    { onConflict: "vendor_id,item_id" }
  );
  if (error) throw new Error(error.message);
}

export async function updateVendorItemPrice(id: string, input: VendorItemPriceInput): Promise<void> {
  const { error } = await db
    .from("fms_import_vendor_item_prices")
    .update({
      vendor_id: input.vendorId,
      item_id: input.itemId,
      currency: input.currency,
      rate: input.rate,
      active: input.active,
      sort_order: input.sortOrder,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/* ------------------------------ live FX rate ------------------------------ */
/**
 * Fetch a live foreign→INR rate via the `import-fx-rate` Edge Function
 * (xe.com scrape + FX-API fallback, server-side). Returns the rate + its source
 * so the UI can show provenance; the value is always editable by hand.
 */
export async function fetchFxRate(from: string, to = "INR"): Promise<{ rate: number; source: string; fetchedAt: string }> {
  const { data, error } = await supabase.functions.invoke("import-fx-rate", { body: { from, to } });
  if (error) throw new Error(error.message);
  const d = data as { rate?: number; source?: string; fetched_at?: string; error?: string };
  if (!d || typeof d.rate !== "number" || d.error) throw new Error(d?.error || "Could not fetch a live rate");
  return { rate: d.rate, source: d.source ?? "unknown", fetchedAt: d.fetched_at ?? new Date().toISOString() };
}

/* ---------------------------- master managers ----------------------------- */
/**
 * Replace the set of managers for a master type (admin-only under RLS): delete
 * the rows for that type, then insert the chosen user ids. Done as delete+insert
 * (not upsert) so removing a manager actually drops the row.
 */
export async function setMasterManagers(masterType: MasterType, userIds: string[]): Promise<void> {
  const { error: delErr } = await db
    .from("fms_import_master_managers")
    .delete()
    .eq("master_type", masterType);
  if (delErr) throw new Error(delErr.message);
  if (userIds.length) {
    const { error: insErr } = await db
      .from("fms_import_master_managers")
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
  const { data, error } = await db
    .from("fms_import_master_requests")
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
  const { data, error } = await db.rpc("fms_import_resolve_master_request", {
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
  const { error } = await db.from("fms_import_step_owners").upsert(
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
  const { data, error } = await db
    .from("fms_import_approval_matrix")
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
  const { error } = await db
    .from("fms_import_approval_matrix")
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
  const { error } = await db.from("fms_import_approval_matrix").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/* -------------------------------- config ---------------------------------- */
/** Upsert a singleton config key (admin-only under RLS). */
export async function setConfig(key: string, value: Record<string, unknown>): Promise<void> {
  const { error } = await db
    .from("fms_import_config")
    .upsert({ key, value: value as unknown as Json }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

/* ===================== workflow RPCs (Stages 1–4) ======================== */

export interface NewRequestLine {
  itemId: string;
  /** Category of THIS line — a request may mix categories across its lines. */
  categoryId: string;
  quantity: number;
  unit: string;
  /** Rate in the vendor's foreign currency (auto-filled from the price master, editable). */
  rate: number;
  lineRemark: string | null;
}

/**
 * Stage 1 — submit an import request. The vendor is chosen on the header (fixed),
 * each line carries its foreign-currency rate, and a request-time FX rate lets
 * the server derive the INR line value that routes the approval tier. No sourcing.
 * Returns the request id.
 */
export async function submitRequest(input: {
  companyId: string;
  vendorId: string;
  /** Header category. Pass null to let the server take the FIRST line's — the
   *  header column is NOT NULL and exists only so pre-existing reads keep working. */
  categoryId: string | null;
  currency: string;
  fxRate: number;
  note: string | null;
  items: NewRequestLine[];
}): Promise<string> {
  const { data, error } = await db.rpc("fms_import_submit_request", {
    p_company_id: input.companyId,
    p_vendor_id: input.vendorId,
    p_category_id: input.categoryId,
    p_note: input.note ?? "",
    p_currency: input.currency,
    p_fx_rate: input.fxRate,
    p_items: input.items.map((l) => ({
      item_id: l.itemId,
      category_id: l.categoryId,
      quantity: l.quantity,
      unit: l.unit,
      rate: l.rate,
      line_remark: l.lineRemark ?? "",
    })) as unknown as Json,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/** A line as sent to `fms_import_update_request`. `id` null ⇒ a brand-new line. */
export interface EditRequestLine extends NewRequestLine {
  /** The existing `fms_import_request_items.id`, or null for a row just added. */
  id: string | null;
}

/**
 * Correct a request the requester already submitted. Only legal while the
 * request is open and EVERY line is still awaiting approval — the RPC re-checks
 * that server-side and raises if not, so this can be called optimistically.
 *
 * Lines are matched by `id`: an existing line is updated in place (keeping its
 * history, SLA anchor and any manual approver routing), a null-id line is
 * inserted, and any line omitted from `items` is removed.
 */
export async function updateRequest(input: {
  requestId: string;
  note: string | null;
  fxRate: number;
  items: EditRequestLine[];
}): Promise<void> {
  const { error } = await db.rpc("fms_import_update_request", {
    p_request_id: input.requestId,
    p_note: input.note ?? "",
    p_fx_rate: input.fxRate,
    p_items: input.items.map((l) => ({
      id: l.id,
      item_id: l.itemId,
      category_id: l.categoryId,
      quantity: l.quantity,
      unit: l.unit,
      rate: l.rate,
      line_remark: l.lineRemark ?? "",
    })) as unknown as Json,
  });
  if (error) throw new Error(error.message);
}

/**
 * Cancel a whole request (requester or admin, pre-approval only). The request is
 * KEPT and marked cancelled — never hard-deleted. The RPC also cascades every
 * still-open line to cancelled, which is what actually removes it from the
 * approver's queue; the header status alone is read by nothing.
 */
export async function cancelRequest(requestId: string, reason: string): Promise<void> {
  const { error } = await db.rpc("fms_import_cancel_request", {
    p_request_id: requestId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

export interface QuotationInput {
  vendorId: string;
  rate: number;
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
  sourcingReason: string | null;
}): Promise<void> {
  const { error } = await db.rpc("fms_import_save_sourcing", {
    p_request_item_id: input.requestItemId,
    p_quotations: input.quotations.map((q) => ({
      vendor_id: q.vendorId,
      rate: q.rate,
      lead_time_days: q.leadTimeDays ?? "",
      remark: q.remark ?? "",
    })) as unknown as Json,
    p_recommended_vendor_id: input.recommendedVendorId,
    p_final_qty: input.finalQty,
    p_final_rate: input.finalRate,
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
  const { error } = await db.rpc("fms_import_decide_approval", {
    p_request_item_id: input.requestItemId,
    p_decision: input.decision,
    p_override_vendor_id: input.overrideVendorId ?? undefined,
    p_reason: input.reason ?? undefined,
  });
  if (error) throw new Error(error.message);
}

/**
 * Stage 3 — one decision for the WHOLE requisition, banded on its total. The
 * request-scoped twin of `decideApproval`; the RPC refuses 'override' (Import
 * has no quoted vendors).
 */
export async function decideApprovalRequest(input: {
  requestId: string;
  decision: ApprovalDecision;
  overrideVendorId?: string | null;
  reason?: string | null;
  /** For `override`: revised rates (vendor's foreign currency) per line. */
  rates?: { requestItemId: string; rate: number }[] | null;
}): Promise<void> {
  const { error } = await db.rpc("fms_import_decide_approval_request", {
    p_request_id: input.requestId,
    p_decision: input.decision,
    p_override_vendor_id: input.overrideVendorId ?? undefined,
    p_reason: input.reason ?? undefined,
    p_rates: input.rates ? input.rates.map((r) => ({ request_item_id: r.requestItemId, rate: r.rate })) : undefined,
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
  const { data, error } = await db.rpc("fms_import_generate_po", {
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
  const { error } = await db.rpc("fms_import_cancel_line", {
    p_request_item_id: requestItemId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

/* ===================== PO cancellation (vendor-requested) ================= */

/** A PO-side step owner logs the vendor's request to cancel a PO. Returns the request id. */
export async function requestPoCancel(poId: string, reason: string, vendorRef?: string | null): Promise<string> {
  const { data, error } = await db.rpc("fms_import_request_po_cancel", {
    p_po_id: poId,
    p_reason: reason,
    p_vendor_ref: vendorRef ?? undefined,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Approver-only — cancel a PO (optionally resolving the logged request). */
export async function cancelPo(poId: string, reason: string, requestId?: string | null): Promise<void> {
  const { error } = await db.rpc("fms_import_cancel_po", {
    p_po_id: poId,
    p_reason: reason,
    p_request_id: requestId ?? undefined,
  });
  if (error) throw new Error(error.message);
}

/** Approver-only — decline a cancellation request; the PO stays open. */
export async function declinePoCancel(requestId: string, note?: string | null): Promise<void> {
  const { error } = await db.rpc("fms_import_decline_po_cancel", {
    p_request_id: requestId,
    p_note: note ?? undefined,
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
  const { error } = await db.rpc("fms_import_share_po", {
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
  const { data, error } = await db.rpc("fms_import_add_pi", {
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

const PI_DOCS_BUCKET = "fms-import-docs";

/**
 * Upload a Vendor PI document (PDF or any file) to the private
 * `fms-import-docs` bucket. Returns the stored object path + original name
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
 * private `fms-import-docs` bucket, under a `po/<poId>/` prefix so PO PDFs stay
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
  /** INR value paid (caps against the PO's INR total). */
  amount: number;
  /** Vendor-currency amount actually paid. */
  amountFx?: number | null;
  currency?: string | null;
  fxRate?: number | null;
  details?: string | null;
  advicePath?: string | null;
  adviceName?: string | null;
  paidOn: string | null;
  utrRef: string | null;
  piRemarks?: string | null;
}): Promise<string> {
  const { data, error } = await db.rpc("fms_import_record_payment", {
    p_po_id: input.poId,
    p_pi_id: input.piId ?? undefined,
    p_kind: input.kind,
    p_amount: input.amount,
    p_paid_on: input.paidOn ?? undefined,
    p_utr: input.utrRef ?? undefined,
    p_pi_remarks: input.piRemarks ?? undefined,
    p_currency: input.currency ?? undefined,
    p_fx_rate: input.fxRate ?? undefined,
    p_amount_fx: input.amountFx ?? undefined,
    p_details: input.details ?? undefined,
    p_advice_path: input.advicePath ?? undefined,
    p_advice_name: input.adviceName ?? undefined,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Upload a payment-advice document to the private docs bucket (`payment/<poId>/`). */
export async function uploadPaymentAdvice(poId: string, file: File): Promise<{ path: string; name: string }> {
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `payment/${poId}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage
    .from(PI_DOCS_BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || undefined });
  if (error) throw new Error(error.message);
  return { path, name: file.name };
}

/** Create a short-lived signed URL to view/download a stored payment advice. */
export async function paymentAdviceUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(PI_DOCS_BUCKET).createSignedUrl(path, 60 * 10);
  if (error) throw new Error(error.message);
  return data.signedUrl;
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
  const { error } = await db.rpc("fms_import_record_followup", {
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
  const { data, error } = await db.rpc("fms_import_record_grn", {
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
  const { data, error } = await db.rpc("fms_import_book_tally", {
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

export type ImportEntity = "request" | "line" | "po" | "pi" | "grn" | "payment" | "master_request";

/**
 * Write one activity row (actor = signed-in user) and fan a notification out to
 * `recipients` via the SECURITY DEFINER `fms_import_announce` RPC. Recipients
 * equal to the actor are skipped server-side. Best-effort: callers should not
 * let a failure here roll back the workflow action that already succeeded.
 */
export async function announce(input: {
  entityType: ImportEntity;
  entityId: string;
  type: string;
  text: string;
  recipients?: string[];
  meta?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await db.rpc("fms_import_announce", {
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
  const { error } = await db.rpc("fms_import_reassign_line", {
    p_request_item_id: input.requestItemId,
    p_approver_id: input.approverId,
    p_note: input.note ?? undefined,
  });
  if (error) throw new Error(error.message);
}

/** Mark the given notifications read (RLS limits the update to the caller's rows). */
export async function markNotificationsRead(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await db
    .from("fms_import_notifications")
    .update({ read_at: new Date().toISOString() })
    .in("id", ids);
  if (error) throw new Error(error.message);
}

/* ------------------------- stage edits (update_*) -------------------------- */
/**
 * Correcting an entry at a stage, until the next step is done.
 *
 * Each of these mirrors a `fms_import_update_<step>` RPC (20260719120000) that
 * re-checks the lock server-side, refuses on a closed/cancelled PO, excludes the
 * edited row from its own cap, and writes its activity row in the same
 * transaction — so, unlike the create wrappers, none of these needs a
 * `safeAnnounce` follow-up call.
 */

export async function updateSharePo(input: {
  poId: string;
  tallyPoNo: string;
  paymentTerms: string;
  dispatchDate: string;
  remarks?: string | null;
  documentPath?: string | null;
  documentName?: string | null;
}): Promise<void> {
  const { error } = await db.rpc("fms_import_update_share_po", {
    p_po_id: input.poId,
    p_tally_po_no: input.tallyPoNo,
    p_payment_terms: input.paymentTerms,
    p_dispatch_date: input.dispatchDate,
    p_remarks: input.remarks ?? undefined,
    p_document_path: input.documentPath ?? undefined,
    p_document_name: input.documentName ?? undefined,
  });
  if (error) throw new Error(error.message);
}

export async function updatePi(input: {
  piId: string;
  vendorPiNo: string;
  items: PiItemInput[];
  piValue: number;
  paymentTerms?: string | null;
  dispatchDate?: string | null;
  documentPath?: string | null;
  documentName?: string | null;
}): Promise<void> {
  const { error } = await db.rpc("fms_import_update_pi", {
    p_pi_id: input.piId,
    p_vendor_pi_no: input.vendorPiNo,
    p_items: input.items.map((i) => ({ po_item_id: i.poItemId, qty: i.qty })) as unknown as Json,
    p_payment_terms: input.paymentTerms ?? undefined,
    p_pi_value: input.piValue,
    p_dispatch_date: input.dispatchDate ?? undefined,
    p_document_path: input.documentPath ?? undefined,
    p_document_name: input.documentName ?? undefined,
  });
  if (error) throw new Error(error.message);
}

/**
 * The cap the RPC applies is on `amountFx` against the PO's foreign value, not on
 * INR — the FX rate at payment is independent of the rate at request, so an INR
 * cap would wrongly reject a full 100% advance after the currency appreciated.
 */
export async function updatePayment(input: {
  paymentId: string;
  amount: number;
  amountFx?: number | null;
  currency?: string | null;
  fxRate?: number | null;
  paidOn?: string | null;
  utrRef?: string | null;
  piRemarks?: string | null;
  details?: string | null;
  advicePath?: string | null;
  adviceName?: string | null;
}): Promise<void> {
  const { error } = await db.rpc("fms_import_update_payment", {
    p_payment_id: input.paymentId,
    p_amount: input.amount,
    p_amount_fx: input.amountFx ?? undefined,
    p_currency: input.currency ?? undefined,
    p_fx_rate: input.fxRate ?? undefined,
    p_paid_on: input.paidOn ?? undefined,
    p_utr: input.utrRef ?? undefined,
    p_pi_remarks: input.piRemarks ?? undefined,
    p_details: input.details ?? undefined,
    p_advice_path: input.advicePath ?? undefined,
    p_advice_name: input.adviceName ?? undefined,
  });
  if (error) throw new Error(error.message);
}

export async function updateFollowup(input: {
  followupId: string;
  dispatchStatus: string;
  actualDispatchDate?: string | null;
  lrNo?: string | null;
  transportDetails?: string | null;
  revisedDispatchDate?: string | null;
  remarks?: string | null;
  piRemarks?: string | null;
}): Promise<void> {
  const { error } = await db.rpc("fms_import_update_followup", {
    p_followup_id: input.followupId,
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

export async function updateGrn(input: {
  grnId: string;
  items: GrnItemInput[];
  poRef: string;
  piRef?: string | null;
  gateRegisterNo?: string | null;
  condition?: string | null;
  note?: string | null;
  photoPath?: string | null;
  photoName?: string | null;
}): Promise<void> {
  const { error } = await db.rpc("fms_import_update_grn", {
    p_grn_id: input.grnId,
    p_items: input.items.map((i) => ({ po_item_id: i.poItemId, received_qty: i.receivedQty, condition: i.condition })) as unknown as Json,
    p_po_ref: input.poRef,
    p_pi_ref: input.piRef ?? undefined,
    p_gate_register_no: input.gateRegisterNo ?? undefined,
    p_condition: input.condition ?? undefined,
    p_note: input.note ?? undefined,
    p_photo_path: input.photoPath ?? undefined,
    p_photo_name: input.photoName ?? undefined,
  });
  if (error) throw new Error(error.message);
}

export async function updateTally(input: {
  bookingId: string;
  tallyPiNo: string;
  documentPath?: string | null;
  documentName?: string | null;
  remarks?: string | null;
}): Promise<void> {
  const { error } = await db.rpc("fms_import_update_tally", {
    p_booking_id: input.bookingId,
    p_tally_pi_no: input.tallyPiNo,
    p_document_path: input.documentPath ?? undefined,
    p_document_name: input.documentName ?? undefined,
    p_remarks: input.remarks ?? undefined,
  });
  if (error) throw new Error(error.message);
}

/** `decision` is 'approve' | 'reject'. Import has no quoted vendors, so the RPC refuses 'override'. */
export async function updateApproval(input: {
  lineId: string;
  decision: string;
  overrideVendorId?: string | null;
  reason?: string | null;
}): Promise<void> {
  const { error } = await db.rpc("fms_import_update_approval", {
    p_line_id: input.lineId,
    p_decision: input.decision,
    p_override_vendor_id: input.overrideVendorId ?? undefined,
    p_reason: input.reason ?? undefined,
  });
  if (error) throw new Error(error.message);
}

/**
 * Correct a whole requisition's approval decision. `decision` is 'approve' |
 * 'reject'; the RPC refuses 'override' and refuses once any line has a PO.
 */
export async function updateApprovalRequest(input: {
  requestId: string;
  decision: string;
  overrideVendorId?: string | null;
  reason?: string | null;
  /** For `override`: revised rates (vendor's foreign currency) per line. */
  rates?: { requestItemId: string; rate: number }[] | null;
}): Promise<void> {
  const { error } = await db.rpc("fms_import_update_approval_request", {
    p_request_id: input.requestId,
    p_decision: input.decision,
    p_override_vendor_id: input.overrideVendorId ?? undefined,
    p_reason: input.reason ?? undefined,
    p_rates: input.rates ? input.rates.map((r) => ({ request_item_id: r.requestItemId, rate: r.rate })) : undefined,
  });
  if (error) throw new Error(error.message);
}

export async function updatePoNo(poId: string, poNo: string): Promise<void> {
  const { error } = await db.rpc("fms_import_update_po_no", { p_po_id: poId, p_po_no: poNo });
  if (error) throw new Error(error.message);
}
