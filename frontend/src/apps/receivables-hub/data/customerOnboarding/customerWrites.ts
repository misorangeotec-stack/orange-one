/**
 * Customer Creation FMS — every write, one thin wrapper per RPC.
 *
 * ⚠ THE DATABASE IS THE GATE. Each wrapper below is deliberately dumb: it
 *   forwards a payload and surfaces the error message. Authorization, transition
 *   validity and the step stamp all live in the SECURITY DEFINER RPC. Do not add
 *   "helpful" client-side branching here — it will drift from the server and the
 *   server is what decides.
 *
 * ⚠ NOTHING IN THIS FILE MAY WRITE TO fms_dispatch_*. Order-to-Dispatch sources
 *   its customer data elsewhere; there is no push helper by design (28-Jul-2026).
 *
 * Two classes of write:
 *   • Config and step owners go DIRECT under RLS (admin-only policies).
 *   • Every workflow transition goes through an RPC.
 */
import { supabase } from "@/core/platform/supabase";
import type { DocSlot } from "@hub/lib/customerOnboarding/types";

const db = supabase as any;

/** Unwrap a PostgREST error into the message the RPC actually raised. */
function boom(error: { message?: string } | null, fallback: string): never {
  throw new Error(error?.message || fallback);
}

/* ── The sales-side form ──────────────────────────────────────────────── */

/**
 * Create (p_req null) or update a draft. Returns the request id.
 *
 * The caller must hold the returned id in a ref and pass it back on every
 * subsequent autosave — otherwise each keystroke debounce mints a new draft row.
 */
export async function saveDraft(payload: Record<string, unknown>, requestId?: string | null): Promise<string> {
  const { data, error } = await db.rpc("fms_customer_save_draft", {
    p: payload,
    p_req: requestId ?? null,
  });
  if (error) boom(error, "Could not save the draft");
  return data as string;
}

/**
 * ⚠ The caller MUST delete <requestId>/** from the bucket BEFORE calling this —
 *   storage does not cascade from a table. removeCustomerDocs() below does it.
 */
export async function deleteDraft(requestId: string): Promise<void> {
  const { error } = await db.rpc("fms_customer_delete_draft", { p_req: requestId });
  if (error) boom(error, "Could not delete the draft");
}

/** Returns the assigned CUST-2627-#### number. */
export async function submitRequest(requestId: string): Promise<string> {
  const { data, error } = await db.rpc("fms_customer_submit_request", { p_req: requestId });
  if (error) boom(error, "Could not submit the request");
  return data as string;
}

/** Edit after submission — allowed in rework, or with Accounts before they stamp. */
export async function updateRequest(requestId: string, payload: Record<string, unknown>): Promise<void> {
  const { error } = await db.rpc("fms_customer_update_request", { p_req: requestId, p: payload });
  if (error) boom(error, "Could not save the changes");
}

/* ── The approval chain ───────────────────────────────────────────────── */

export interface AccountsInput {
  gstVerified: boolean | null;
  refsVerified: boolean | null;
  recommendedLimit: string;
  recommendedDays: string;
  remarks: string;
  verifiedDate: string;
  decision: "forward" | "reject" | "rework";
}

export async function decideAccounts(requestId: string, input: AccountsInput): Promise<void> {
  const { error } = await db.rpc("fms_customer_decide_accounts", {
    p_req: requestId,
    p: {
      gst_verified: input.gstVerified,
      refs_verified: input.refsVerified,
      recommended_limit: input.recommendedLimit,
      recommended_days: input.recommendedDays,
      remarks: input.remarks,
      verified_date: input.verifiedDate,
      decision: input.decision,
    },
  });
  if (error) boom(error, "Could not record the verification");
}

export interface SalesHeadInput {
  customerCategory: string;
  businessPotential: string;
  decision: "approve" | "reject" | "rework";
  forceDirector: boolean;
  remarks: string;
  decidedDate: string;
}

export async function decideSalesHead(requestId: string, input: SalesHeadInput): Promise<void> {
  const { error } = await db.rpc("fms_customer_decide_sales_head", {
    p_req: requestId,
    p: {
      customer_category: input.customerCategory,
      business_potential: input.businessPotential,
      decision: input.decision,
      force_director: input.forceDirector,
      remarks: input.remarks,
      decided_date: input.decidedDate,
    },
  });
  if (error) boom(error, "Could not record the decision");
}

export interface DirectorInput {
  decision: "approve" | "reject" | "rework";
  remarks: string;
  decidedDate: string;
}

export async function decideDirector(requestId: string, input: DirectorInput): Promise<void> {
  const { error } = await db.rpc("fms_customer_decide_director", {
    p_req: requestId,
    p: { decision: input.decision, remarks: input.remarks, decided_date: input.decidedDate },
  });
  if (error) boom(error, "Could not record the decision");
}

export interface TallyInput {
  customerCode: string;
  tallyLedgerCreated: boolean;
  tallyLedgerName: string;
  assignedSalesExecId: string;
  assignedSalesExecName: string;
  customerStatus: "active" | "hold" | "rejected";
  tallyDate: string;
}

/**
 * Closes the request. ⚠ This is the END of the line — it does not, and must not,
 * write the customer anywhere downstream.
 */
export async function recordTally(requestId: string, input: TallyInput): Promise<void> {
  const { error } = await db.rpc("fms_customer_record_tally", {
    p_req: requestId,
    p: {
      customer_code: input.customerCode,
      tally_ledger_created: input.tallyLedgerCreated,
      tally_ledger_name: input.tallyLedgerName,
      assigned_sales_exec_id: input.assignedSalesExecId,
      assigned_sales_exec_name: input.assignedSalesExecName,
      customer_status: input.customerStatus,
      tally_date: input.tallyDate,
    },
  });
  if (error) boom(error, "Could not record the Tally ledger");
}

/* ── Corrections to a step that is already done ───────────────────────────
 * Each mirrors its decide* twin MINUS the decision: a correction changes what
 * was recorded, never where the request went. The server refuses once the next
 * step has acted (fms_customer_*_editable); Tally is the one deliberate
 * exception and stays correctable after completion.
 * ----------------------------------------------------------------------- */

export async function updateAccounts(
  requestId: string, input: Omit<AccountsInput, "decision">,
): Promise<void> {
  const { error } = await db.rpc("fms_customer_update_accounts", {
    p_req: requestId,
    p: {
      gst_verified: input.gstVerified,
      refs_verified: input.refsVerified,
      recommended_limit: input.recommendedLimit,
      recommended_days: input.recommendedDays,
      remarks: input.remarks,
      verified_date: input.verifiedDate,
    },
  });
  if (error) boom(error, "Could not save the correction");
}

export async function updateSalesHead(
  requestId: string, input: Omit<SalesHeadInput, "decision" | "forceDirector">,
): Promise<void> {
  const { error } = await db.rpc("fms_customer_update_sales_head", {
    p_req: requestId,
    p: {
      customer_category: input.customerCategory,
      business_potential: input.businessPotential,
      remarks: input.remarks,
      decided_date: input.decidedDate,
    },
  });
  if (error) boom(error, "Could not save the correction");
}

export async function updateDirector(
  requestId: string, input: Omit<DirectorInput, "decision">,
): Promise<void> {
  const { error } = await db.rpc("fms_customer_update_director", {
    p_req: requestId,
    p: { remarks: input.remarks, decided_date: input.decidedDate },
  });
  if (error) boom(error, "Could not save the correction");
}

/** ⚠ Corrects a COMPLETED customer's Tally record. Still pushes nothing downstream. */
export async function updateTally(
  requestId: string,
  input: Omit<TallyInput, "assignedSalesExecId" | "assignedSalesExecName">,
): Promise<void> {
  const { error } = await db.rpc("fms_customer_update_tally", {
    p_req: requestId,
    p: {
      customer_code: input.customerCode,
      tally_ledger_created: input.tallyLedgerCreated,
      tally_ledger_name: input.tallyLedgerName,
      customer_status: input.customerStatus,
      tally_date: input.tallyDate,
    },
  });
  if (error) boom(error, "Could not save the correction");
}

/* ── Assignment and exceptions ────────────────────────────────────────── */

export async function assignSalesExec(
  requestId: string, userId: string | null, name: string,
): Promise<void> {
  const { error } = await db.rpc("fms_customer_assign_sales_exec", {
    p_req: requestId, p_user: userId, p_name: name,
  });
  if (error) boom(error, "Could not assign the sales executive");
}

export async function holdRequest(requestId: string, hold: boolean, reason: string): Promise<void> {
  const { error } = await db.rpc("fms_customer_hold_request", {
    p_req: requestId, p_hold: hold, p_reason: reason,
  });
  if (error) boom(error, hold ? "Could not hold the request" : "Could not resume the request");
}

export async function cancelRequest(requestId: string, reason: string): Promise<void> {
  const { error } = await db.rpc("fms_customer_cancel_request", { p_req: requestId, p_reason: reason });
  if (error) boom(error, "Could not cancel the request");
}

export async function reopenRequest(requestId: string, reason: string): Promise<void> {
  const { error } = await db.rpc("fms_customer_reopen_request", { p_req: requestId, p_reason: reason });
  if (error) boom(error, "Could not reopen the request");
}

/* ── Configuration (direct writes, admin-only RLS) ────────────────────── */

export async function setStepOwner(
  stepKey: string,
  value: { departmentIds: string[]; designationId: string | null; employeeIds: string[] },
): Promise<void> {
  const { error } = await db
    .from("fms_customer_step_owners")
    .upsert(
      {
        step_key: stepKey,
        department_ids: value.departmentIds,
        designation_id: value.designationId,
        employee_ids: value.employeeIds,
      },
      { onConflict: "step_key" },
    );
  if (error) boom(error, "Could not save the step owners");
}

export async function setConfig(key: string, value: Record<string, unknown>): Promise<void> {
  const { error } = await db
    .from("fms_customer_config")
    .upsert({ key, value }, { onConflict: "key" });
  if (error) boom(error, "Could not save the setting");
}

/**
 * The module's email switch. Shared infrastructure (`email_module_settings`,
 * seeded OFF in 20260802120000) — the bell is unaffected either way, this gates
 * the email_outbox enqueue inside fms_customer_announce only.
 */
export const EMAIL_MODULE_ID = "customer-onboarding";

export async function fetchEmailEnabled(): Promise<boolean> {
  const { data, error } = await db
    .from("email_module_settings")
    .select("enabled")
    .eq("module_id", EMAIL_MODULE_ID)
    .maybeSingle();
  if (error) boom(error, "Could not read the email setting");
  return data?.enabled === true;
}

export async function setEmailEnabled(enabled: boolean): Promise<void> {
  const { error } = await db.rpc("set_email_module_enabled", {
    p_module: EMAIL_MODULE_ID,
    p_enabled: enabled,
  });
  if (error) boom(error, "Could not change the email setting");
}

export async function markNotificationsRead(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await db
    .from("fms_customer_notifications")
    .update({ read_at: new Date().toISOString() })
    .in("id", ids)
    .is("read_at", null);
  if (error) boom(error, "Could not mark the notifications read");
}

/* ── Documents ─────────────────────────────────────────────────────────
 * Private bucket. Path convention: <requestId>/<slot>/<epoch>-<safe-name>.
 * The first segment is what the storage policies match against the request row,
 * so it must stay a bare uuid.
 * -------------------------------------------------------------------- */

export const DOCS_BUCKET = "fms-customer-docs";

/** 10 MB — a scan of a GST certificate is well under this; a phone photo is not. */
export const MAX_DOC_BYTES = 10 * 1024 * 1024;

export async function uploadCustomerDoc(
  requestId: string, slot: DocSlot, file: File,
): Promise<{ path: string; name: string }> {
  if (file.size > MAX_DOC_BYTES) {
    throw new Error(`${file.name} is larger than 10 MB — please attach a smaller scan.`);
  }
  const safe = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${requestId}/${slot}/${Date.now()}-${safe}`;
  const { error } = await supabase.storage
    .from(DOCS_BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || undefined });
  if (error) boom(error, "Could not upload the document");
  return { path, name: file.name };
}

/** Record (or clear, with empty strings) one document slot on the request. */
export async function setDocument(
  requestId: string, slot: DocSlot, path: string, name: string,
): Promise<void> {
  const { error } = await db.rpc("fms_customer_set_document", {
    p_req: requestId, p_slot: slot, p_path: path, p_name: name,
  });
  if (error) boom(error, "Could not attach the document");
}

/**
 * A fresh short-lived signed URL, minted per click — which is why the components
 * that open documents are BUTTONS, not <a href>. A URL baked at render time
 * would be stale (or leaked) by the time anyone clicked it.
 */
export async function customerDocUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(DOCS_BUCKET).createSignedUrl(path, 60 * 10);
  if (error) boom(error, "Could not open the document");
  return data!.signedUrl;
}

/**
 * Delete every file under a request. Call BEFORE deleteDraft(): storage has no
 * cascade, so a row deleted first leaves PAN cards and cancelled cheques in a
 * private bucket forever with nothing pointing at them.
 *
 * Best-effort by design — a storage hiccup must not block the user from
 * discarding their own draft.
 */
export async function removeCustomerDocs(requestId: string): Promise<void> {
  try {
    const slots: DocSlot[] = ["gst", "pan", "cheque", "msme"];
    const paths: string[] = [];
    for (const slot of slots) {
      const { data } = await supabase.storage.from(DOCS_BUCKET).list(`${requestId}/${slot}`);
      for (const f of data ?? []) paths.push(`${requestId}/${slot}/${f.name}`);
    }
    if (paths.length) await supabase.storage.from(DOCS_BUCKET).remove(paths);
  } catch {
    /* best effort — see the doc comment */
  }
}
