/**
 * Per-step field descriptors that drive the ONE generic step modal + queue page.
 *
 * Each queue step captures its own set of fields (dates, statuses, quantities,
 * remarks). Rather than nine near-identical modal files, every step is described
 * here — its editable fields, the value each pre-fills from, and the one "captured"
 * column its completed-tab shows. The `key` of every field is the jsonb payload key
 * read verbatim by the matching `fms_production_record_*` / `_update_*` RPC.
 */
import type { ProductionRequest } from "../types";
import type { QueueStep } from "./queues";
import { dmy, numOrDash } from "./format";

export type StepFieldKind = "date" | "text" | "number" | "textarea" | "status";

export interface StepField {
  key: string;
  label: string;
  kind: StepFieldKind;
  /** Current value, for edit/prefill. */
  get: (r: ProductionRequest) => string;
  placeholder?: string;
  hint?: string;
}

export interface CapturedColumn {
  key: string;
  header: string;
  get: (r: ProductionRequest) => string;
  isDate?: boolean;
}

export interface StepConfig {
  stepKey: QueueStep;
  title: string;
  actionLabel: string;
  description: string;
  completedBlurb: string;
  fields: StepField[];
  hasAttachment?: boolean;
  captured: CapturedColumn;
}

/** The per-step "Status of …" pick-list (matches the source sheet). */
export const STATUS_OPTIONS = [
  { value: "Completed", label: "Completed" },
  { value: "Pending", label: "Pending" },
  { value: "Not Applicable", label: "Not Applicable" },
];

const s = (v: string | null | undefined): string => v ?? "";
const n = (v: number | null | undefined): string => (v != null ? String(v) : "");

export const STEP_CONFIG: Record<QueueStep, StepConfig> = {
  material_handover: {
    stepKey: "material_handover",
    title: "Material Handover Confirmation",
    actionLabel: "Record handover",
    description: "Job cards awaiting the raw-material handover to be confirmed.",
    completedBlurb: "Handovers you record appear here, and stay revisable until the transfer slip is created.",
    // The date auto-stamps on save and the per-raw-material handover grid (actual
    // qty + issue lot no) is rendered by StepModal itself — only RM Book No. and
    // Remarks are plain fields here.
    fields: [
      { key: "rm_book_no", label: "RM Book No.", kind: "text", get: (r) => s(r.rmBookNo) },
      { key: "mh_remarks", label: "Remarks", kind: "textarea", get: (r) => s(r.mhRemarks) },
    ],
    captured: { key: "mhDate", header: "Handover date", get: (r) => dmy(r.mhActualDate), isDate: true },
  },
  transfer_slip: {
    stepKey: "transfer_slip",
    title: "Transfer Slip & Batch Card Creation",
    actionLabel: "Record transfer slip",
    description: "Job cards awaiting the transfer slip and batch card to be created.",
    completedBlurb: "Transfer slips you record appear here, and stay revisable until production entry is recorded.",
    fields: [
      { key: "ts_actual_date", label: "Actual date of creation", kind: "date", get: (r) => s(r.tsActualDate), hint: "defaults to today if left blank" },
      { key: "ts_status", label: "Status of card creation", kind: "status", get: (r) => s(r.tsStatus) },
      { key: "transfer_slip_no", label: "Transfer Slip No.", kind: "text", get: (r) => s(r.transferSlipNo) },
      { key: "batch_card_no", label: "Batch Card No.", kind: "text", get: (r) => s(r.batchCardNo) },
      { key: "ts_remarks", label: "Remark", kind: "textarea", get: (r) => s(r.tsRemarks) },
    ],
    captured: { key: "slipNo", header: "Transfer Slip No.", get: (r) => s(r.transferSlipNo) || "—" },
  },
  production_entry: {
    stepKey: "production_entry",
    title: "Production Entry",
    actionLabel: "Record production",
    description: "Job cards awaiting the production entry to be recorded.",
    completedBlurb: "Production entries you record appear here, and stay revisable until quality checking is recorded.",
    fields: [
      { key: "pe_actual_date", label: "Actual date of production entry", kind: "date", get: (r) => s(r.peActualDate), hint: "defaults to today if left blank" },
      { key: "pe_status", label: "Status of production entry", kind: "status", get: (r) => s(r.peStatus) },
      { key: "actual_qty", label: "Actual Qty", kind: "number", get: (r) => n(r.actualQty) },
      { key: "scrap_qty", label: "Scrap", kind: "number", get: (r) => n(r.scrapQty) },
      { key: "lot_no", label: "LOT No.", kind: "text", get: (r) => s(r.lotNo) },
      { key: "pe_remarks", label: "Remarks", kind: "textarea", get: (r) => s(r.peRemarks) },
    ],
    captured: { key: "lotNo", header: "LOT No.", get: (r) => s(r.lotNo) || "—" },
  },
  quality_check: {
    stepKey: "quality_check",
    title: "Quality Checking",
    actionLabel: "Record quality check",
    description: "Job cards awaiting lab quality checking after production.",
    completedBlurb: "Quality checks you record appear here, and stay revisable until M/C testing is recorded.",
    hasAttachment: true,
    fields: [
      { key: "qc_actual_date", label: "Actual date of lab testing", kind: "date", get: (r) => s(r.qcActualDate), hint: "defaults to today if left blank" },
      { key: "qc_status", label: "Status of lab testing", kind: "status", get: (r) => s(r.qcStatus) },
      { key: "qc_remarks", label: "Remarks if any", kind: "textarea", get: (r) => s(r.qcRemarks) },
    ],
    captured: { key: "qcDate", header: "Lab testing date", get: (r) => dmy(r.qcActualDate), isDate: true },
  },
  mc_testing: {
    stepKey: "mc_testing",
    title: "Testing of M/C",
    actionLabel: "Record M/C testing",
    description: "Job cards awaiting machine testing after lab testing.",
    completedBlurb: "M/C tests you record appear here, and stay revisable until the packing-material handover is recorded.",
    fields: [
      { key: "mc_actual_date", label: "Actual date of M/C testing", kind: "date", get: (r) => s(r.mcActualDate), hint: "defaults to today if left blank" },
      { key: "mc_status", label: "Status of M/C testing", kind: "status", get: (r) => s(r.mcStatus) },
      { key: "mc_remarks", label: "Remarks", kind: "textarea", get: (r) => s(r.mcRemarks) },
    ],
    captured: { key: "mcDate", header: "M/C testing date", get: (r) => dmy(r.mcActualDate), isDate: true },
  },
  pm_handover: {
    stepKey: "pm_handover",
    title: "Packing Material Handover",
    actionLabel: "Record PM handover",
    description: "Job cards awaiting packing-material handover for packing.",
    completedBlurb: "Handovers you record appear here, and stay revisable until the packing-material transfer is recorded.",
    fields: [
      { key: "pmh_actual_date", label: "Actual date of PM transfer", kind: "date", get: (r) => s(r.pmhActualDate), hint: "defaults to today if left blank" },
      { key: "pmh_status", label: "Status of PM transfer", kind: "status", get: (r) => s(r.pmhStatus) },
      { key: "pmh_qty", label: "Qty transfer", kind: "number", get: (r) => n(r.pmhQty) },
      { key: "pmh_batch_no", label: "Batch No. against material transfer", kind: "text", get: (r) => s(r.pmhBatchNo) },
      { key: "pmh_remarks", label: "Remarks", kind: "textarea", get: (r) => s(r.pmhRemarks) },
    ],
    captured: { key: "pmhDate", header: "PM handover date", get: (r) => dmy(r.pmhActualDate), isDate: true },
  },
  pm_transfer: {
    stepKey: "pm_transfer",
    title: "Packing Material Transfer to Production",
    actionLabel: "Record PM transfer",
    description: "Job cards awaiting the packing-material transfer entry.",
    completedBlurb: "Transfers you record appear here, and stay revisable until the packing entry is recorded.",
    fields: [
      { key: "pmt_actual_date", label: "Actual date of PM transfer entry", kind: "date", get: (r) => s(r.pmtActualDate), hint: "defaults to today if left blank" },
      { key: "pmt_status", label: "Status of PM transfer", kind: "status", get: (r) => s(r.pmtStatus) },
      { key: "pmt_qty", label: "PM transfer qty", kind: "number", get: (r) => n(r.pmtQty) },
      { key: "pmt_remarks", label: "Remarks", kind: "textarea", get: (r) => s(r.pmtRemarks) },
    ],
    captured: { key: "pmtQty", header: "PM transfer qty", get: (r) => numOrDash(r.pmtQty) },
  },
  packing_entry: {
    stepKey: "packing_entry",
    title: "Packing (Consumption) Entry",
    actionLabel: "Record packing",
    description: "Job cards awaiting the packing consumption entry.",
    completedBlurb: "Packing entries you record appear here, and stay revisable until the finished-good transfer is recorded.",
    fields: [
      { key: "pk_actual_date", label: "Actual date of packing entry", kind: "date", get: (r) => s(r.pkActualDate), hint: "defaults to today if left blank" },
      { key: "pk_status", label: "Status of packing entry", kind: "status", get: (r) => s(r.pkStatus) },
      { key: "packed_qty", label: "Packed Qty", kind: "number", get: (r) => n(r.packedQty) },
      { key: "loose_ink_qty", label: "Loose INK Qty", kind: "number", get: (r) => n(r.looseInkQty) },
      { key: "pk_remarks", label: "Remarks", kind: "textarea", get: (r) => s(r.pkRemarks) },
    ],
    captured: { key: "packedQty", header: "Packed Qty", get: (r) => numOrDash(r.packedQty) },
  },
  fg_transfer: {
    stepKey: "fg_transfer",
    title: "Finished Good Transfer to Hojiwala",
    actionLabel: "Record transfer & close",
    description: "Job cards awaiting the finished-good transfer to Hojiwala — recording it closes the card.",
    completedBlurb: "Finished-good transfers you record appear here. As the last step it stays editable after the card closes.",
    fields: [
      { key: "fg_actual_date", label: "Actual date of transfer to Hojiwala", kind: "date", get: (r) => s(r.fgActualDate), hint: "defaults to today if left blank" },
      { key: "fg_status", label: "Status of Hojiwala transfer entry", kind: "status", get: (r) => s(r.fgStatus) },
      { key: "final_qty", label: "Final Qty", kind: "number", get: (r) => n(r.finalQty) },
      { key: "fg_remarks", label: "Remarks", kind: "textarea", get: (r) => s(r.fgRemarks) },
    ],
    captured: { key: "finalQty", header: "Final Qty", get: (r) => numOrDash(r.finalQty) },
  },
};
