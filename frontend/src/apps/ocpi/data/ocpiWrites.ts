import { supabase } from "@/core/platform/supabase";
import type { SignatureSlot } from "../lib/signatures";
import type { OcpiDoc } from "../types";
const db = supabase as any;

/**
 * OCPI write layer.
 *
 * ⚠ EVERY MUTATION GOES THROUGH A SECURITY-DEFINER RPC. fms_ocpi_deals carries
 *   no write policy at all, so the RPC is the only write door and the guard
 *   cannot be side-stepped from the browser. Hidden buttons are a courtesy; the
 *   RPC and RLS are the boundary.
 *
 * Phase 1 ships only the notification read-marker — the draft, submit, approval
 * and sign-off RPCs land with the screens that call them, so nothing here is
 * dead code waiting for a UI.
 */

/** Mark bell notifications read. Own rows only, enforced by RLS. */
export async function markNotificationsRead(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await db
    .from("fms_ocpi_notifications")
    .update({ read_at: new Date().toISOString() })
    .in("id", ids)
    .is("read_at", null);
  if (error) throw new Error(error.message);
}

/**
 * Create or update a draft quotation. Returns the deal id.
 *
 * ⚠ NO NUMBER IS MINTED. `quotation_no` stays null for the whole of a draft's
 *   life — an abandoned draft must not burn a number from a series customers
 *   already hold. The submit RPC allocates one (phase 4).
 */
export async function saveDraft(
  payload: Record<string, unknown>,
  dealId?: string | null,
): Promise<string> {
  const { data, error } = await db.rpc("fms_ocpi_save_draft", {
    p: payload,
    p_deal: dealId ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/**
 * Bin an abandoned draft.
 *
 * Only a draft can go this way; anything already submitted is cancelled, so a
 * number that may already be in a customer's inbox is never silently reused.
 */
export async function deleteDraft(dealId: string): Promise<void> {
  const { error } = await db.rpc("fms_ocpi_delete_draft", { p_deal: dealId });
  if (error) throw new Error(error.message);
}

/**
 * Freeze a quotation revision and mint its number on the first generation.
 *
 * ⚠ THE CALLER PASSES THE RESOLVED DOCUMENT, not just the answers. Whatever the
 *   PDF renderer actually used — the machine's spec rows and section bodies as
 *   they stand right now — is stored with the version, so rewording a template
 *   next month cannot rewrite a document the customer already holds.
 */
export async function generateQuotation(
  dealId: string,
  fields: Record<string, unknown>,
  document: Record<string, unknown>,
): Promise<number> {
  const { data, error } = await db.rpc("fms_ocpi_generate_quotation", {
    p_deal: dealId,
    p_fields: fields,
    p_document: document,
  });
  if (error) throw new Error(error.message);
  return data as number;
}

const DOCS_BUCKET = "fms-ocpi-docs";

/**
 * Store the generated PDF beside its version.
 *
 * ⚠ THE PATH STARTS WITH THE DEAL ID, and that is load-bearing rather than
 *   tidy: the storage policy derives the owning deal from the first segment, so
 *   a file filed anywhere else would be readable by the wrong people. The RPC
 *   refuses a path that does not.
 *
 * A failure here is NOT fatal to generating — the version is already frozen and
 * the PDF is deterministic, so it can be re-rendered. The caller reports it
 * without unwinding the revision.
 */
export async function uploadQuotationPdf(
  dealId: string,
  versionNo: number,
  blob: Blob,
  fileName: string,
): Promise<string> {
  const path = `${dealId}/quotation/v${versionNo}-${fileName}`;
  const up = await supabase.storage
    .from(DOCS_BUCKET)
    .upload(path, blob, { cacheControl: "3600", upsert: true, contentType: "application/pdf" });
  if (up.error) throw new Error(up.error.message);
  const { error } = await db.rpc("fms_ocpi_set_version_pdf", {
    p_deal: dealId,
    p_version: versionNo,
    p_path: path,
  });
  if (error) throw new Error(error.message);
  return path;
}

/** Mark a generated quotation final and send it to the approvers. */
export async function submitQuotation(dealId: string): Promise<void> {
  const { error } = await db.rpc("fms_ocpi_submit_quotation", { p_deal: dealId });
  if (error) throw new Error(error.message);
}

/**
 * Approve, reject or return a quotation.
 *
 * ⚠ REJECT AND REWORK BOTH REQUIRE A REASON, and the database enforces it — a
 *   salesperson told only "sent back" has to guess what to change.
 */
export async function decideQuotation(
  dealId: string,
  decision: "approve" | "reject" | "rework",
  note?: string,
): Promise<void> {
  const { error } = await db.rpc("fms_ocpi_decide_quotation", {
    p_deal: dealId,
    p_decision: decision,
    p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
}

/** Set who owns one step. Admin only, enforced server-side. */
export async function setStepOwners(
  stepKey: string,
  employeeIds: string[],
  departmentIds: string[] = [],
  designationId: string | null = null,
): Promise<void> {
  const { error } = await db.rpc("fms_ocpi_set_step_owners", {
    p_step_key: stepKey,
    p_employee_ids: employeeIds,
    p_department_ids: departmentIds,
    p_designation_id: designationId,
  });
  if (error) throw new Error(error.message);
}

/**
 * Confirm where the quotation series stands, and move the counter to it.
 *
 * ⚠ FORWARD-ONLY, ENFORCED IN THE DATABASE. The number this sets is the LAST one
 *   already used — on paper or in the app — so the next quotation minted is this
 *   plus one. Lowering it is the one move that can hand a customer a number
 *   somebody else already holds, so the RPC refuses it rather than trusting the
 *   form.
 *
 * Returns the value the series now stands at.
 */
export async function setQuotationSeries(lastUsed: number): Promise<number> {
  const { data, error } = await db.rpc("fms_ocpi_set_quotation_series", {
    p_last_used: lastUsed,
  });
  if (error) throw new Error(error.message);
  return data as number;
}

/** Save part-B answers in place, without submitting. Mints no number. */
export async function saveOcDraft(dealId: string, payload: Record<string, unknown>): Promise<void> {
  const { error } = await db.rpc("fms_ocpi_save_oc_draft", { p_deal: dealId, p: payload });
  if (error) throw new Error(error.message);
}

/**
 * Mark the order confirmation complete and send it for approval.
 *
 * ⚠ THIS MINTS `OTPL/OC/<fy>/<nnnn>`, and refuses a machine with no template —
 *   naming it, so the failure reads as missing content rather than a bug.
 * Returns the number.
 */
export async function submitOc(dealId: string): Promise<string> {
  const { data, error } = await db.rpc("fms_ocpi_submit_oc", { p_deal: dealId });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Store the resolved order confirmation and its PDF path. */
export async function freezeOc(
  dealId: string,
  document: Record<string, unknown>,
  path?: string,
): Promise<void> {
  const { error } = await db.rpc("fms_ocpi_freeze_oc", {
    p_deal: dealId,
    p_document: document,
    p_path: path ?? null,
  });
  if (error) throw new Error(error.message);
}

/** Upload the order-confirmation PDF under the deal's own folder. */
export async function uploadOcPdf(dealId: string, blob: Blob, fileName: string): Promise<string> {
  const path = `${dealId}/oc/${fileName}`;
  const up = await supabase.storage
    .from("fms-ocpi-docs")
    .upload(path, blob, { cacheControl: "3600", upsert: true, contentType: "application/pdf" });
  if (up.error) throw new Error(up.error.message);
  return path;
}

/** Confirm, reject or return an order confirmation. */
export async function decideOc(
  dealId: string,
  decision: "approve" | "reject" | "rework",
  note?: string,
): Promise<void> {
  const { error } = await db.rpc("fms_ocpi_decide_oc", {
    p_deal: dealId,
    p_decision: decision,
    p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
}

/* ------------------------------------------------------------------------- */
/*  The signature loop                                                        */
/* ------------------------------------------------------------------------- */

/**
 * Put one scanned page of a signed document into the deal's own folder.
 *
 * ⚠ `upsert: false` AND AN EPOCH IN THE NAME. Two photographs of two different
 *   pages routinely arrive as `image.jpg` twice; overwriting would silently
 *   lose one of them, and a signed contract is the one thing here that cannot
 *   be re-rendered. The timestamp makes every page a new object, and a refused
 *   overwrite is louder than a lost page.
 *
 * ⚠ THE PATH STARTS WITH THE DEAL ID, and that is load-bearing rather than
 *   tidy: `fms_ocpi_doc_deal` reads the owning deal out of that first segment,
 *   and both the storage policy and the record RPCs refuse anything else.
 */
export async function uploadSignedPage(
  dealId: string,
  slot: SignatureSlot,
  file: File,
): Promise<OcpiDoc> {
  // Strip anything that would open a second path segment, so a mischievous file
  // name cannot file itself under another deal.
  const safe = file.name.replace(/[/\\]+/g, "-").slice(-120) || "page";
  const path = `${dealId}/${slot}/${Date.now()}-${safe}`;
  const up = await supabase.storage
    .from(DOCS_BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || undefined });
  if (up.error) throw new Error(up.error.message);
  return { path, name: file.name };
}

/**
 * File the customer-signed order confirmation; the deal moves to management.
 *
 * `pages` is the WHOLE list, page one first. The RPC strips the primary from
 * the tail itself, so a caller holding one ordered list never has to split it.
 */
export async function recordCustomerSign(
  dealId: string,
  pages: OcpiDoc[],
  note?: string,
): Promise<void> {
  const { error } = await db.rpc("fms_ocpi_record_customer_sign", {
    p_deal: dealId,
    p: {
      doc_path: pages[0]?.path ?? null,
      doc_pages: pages.slice(1),
      note: note ?? null,
    },
  });
  if (error) throw new Error(error.message);
}

/**
 * Management sends a signed copy back for a re-scan or a re-signature.
 *
 * The reason is required, and the database enforces it — "sent back" with no
 * explanation leaves the salesperson to guess which of five pages was the
 * problem.
 */
export async function returnSignature(dealId: string, note: string): Promise<void> {
  const { error } = await db.rpc("fms_ocpi_return_signature", {
    p_deal: dealId,
    p_note: note,
  });
  if (error) throw new Error(error.message);
}

/** File the countersigned copy. This closes the deal. */
export async function recordManagementSign(
  dealId: string,
  pages: OcpiDoc[],
  note?: string,
): Promise<void> {
  const { error } = await db.rpc("fms_ocpi_record_management_sign", {
    p_deal: dealId,
    p: {
      doc_path: pages[0]?.path ?? null,
      doc_pages: pages.slice(1),
      note: note ?? null,
    },
  });
  if (error) throw new Error(error.message);
}

/**
 * Replace the pages of an already-filed signature. Coordinators only.
 *
 * Announces to NOBODY — it is an audit entry, not news — and stamps
 * `edited_at` / `edited_by` rather than `updated_at`, which a trigger touches on
 * every write and so cannot answer "who changed this by hand".
 */
export async function updateSignedDocs(
  dealId: string,
  slot: SignatureSlot,
  pages: OcpiDoc[],
  note?: string,
): Promise<void> {
  const { error } = await db.rpc("fms_ocpi_update_signed_docs", {
    p_deal: dealId,
    p_slot: slot,
    p: {
      doc_path: pages[0]?.path ?? null,
      doc_pages: pages.slice(1),
      note: note ?? null,
    },
  });
  if (error) throw new Error(error.message);
}

/* ------------------------------------------------------------------------- */
/*  Lifecycle — the ways a deal leaves a queue without being signed            */
/* ------------------------------------------------------------------------- */

/** Park a deal, remembering the status it was at. A reason is required. */
export async function holdDeal(dealId: string, reason: string): Promise<void> {
  const { error } = await db.rpc("fms_ocpi_hold", { p_deal: dealId, p_reason: reason });
  if (error) throw new Error(error.message);
}

/** Put it back exactly where it was — the remembered status, never a recomputed one. */
export async function resumeDeal(dealId: string): Promise<void> {
  const { error } = await db.rpc("fms_ocpi_resume", { p_deal: dealId });
  if (error) throw new Error(error.message);
}

/**
 * Write a deal off.
 *
 * Refused once the deal is closed, and — once the customer has signed —
 * restricted to coordinators. The database decides; this is only the call.
 */
export async function cancelDeal(dealId: string, reason: string): Promise<void> {
  const { error } = await db.rpc("fms_ocpi_cancel", { p_deal: dealId, p_reason: reason });
  if (error) throw new Error(error.message);
}

/* ------------------------------------------------------------------------- */
/*  Config                                                                     */
/* ------------------------------------------------------------------------- */

/**
 * Write one settings key.
 *
 * ⚠ NOT AN RPC, unlike every workflow write here. fms_ocpi_config carries a real
 *   admin-only write policy, so the table IS the boundary and a definer function
 *   would only be a second thing to keep in step with it.
 */
export async function setConfig(key: string, value: Record<string, unknown>): Promise<void> {
  const { error } = await db
    .from("fms_ocpi_config")
    .upsert({ key, value }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

/**
 * Create or update one selling entity's printed identity.
 *
 * ⚠ MARKING ONE DEFAULT UNMARKS THE OTHERS, in two writes rather than one, and
 *   the order matters: clear first, then set. Doing it the other way round
 *   leaves a moment with no default at all, and a document rendered in that
 *   moment prints no bank block. There is no partial-unique index to lean on
 *   here — `is_default` is a plain boolean — so this is where the invariant is
 *   kept.
 */
export async function saveCompanyProfile(
  id: string | null,
  profile: {
    companyId: string | null;
    isDefault: boolean;
    legalName: string | null;
    cin: string | null;
    registeredAddress: string | null;
    bankName: string | null;
    bankBranch: string | null;
    bankAccountNo: string | null;
    bankIfsc: string | null;
    exWorksCity: string | null;
    letterheadPath: string | null;
    active: boolean;
    sortOrder: number;
  },
): Promise<void> {
  const row = {
    company_id: profile.companyId,
    is_default: profile.isDefault,
    legal_name: profile.legalName || null,
    cin: profile.cin || null,
    registered_address: profile.registeredAddress || null,
    bank_name: profile.bankName || null,
    bank_branch: profile.bankBranch || null,
    bank_account_no: profile.bankAccountNo || null,
    bank_ifsc: profile.bankIfsc || null,
    ex_works_city: profile.exWorksCity || null,
    letterhead_path: profile.letterheadPath || null,
    active: profile.active,
    sort_order: profile.sortOrder,
  };

  if (profile.isDefault) {
    const clear = await db
      .from("fms_ocpi_company_profiles")
      .update({ is_default: false })
      .eq("is_default", true);
    if (clear.error) throw new Error(clear.error.message);
  }

  const res = id
    ? await db.from("fms_ocpi_company_profiles").update(row).eq("id", id)
    : await db.from("fms_ocpi_company_profiles").insert(row);
  if (res.error) throw new Error(res.error.message);
}
