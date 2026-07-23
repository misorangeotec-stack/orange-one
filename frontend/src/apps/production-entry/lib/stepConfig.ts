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
  rm_transfer: {
    stepKey: "rm_transfer",
    title: "RM Transfer to Production",
    actionLabel: "Transfer to production",
    description: "Job cards awaiting the raw-material transfer to production (Tally location transfer).",
    completedBlurb: "RM transfers you record appear here, and stay revisable until the log book entry is recorded.",
    // The date auto-stamps on save; the handover details are shown read-only by
    // StepModal. Only the Tally entry + Remarks are captured here.
    fields: [
      { key: "rmt_tally_entry", label: "Tally Entry", kind: "text", get: (r) => s(r.rmtTallyEntry), placeholder: "Tally location-transfer entry" },
      { key: "rmt_remarks", label: "Remarks", kind: "textarea", get: (r) => s(r.rmtRemarks) },
    ],
    captured: { key: "rmtEntry", header: "Tally Entry", get: (r) => s(r.rmtTallyEntry) || "—" },
  },
  transfer_slip: {
    stepKey: "transfer_slip",
    title: "Log Book Entry",
    actionLabel: "Record log book entry",
    description: "Job cards awaiting the log book entry (actual use per raw material).",
    completedBlurb: "Log book entries you record appear here, and stay revisable until production entry is recorded.",
    // The date auto-stamps on save; the per-raw-material log-book grid (actual use,
    // added items), the OUTPUT METRICS (expected/scrap/actual output/lab/packed/
    // loose) and the mandatory attachment are rendered by StepModal itself — only
    // Remarks is a plain field here.
    fields: [
      { key: "ts_remarks", label: "Remarks", kind: "textarea", get: (r) => s(r.tsRemarks) },
    ],
    captured: { key: "output", header: "Actual Output", get: (r) => numOrDash(r.actualQty) },
  },
  production_entry: {
    stepKey: "production_entry",
    title: "Production Entry",
    actionLabel: "Record production",
    description: "Job cards awaiting the production entry to be recorded.",
    completedBlurb: "Production entries you record appear here, and stay revisable until quality checking is recorded.",
    // Now a Tally-posting step: the output metrics (expected/scrap/actual output/
    // lab/packed/loose) are captured at the log book and shown READ-ONLY here; the
    // read-only log-book item table + the Tally Entry input are rendered by
    // StepModal. Only Remarks is a plain field here.
    fields: [
      { key: "pe_remarks", label: "Remarks", kind: "textarea", get: (r) => s(r.peRemarks) },
    ],
    captured: { key: "peTally", header: "Tally Entry", get: (r) => s(r.peTallyEntry) || "—" },
  },
  quality_check: {
    stepKey: "quality_check",
    title: "Quality Checking",
    actionLabel: "Record quality check",
    description: "Job cards awaiting lab quality checking (approve / reject, with retests).",
    completedBlurb: "Quality checks you record appear here, and stay revisable until M/C testing is recorded.",
    // The multi-round approve/reject form (read-only top, test history, result +
    // date + remarks + attachment) is rendered entirely by StepModal.
    fields: [],
    captured: { key: "qcResult", header: "Result", get: (r) => (r.qcStatus ? r.qcStatus[0].toUpperCase() + r.qcStatus.slice(1) : "—") },
  },
  mc_testing: {
    stepKey: "mc_testing",
    title: "Testing of M/C",
    actionLabel: "Record M/C testing",
    description: "Job cards awaiting machine testing after lab testing (approve / reject).",
    completedBlurb: "M/C tests you record appear here, and stay revisable until the packing-material handover is recorded.",
    // The single approve/reject form (read-only top, result + remarks + optional
    // attachment) is rendered entirely by StepModal.
    fields: [],
    captured: { key: "mcResult", header: "Result", get: (r) => (r.mcStatus ? r.mcStatus[0].toUpperCase() + r.mcStatus.slice(1) : "—") },
  },
  pm_handover: {
    stepKey: "pm_handover",
    title: "Packing Material Handover",
    actionLabel: "Record PM handover",
    description: "Job cards awaiting packing-material handover for packing.",
    completedBlurb: "Handovers you record appear here, and stay revisable until the packing-material transfer is recorded.",
    // The FG packed-qty box and the multi-line packaging grid (item + qty + auto
    // unit + total) are rendered entirely by StepModal.
    fields: [],
    captured: { key: "pmhQty", header: "FG Packed Qty", get: (r) => numOrDash(r.pmhQty) },
  },
  pm_transfer: {
    stepKey: "pm_transfer",
    title: "Packing Material Transfer to Production",
    actionLabel: "Confirm transfer",
    description: "Job cards awaiting the packing-material transfer confirmation.",
    completedBlurb: "Transfers you confirm appear here, and stay revisable until the packing entry is recorded.",
    // View-only: StepModal shows the production-entry Tally no., FG packed qty and
    // the handover's packaging list; the user just saves to advance.
    fields: [],
    captured: { key: "pmtDate", header: "Transferred", get: (r) => dmy(r.pmtActualDate), isDate: true },
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
