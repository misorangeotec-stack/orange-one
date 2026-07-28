/**
 * Per-step field descriptors that drive the ONE generic step modal + stage queue.
 *
 * Each queue step captures its own set of fields (dates, statuses, master picks,
 * quantities, remarks). Rather than six near-identical modal files, every step is
 * described here — its editable fields, the value each pre-fills from, and the one
 * "captured" column its Completed tab shows.
 *
 * ⚠ WIRE CONTRACT: the `key` of every field is the jsonb payload key read VERBATIM
 *   by the matching `fms_dispatch_record_*` / `fms_dispatch_update_*` RPC. Rename
 *   one here without renaming it in the migration and the value is silently dropped.
 *
 * This module stays PURE — no React, no store import. Master-backed dropdowns name
 * the list they want via `optionsFrom`; StepModal resolves it from the store. That
 * is what lets the same descriptor drive both the record and the edit path.
 */
import type { DispatchOrder } from "../types";
import type { QueueStep } from "./queues";
import {
  CREDIT_STATUS_LABEL,
  DELIVERY_STATUS_LABEL,
  MATERIAL_STATUS_LABEL,
  dmy,
  numOrDash,
} from "./format";

/**
 * `select` is new relative to the Production Entry template this is modelled on:
 * this FMS picks LOTs, transporters, vehicles, drivers, godowns, gates, invoice
 * series and payment terms from masters, and the house rule is that a master pick
 * is never free text.
 */
export type StepFieldKind = "date" | "datetime" | "text" | "number" | "textarea" | "select";

/** Which master list a `select` field draws from. Resolved by StepModal. */
export type OptionSource =
  | "payment_term" | "godown" | "company" | "invoice_series"
  | "gate" | "vehicle" | "driver" | "transporter";

export interface StepField {
  key: string;
  label: string;
  kind: StepFieldKind;
  /** Current value, for edit/prefill. Always a string — the modal is string-keyed. */
  get: (o: DispatchOrder) => string;
  /** `select` backed by a master list. */
  optionsFrom?: OptionSource;
  /** `select` backed by a fixed code enum (a branch condition, never a master). */
  choices?: { value: string; label: string }[];
  placeholder?: string;
  hint?: string;
  /** Save stays disabled until this is filled. */
  required?: boolean;
  /**
   * Conditional fields. `values` is the live form state; `order` is the row being
   * acted on (null only in the impossible no-row case).
   */
  showWhen?: (values: Record<string, string>, order: DispatchOrder | null) => boolean;
}

export interface CapturedColumn {
  key: string;
  header: string;
  get: (o: DispatchOrder) => string;
  isDate?: boolean;
}

export interface StepConfig {
  stepKey: QueueStep;
  title: string;
  actionLabel: string;
  /** Blurb above the Pending tab. */
  description: string;
  /** Blurb above the Completed tab. */
  completedBlurb: string;
  fields: StepField[];
  /** Renders the file picker and routes the upload into this bucket folder. */
  attachment?: { label: string; folder: string; pathKey: string; nameKey: string; required?: boolean };
  /** Renders the per-line grid for this step. */
  lines?: "material_status" | "lot_confirm";
  /** The one column the Completed tab shows. */
  captured: CapturedColumn;
}

/** The generic per-step "Status of …" pick-list, matching the source sheet. */
export const STEP_STATUS_OPTIONS = [
  { value: "Completed", label: "Completed" },
  { value: "Pending", label: "Pending" },
  { value: "Not Applicable", label: "Not Applicable" },
];

/** Sheet dropdown: Status - Credit Confirmation. */
export const CREDIT_STATUS_OPTIONS = [
  { value: "credit_available", label: CREDIT_STATUS_LABEL.credit_available },
  { value: "payment_required", label: CREDIT_STATUS_LABEL.payment_required },
];

/** Sheet dropdown: Status - Confirmation (material availability). */
export const MATERIAL_STATUS_OPTIONS = [
  { value: "available_for_dispatch", label: MATERIAL_STATUS_LABEL.available_for_dispatch },
  { value: "production_required", label: MATERIAL_STATUS_LABEL.production_required },
];

/** Delivery outcome. `returned` is a branch the RPC and the dashboard treat apart. */
export const DELIVERY_STATUS_OPTIONS = [
  { value: "delivered", label: DELIVERY_STATUS_LABEL.delivered },
  { value: "partially_delivered", label: DELIVERY_STATUS_LABEL.partially_delivered },
  { value: "returned", label: DELIVERY_STATUS_LABEL.returned },
];

const s = (v: string | null | undefined): string => v ?? "";
const n = (v: number | null | undefined): string => (v !== null && v !== undefined ? String(v) : "");
/** A timestamptz → the `datetime-local` input's yyyy-MM-ddTHH:mm. */
const dt = (v: string | null | undefined): string => {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const day = (v: string | null | undefined): string => (v ? v.slice(0, 10) : "");

const isTransport = (_v: Record<string, string>, o: DispatchOrder | null) => o?.dispatchType === "transport";
const isLocal = (_v: Record<string, string>, o: DispatchOrder | null) => o?.dispatchType === "local";

export const STEP_CONFIG: Record<QueueStep, StepConfig> = {
  credit_check: {
    stepKey: "credit_check",
    title: "Confirm Credit Limit",
    actionLabel: "Record credit confirmation",
    description: "Orders waiting on the collection team to confirm the customer's credit before the sales bill is processed.",
    completedBlurb: "Confirmations you record appear here, and stay revisable until the material-status check is recorded.",
    fields: [
      { key: "cc_actual_date", label: "Actual date", kind: "date", get: (o) => day(o.ccActualDate) },
      {
        key: "cc_status", label: "Credit outcome", kind: "select", required: true,
        choices: CREDIT_STATUS_OPTIONS, get: (o) => s(o.ccStatus),
        hint: "Payment Required opens the payment fields below",
      },
      { key: "cc_credit_limit", label: "Credit limit", kind: "number", get: (o) => n(o.ccCreditLimit),
        hint: "snapshotted, so the decision stays readable after the master changes" },
      { key: "cc_outstanding_amount", label: "Outstanding", kind: "number", get: (o) => n(o.ccOutstandingAmount) },
      {
        key: "cc_payment_term_id", label: "Payment term", kind: "select", optionsFrom: "payment_term",
        get: (o) => s(o.ccPaymentTermId),
      },
      {
        key: "cc_payment_ref", label: "Payment reference", kind: "text", get: (o) => s(o.ccPaymentRef),
        placeholder: "NEFT / cheque / UPI reference",
        showWhen: (v) => v.cc_status === "payment_required",
      },
      {
        key: "cc_payment_amount", label: "Amount received", kind: "number", get: (o) => n(o.ccPaymentAmount),
        showWhen: (v) => v.cc_status === "payment_required",
      },
      { key: "cc_remarks", label: "Remarks", kind: "textarea", get: (o) => s(o.ccRemarks) },
    ],
    captured: {
      key: "ccStatus", header: "Credit outcome",
      get: (o) => (o.ccStatus ? CREDIT_STATUS_LABEL[o.ccStatus] : "—"),
    },
  },

  material_status: {
    stepKey: "material_status",
    title: "Check Material Status",
    actionLabel: "Record material status",
    description:
      "Orders waiting on the store keeper's physical stock check. Due the same working day when the order arrived before the cut-off, the next working day after it.",
    completedBlurb: "Checks you record appear here, and stay revisable until LOT confirmation is recorded.",
    fields: [
      { key: "ms_actual_date", label: "Actual date", kind: "date", get: (o) => day(o.msActualDate) },
      {
        key: "ms_status", label: "Material status", kind: "select", required: true,
        choices: MATERIAL_STATUS_OPTIONS, get: (o) => s(o.msStatus),
        hint: "Production Required is recorded and the order continues - the shortfall is set per line at LOT confirmation",
      },
      { key: "ms_godown_id", label: "Godown checked", kind: "select", optionsFrom: "godown", get: (o) => s(o.msGodownId) },
      {
        key: "ms_planned_dispatch_date", label: "Planned dispatch date", kind: "date",
        get: (o) => day(o.msPlannedDispatchDate),
        hint: "this is the date the customer is told, if the auto-mail is on",
      },
      { key: "ms_remarks", label: "Remarks", kind: "textarea", get: (o) => s(o.msRemarks) },
    ],
    lines: "material_status",
    captured: {
      key: "msStatus", header: "Material status",
      get: (o) => (o.msStatus ? MATERIAL_STATUS_LABEL[o.msStatus] : "—"),
    },
  },

  lot_confirm: {
    stepKey: "lot_confirm",
    title: "Confirm LOT No. & Final Qty",
    actionLabel: "Confirm LOT and quantity",
    description: "Orders waiting on the store keeper to pick the LOT and confirm the quantity actually going out, line by line.",
    completedBlurb: "Confirmations you record appear here, and stay revisable until the sales bill is raised.",
    fields: [
      { key: "lc_actual_date", label: "Actual date", kind: "date", get: (o) => day(o.lcActualDate) },
      { key: "lc_status", label: "Status", kind: "select", choices: STEP_STATUS_OPTIONS, get: (o) => s(o.lcStatus) },
      { key: "lc_remarks", label: "Remarks", kind: "textarea", get: (o) => s(o.lcRemarks) },
    ],
    lines: "lot_confirm",
    captured: {
      key: "finalQty", header: "Final qty",
      get: (o) => {
        const total = o.lines.reduce((a, l) => a + (Number(l.finalQty) || 0), 0);
        const lots = o.lines.filter((l) => !!l.lotNoSnapshot).length;
        return total ? `${total} · ${lots} lot${lots === 1 ? "" : "s"}` : "—";
      },
    },
  },

  sales_bill: {
    stepKey: "sales_bill",
    title: "Generate Sales Bill",
    actionLabel: "Record sales bill",
    description: "Orders whose LOT and final quantity are confirmed and are waiting for the invoice to be raised in the system.",
    completedBlurb: "Bills you record appear here, and stay revisable until the gate-out entry is recorded.",
    fields: [
      { key: "sb_actual_date", label: "Actual date", kind: "date", get: (o) => day(o.sbActualDate) },
      { key: "sb_company_id", label: "Company", kind: "select", optionsFrom: "company", get: (o) => s(o.sbCompanyId) },
      { key: "sb_invoice_series_id", label: "Invoice series", kind: "select", optionsFrom: "invoice_series", get: (o) => s(o.sbInvoiceSeriesId) },
      { key: "sb_invoice_no", label: "Invoice no.", kind: "text", required: true, get: (o) => s(o.sbInvoiceNo), placeholder: "as generated in Tally" },
      { key: "sb_invoice_date", label: "Invoice date", kind: "date", get: (o) => day(o.sbInvoiceDate) },
      { key: "sb_invoice_value", label: "Invoice value", kind: "number", get: (o) => n(o.sbInvoiceValue) },
      { key: "sb_status", label: "Status", kind: "select", choices: STEP_STATUS_OPTIONS, get: (o) => s(o.sbStatus) },
      { key: "sb_remarks", label: "Remarks", kind: "textarea", get: (o) => s(o.sbRemarks) },
    ],
    attachment: {
      label: "Sales invoice", folder: "invoice",
      pathKey: "sb_attachment_path", nameKey: "sb_attachment_name",
    },
    captured: { key: "sbInvoiceNo", header: "Invoice no.", get: (o) => s(o.sbInvoiceNo) || "—" },
  },

  gate_out: {
    stepKey: "gate_out",
    title: "Gate Out Entry",
    actionLabel: "Record gate out",
    description: "Billed orders waiting for the plant in-charge to record the gate register entry as the material leaves.",
    completedBlurb: "Gate entries you record appear here, and stay revisable until the delivery is confirmed.",
    fields: [
      { key: "go_actual_date", label: "Actual date", kind: "date", get: (o) => day(o.goActualDate) },
      { key: "go_gate_id", label: "Gate", kind: "select", optionsFrom: "gate", get: (o) => s(o.goGateId) },
      { key: "go_godown_id", label: "Dispatched from", kind: "select", optionsFrom: "godown", get: (o) => s(o.goGodownId),
        hint: "defaults to the godown the stock was checked in" },
      { key: "go_vehicle_id", label: "Vehicle", kind: "select", optionsFrom: "vehicle", get: (o) => s(o.goVehicleId) },
      { key: "go_driver_id", label: "Driver", kind: "select", optionsFrom: "driver", get: (o) => s(o.goDriverId),
        hint: "a driver linked to a portal user can confirm their own delivery" },
      { key: "go_out_at", label: "Out at", kind: "datetime", get: (o) => dt(o.goOutAt) },
      { key: "go_status", label: "Status", kind: "select", choices: STEP_STATUS_OPTIONS, get: (o) => s(o.goStatus) },
      { key: "go_remarks", label: "Remarks", kind: "textarea", get: (o) => s(o.goRemarks) },
    ],
    captured: { key: "goGatePassNo", header: "Gate pass", get: (o) => s(o.goGatePassNo) || "—" },
  },

  dispatch_confirm: {
    stepKey: "dispatch_confirm",
    title: "Confirmation on Dispatch",
    actionLabel: "Confirm delivery",
    description:
      "Consignments out of the gate, waiting for the driver to confirm delivery - the customer's signature for a Local dispatch, the LR details for a Transport one.",
    completedBlurb: "Confirmations you record appear here. This is the last step, so it stays correctable after the order closes.",
    fields: [
      { key: "dc_actual_date", label: "Actual date", kind: "date", get: (o) => day(o.dcActualDate) },
      { key: "dc_status", label: "Delivery outcome", kind: "select", required: true, choices: DELIVERY_STATUS_OPTIONS, get: (o) => s(o.dcStatus) },
      { key: "dc_driver_id", label: "Driver", kind: "select", optionsFrom: "driver", get: (o) => s(o.dcDriverId),
        hint: "defaults to the driver on the gate-out entry" },

      // --- Local branch ---
      { key: "dc_receiver_name", label: "Received by", kind: "text", required: true, get: (o) => s(o.dcReceiverName),
        placeholder: "who signed at the customer's dock", showWhen: isLocal },
      { key: "dc_received_at", label: "Received at", kind: "datetime", get: (o) => dt(o.dcReceivedAt), showWhen: isLocal },

      // --- Transport branch ---
      { key: "dc_transporter_id", label: "Transporter", kind: "select", required: true, optionsFrom: "transporter",
        get: (o) => s(o.dcTransporterId), showWhen: isTransport },
      { key: "dc_lr_no", label: "LR no.", kind: "text", required: true, get: (o) => s(o.dcLrNo), showWhen: isTransport },
      { key: "dc_lr_date", label: "LR date", kind: "date", get: (o) => day(o.dcLrDate), showWhen: isTransport },
      { key: "dc_freight_amount", label: "Freight", kind: "number", get: (o) => n(o.dcFreightAmount), showWhen: isTransport },

      { key: "dc_remarks", label: "Remarks", kind: "textarea", get: (o) => s(o.dcRemarks) },
    ],
    attachment: {
      label: "Receiver copy / LR", folder: "receiver",
      pathKey: "dc_attachment_path", nameKey: "dc_attachment_name",
    },
    captured: {
      key: "dcStatus", header: "Outcome",
      get: (o) => (o.dcStatus ? DELIVERY_STATUS_LABEL[o.dcStatus] : "—"),
    },
  },
};

/** The fields actually shown for a given form state — the modal's single filter. */
export const visibleFields = (
  cfg: StepConfig,
  values: Record<string, string>,
  order: DispatchOrder | null,
): StepField[] => cfg.fields.filter((f) => !f.showWhen || f.showWhen(values, order));

/** Which required field (if any) is still blank. Courtesy only — the RPC is the gate. */
export function missingRequired(
  cfg: StepConfig,
  values: Record<string, string>,
  order: DispatchOrder | null,
): string | null {
  for (const f of visibleFields(cfg, values, order)) {
    if (f.required && !String(values[f.key] ?? "").trim()) return `${f.label} is required.`;
  }
  return null;
}

/** Used by the order-detail progress panel for the "Planned/Actual" pair. */
export const stepActualDate = (step: QueueStep, o: DispatchOrder): string => {
  const raw =
    step === "credit_check" ? o.ccActualDate
    : step === "material_status" ? o.msActualDate
    : step === "lot_confirm" ? o.lcActualDate
    : step === "sales_bill" ? o.sbActualDate
    : step === "gate_out" ? o.goActualDate
    : o.dcActualDate;
  return dmy(raw);
};

export { numOrDash };
