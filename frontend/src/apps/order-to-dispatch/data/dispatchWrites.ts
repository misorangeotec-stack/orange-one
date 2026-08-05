import { supabase } from "@/core/platform/supabase";
// fms_dispatch_* tables/RPCs are not in the generated Database types; route
// through an untyped alias.
const db = supabase as any;
import type { DispatchMasterType, DispatchType } from "../types";
import { isNameless } from "../lib/masterFields";
import type { QueueStep } from "../lib/queues";

/**
 * Order to Dispatch FMS write layer. The masters + config are written directly
 * under RLS (admin / the master's owner). Every WORKFLOW mutation goes through a
 * SECURITY DEFINER RPC that re-checks authorization, validates the transition and
 * stamps the step's timestamp. The wrappers are thin: the DATABASE is the gate.
 */

/* ---------------------------------- orders -------------------------------- */

export interface OrderLineInput {
  itemId: string;
  quantity: string;
  lineRemark: string | null;
}

/**
 * ⚠ `companyId` IS REQUIRED. Which of our entities bills the order is settled
 *   here, at intake, by the person raising it — `fms_dispatch_submit_order`
 *   validates it against the active company master and refuses without one. It
 *   used to be asked two steps later, at the stock check.
 *
 * `customerLocation` is seeded from the customer master but stored on the order
 * as plain text, so a later rename of the master cannot rewrite a consignment
 * that has already gone out. `customerPoNo` is the customer's own reference and
 * is optional.
 */
export interface OrderInput {
  dispatchType: DispatchType;
  companyId: string;
  customerId: string;
  customerLocation: string | null;
  customerPoNo: string | null;
  orderDate: string;
  orderRemarks: string | null;
  requesterName: string;
  lines: OrderLineInput[];
}

const orderPayload = (input: OrderInput) => ({
  dispatch_type: input.dispatchType,
  company_id: input.companyId,
  customer_id: input.customerId,
  customer_location: input.customerLocation ?? "",
  customer_po_no: input.customerPoNo ?? "",
  order_date: input.orderDate ?? "",
  order_remarks: input.orderRemarks ?? "",
  requester_name: input.requesterName,
  // No unit is sent: fms_dispatch_replace_lines reads it off the item, so it is
  // a property of what is going out rather than a per-line choice.
  lines: input.lines.map((l) => ({
    item_id: l.itemId ?? "",
    quantity: l.quantity ?? "",
    line_remark: l.lineRemark ?? "",
  })),
});

/** Raise a sales order. The order number is auto-generated server-side. */
export async function submitOrder(input: OrderInput): Promise<string> {
  const { data, error } = await db.rpc("fms_dispatch_submit_order", { p: orderPayload(input) });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Edit the intake. Server-gated: only while the order is still awaiting the
 *  credit check, and only by the raiser / admin / coordinator. */
export async function updateOrder(orderId: string, input: OrderInput): Promise<void> {
  const { error } = await db.rpc("fms_dispatch_update_order", {
    p_order: orderId,
    p: orderPayload(input),
  });
  if (error) throw new Error(error.message);
}

/* ----------------------------- workflow steps ----------------------------- */

/**
 * A step's captured values, exactly as `lib/stepConfig.ts` keys them — this bag is
 * handed to the RPC verbatim.
 *
 * ⚠ ATTACHMENT CONTRACT: on an edit that keeps the existing file, the caller must
 *   OMIT `*_attachment_path` / `*_attachment_name` entirely. The RPCs read them
 *   with `p ? '<key>'`, so an omitted key preserves the stored file while a blank
 *   string clears it. Sending "" on every edit would wipe the invoice.
 */
export type StepPayload = Record<string, unknown>;

const RECORD_RPC: Record<QueueStep, string> = {
  credit_check: "fms_dispatch_record_credit_check",
  material_status: "fms_dispatch_record_material_status",
  sales_bill: "fms_dispatch_record_sales_bill",
  gate_out: "fms_dispatch_record_gate_out",
  dispatch_confirm: "fms_dispatch_record_dispatch_confirm",
};

const UPDATE_RPC: Record<QueueStep, string> = {
  credit_check: "fms_dispatch_update_credit_check",
  material_status: "fms_dispatch_update_material_status",
  sales_bill: "fms_dispatch_update_sales_bill",
  gate_out: "fms_dispatch_update_gate_out",
  dispatch_confirm: "fms_dispatch_update_dispatch_confirm",
};

export async function recordStep(step: QueueStep, orderId: string, payload: StepPayload): Promise<void> {
  const { error } = await db.rpc(RECORD_RPC[step], { p_order: orderId, p: payload });
  if (error) throw new Error(error.message);
}

export async function updateStep(step: QueueStep, orderId: string, payload: StepPayload): Promise<void> {
  const { error } = await db.rpc(UPDATE_RPC[step], { p_order: orderId, p: payload });
  if (error) throw new Error(error.message);
}

/**
 * "Nothing available yet" — the store checked and found no stock. Records the
 * check and restarts the round's clock WITHOUT moving the order on, so waiting
 * on production reads as waiting rather than as lateness.
 */
export async function materialNothingAvailable(orderId: string, remarks: string): Promise<void> {
  const { error } = await db.rpc("fms_dispatch_material_nothing_available", {
    p_order: orderId, p_remarks: remarks,
  });
  if (error) throw new Error(error.message);
}

export interface AmendRoundLine {
  id: string;
  shipQty: string;
  lotNo?: string | null;
}

/**
 * Correct a FINISHED round — coordinators only. This is how a part return is
 * recorded (mark the round Returned, then set what the customer actually kept)
 * and the only way back from a mis-tapped outcome. The RPC recalculates the
 * delivered totals and re-opens the order if the correction leaves a balance.
 */
export async function amendRound(
  roundId: string,
  input: { dcStatus?: "delivered" | "returned"; reason: string; lines?: AmendRoundLine[] },
): Promise<void> {
  const payload: Record<string, unknown> = { amend_reason: input.reason };
  if (input.dcStatus) payload.dc_status = input.dcStatus;
  if (input.lines?.length) {
    payload.lines = input.lines.map((l) => ({
      id: l.id, ship_qty: l.shipQty, lot_no: l.lotNo ?? "",
    }));
  }
  const { error } = await db.rpc("fms_dispatch_amend_round", { p_round: roundId, p: payload });
  if (error) throw new Error(error.message);
}

export async function holdOrder(orderId: string, hold: boolean, reason: string): Promise<void> {
  const { error } = await db.rpc("fms_dispatch_hold_order", { p_order: orderId, p_hold: hold, p_reason: reason });
  if (error) throw new Error(error.message);
}

export async function cancelOrder(orderId: string, reason: string): Promise<void> {
  const { error } = await db.rpc("fms_dispatch_cancel_order", { p_order: orderId, p_reason: reason });
  if (error) throw new Error(error.message);
}

/**
 * Close an order that will never be completed. Server-gated to the gap BETWEEN
 * rounds — mid-round the goods may already be through the gate, and closing then
 * would leave a consignment that left the plant with no delivery record.
 */
export async function closeOrder(orderId: string, reason: string): Promise<void> {
  const { error } = await db.rpc("fms_dispatch_close_order", { p_order: orderId, p_reason: reason });
  if (error) throw new Error(error.message);
}

/* ------------------------------- documents -------------------------------- */

const DOCS_BUCKET = "fms-dispatch-docs";

/**
 * Upload a step attachment; returns the stored path + name.
 *
 * The round number is in the path purely so the bucket stays legible once an
 * order has several invoices — uniqueness already came from the timestamp. Files
 * from earlier rounds are never deleted: the archive still points at them.
 */
export async function uploadStepDocument(
  orderId: string,
  folder: string,
  file: File,
  roundNo = 1,
): Promise<{ path: string; name: string }> {
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${orderId}/r${roundNo}/${folder}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage
    .from(DOCS_BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || undefined });
  if (error) throw new Error(error.message);
  return { path, name: file.name };
}

/** Create a short-lived signed URL to view/download a stored document. */
export async function stepDocumentUrl(path: string): Promise<string> {
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
  const { error } = await db.from("fms_dispatch_step_owners").upsert(
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
  const { error } = await db.from("fms_dispatch_config").upsert({ key, value }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

/* --------------------------------- masters -------------------------------- */

const MASTER_TABLE: Record<DispatchMasterType, string> = {
  company: "fms_dispatch_companies",
  customer: "fms_dispatch_customers",
  item: "fms_dispatch_items",
  customer_item: "fms_dispatch_customer_items",
};

/**
 * The base MasterCrud contract plus whatever extra columns that master carries.
 * `extra` keys are already snake_case column names — built by the Masters page
 * from the same lib/masterFields.ts schema the request RPC reads.
 */
export interface MasterInput {
  name: string;
  active: boolean;
  sortOrder: number;
  extra?: Record<string, unknown>;
}

/**
 * ⚠ `name` is OMITTED for a nameless master. fms_dispatch_customer_items has no
 *   name column, so including it fails every insert and update with "column
 *   does not exist" — the pair IS the record.
 */
const masterRow = (mt: DispatchMasterType, input: MasterInput) => ({
  ...(isNameless(mt) ? {} : { name: input.name }),
  active: input.active,
  sort_order: input.sortOrder,
  ...(input.extra ?? {}),
});

export async function insertMaster(mt: DispatchMasterType, input: MasterInput): Promise<void> {
  const { error } = await db.from(MASTER_TABLE[mt]).insert(masterRow(mt, input));
  if (error) throw new Error(error.message);
}

export async function updateMaster(mt: DispatchMasterType, id: string, input: MasterInput): Promise<void> {
  const { error } = await db.from(MASTER_TABLE[mt]).update(masterRow(mt, input)).eq("id", id);
  if (error) throw new Error(error.message);
}

/* ============================ MASTER GOVERNANCE ========================== */

export async function setMasterManagers(masterType: DispatchMasterType, userIds: string[]): Promise<void> {
  const { error: delError } = await db
    .from("fms_dispatch_master_managers")
    .delete()
    .eq("master_type", masterType);
  if (delError) throw new Error(delError.message);

  if (userIds.length === 0) return;
  const { error } = await db
    .from("fms_dispatch_master_managers")
    .insert(userIds.map((id) => ({ master_type: masterType, manager_user_id: id })));
  if (error) throw new Error(error.message);
}

/**
 * Raise a "Request new …" submission. RLS requires requested_by = auth.uid(), so
 * `requestedBy` must be the REAL session user id — never an impersonated persona,
 * or the insert is silently rejected.
 */
export async function requestNewMaster(
  masterType: DispatchMasterType,
  payload: Record<string, unknown>,
  requestedBy: string,
): Promise<string> {
  const { data, error } = await db
    .from("fms_dispatch_master_requests")
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
  const { data, error } = await db.rpc("fms_dispatch_resolve_master_request", {
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
  entityType: "order" | "master_request";
  entityId: string;
  type: string;
  text: string;
  recipients?: string[];
  meta?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await db.rpc("fms_dispatch_announce", {
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
    .from("fms_dispatch_notifications")
    .update({ read_at: new Date().toISOString() })
    .in("id", ids)
    .is("read_at", null);
  if (error) throw new Error(error.message);
}
