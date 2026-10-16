import { supabase } from "@/core/platform/supabase";
import type { CreditNote, CreditNoteDoc, CreditNoteDocSlot, CreditNoteStatus } from "../types/creditNote";

// Not in the generated Database types — same untyped alias as complaintFetch.ts.
const db = supabase as any;

const DOCS_BUCKET = "fms-complaint-docs";

/* --------------------------------- mappers -------------------------------- */

export const mapCreditNote = (r: any): CreditNote => ({
  id: r.id,
  cnNo: r.cn_no,
  status: r.status as CreditNoteStatus,
  currentStep: r.current_step ?? null,
  raisedBy: r.raised_by ?? null,
  requesterName: r.requester_name ?? "",
  companyId: r.company_id ?? null,
  partyId: r.party_id ?? null,
  partyName: r.party_name ?? "",
  salespersonName: r.salesperson_name ?? "",
  approvedByName: r.approved_by_name ?? "",
  reason: r.reason ?? "",
  amount: Number(r.amount ?? 0),
  details: r.details ?? "",
  submittedAt: r.submitted_at,
  aprDecision: r.apr_decision ?? null,
  aprNote: r.apr_note ?? null,
  aprAt: r.apr_at ?? null,
  aprBy: r.apr_by ?? null,
  tallyNo: r.tally_no ?? null,
  tallyRemarks: r.tally_remarks ?? null,
  tallyAt: r.tally_at ?? null,
  tallyBy: r.tally_by ?? null,
  closedAt: r.closed_at ?? null,
  createdAt: r.created_at,
});

export const mapCreditNoteDoc = (r: any): CreditNoteDoc => ({
  id: r.id,
  creditNoteId: r.credit_note_id,
  stepKey: r.step_key,
  slot: r.slot as CreditNoteDocSlot,
  path: r.path,
  name: r.name,
  mime: r.mime ?? null,
  sizeBytes: r.size_bytes ?? null,
  uploadedBy: r.uploaded_by ?? null,
  createdAt: r.created_at,
});

/* --------------------------------- writes --------------------------------- */

export interface CreditNoteInput {
  companyId: string | null;
  partyId: string | null;
  partyName: string;
  salespersonName: string;
  approvedByName: string;
  reason: string;
  amount: number;
  details: string;
  requesterName: string;
}

export async function submitCreditNote(input: CreditNoteInput): Promise<string> {
  const { data, error } = await db.rpc("fms_complaint_cn_submit", {
    p: {
      company_id: input.companyId ?? "",
      party_id: input.partyId ?? "",
      party_name: input.partyName,
      salesperson_name: input.salespersonName,
      approved_by_name: input.approvedByName,
      reason: input.reason,
      amount: input.amount,
      details: input.details,
      requester_name: input.requesterName,
    },
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export interface CreditNoteApprovalInput {
  decision: "approve" | "reject";
  note: string;
}

export async function approveCreditNote(id: string, input: CreditNoteApprovalInput): Promise<void> {
  const { error } = await db.rpc("fms_complaint_cn_approve", {
    p_cn: id,
    p: { decision: input.decision, note: input.note },
  });
  if (error) throw new Error(error.message);
}

export interface CreditNoteTallyInput {
  tallyNo: string;
  remarks: string;
}

export async function recordCreditNoteTally(id: string, input: CreditNoteTallyInput): Promise<void> {
  const { error } = await db.rpc("fms_complaint_cn_record_tally", {
    p_cn: id,
    p: { tally_no: input.tallyNo, remarks: input.remarks },
  });
  if (error) throw new Error(error.message);
}

/**
 * ⚠ THE PATH IS cn/<credit-note-id>/…, AND THE SECOND SEGMENT IS LOAD-BEARING:
 *   the "fms complaint cn docs" storage policies derive the credit note from it.
 */
export async function uploadCreditNoteDoc(
  creditNoteId: string,
  slot: CreditNoteDocSlot,
  stepKey: string,
  file: File,
): Promise<string> {
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `cn/${creditNoteId}/${slot}/${Date.now()}-${safeName}`;
  const { error: upErr } = await supabase.storage
    .from(DOCS_BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || undefined });
  if (upErr) throw new Error(upErr.message);

  const { data, error } = await db.rpc("fms_complaint_cn_add_doc", {
    p_cn: creditNoteId,
    p: { step_key: stepKey, slot, path, name: file.name, mime: file.type || "", size_bytes: file.size },
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function deleteCreditNoteDoc(docId: string): Promise<void> {
  const { error } = await db.rpc("fms_complaint_cn_delete_doc", { p_doc: docId });
  if (error) throw new Error(error.message);
}
