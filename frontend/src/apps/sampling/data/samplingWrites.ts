import { supabase } from "@/core/platform/supabase";
// fms_sampling_* tables/RPCs are not in the generated Database types; route
// through an untyped alias.
const db = supabase as any;
import type { ConfirmerSource, Direction, ReceiveVia, RequirementType, SampleItem, SamplingEntityType, SamplingMasterType, SamplingSource, TransportBorne } from "../types";

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
  /** Inward: the supplier / customer. Outward: the company we send to (required). */
  partyName: string | null;
  /** The rest of the party block + the sender are OUTWARD-only; null on inward. */
  partyAddress: string | null;
  partyContactName: string | null;
  partyContactMobile: string | null;
  senderId: string | null;
  senderName: string | null;
  productDesc: string;
  sampleItems: SampleItem[];
  collectorId: string | null;
  handoverName: string | null;
  /** Inward only: true / false; null on outward (the RPC rejects a null inward value). */
  labTestingRequired: boolean | null;
  handoverRecipientId: string | null;
  handoverRecipientName: string | null;
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
      party_address: input.partyAddress ?? "",
      party_contact_name: input.partyContactName ?? "",
      party_contact_mobile: input.partyContactMobile ?? "",
      // ALWAYS send this key, even empty: its PRESENCE is what tells the RPC this
      // is the new client, which is what switches the outward party-block
      // requirements on. Drop the key and outward silently stops validating.
      sender_id: input.senderId ?? "",
      sender_name: input.senderName ?? "",
      product_desc: input.productDesc,
      sample_items: input.sampleItems,
      collector_id: input.collectorId ?? "",
      handover_name: input.handoverName ?? "",
      // Pass '' when null so the RPC's nullif() sees "unset"; 'true'/'false' otherwise.
      lab_testing_required: input.labTestingRequired === null ? "" : String(input.labTestingRequired),
      handover_recipient_id: input.handoverRecipientId ?? "",
      handover_recipient_name: input.handoverRecipientName ?? "",
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

export interface CollectInput {
  handoverRecipientId: string | null;
  handoverRecipientName: string | null;
  collectedDate: string | null;
}
const collectPayload = (input: CollectInput) => ({
  handover_recipient_id: input.handoverRecipientId ?? "",
  handover_recipient_name: input.handoverRecipientName ?? "",
  collected_date: input.collectedDate ?? "",
});
export async function recordCollect(requestId: string, input: CollectInput): Promise<void> {
  const { error } = await db.rpc("fms_sampling_record_collect", { p_req: requestId, p: collectPayload(input) });
  if (error) throw new Error(error.message);
}
export async function updateCollect(requestId: string, input: CollectInput): Promise<void> {
  const { error } = await db.rpc("fms_sampling_update_collect", { p_req: requestId, p: collectPayload(input) });
  if (error) throw new Error(error.message);
}

export interface SampleReceivedInput {
  sampleReceivedDate: string | null;
  sampleReceivedNote: string | null;
  /** Pass a key (even null) to REPLACE the attachment; omit both keys to keep it. */
  docPath?: string | null;
  docName?: string | null;
}
const sampleReceivedPayload = (input: SampleReceivedInput) => {
  const p: Record<string, unknown> = {
    sample_received_date: input.sampleReceivedDate ?? "",
    sample_received_note: input.sampleReceivedNote ?? "",
  };
  if (input.docPath !== undefined) p.sample_received_doc_path = input.docPath ?? "";
  if (input.docName !== undefined) p.sample_received_doc_name = input.docName ?? "";
  return p;
};
export async function recordSampleReceived(requestId: string, input: SampleReceivedInput): Promise<void> {
  const { error } = await db.rpc("fms_sampling_record_sample_received", { p_req: requestId, p: sampleReceivedPayload(input) });
  if (error) throw new Error(error.message);
}
export async function updateSampleReceived(requestId: string, input: SampleReceivedInput): Promise<void> {
  const { error } = await db.rpc("fms_sampling_update_sample_received", { p_req: requestId, p: sampleReceivedPayload(input) });
  if (error) throw new Error(error.message);
}

/* ------------------ inward lab branch: to-lab → lab → received ------------- */

export interface SampleToLabInput {
  /** The internal reference number. Required — the RPC rejects a blank. */
  internalRef: string;
  labSentDate: string | null;
}
const sampleToLabPayload = (input: SampleToLabInput) => ({
  internal_ref: input.internalRef,
  lab_sent_date: input.labSentDate ?? "",
});
export async function recordSampleToLab(requestId: string, input: SampleToLabInput): Promise<void> {
  const { error } = await db.rpc("fms_sampling_record_sample_to_lab", { p_req: requestId, p: sampleToLabPayload(input) });
  if (error) throw new Error(error.message);
}
export async function updateSampleToLab(requestId: string, input: SampleToLabInput): Promise<void> {
  const { error } = await db.rpc("fms_sampling_update_sample_to_lab", { p_req: requestId, p: sampleToLabPayload(input) });
  if (error) throw new Error(error.message);
}

/** lab_process PASS 1 — the tentative result date. Does NOT advance the request. */
export interface LabStartInput {
  labTentativeDate: string;
}
export async function recordLabStart(requestId: string, input: LabStartInput): Promise<void> {
  const { error } = await db.rpc("fms_sampling_record_lab_start", {
    p_req: requestId,
    p: { lab_tentative_date: input.labTentativeDate },
  });
  if (error) throw new Error(error.message);
}
export async function updateLabStart(requestId: string, input: LabStartInput): Promise<void> {
  const { error } = await db.rpc("fms_sampling_update_lab_start", {
    p_req: requestId,
    p: { lab_tentative_date: input.labTentativeDate },
  });
  if (error) throw new Error(error.message);
}

/** lab_process PASS 2 — testing done. Comment + document are both required. */
export interface LabCompleteInput {
  labCompletedDate: string | null;
  labComment: string;
  labResultToId: string | null;
  labResultToName: string | null;
  /** Only on update: also correct the tentative date. */
  labTentativeDate?: string | null;
  /** Pass a key (even null) to REPLACE the attachment; omit both keys to keep it. */
  docPath?: string | null;
  docName?: string | null;
}
const labCompletePayload = (input: LabCompleteInput) => {
  const p: Record<string, unknown> = {
    lab_completed_date: input.labCompletedDate ?? "",
    lab_comment: input.labComment,
    lab_result_to_id: input.labResultToId ?? "",
    lab_result_to_name: input.labResultToName ?? "",
  };
  if (input.labTentativeDate !== undefined) p.lab_tentative_date = input.labTentativeDate ?? "";
  // The RPC keys off `p ? 'lab_doc_path'`: send the key only when replacing.
  if (input.docPath !== undefined) p.lab_doc_path = input.docPath ?? "";
  if (input.docName !== undefined) p.lab_doc_name = input.docName ?? "";
  return p;
};
export async function recordLabComplete(requestId: string, input: LabCompleteInput): Promise<void> {
  const { error } = await db.rpc("fms_sampling_record_lab_complete", { p_req: requestId, p: labCompletePayload(input) });
  if (error) throw new Error(error.message);
}
export async function updateLabComplete(requestId: string, input: LabCompleteInput): Promise<void> {
  const { error } = await db.rpc("fms_sampling_update_lab_complete", { p_req: requestId, p: labCompletePayload(input) });
  if (error) throw new Error(error.message);
}

export interface ResultReceivedInput {
  resultReceivedDate: string | null;
  resultReceivedNote: string | null;
}
const resultReceivedPayload = (input: ResultReceivedInput) => ({
  result_received_date: input.resultReceivedDate ?? "",
  result_received_note: input.resultReceivedNote ?? "",
});
export async function recordResultReceived(requestId: string, input: ResultReceivedInput): Promise<void> {
  const { error } = await db.rpc("fms_sampling_record_result_received", { p_req: requestId, p: resultReceivedPayload(input) });
  if (error) throw new Error(error.message);
}
export async function updateResultReceived(requestId: string, input: ResultReceivedInput): Promise<void> {
  const { error } = await db.rpc("fms_sampling_update_result_received", { p_req: requestId, p: resultReceivedPayload(input) });
  if (error) throw new Error(error.message);
}

export interface SendInput {
  sentDate: string | null;
  gateEntryNo: string | null;
  sentQty: string | null;
  /** Pass a key (even null) to REPLACE the gate pass; omit both keys to keep it. */
  docPath?: string | null;
  docName?: string | null;
}
const sendPayload = (input: SendInput) => {
  const p: Record<string, unknown> = {
    sent_date: input.sentDate ?? "",
    gate_entry_no: input.gateEntryNo ?? "",
    sent_qty: input.sentQty ?? "",
    // DEPLOY-WINDOW MARKER. The RPC switches the "gate entry no. + gate pass are
    // required" rules on only when it sees this, so the previously deployed
    // frontend — which cannot upload a gate pass — keeps dispatching through the
    // gap between the migration and this build going live. It cannot key off the
    // doc keys themselves: on an edit those are deliberately ABSENT unless the
    // file is being replaced.
    client_v: 2,
  };
  // The RPC keys off `p ? 'send_doc_path'`: send the key only when replacing.
  if (input.docPath !== undefined) p.send_doc_path = input.docPath ?? "";
  if (input.docName !== undefined) p.send_doc_name = input.docName ?? "";
  return p;
};
export async function recordSend(requestId: string, input: SendInput): Promise<void> {
  const { error } = await db.rpc("fms_sampling_record_send", { p_req: requestId, p: sendPayload(input) });
  if (error) throw new Error(error.message);
}
export async function updateSend(requestId: string, input: SendInput): Promise<void> {
  const { error } = await db.rpc("fms_sampling_update_send", { p_req: requestId, p: sendPayload(input) });
  if (error) throw new Error(error.message);
}

export interface ConfirmInput {
  partyReceivedDate: string | null;
  /** Optional forecast — when the party expects to test it. Always sent, so it can be cleared. */
  partyTestingDate: string | null;
}
const confirmPayload = (input: ConfirmInput) => ({
  party_received_date: input.partyReceivedDate ?? "",
  party_testing_date: input.partyTestingDate ?? "",
});
export async function recordConfirm(requestId: string, input: ConfirmInput): Promise<void> {
  const { error } = await db.rpc("fms_sampling_record_confirm", { p_req: requestId, p: confirmPayload(input) });
  if (error) throw new Error(error.message);
}
export async function updateConfirm(requestId: string, input: ConfirmInput): Promise<void> {
  const { error } = await db.rpc("fms_sampling_update_confirm", { p_req: requestId, p: confirmPayload(input) });
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
  /**
   * Whom the result is handed over to, from the result-recipient master. Replaces
   * the legacy free-text `resultOwner`, which the RPC no longer writes at all —
   * old rows keep theirs and the UI falls back to it.
   */
  resultHandoverToId: string | null;
  resultHandoverToName: string | null;
  /** Pass a key (even null) to REPLACE the attachment; omit both keys to keep it. */
  attachmentPath?: string | null;
  attachmentName?: string | null;
}
const resultPayload = (input: ResultInput) => {
  const p: Record<string, unknown> = {
    result_comment: input.resultComment,
    // ALWAYS sent (even empty): its presence is what tells the RPC this is the new
    // client, so it can require the pick without breaking the deployed one.
    result_handover_to_id: input.resultHandoverToId ?? "",
    result_handover_to_name: input.resultHandoverToName ?? "",
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

export interface HandoverInput {
  handoverDate: string | null;
  handoverNote: string | null;
}
const handoverPayload = (input: HandoverInput) => ({
  handover_date: input.handoverDate ?? "",
  handover_note: input.handoverNote ?? "",
});
export async function recordHandover(requestId: string, input: HandoverInput): Promise<void> {
  const { error } = await db.rpc("fms_sampling_record_handover", { p_req: requestId, p: handoverPayload(input) });
  if (error) throw new Error(error.message);
}
export async function updateHandover(requestId: string, input: HandoverInput): Promise<void> {
  const { error } = await db.rpc("fms_sampling_update_handover", { p_req: requestId, p: handoverPayload(input) });
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

/** Upload an attachment under a per-request subfolder; returns the stored path + name. */
async function uploadDocument(requestId: string, subfolder: string, file: File): Promise<{ path: string; name: string }> {
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${requestId}/${subfolder}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage
    .from(DOCS_BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || undefined });
  if (error) throw new Error(error.message);
  return { path, name: file.name };
}

/** Upload the result / lab-report attachment; returns the stored path + name. */
export async function uploadResultDocument(requestId: string, file: File): Promise<{ path: string; name: string }> {
  return uploadDocument(requestId, "result", file);
}

/** Upload the sample-received attachment (no-lab branch); returns the stored path + name. */
export async function uploadReceivedDocument(requestId: string, file: File): Promise<{ path: string; name: string }> {
  return uploadDocument(requestId, "received", file);
}

/** Upload the lab-process report (inward lab branch); returns the stored path + name. */
export async function uploadLabDocument(requestId: string, file: File): Promise<{ path: string; name: string }> {
  return uploadDocument(requestId, "lab", file);
}

/** Upload the outward gate pass / dispatch document; returns the stored path + name. */
export async function uploadSendDocument(requestId: string, file: File): Promise<{ path: string; name: string }> {
  return uploadDocument(requestId, "send", file);
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

/**
 * Owners of a SOURCE-SCOPED step (send_sample / confirm_receipt / result), where
 * a Domestic dispatch and an Export one are different people's work.
 *
 * A SIBLING of setStepOwner, not an overload of it: two tables, two conflict
 * targets. Keeping them apart is what leaves `onConflict: "step_key"` above
 * demonstrably correct.
 */
export async function setStepSourceOwner(
  stepKey: string,
  source: SamplingSource,
  input: StepOwnerInput,
): Promise<void> {
  const { error } = await db.from("fms_sampling_step_source_owners").upsert(
    {
      step_key: stepKey,
      source,
      department_ids: input.departmentIds,
      designation_id: input.designationId,
      employee_ids: input.employeeIds,
    },
    { onConflict: "step_key,source" },
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

/** Collector, hand-over recipient, sender + result-handover-to masters: a display name mapped to an app user. */
export interface PersonMasterInput {
  name: string;
  userId: string;
  active: boolean;
  sortOrder: number;
}
const personRow = (input: PersonMasterInput) => ({
  name: input.name,
  user_id: input.userId,
  active: input.active,
  sort_order: input.sortOrder,
});

export async function insertCollector(input: PersonMasterInput): Promise<void> {
  const { error } = await db.from("fms_sampling_collectors").insert(personRow(input));
  if (error) throw new Error(error.message);
}
export async function updateCollector(id: string, input: PersonMasterInput): Promise<void> {
  const { error } = await db.from("fms_sampling_collectors").update(personRow(input)).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function insertRecipient(input: PersonMasterInput): Promise<void> {
  const { error } = await db.from("fms_sampling_handover_recipients").insert(personRow(input));
  if (error) throw new Error(error.message);
}
export async function updateRecipient(id: string, input: PersonMasterInput): Promise<void> {
  const { error } = await db.from("fms_sampling_handover_recipients").update(personRow(input)).eq("id", id);
  if (error) throw new Error(error.message);
}

/** The confirmer master carries a source on top of the shared person shape. */
export interface ConfirmerInput extends PersonMasterInput {
  source: ConfirmerSource;
}
const confirmerRow = (input: ConfirmerInput) => ({ ...personRow(input), source: input.source });

export async function insertConfirmer(input: ConfirmerInput): Promise<void> {
  const { error } = await db.from("fms_sampling_confirmers").insert(confirmerRow(input));
  if (error) throw new Error(error.message);
}
export async function updateConfirmer(id: string, input: ConfirmerInput): Promise<void> {
  const { error } = await db.from("fms_sampling_confirmers").update(confirmerRow(input)).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function insertSender(input: PersonMasterInput): Promise<void> {
  const { error } = await db.from("fms_sampling_senders").insert(personRow(input));
  if (error) throw new Error(error.message);
}
export async function updateSender(id: string, input: PersonMasterInput): Promise<void> {
  const { error } = await db.from("fms_sampling_senders").update(personRow(input)).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function insertResultRecipient(input: PersonMasterInput): Promise<void> {
  const { error } = await db.from("fms_sampling_result_recipients").insert(personRow(input));
  if (error) throw new Error(error.message);
}
export async function updateResultRecipient(id: string, input: PersonMasterInput): Promise<void> {
  const { error } = await db.from("fms_sampling_result_recipients").update(personRow(input)).eq("id", id);
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
