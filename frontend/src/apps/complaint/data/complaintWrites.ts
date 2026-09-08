import { supabase } from "@/core/platform/supabase";
// fms_complaint_* tables/RPCs are not in the generated Database types; route
// through an untyped alias.
const db = supabase as any;
import type {
  AckDecision,
  CauseGroup,
  ComplaintMasterType,
  ComplaintType,
  DocSlot,
  ResolutionType,
  Severity,
} from "../types";

/**
 * Complaint FMS write layer.
 *
 * The two module masters and the config are written directly under RLS (admin /
 * that master's owner). Every WORKFLOW mutation goes through a SECURITY DEFINER
 * RPC that re-checks authorization, validates the transition and stamps the step's
 * own timestamp trio. The wrappers below are deliberately thin: THE DATABASE IS
 * THE GATE, and anything enforced only here is not enforced.
 */

/* --------------------------------- raise ---------------------------------- */

/**
 * The raise panel. ONE party/invoice/lot block for both complaint types — see
 * types/index.ts for why — with `complaintType` deciding the labels the form
 * showed and which side of `mst_parties` the picker offered.
 *
 * `itemId` / `partyId` may be null with a name still supplied: a complaint can
 * legitimately name an item or a party that is not in the central masters, and
 * refusing it would block the complaint rather than fix the master.
 */
export interface RequestInput {
  complaintType: ComplaintType;
  companyId: string | null;
  requesterName: string;

  lotNo: string;
  lotExpiryDate: string | null;
  category: string | null;
  inkType: string | null;
  itemId: string | null;
  itemName: string;
  partyId: string | null;
  partyName: string;
  invoiceNo: string;
  invoiceDate: string;
  qtyAffected: string | null;
  unitName: string | null;
  natureId: string | null;

  issueIdentifiedAt: string;
  problemDetails: string;
  otherRemarks: string | null;
}

export async function submitRequest(input: RequestInput): Promise<string> {
  const { data, error } = await db.rpc("fms_complaint_submit_request", {
    p: {
      complaint_type: input.complaintType,
      company_id: input.companyId ?? "",
      requester_name: input.requesterName,
      lot_no: input.lotNo,
      lot_expiry_date: input.lotExpiryDate ?? "",
      category: input.category ?? "",
      ink_type: input.inkType ?? "",
      item_id: input.itemId ?? "",
      item_name: input.itemName,
      party_id: input.partyId ?? "",
      party_name: input.partyName,
      invoice_no: input.invoiceNo,
      invoice_date: input.invoiceDate,
      qty_affected: input.qtyAffected ?? "",
      unit_name: input.unitName ?? "",
      nature_id: input.natureId ?? "",
      issue_identified_at: input.issueIdentifiedAt,
      problem_details: input.problemDetails,
      other_remarks: input.otherRemarks ?? "",
    },
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/* --------------------------------- steps ---------------------------------- */

/** Plant: check it, act on it, say what was done. Both fields required by the RPC. */
export interface PlantInput {
  action: string;
  remarks: string;
  date: string;
}

export async function recordPlant(requestId: string, input: PlantInput): Promise<void> {
  const { error } = await db.rpc("fms_complaint_record_plant", {
    p_req: requestId,
    p: { action: input.action, remarks: input.remarks, date: input.date },
  });
  if (error) throw new Error(error.message);
}

/**
 * Service team, FIRST pass.
 *
 * ⚠ NO `requisition` FIELD. It was built from a literal reading of the brief and
 *   removed on 07-09-2026 once the user confirmed it meant nothing here — in the
 *   rest of Orange One a "requisition" is a numbered document raised in another
 *   module (MRF, PR-), and this was a free-text box nobody knew how to fill.
 *   `svc_requisition` remains on the table (changes here are additive-only) and
 *   is written by nothing.
 *
 * ⚠ `commercialCall` IS THE GATE. true routes to management approval and needs
 *   `callRemarks`; false closes the complaint here and needs `closeRemarks`. The
 *   RPC enforces both — this shape just makes the pairing visible.
 */
export interface ServiceInput {
  remarks: string | null;
  conclusion: string;
  commercialCall: boolean;
  callRemarks: string | null;
  closeRemarks: string | null;
  date: string;
}

export async function recordService(requestId: string, input: ServiceInput): Promise<void> {
  const { error } = await db.rpc("fms_complaint_record_service", {
    p_req: requestId,
    p: {
      remarks: input.remarks ?? "",
      conclusion: input.conclusion,
      commercial_call: input.commercialCall,
      call_remarks: input.callRemarks ?? "",
      close_remarks: input.closeRemarks ?? "",
      date: input.date,
    },
  });
  if (error) throw new Error(error.message);
}

/** Service team, SECOND pass — after management has ruled on the commercial call. */
export interface ServiceCloseInput {
  closeRemarks: string;
  date: string;
}

export async function recordServiceClose(requestId: string, input: ServiceCloseInput): Promise<void> {
  const { error } = await db.rpc("fms_complaint_record_service_close", {
    p_req: requestId,
    p: { close_remarks: input.closeRemarks, date: input.date },
  });
  if (error) throw new Error(error.message);
}

/**
 * Management, on the commercial call.
 *
 * ⚠ EITHER WAY IT GOES BACK TO THE SERVICE TEAM — approved so they can act and
 *   close, refused so they can settle it another way. A refusal needs a reason.
 */
export interface ApprovalInput {
  decision: "approve" | "reject";
  note: string | null;
  date: string;
}

export async function recordApproval(requestId: string, input: ApprovalInput): Promise<void> {
  const { error } = await db.rpc("fms_complaint_record_approval", {
    p_req: requestId,
    p: { decision: input.decision, note: input.note ?? "", date: input.date },
  });
  if (error) throw new Error(error.message);
}

/** Management review — one click. The note is optional by design. */
export interface ManagementReviewInput {
  note: string | null;
  date: string;
}

export async function recordManagementReview(
  requestId: string,
  input: ManagementReviewInput,
): Promise<void> {
  const { error } = await db.rpc("fms_complaint_record_management_review", {
    p_req: requestId,
    p: { note: input.note ?? "", date: input.date },
  });
  if (error) throw new Error(error.message);
}

/* -------------------------------- lifecycle ------------------------------- */

export async function holdRequest(requestId: string, hold: boolean, reason = ""): Promise<void> {
  const { error } = await db.rpc("fms_complaint_hold_request", {
    p_req: requestId,
    p_hold: hold,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

export async function cancelRequest(requestId: string, reason: string): Promise<void> {
  const { error } = await db.rpc("fms_complaint_cancel_request", { p_req: requestId, p_reason: reason });
  if (error) throw new Error(error.message);
}

/* ------------------------------- documents -------------------------------- */

const DOCS_BUCKET = "fms-complaint-docs";

/**
 * ⚠ THE FIRST PATH SEGMENT IS THE COMPLAINT ID, AND THAT IS LOAD-BEARING. The
 *   storage policies derive the owning complaint from it and hand it to
 *   `fms_complaint_can_see_request()`. A path that does not start with the
 *   complaint's uuid is unreadable by anyone, including whoever uploaded it.
 */
export async function uploadDoc(
  complaintId: string,
  slot: DocSlot,
  stepKey: string,
  file: File,
): Promise<string> {
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${complaintId}/${slot}/${Date.now()}-${safeName}`;
  const { error: upErr } = await supabase.storage
    .from(DOCS_BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || undefined });
  if (upErr) throw new Error(upErr.message);

  // The row is what the app lists; the object is what it fetches. Written through
  // an RPC so the same authorization that governs the step governs its evidence.
  const { data, error } = await db.rpc("fms_complaint_add_doc", {
    p_req: complaintId,
    p: {
      step_key: stepKey,
      slot,
      path,
      name: file.name,
      mime: file.type || "",
      size_bytes: file.size,
    },
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function deleteDoc(docId: string): Promise<void> {
  const { error } = await db.rpc("fms_complaint_delete_doc", { p_doc: docId });
  if (error) throw new Error(error.message);
}

/**
 * A short-lived signed URL for one stored document.
 *
 * ⚠ MINT IT ON CLICK, NEVER ON RENDER. Ten minutes expires while a modal sits
 *   open, and a link that was valid when the page painted is the worst kind of
 *   broken — it works when tested and fails for the person who needed it.
 */
export async function docUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(DOCS_BUCKET).createSignedUrl(path, 60 * 10);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

/* ------------------------------- step owners ------------------------------ */

export interface StepOwnerInput {
  stepKey: string;
  departmentIds: string[];
  designationId: string | null;
  employeeIds: string[];
}

/**
 * ⚠ `employeeIds` IS THE ONLY THING THAT GRANTS ANYTHING. The department and
 *   designation are UI filters that help an admin FIND the people; the SQL
 *   `fms_complaint_is_step_owner` reads `employee_ids` and nothing else. Saving a
 *   department with no employees grants nobody, deliberately.
 */
export async function saveStepOwner(input: StepOwnerInput): Promise<void> {
  const { error } = await db.from("fms_complaint_step_owners").upsert(
    {
      step_key: input.stepKey,
      department_ids: input.departmentIds,
      designation_id: input.designationId,
      employee_ids: input.employeeIds,
    },
    { onConflict: "step_key" },
  );
  if (error) throw new Error(error.message);
}

/* --------------------------------- config --------------------------------- */

async function saveConfig(key: string, value: unknown): Promise<void> {
  const { error } = await db
    .from("fms_complaint_config")
    .upsert({ key, value }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

export const saveProcessCoordinators = (userIds: string[]) =>
  saveConfig("process_coordinators", { user_ids: userIds });

export const saveStepSla = (map: Record<string, unknown>) => saveConfig("step_sla", map);

/**
 * The credit-note approval threshold.
 *
 * ⚠ CHANGING IT DOES NOT MOVE COMPLAINTS ALREADY IN FLIGHT. Each row froze
 *   `approval_required` when its resolution was recorded, so raising the
 *   threshold cannot silently release everything waiting, and lowering it cannot
 *   strand a complaint at a step it already passed.
 */
/** RETIRED with the credit-note threshold (phase 12). Left so the key can be read back. */
export const saveApprovalThreshold = (threshold: number) =>
  saveConfig("approval", { credit_note_threshold: threshold });

/* --------------------------------- masters -------------------------------- */

export interface NatureInput {
  name: string;
  active: boolean;
  sortOrder: number;
}

export async function saveNature(id: string | null, input: NatureInput): Promise<void> {
  const row = { name: input.name, active: input.active, sort_order: input.sortOrder };
  const { error } = id
    ? await db.from("fms_complaint_natures").update(row).eq("id", id)
    : await db.from("fms_complaint_natures").insert(row);
  if (error) throw new Error(error.message);
}

export interface RootCauseInput {
  name: string;
  causeGroup: CauseGroup;
  active: boolean;
  sortOrder: number;
}

export async function saveRootCause(id: string | null, input: RootCauseInput): Promise<void> {
  const row = {
    name: input.name,
    cause_group: input.causeGroup,
    active: input.active,
    sort_order: input.sortOrder,
  };
  const { error } = id
    ? await db.from("fms_complaint_root_causes").update(row).eq("id", id)
    : await db.from("fms_complaint_root_causes").insert(row);
  if (error) throw new Error(error.message);
}

/** Flip a master row's `active`. Deactivating is how a value retires — never delete. */
export async function setMasterActive(
  table: "fms_complaint_natures" | "fms_complaint_root_causes",
  id: string,
  active: boolean,
): Promise<void> {
  const { error } = await db.from(table).update({ active }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function setMasterManagers(
  masterType: ComplaintMasterType,
  userIds: string[],
): Promise<void> {
  const { error: delErr } = await db
    .from("fms_complaint_master_managers")
    .delete()
    .eq("master_type", masterType);
  if (delErr) throw new Error(delErr.message);
  if (!userIds.length) return;
  const { error } = await db
    .from("fms_complaint_master_managers")
    .insert(userIds.map((u) => ({ master_type: masterType, manager_user_id: u })));
  if (error) throw new Error(error.message);
}

/* ---------------------------- master requests ----------------------------- */

/**
 * Ask for a value that isn't in one of THIS module's two masters.
 *
 * ⚠ THE PAYLOAD KEYS ARE A WIRE CONTRACT read verbatim by
 *   `fms_complaint_resolve_master_request`. They are authored in
 *   lib/masterFields.ts; a key added there without being added to the RPC is
 *   silently dropped on approval.
 *
 * The CENTRAL masters (party, item, company) are deliberately not requestable
 * here — a complaint is the worst possible moment to invent a customer.
 */
export async function requestNewMaster(
  masterType: ComplaintMasterType,
  payload: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await db.rpc("fms_complaint_request_master", {
    p_master_type: masterType,
    p_payload: payload,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function resolveMasterRequest(
  requestId: string,
  approve: boolean,
  payload: Record<string, unknown> | null,
  note: string | null,
): Promise<void> {
  const { error } = await db.rpc("fms_complaint_resolve_master_request", {
    p_request_id: requestId,
    p_approve: approve,
    p_payload: payload,
    p_note: note ?? "",
  });
  if (error) throw new Error(error.message);
}

/* ------------------------------ notifications ----------------------------- */

export async function markNotificationsRead(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await db
    .from("fms_complaint_notifications")
    .update({ read_at: new Date().toISOString() })
    .in("id", ids);
  if (error) throw new Error(error.message);
}
