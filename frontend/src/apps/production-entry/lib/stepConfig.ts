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
  /** When true, the field must be filled before Save is enabled (text fields). */
  required?: boolean;
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

/** The latest additional issue slip round's top-up qty (for the AIS captured column). */
const latestAisQty = (r: ProductionRequest): string => {
  const last = r.aisRounds[r.aisRounds.length - 1];
  return last?.aisQty != null ? String(last.aisQty) : "—";
};

export const STEP_CONFIG: Record<QueueStep, StepConfig> = {
  material_handover: {
    stepKey: "material_handover",
    title: "Material Handover Confirmation",
    actionLabel: "Record handover",
    description: "Job cards awaiting the raw-material handover to be confirmed.",
    completedBlurb: "Handovers you record appear here, and stay revisable until the RM transfer to production is recorded.",
    // The date auto-stamps on save and the per-raw-material handover grid (actual
    // qty + issue lot no) is rendered by StepModal itself — only Remarks is a plain
    // field here (RM Book No. was removed).
    fields: [
      { key: "mh_remarks", label: "Remarks", kind: "textarea", get: (r) => s(r.mhRemarks) },
    ],
    captured: { key: "mhDate", header: "Handover date", get: (r) => dmy(r.mhActualDate), isDate: true },
  },
  rm_transfer: {
    stepKey: "rm_transfer",
    title: "RM Transfer to Production (Tally)",
    actionLabel: "Transfer to production",
    description: "Job cards awaiting the raw-material transfer to production (Tally location transfer).",
    completedBlurb: "RM transfers you record appear here, and stay revisable until quality checking is recorded.",
    // The date auto-stamps on save; the handover details are shown read-only by
    // StepModal. Only the Tally entry + Remarks are captured here.
    fields: [
      { key: "rmt_tally_entry", label: "Tally Entry", kind: "text", get: (r) => s(r.rmtTallyEntry), placeholder: "Tally location-transfer entry", required: true },
      { key: "rmt_remarks", label: "Remarks", kind: "textarea", get: (r) => s(r.rmtRemarks) },
    ],
    captured: { key: "rmtEntry", header: "Tally Entry", get: (r) => s(r.rmtTallyEntry) || "—" },
  },
  quality_check: {
    stepKey: "quality_check",
    title: "Quality Checking",
    actionLabel: "Record quality check",
    description: "Job cards awaiting lab quality checking — approve to proceed to the log book, or reject to raise an additional issue slip.",
    completedBlurb: "Quality checks you record appear here, and stay revisable until the log book entry is recorded.",
    // The multi-round approve/reject form (read-only top, test history, result +
    // date + remarks + attachment) is rendered entirely by StepModal.
    fields: [],
    captured: { key: "qcResult", header: "Result", get: (r) => (r.qcStatus ? r.qcStatus[0].toUpperCase() + r.qcStatus.slice(1) : "—") },
  },
  additional_issue_slip: {
    stepKey: "additional_issue_slip",
    title: "Generate Additional Issue Slip",
    actionLabel: "Generate issue slip",
    description: "QC-rejected lots awaiting a top-up: add an extra FG quantity and the extra raw material, then re-run handover → RM transfer → quality.",
    completedBlurb: "Additional issue slips you raise appear here until the top-up material handover is recorded.",
    // The additional-qty field + additional-RM grid (sum-matched) is rendered by StepModal.
    fields: [],
    captured: { key: "aisQty", header: "Extra Qty", get: (r) => latestAisQty(r) },
  },
  transfer_slip: {
    stepKey: "transfer_slip",
    title: "Log Book Entry",
    actionLabel: "Record log book entry",
    description: "Job cards awaiting the log book entry (actual use per raw material, output and packing).",
    completedBlurb: "Log book entries you record appear here, and stay revisable until production entry is recorded.",
    // The date auto-stamps on save; the per-raw-material log-book grid (combined
    // with any additional issue slips), the OUTPUT METRICS (expected/loss/scrap/
    // actual/lab/packed/loose), the PACKING grid and the mandatory attachment are
    // rendered by StepModal — only Remarks is a plain field here.
    fields: [
      { key: "ts_remarks", label: "Remarks", kind: "textarea", get: (r) => s(r.tsRemarks) },
    ],
    captured: { key: "output", header: "Actual Output", get: (r) => numOrDash(r.actualQty) },
  },
  production_entry: {
    stepKey: "production_entry",
    title: "Production Entry (Tally)",
    actionLabel: "Record production",
    description: "Job cards awaiting the production entry to be recorded.",
    completedBlurb: "Production entries you record appear here, and stay revisable until M/C testing is recorded.",
    // Now a Tally-posting step: the output metrics (expected/loss/scrap/actual/
    // lab/packed/loose) are captured at the log book and shown READ-ONLY here; the
    // read-only log-book item table + the Tally Entry input are rendered by
    // StepModal. Only Remarks is a plain field here.
    fields: [
      { key: "pe_remarks", label: "Remarks", kind: "textarea", get: (r) => s(r.peRemarks) },
    ],
    captured: { key: "peTally", header: "Tally Entry", get: (r) => s(r.peTallyEntry) || "—" },
  },
  mc_testing: {
    stepKey: "mc_testing",
    title: "Testing of M/C",
    actionLabel: "Record M/C testing",
    description: "Job cards awaiting machine testing after lab testing (approve / reject / bypass).",
    completedBlurb: "M/C tests you record appear here, and stay revisable until the packing-material transfer is recorded.",
    // The approve / reject / bypass form (read-only top, result + remarks + optional
    // attachment) is rendered entirely by StepModal. Bypass is admin-only.
    fields: [],
    captured: { key: "mcResult", header: "Result", get: (r) => (r.mcStatus ? r.mcStatus[0].toUpperCase() + r.mcStatus.slice(1) : "—") },
  },
  pm_transfer: {
    stepKey: "pm_transfer",
    title: "Packing Material Transfer (Tally)",
    actionLabel: "Confirm transfer",
    description: "Job cards awaiting the packing-material transfer confirmation.",
    completedBlurb: "Transfers you confirm appear here, and stay revisable until the packing entry is recorded.",
    // View-only: StepModal shows the production-entry Tally no., FG packed qty and
    // the log book's packaging list; the user just saves to advance.
    fields: [],
    captured: { key: "pmtDate", header: "Transferred", get: (r) => dmy(r.pmtActualDate), isDate: true },
  },
  packing_entry: {
    stepKey: "packing_entry",
    title: "Packing Entry (Tally)",
    actionLabel: "Record packing",
    description: "Job cards awaiting the packing consumption entry.",
    completedBlurb: "Packing entries you record appear here, and stay revisable until the card is marked ready to dispatch.",
    // Review-only step: StepModal shows the net packing qty (Actual Output − Lab),
    // the packed/loose qtys + production Tally entry (from earlier steps) and the
    // log book's packaging list, all READ-ONLY. The user just Saves to log it in Tally.
    fields: [],
    captured: {
      key: "netQty",
      header: "Net Qty",
      get: (r) => numOrDash(r.actualQty != null ? Math.round((r.actualQty - (r.peLabQty ?? 0)) * 1000) / 1000 : null),
    },
  },
  ready_to_dispatch: {
    stepKey: "ready_to_dispatch",
    title: "Ready to Dispatch",
    actionLabel: "Ready to dispatch",
    description: "Packed FG items ready to move to FG transfer to godown — select one or many and mark them ready.",
    completedBlurb: "Cards you marked ready to dispatch appear here.",
    // A dedicated multi-select page renders this step; the config drives its heading.
    fields: [],
    captured: { key: "packedQty", header: "Packed Qty", get: (r) => numOrDash(r.tsPackedQty) },
  },
  fg_transfer: {
    stepKey: "fg_transfer",
    title: "FG Transfer to Godown (Tally)",
    actionLabel: "Transfer to godown",
    description: "Job cards ready for the finished-good transfer to the godown — select cards and upload the Tally voucher to close them.",
    completedBlurb: "Finished-good transfers you record appear here. As the last step it stays editable after the card closes.",
    // A dedicated multi-select page renders this step (upload one Tally file to close).
    fields: [],
    captured: { key: "packedQty", header: "Packed Qty", get: (r) => numOrDash(r.tsPackedQty) },
  },
};
