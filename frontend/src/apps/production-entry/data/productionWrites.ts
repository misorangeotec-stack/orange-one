import { supabase } from "@/core/platform/supabase";
// fms_production_* tables/RPCs are not in the generated Database types; route
// through an untyped alias.
const db = supabase as any;
import type { ProductionCardType, ProductionEntityType, ProductionMasterType } from "../types";
import type { QueueStep } from "../lib/queues";

/**
 * Production Entry FMS write layer. The masters + config are written directly
 * under RLS (admin / the master's owner). Every WORKFLOW mutation goes through a
 * SECURITY DEFINER RPC that re-checks authorization, validates the transition and
 * stamps the step's timestamp. The wrappers are thin: the DATABASE is the gate.
 */

/* --------------------------------- requests ------------------------------- */

/** One raw-material line of the intake BOM. */
export interface RequestLineInput {
  rawMaterialId: string;
  qty: string;
  unitId: string | null;
  /** This line's share of the FG quantity. Carried for traceability + exact
   *  rehydration on edit, and read by the printed slip's Proportion Dosage. */
  pct: string | null;
  /** The BOM master row this line came from, or null when typed by hand. */
  bomId: string | null;
}

/** One packaging line of a REPACKAGING slip. Same element shape the log book
 *  sends, so `fms_production_pack_lines()` reads it unchanged. */
export interface RequestPackLineInput {
  packagingItemId: string | null;
  unitId: string | null;
  qty: string;
  extra: string;
}

export interface RequestInput {
  /** FG total quantity to produce. The RM line quantities are shown against this
   *  but are NOT required to sum to it — see useJobCardForm's sumWarning.
   *  On a repackaging slip this is the ONE quantity: packed qty = FG qty. */
  fgTotalQty: string;
  bomLines: RequestLineInput[];
  fgItemId: string;
  issueRemarks: string | null;
  requesterName: string;
  /** The job date (yyyy-mm-dd). Defaults to today server-side when omitted; a
   *  future date is rejected. Never post-dated, freely back-dated. */
  issueDate?: string;
  /** Omitted → "production", so every existing caller keeps working unchanged. */
  cardType?: ProductionCardType;
  /** Repackaging only — the packaging material. Ignored for production cards. */
  packLines?: RequestPackLineInput[];
  /** Repackaging only — the incoming FG lot number, MANDATORY there (the server
   *  rejects a blank). Ignored for production cards, which have no such lot. */
  fgLotNo?: string | null;
}

/** The pmh_bom_lines element shape — server recomputes extra/total from it. */
const packLinePayload = (l: RequestPackLineInput) => ({
  packaging_item_id: l.packagingItemId ?? "",
  unit_id: l.unitId ?? "",
  qty: l.qty ?? "",
  extra: l.extra ?? "",
});

/** The bom_lines element shape both intake RPCs store. The extra pct/bom_id keys
 *  need no migration: `select jsonb_agg(l) from jsonb_array_elements(...) l`
 *  re-aggregates whole elements, so unknown keys ride through untouched. */
const bomLinePayload = (l: RequestLineInput) => ({
  raw_material_id: l.rawMaterialId,
  required_qty: l.qty ?? "",
  unit_id: l.unitId ?? "",
  pct: l.pct ?? "",
  bom_id: l.bomId ?? "",
});

/** Raise a job card. The Lot/Batch number is auto-generated server-side — from the
 *  SAME continuous counter for both card types. */
export async function submitRequest(input: RequestInput): Promise<string> {
  const { data, error } = await db.rpc("fms_production_submit_request", {
    p: {
      fg_qty: input.fgTotalQty ?? "",
      bom_lines: input.bomLines.map(bomLinePayload),
      fg_item_id: input.fgItemId,
      issue_remarks: input.issueRemarks ?? "",
      requester_name: input.requesterName,
      issue_date: input.issueDate ?? "",
      card_type: input.cardType ?? "production",
      fg_lot_no: input.fgLotNo ?? "",
      pmh_bom_lines: (input.packLines ?? []).map(packLinePayload),
    },
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Edit an issue slip (step 1). Server-gated: only while it is still awaiting the
 *  first material handover, and only by the raiser / admin / coordinator. */
export async function updateRequest(requestId: string, input: RequestInput): Promise<void> {
  const { error } = await db.rpc("fms_production_update_request", {
    p_req: requestId,
    p: {
      fg_qty: input.fgTotalQty ?? "",
      bom_lines: input.bomLines.map(bomLinePayload),
      fg_item_id: input.fgItemId,
      issue_remarks: input.issueRemarks ?? "",
      // Blank keeps whatever is stored — the RPC coalesces to the current value.
      issue_date: input.issueDate ?? "",
      fg_lot_no: input.fgLotNo ?? "",
      pmh_bom_lines: (input.packLines ?? []).map(packLinePayload),
    },
  });
  if (error) throw new Error(error.message);
}

/* ------------------------------- stage records ---------------------------- */

/** payload keys are the jsonb keys the matching RPC reads (see lib/stepConfig.ts).
 *  Values are usually strings, but a step may send structured data (e.g. the
 *  material handover's `mh_bom_lines` array), so the value type is unknown. */
export type StepPayload = Record<string, unknown>;

const RECORD_RPC: Record<QueueStep, string> = {
  material_handover: "fms_production_record_material_handover",
  rm_transfer: "fms_production_record_rm_transfer",
  quality_check: "fms_production_record_quality",
  additional_issue_slip: "fms_production_record_additional_issue_slip",
  transfer_slip: "fms_production_record_transfer_slip",
  production_entry: "fms_production_record_production",
  mc_testing: "fms_production_record_mc_testing",
  pm_transfer: "fms_production_record_pm_transfer",
  packing_entry: "fms_production_record_packing",
  // ready_to_dispatch & fg_transfer use dedicated multi-select pages + the bulk
  // helpers below; these entries exist only to satisfy the map type.
  ready_to_dispatch: "fms_production_mark_ready_to_dispatch",
  fg_transfer: "fms_production_record_fg_transfer_bulk",
};

const UPDATE_RPC: Record<QueueStep, string> = {
  material_handover: "fms_production_update_material_handover",
  rm_transfer: "fms_production_update_rm_transfer",
  quality_check: "fms_production_update_quality",
  additional_issue_slip: "fms_production_update_additional_issue_slip",
  transfer_slip: "fms_production_update_transfer_slip",
  production_entry: "fms_production_update_production",
  mc_testing: "fms_production_update_mc_testing",
  pm_transfer: "fms_production_update_pm_transfer",
  packing_entry: "fms_production_update_packing",
  ready_to_dispatch: "fms_production_mark_ready_to_dispatch",
  fg_transfer: "fms_production_update_fg_transfer",
};

export async function recordStep(step: QueueStep, requestId: string, payload: StepPayload): Promise<void> {
  const { error } = await db.rpc(RECORD_RPC[step], { p_req: requestId, p: payload });
  if (error) throw new Error(error.message);
}

export async function updateStep(step: QueueStep, requestId: string, payload: StepPayload): Promise<void> {
  const { error } = await db.rpc(UPDATE_RPC[step], { p_req: requestId, p: payload });
  if (error) throw new Error(error.message);
}

/** Bulk: move the selected packed cards on to FG transfer. Returns how many moved. */
export async function markReadyToDispatch(requestIds: string[]): Promise<number> {
  const { data, error } = await db.rpc("fms_production_mark_ready_to_dispatch", { p_reqs: requestIds });
  if (error) throw new Error(error.message);
  return (data as number) ?? 0;
}

/** Bulk: close the selected FG-transfer cards with one uploaded Tally voucher file. */
export async function recordFgTransferBulk(requestIds: string[], path: string, name: string): Promise<number> {
  const { data, error } = await db.rpc("fms_production_record_fg_transfer_bulk", {
    p_reqs: requestIds,
    p_path: path,
    p_name: name,
  });
  if (error) throw new Error(error.message);
  return (data as number) ?? 0;
}

export async function holdRequest(requestId: string, hold: boolean, reason: string): Promise<void> {
  const { error } = await db.rpc("fms_production_hold_request", { p_req: requestId, p_hold: hold, p_reason: reason });
  if (error) throw new Error(error.message);
}

export async function cancelRequest(requestId: string, reason: string): Promise<void> {
  const { error } = await db.rpc("fms_production_cancel_request", { p_req: requestId, p_reason: reason });
  if (error) throw new Error(error.message);
}

/* ------------------------------- documents -------------------------------- */

const DOCS_BUCKET = "fms-production-docs";

/** Upload a step attachment into a per-step folder; returns the stored path + name. */
export async function uploadStepDocument(requestId: string, folder: string, file: File): Promise<{ path: string; name: string }> {
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${requestId}/${folder}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage
    .from(DOCS_BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || undefined });
  if (error) throw new Error(error.message);
  return { path, name: file.name };
}

/** Upload the quality-checking test-report attachment; returns the stored path + name. */
export async function uploadQualityDocument(requestId: string, file: File): Promise<{ path: string; name: string }> {
  return uploadStepDocument(requestId, "quality", file);
}

/** Create a short-lived signed URL to view/download a stored quality document. */
export async function qualityDocumentUrl(path: string): Promise<string> {
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
  const { error } = await db.from("fms_production_step_owners").upsert(
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
  const { error } = await db.from("fms_production_config").upsert({ key, value }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

/* --------------------------------- masters -------------------------------- */

const MASTER_TABLE: Record<ProductionMasterType, string> = {
  category: "fms_production_categories",
  raw_material: "fms_production_raw_materials",
  packaging_item: "fms_production_packaging_items",
  fg_item: "fms_production_fg_items",
  unit: "fms_production_units",
  test_equipment: "fms_production_test_equipments",
  coa_parameter: "fms_production_coa_parameters",
  // Present so this record stays exhaustive over ProductionMasterType, but BOMs
  // are NOT written through insertMaster/updateMaster — a header plus its
  // component list has to move in one transaction, so it goes via saveBom below.
  bom: "fms_production_boms",
};

export interface MasterInput {
  name: string;
  active: boolean;
  sortOrder: number;
  /** Raw materials only: the material's own unit (fms_production_units id). */
  unitId?: string | null;
  /** COA parameters only: the default specification, free text. */
  standard?: string | null;
  /** COA parameters only: the instrument, OPTIONAL — not every test uses one. */
  testEquipmentId?: string | null;
  /** COA parameters only: which generated copy prints this parameter. */
  appearsOn?: string | null;
}

/**
 * Base columns + whichever per-master extras the caller actually supplied.
 *
 * ⚠ EVERY EXTRA IS KEYED ON `!== undefined`, NOT ON TRUTHINESS. A master that
 * does not carry the column must send no key at all — PostgREST would reject the
 * write for a column that table has never heard of — while one that does must be
 * able to send an explicit null (clearing a COA parameter's equipment back to
 * "no instrument" is a real edit, and `input.x || null` cannot tell the two apart).
 */
const masterRow = (input: MasterInput) => ({
  name: input.name,
  active: input.active,
  sort_order: input.sortOrder,
  ...(input.unitId !== undefined ? { unit_id: input.unitId || null } : {}),
  ...(input.standard !== undefined ? { standard: input.standard || null } : {}),
  ...(input.testEquipmentId !== undefined ? { test_equipment_id: input.testEquipmentId || null } : {}),
  ...(input.appearsOn !== undefined ? { appears_on: input.appearsOn || "both" } : {}),
});

export async function insertMaster(mt: ProductionMasterType, input: MasterInput): Promise<void> {
  const { error } = await db.from(MASTER_TABLE[mt]).insert(masterRow(input));
  if (error) throw new Error(error.message);
}

export async function updateMaster(mt: ProductionMasterType, id: string, input: MasterInput): Promise<void> {
  const { error } = await db.from(MASTER_TABLE[mt]).update(masterRow(input)).eq("id", id);
  if (error) throw new Error(error.message);
}

/* ----------------------------------- COA ---------------------------------- */

/** One line of a COA as it is SENT. Snake_case because the RPC stores the array
 *  verbatim — these keys are what `fms_production_coas.lines` will hold forever,
 *  so they are the wire contract with lib/coaVm.ts, not a passing shape. */
export interface CoaLineInput {
  parameter_id: string | null;
  name: string;
  standard: string | null;
  observed: string | null;
  equipment_id: string | null;
  equipment_name: string | null;
  appears_on: string;
  sort_order: number;
}

export interface CoaInput {
  requestId: string;
  /**
   * The certificate being CORRECTED, when one is open; null issues a new one.
   *
   * ⚠ THE ROUND IS NEVER SENT — the server stamps it from the card, or takes it
   *   from this row when correcting. Sending an id rather than a round is what
   *   stops "correct Test 1 while Test 2 is open" from minting a duplicate.
   */
  coaId: string | null;
  /** yyyy-mm-dd. Blank lets the server stamp today (in IST, not UTC). */
  issueDate: string;
  conclusion: string;
  /** ⚠ The CERTIFICATE's remark — internal copy only. Not the test's remark. */
  remarks: string;
  /**
   * The signed copy, OMITTED unless a new file was just uploaded.
   *
   * ⚠ UNDEFINED, NOT NULL, WHEN THERE IS NOTHING NEW. `JSON.stringify` drops an
   *   undefined key, so the RPC sees no key and keeps whatever is stored — the
   *   same presence rule the step payloads use. Sending null would wipe it.
   */
  attachmentPath?: string;
  attachmentName?: string;
  /**
   * Standards the user asked to push back to the COA-parameter master.
   *
   * ⚠ Empty unless the tick under the table is set. The server re-checks that
   *   the value actually differs, writes an activity row per change, and does it
   *   under the SAME authority that issues the COA — see the migration.
   */
  pushStandards: { parameter_id: string; standard: string | null }[];
  lines: CoaLineInput[];
}

/**
 * Issue or correct ONE TEST ROUND's COA for a job card.
 *
 * ⚠ The product name and lot number are deliberately NOT sent. The RPC reads
 * them off the card, so a certificate can never name a product the job card does
 * not — see fms_production_save_coa.
 */
export async function saveCoa(input: CoaInput): Promise<void> {
  const { error } = await db.rpc("fms_production_save_coa", {
    p: {
      request_id: input.requestId,
      coa_id: input.coaId,
      issue_date: input.issueDate,
      conclusion: input.conclusion,
      remarks: input.remarks,
      // Present only when a file was just uploaded — see the note on the field.
      ...(input.attachmentPath !== undefined
        ? { attachment_path: input.attachmentPath, attachment_name: input.attachmentName ?? "" }
        : {}),
      push_standards: input.pushStandards,
      lines: input.lines,
    },
  });
  if (error) throw new Error(error.message);
}

/* ---------------------------------- BOMs ---------------------------------- */

export interface BomComponentInput {
  rawMaterialId: string;
  /** Share of the FG quantity, as a percentage. Never a quantity. */
  pct: string;
}

export interface BomInput {
  id: string | null;
  fgItemId: string;
  name: string;
  isDefault: boolean;
  active: boolean;
  sortOrder: number;
  components: BomComponentInput[];
}

/**
 * Save one BOM — header plus its COMPLETE component list, which replaces
 * whatever was there. Goes through an RPC rather than a direct table write
 * because two things here must be atomic: clearing the FG's previous default
 * before setting this one (a partial unique index permits exactly one), and the
 * delete-then-insert of the components (split across two supabase-js calls, a
 * failed insert would leave the BOM empty).
 */
export async function saveBom(input: BomInput): Promise<string> {
  const { data, error } = await db.rpc("fms_production_save_bom", {
    p: {
      id: input.id ?? "",
      fg_item_id: input.fgItemId,
      name: input.name,
      is_default: input.isDefault,
      active: input.active,
      sort_order: input.sortOrder,
      components: input.components.map((c, i) => ({
        raw_material_id: c.rawMaterialId,
        pct: c.pct ?? "0",
        sort_order: i,
      })),
    },
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/** One parsed BOM block from the spreadsheet — names, not ids. */
export interface BomImportBlock {
  fgItem: string;
  bomName: string;
  components: { rawMaterial: string; pct: number }[];
}

export interface BomImportResult {
  boms_added: number;
  boms_updated: number;
  components: number;
  fg_items_created: number;
  raw_materials_created: number;
}

/**
 * Apply a parsed spreadsheet. The RPC matches FG items and raw materials by name
 * (case-insensitively) and CREATES any that are missing — which is why it runs
 * SECURITY DEFINER: those two masters' RLS policies would otherwise reject a BOM
 * owner who doesn't also own them, halfway through the import.
 */
export async function importBoms(blocks: BomImportBlock[]): Promise<BomImportResult> {
  const { data, error } = await db.rpc("fms_production_import_boms", {
    p: {
      boms: blocks.map((b) => ({
        fg_item: b.fgItem,
        bom_name: b.bomName,
        components: b.components.map((c) => ({ raw_material: c.rawMaterial, pct: c.pct })),
      })),
    },
  });
  if (error) throw new Error(error.message);
  return data as BomImportResult;
}

/* ============================ MASTER GOVERNANCE ========================== */

export async function setMasterManagers(masterType: ProductionMasterType, userIds: string[]): Promise<void> {
  const { error: delError } = await db
    .from("fms_production_master_managers")
    .delete()
    .eq("master_type", masterType);
  if (delError) throw new Error(delError.message);

  if (userIds.length === 0) return;
  const { error } = await db
    .from("fms_production_master_managers")
    .insert(userIds.map((id) => ({ master_type: masterType, manager_user_id: id })));
  if (error) throw new Error(error.message);
}

/** Raise a "Request new …" submission. RLS requires requested_by = auth.uid(). */
export async function requestNewMaster(
  masterType: ProductionMasterType,
  payload: Record<string, unknown>,
  requestedBy: string,
): Promise<string> {
  const { data, error } = await db
    .from("fms_production_master_requests")
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
  const { data, error } = await db.rpc("fms_production_resolve_master_request", {
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
  entityType: ProductionEntityType;
  entityId: string;
  type: string;
  text: string;
  recipients?: string[];
  meta?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await db.rpc("fms_production_announce", {
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
    .from("fms_production_notifications")
    .update({ read_at: new Date().toISOString() })
    .in("id", ids)
    .is("read_at", null);
  if (error) throw new Error(error.message);
}
