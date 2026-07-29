/**
 * Per-step field descriptors that drive the ONE generic step modal + stage queue.
 *
 * Rather than five near-identical modal files, every step is described here — its
 * editable fields, the value each pre-fills from, the read-only context panel it
 * opens with, and the one "captured" column its Completed tab shows.
 *
 * ⚠ WIRE CONTRACT: the `key` of every field is the jsonb payload key read VERBATIM
 *   by the matching `fms_dispatch_record_*` / `fms_dispatch_update_*` RPC. Rename
 *   one here without renaming it in the migration and the value is silently dropped.
 *
 * ⚠ EVERY GETTER TAKES THE ROUND, NOT JUST THE ORDER. After a loop-back the order
 *   row holds round N while a Completed tab may be showing round 1; reading the
 *   header would show the wrong invoice under the right heading. `o` is for
 *   order-scoped facts (credit), `v` for everything round-scoped.
 *
 * This module stays PURE — no React, no store import.
 */
import type { DispatchOrder } from "../types";
import type { RoundView } from "./rounds";
import type { QueueStep } from "./queues";
import { CREDIT_STATUS_LABEL, DELIVERY_STATUS_LABEL, dmy, numOrDash } from "./format";

export type StepFieldKind = "date" | "text" | "number" | "textarea" | "select";

export interface StepField {
  key: string;
  label: string;
  kind: StepFieldKind;
  /** Current value, for edit/prefill. Always a string — the modal is string-keyed. */
  get: (o: DispatchOrder, v: RoundView) => string;
  /** `select` backed by a fixed code enum. No step picks from a master any more. */
  choices?: { value: string; label: string }[];
  placeholder?: string;
  hint?: string;
  /** Save stays disabled until this is filled. */
  required?: boolean;
  /**
   * Required only in some states — the credit remark, which is compulsory the
   * moment "On hold" is picked and optional otherwise. Without this the person
   * finds out by round-tripping to Postgres and reading a raised exception.
   */
  requiredWhen?: (values: Record<string, string>, order: DispatchOrder | null) => boolean;
  showWhen?: (values: Record<string, string>, order: DispatchOrder | null) => boolean;
}

export interface CapturedColumn {
  key: string;
  header: string;
  get: (o: DispatchOrder, v: RoundView) => string;
  isDate?: boolean;
}

/** Which cells the read-only context card above the form shows. */
export interface StepContext {
  /** Credit outcome + its remark. */
  showCredit?: boolean;
  /** The full item list: ordered · dispatched · pending · going out now · LOT. */
  showLines?: boolean;
  /** Tally invoice no. + a button that opens the invoice. */
  showInvoice?: boolean;
  /** Gate outward no. */
  showOutward?: boolean;
}

export interface StepConfig {
  stepKey: QueueStep;
  title: string;
  actionLabel: string;
  /** Blurb above the Pending tab. */
  description: string;
  /** Blurb above the Completed tab. */
  completedBlurb: string;
  /** The read-only recap the step opens with. */
  context?: StepContext;
  fields: StepField[];
  attachment?: {
    label: string;
    folder: string;
    pathKey: string;
    nameKey: string;
    required?: boolean;
    /** Read off the ROUND, so a Completed row shows its own file. */
    getPath: (v: RoundView) => string | null;
    getName: (v: RoundView) => string | null;
  };
  /** Renders the per-line ship-quantity grid. */
  lines?: "ship";
  /** The one column the Completed tab shows. */
  captured: CapturedColumn;
}

/** Sheet dropdown: the credit decision. */
export const CREDIT_STATUS_OPTIONS = [
  { value: "approved", label: CREDIT_STATUS_LABEL.approved },
  { value: "credit_hold", label: CREDIT_STATUS_LABEL.credit_hold },
];

/** Delivery outcome. Two values — a part-return is corrected afterwards. */
export const DELIVERY_STATUS_OPTIONS = [
  { value: "delivered", label: DELIVERY_STATUS_LABEL.delivered },
  { value: "returned", label: DELIVERY_STATUS_LABEL.returned },
];

const s = (v: string | null | undefined): string => v ?? "";
const day = (v: string | null | undefined): string => (v ? v.slice(0, 10) : "");

export const STEP_CONFIG: Record<QueueStep, StepConfig> = {
  credit_check: {
    stepKey: "credit_check",
    title: "Confirm Credit Limit",
    actionLabel: "Record credit decision",
    description:
      "Orders waiting on the collection team to approve the customer's credit, or hold the order until payment lands.",
    completedBlurb: "Approvals you record appear here, and stay revisable until the stock check is recorded.",
    fields: [
      {
        key: "cc_status", label: "Credit outcome", kind: "select", required: true,
        choices: CREDIT_STATUS_OPTIONS, get: (o) => s(o.ccStatus),
        hint: "On hold keeps the order in this queue until you come back and approve it",
      },
      {
        key: "cc_remarks", label: "Remarks", kind: "textarea", get: (o) => s(o.ccRemarks),
        requiredWhen: (v) => v.cc_status === "credit_hold",
        placeholder: "why the order is being held",
      },
    ],
    captured: {
      key: "ccStatus", header: "Credit outcome",
      get: (o) => (o.ccStatus ? CREDIT_STATUS_LABEL[o.ccStatus] : "—"),
    },
  },

  material_status: {
    stepKey: "material_status",
    title: "Check Material Status",
    actionLabel: "Record what is going out",
    description:
      "Orders waiting on the store keeper's physical stock check. Send whatever is available — anything short stays pending and comes back here.",
    completedBlurb: "Each round you send appears here, and stays revisable until its sales bill is raised.",
    context: { showCredit: true },
    fields: [
      { key: "ms_remarks", label: "Remarks", kind: "textarea", get: (_o, v) => s(v.msRemarks) },
    ],
    lines: "ship",
    captured: {
      key: "shipQty", header: "Going out",
      get: (_o, v) => {
        const total = v.items.reduce((a, i) => a + (Number(i.shipQty) || 0), 0);
        const lines = v.items.length;
        return total ? `${total} · ${lines} line${lines === 1 ? "" : "s"}` : "—";
      },
    },
  },

  sales_bill: {
    stepKey: "sales_bill",
    title: "Generate Sales Bill",
    actionLabel: "Record sales bill",
    description: "Consignments picked and waiting for the invoice to be raised in Tally.",
    completedBlurb: "Bills you record appear here, and stay revisable until the gate outward entry is recorded.",
    context: { showCredit: true, showLines: true },
    fields: [
      {
        key: "sb_invoice_no", label: "Tally invoice no.", kind: "text", required: true,
        get: (_o, v) => s(v.sbInvoiceNo), placeholder: "as generated in Tally",
      },
      { key: "sb_remarks", label: "Remarks", kind: "textarea", get: (_o, v) => s(v.sbRemarks) },
    ],
    attachment: {
      label: "Sales invoice", folder: "invoice",
      pathKey: "sb_attachment_path", nameKey: "sb_attachment_name", required: true,
      getPath: (v) => v.sbAttachmentPath, getName: (v) => v.sbAttachmentName,
    },
    captured: { key: "sbInvoiceNo", header: "Invoice no.", get: (_o, v) => s(v.sbInvoiceNo) || "—" },
  },

  gate_out: {
    stepKey: "gate_out",
    title: "Gate Outward Entry",
    actionLabel: "Record gate outward",
    description: "Billed consignments waiting for the plant in-charge to write the gate register entry as the material leaves.",
    completedBlurb: "Gate entries you record appear here, and stay revisable until the delivery is confirmed.",
    context: { showCredit: true, showLines: true, showInvoice: true },
    fields: [
      {
        key: "go_outward_no", label: "Gate outward no.", kind: "text", required: true,
        get: (_o, v) => s(v.goOutwardNo), placeholder: "as written in the gate register",
      },
      { key: "go_remarks", label: "Remarks", kind: "textarea", get: (_o, v) => s(v.goRemarks) },
    ],
    captured: { key: "goOutwardNo", header: "Gate outward no.", get: (_o, v) => s(v.goOutwardNo) || "—" },
  },

  dispatch_confirm: {
    stepKey: "dispatch_confirm",
    title: "Confirmation on Dispatch",
    actionLabel: "Confirm delivery",
    description:
      "Consignments out of the gate, waiting for confirmation that they reached the customer.",
    completedBlurb:
      "Confirmations appear here. Once a round is finished, correcting what was delivered is done from the order page.",
    context: { showLines: true, showInvoice: true, showOutward: true },
    fields: [
      {
        key: "dc_status", label: "Delivery outcome", kind: "select", required: true,
        choices: DELIVERY_STATUS_OPTIONS, get: (_o, v) => s(v.dcStatus),
        hint: "Returned puts the whole consignment back into pending — a part return is corrected from the order page afterwards",
      },
      { key: "dc_remarks", label: "Remarks", kind: "textarea", get: (_o, v) => s(v.dcRemarks) },
    ],
    attachment: {
      label: "Receiver copy / LR", folder: "receiver",
      pathKey: "dc_attachment_path", nameKey: "dc_attachment_name", required: true,
      getPath: (v) => v.dcAttachmentPath, getName: (v) => v.dcAttachmentName,
    },
    captured: {
      key: "dcStatus", header: "Outcome",
      get: (_o, v) => (v.dcStatus ? DELIVERY_STATUS_LABEL[v.dcStatus] : "—"),
    },
  },
};

/** The fields actually shown for a given form state — the modal's single filter. */
export const visibleFields = (
  cfg: StepConfig,
  values: Record<string, string>,
  order: DispatchOrder | null,
): StepField[] => cfg.fields.filter((f) => !f.showWhen || f.showWhen(values, order));

/** Is this field required right now? Static flag OR the conditional rule. */
export const isRequiredNow = (
  f: StepField,
  values: Record<string, string>,
  order: DispatchOrder | null,
): boolean => !!f.required || !!f.requiredWhen?.(values, order);

/** Which required field (if any) is still blank. Courtesy only — the RPC is the gate. */
export function missingRequired(
  cfg: StepConfig,
  values: Record<string, string>,
  order: DispatchOrder | null,
): string | null {
  for (const f of visibleFields(cfg, values, order)) {
    if (isRequiredNow(f, values, order) && !String(values[f.key] ?? "").trim()) {
      return `${f.label} is required.`;
    }
  }
  return null;
}

/** Used by the order register for the "Actual" column of each step. */
export const stepActualDate = (step: QueueStep, o: DispatchOrder, v: RoundView): string => {
  if (step === "credit_check") {
    // cc_actual_date was dropped with the rest of the credit capture; the
    // completion stamp is a TIMESTAMP, so slice it before it reaches a
    // date-only formatter — feeding it whole yields "NaN" in the export.
    return dmy(o.ccAt ? o.ccAt.slice(0, 10) : null);
  }
  const raw =
    step === "material_status" ? v.msActualDate
    : step === "sales_bill" ? v.sbActualDate
    : step === "gate_out" ? v.goActualDate
    : v.dcActualDate;
  return dmy(raw);
};

export { numOrDash };
