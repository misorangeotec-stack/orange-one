/**
 * Domain types for the Production Entry FMS (ink production floor).
 *
 * A job-card tracker with ONE entity per card (no header/line split). The card
 * moves through a strictly linear ten-step chain; every DB row is mapped
 * snake_case → camelCase in data/productionFetch.ts.
 */

/** STATUSES ARE NOT STEP KEYS — closed / on_hold / cancelled leave every queue. */
export type ProductionStatus =
  | "awaiting_material_handover"
  | "awaiting_rm_transfer"
  | "awaiting_transfer_slip"
  | "awaiting_production"
  | "awaiting_quality"
  | "awaiting_mc_testing"
  | "awaiting_pm_handover"
  | "awaiting_pm_transfer"
  | "awaiting_packing"
  | "awaiting_fg_transfer"
  | "closed"
  | "on_hold"
  | "cancelled";

/** Every simple name+active master shares this shape. */
export interface NamedMaster {
  id: string;
  name: string;
  active: boolean;
  sortOrder: number;
}
export type Category = NamedMaster;
/** A raw material carries its own unit of measure (shown automatically on pick). */
export interface RawMaterial extends NamedMaster {
  unitId: string | null;
}
/** A packaging item likewise carries its own unit (shown automatically on pick). */
export interface PackagingItem extends NamedMaster {
  unitId: string | null;
}
/** An FG item likewise carries its own unit (shown automatically wherever it appears). */
export interface FgItem extends NamedMaster {
  unitId: string | null;
}
export type Unit = NamedMaster;

/** One raw-material line of a job card's BOM (intake-only reference data). */
export interface BomLine {
  rawMaterialId: string | null;
  requiredQty: number | null;
  unitId: string | null;
}

/** One raw-material line of the material handover: the ACTUAL qty handed over
 *  and its issue lot number (pre-filled from the issue-slip BomLine). */
export interface HandoverBomLine {
  rawMaterialId: string | null;
  unitId: string | null;
  qty: number | null;
  lotNo: string | null;
}

/** One packaging line of the packing-material handover: the packaging item (from
 *  the packaging master, carrying its own unit) and the quantity handed over. */
export interface PackingBomLine {
  packagingItemId: string | null;
  unitId: string | null;
  qty: number | null;
}

/** One quality test round (approve / reject) inside the quality-checking step. */
export interface QualityRound {
  round: number;
  testDate: string | null;
  result: "approved" | "rejected" | null;
  remarks: string | null;
  attachmentPath: string | null;
  attachmentName: string | null;
}

/** One line of the Log Book Entry (step 3): the (locked) requested + handover
 *  quantities and lot carried from earlier steps, plus this step's ACTUAL USE.
 *  `isNew` items are added here — a master pick (rawMaterialId set) or free text
 *  (name only) — with their own lot number. */
export interface LogBookLine {
  rawMaterialId: string | null;
  rawMaterialName: string | null;
  unitId: string | null;
  requestedQty: number | null;
  handoverQty: number | null;
  actualUse: number | null;
  lotNo: string | null;
  isNew: boolean;
}

export interface ProductionRequest {
  id: string;
  reqNo: string;

  // issue slip (step 1)
  jobcardNo: string;
  categoryId: string | null;
  // Legacy single-RM columns — mirror the FIRST bom line (fallback for cards
  // raised before multi-RM intake, and what the downstream steps still read).
  rawMaterialId: string | null;
  requiredQty: number | null;
  unitId: string | null;
  // The full multi-raw-material BOM (intake-only reference data). Empty for
  // legacy cards; display falls back to the single columns above.
  bomLines: BomLine[];
  fgItemId: string | null;
  issueRemarks: string | null;
  raisedBy: string | null;
  requesterName: string;

  status: ProductionStatus;
  currentStep: string;
  submittedAt: string;

  // step 2: material_handover
  mhActualDate: string | null;
  mhStatus: string | null;
  mhQty: number | null;
  mhBomLines: HandoverBomLine[];
  rmBookNo: string | null;
  mhRemarks: string | null;
  mhAt: string | null;
  mhBy: string | null;

  // step 2.5: rm_transfer — "RM Transfer to Production" (the Tally location transfer)
  rmtActualDate: string | null;
  rmtTallyEntry: string | null;
  rmtRemarks: string | null;
  rmtAt: string | null;
  rmtBy: string | null;

  // step 3: transfer_slip (displayed as "Log Book Entry")
  tsActualDate: string | null;
  tsStatus: string | null;
  transferSlipNo: string | null;
  batchCardNo: string | null;
  tsBomLines: LogBookLine[];
  // Production output metrics — captured HERE (the log book), shown read-only at
  // production entry. Expected = Σ actual use; Actual Output = expected − scrap;
  // Loose = Actual Output − Lab − Packed. Expected/scrap/actual/lab reuse the
  // pe_* / scrap columns; packed + loose are the two ts_* columns below.
  tsPackedQty: number | null;
  tsLooseQty: number | null; // = actualQty − peLabQty − tsPackedQty
  tsAttachmentPath: string | null;
  tsAttachmentName: string | null;
  tsRemarks: string | null;
  tsAt: string | null;
  tsBy: string | null;

  // step 4: production_entry — now a Tally-posting step (metrics captured at the
  // log book, shown read-only here). It captures only the Tally entry + remarks.
  peActualDate: string | null;
  peStatus: string | null;
  peExpectedQty: number | null;
  actualQty: number | null; // actual output = expected − scrap
  scrapQty: number | null;
  peLabQty: number | null;
  peTallyEntry: string | null;
  lotNo: string | null;
  peRemarks: string | null;
  peAt: string | null;
  peBy: string | null;

  // step 5: quality_check (multi-round approve/reject)
  qcActualDate: string | null;
  qcStatus: string | null;
  qcRemarks: string | null;
  qcAttachmentPath: string | null;
  qcAttachmentName: string | null;
  qcRounds: QualityRound[];
  qcRetestDue: string | null;
  qcAt: string | null;
  qcBy: string | null;

  // step 6: mc_testing — a single approve/reject (mcStatus = "approved" | "rejected")
  mcActualDate: string | null;
  mcStatus: string | null;
  mcRemarks: string | null;
  mcAttachmentPath: string | null;
  mcAttachmentName: string | null;
  mcAt: string | null;
  mcBy: string | null;

  // step 7: pm_handover — FG packed qty + packaging lines
  pmhActualDate: string | null;
  pmhStatus: string | null;
  pmhQty: number | null;
  pmhBatchNo: string | null;
  pmhBomLines: PackingBomLine[];
  pmhRemarks: string | null;
  pmhAt: string | null;
  pmhBy: string | null;

  // step 8: pm_transfer
  pmtActualDate: string | null;
  pmtStatus: string | null;
  pmtQty: number | null;
  pmtRemarks: string | null;
  pmtAt: string | null;
  pmtBy: string | null;

  // step 9: packing_entry
  pkActualDate: string | null;
  pkStatus: string | null;
  packedQty: number | null;
  looseInkQty: number | null;
  pkRemarks: string | null;
  pkAt: string | null;
  pkBy: string | null;

  // step 10: fg_transfer (UI "FG Transfer to Godown") — two Tally-entry ticks close the card
  fgActualDate: string | null;
  fgStatus: string | null;
  finalQty: number | null;
  fgRemarks: string | null;
  fgProdToFg: boolean; // "Production → Finished Goods" Tally entry made
  fgToHojiwala: boolean; // "Finished Goods → Hojiwala" Tally entry made
  fgAt: string | null;
  fgBy: string | null;
  closedAt: string | null;

  editedAt: string | null;
  editedBy: string | null;
  holdAt: string | null;
  holdReason: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
}

/* ------------------------------ master governance ------------------------- */

export type ProductionMasterType = "category" | "raw_material" | "fg_item" | "unit" | "packaging_item";

// Category is retained in the union above (legacy master_requests / managers rows
// may still reference it) but is intentionally omitted from this registry so it no
// longer surfaces on any UI (Masters tabs, Master Owners, Master Requests, the
// request-new-master modal). The intake no longer captures a category.
export const PRODUCTION_MASTER_TYPES: { value: ProductionMasterType; label: string; plural: string }[] = [
  { value: "raw_material", label: "Raw Material", plural: "Raw Materials" },
  { value: "packaging_item", label: "Packaging Item", plural: "Packaging Items" },
  { value: "fg_item", label: "FG Item", plural: "FG Items" },
  { value: "unit", label: "Unit", plural: "Units" },
];

export interface ProductionMasterManager {
  id: string;
  masterType: ProductionMasterType;
  managerUserId: string;
}

export type MasterRequestStatus = "pending" | "approved" | "rejected";

export interface ProductionMasterRequest {
  id: string;
  masterType: ProductionMasterType;
  proposedPayload: Record<string, unknown>;
  status: MasterRequestStatus;
  requestedBy: string | null;
  reviewedBy: string | null;
  reviewNote: string | null;
  resolvedMasterId: string | null;
  createdAt: string;
}

/* --------------------------------- config --------------------------------- */

export interface StepOwner {
  id: string;
  stepKey: string;
  departmentIds: string[];
  designationId: string | null;
  employeeIds: string[];
}

export interface Designation {
  id: string;
  name: string;
  active: boolean;
}

/* ------------------------------ activity + bell --------------------------- */

export type ProductionEntityType = "request" | "master_request";

export interface ProductionActivity {
  id: string;
  entityType: ProductionEntityType;
  entityId: string;
  type: string;
  actorId: string | null;
  note: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
}

export interface ProductionNotification {
  id: string;
  userId: string;
  type: string;
  entityType: ProductionEntityType;
  entityId: string;
  text: string;
  actorId: string | null;
  readAt: string | null;
  createdAt: string;
}
