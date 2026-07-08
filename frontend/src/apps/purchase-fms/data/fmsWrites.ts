import { supabase } from "@/core/platform/supabase";
import type { Database } from "@/core/platform/database.types";
import type { PurchaseEntry, StepOwner } from "../types";
import { addWorkingDays, nextPlannedDate, todayIso } from "../lib/plannedDate";

type StepUpdate = Database["public"]["Tables"]["fms_workflow_steps"]["Update"];
type OptionUpdate = Database["public"]["Tables"]["fms_field_options"]["Update"];

/**
 * Phase-3 write layer for Purchase FMS. All mutations run under RLS; stage
 * advancement (which crosses ownership boundaries) goes through the
 * fms_complete_stage SECURITY DEFINER RPC. Each function throws on error
 * (error.message) — the store catches and surfaces it. Mirrors
 * core/platform/directoryWrites.ts + apps/task-management/data/taskWrites.ts.
 */

export interface NewOrderInput {
  category: string;
  itemName: string;
  quantity: number;
  unit: string;
  remarks: string;
}

/**
 * Private storage bucket for Purchase FMS documents (PO PDFs, etc.). Reuses the
 * bucket + authenticated RLS policies created in
 * supabase/migrations/20260701120000_add_fms_purchase_pi_document.sql.
 */
export const FMS_DOCS_BUCKET = "fms-purchase-docs";

/**
 * Upload a stage document (e.g. the PO PDF exported from Tally) to the private
 * FMS bucket and return the storage PATH (not a URL). The path is what gets
 * persisted in the stage's `values` JSONB; a signed URL is minted on demand when
 * someone opens it (see components/AttachmentLink). Filenames are sanitised and
 * namespaced under the entry code so an entry's files stay together.
 */
export async function uploadDocument(entry: PurchaseEntry, file: File): Promise<string> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "file";
  const path = `${entry.code}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage
    .from(FMS_DOCS_BUCKET)
    .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

const ORIGIN_NEXT_INDEX = 1; // stage after Generate Order (Approval)

function codeNumber(code: string): number {
  const n = Number(code.replace(/[^0-9]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function nextCode(existingCodes: string[]): string {
  const nums = existingCodes.map(codeNumber).filter((n) => n > 0);
  const max = nums.length ? Math.max(...nums) : 1044;
  return `PO-${max + 1}`;
}

/**
 * Create an entry (Stage 1) and immediately complete the origin stage so the
 * pipeline lands on Approval. Returns the new entry id.
 */
export async function createEntry(params: {
  workflowId: string;
  createdBy: string;
  input: NewOrderInput;
  existingCodes: string[];
}): Promise<string> {
  const { workflowId, createdBy, input } = params;
  const summary = {
    category: input.category,
    itemName: input.itemName,
    quantity: input.quantity,
    unit: input.unit,
    remarks: input.remarks,
  };

  // Insert the header; retry a couple of times if the generated code collides.
  let code = nextCode(params.existingCodes);
  let entryId: string | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await supabase
      .from("fms_entries")
      .insert({ workflow_id: workflowId, code, summary, created_by: createdBy })
      .select("id")
      .single();
    if (!error) {
      entryId = data.id as string;
      break;
    }
    if (error.code === "23505" && attempt < 3) {
      code = `PO-${codeNumber(code) + 1}`;
      continue;
    }
    throw new Error(error.message);
  }
  if (!entryId) throw new Error("Could not allocate an order code — please retry.");

  // Complete the origin stage (Generate Order) → activates Approval.
  const planned = addWorkingDays(todayIso(), 1);
  const { error: rpcErr } = await supabase.rpc("fms_complete_stage", {
    p_entry_id: entryId,
    p_values: summary,
    p_next_planned_date: planned,
  });
  if (rpcErr) throw new Error(rpcErr.message);

  return entryId;
}

/** Complete the entry's active stage with the captured values; advances the pipeline. */
export async function completeStage(
  entry: PurchaseEntry,
  values: Record<string, string | number | null>
): Promise<void> {
  const nextIdx = entry.currentIndex + 1;
  const planned = nextPlannedDate(entry, nextIdx);
  const { error } = await supabase.rpc("fms_complete_stage", {
    p_entry_id: entry.id,
    p_values: values,
    p_next_planned_date: planned,
  });
  if (error) throw new Error(error.message);
}

/** Map a step → its owner(s)/dept/designation. Writes to fms_workflow_steps. */
export async function updateStepOwner(params: {
  workflowId: string;
  stepKey: string;
  patch: Partial<Omit<StepOwner, "stepKey">>;
}): Promise<void> {
  const { workflowId, stepKey, patch } = params;
  const update: StepUpdate = {};
  if ("departmentId" in patch) update.department_id = patch.departmentId ?? null;
  if ("designationId" in patch) update.designation_id = patch.designationId ?? null;
  if ("employeeIds" in patch) update.owner_employee_ids = patch.employeeIds ?? [];
  if ("employeeNames" in patch) update.owner_employee_names = patch.employeeNames ?? [];

  const { error } = await supabase
    .from("fms_workflow_steps")
    .update(update)
    .eq("workflow_id", workflowId)
    .eq("key", stepKey);
  if (error) throw new Error(error.message);
}

// ---- category master (fms_field_options, option_set='category') ----

export async function addCategory(params: { workflowId: string; name: string; unit: string }): Promise<void> {
  const { error } = await supabase.from("fms_field_options").insert({
    workflow_id: params.workflowId,
    option_set: "category",
    label: params.name.trim(),
    meta: { unit: params.unit.trim() },
  });
  if (error) throw new Error(error.message);
}

export async function updateCategory(id: string, patch: { name?: string; unit?: string }): Promise<void> {
  const update: OptionUpdate = {};
  if (patch.name !== undefined) update.label = patch.name.trim();
  if (patch.unit !== undefined) update.meta = { unit: patch.unit.trim() };
  const { error } = await supabase.from("fms_field_options").update(update).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteCategory(id: string): Promise<void> {
  const { error } = await supabase.from("fms_field_options").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ---- designation master ----

export async function addDesignation(name: string): Promise<void> {
  const { error } = await supabase.from("designations").insert({ name: name.trim() });
  if (error) throw new Error(error.message);
}

export async function updateDesignation(id: string, name: string): Promise<void> {
  const { error } = await supabase.from("designations").update({ name: name.trim() }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteDesignation(id: string): Promise<void> {
  const { error } = await supabase.from("designations").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
