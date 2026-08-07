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
 *   header would show the wrong invoice under the right heading.
 *
 * ⚠ CREDIT IS NO LONGER THE ORDER-SCOPED EXCEPTION. It used to be the one thing
 *   read off `o`, because it was decided once and survived every round. Partial
 *   approval releases a quantity, so an order comes back for a fresh decision
 *   once that quantity has gone out — and a Completed row for round 1 must show
 *   round 1's decision, not the one governing the order today. Read `v`.
 *   (`OrderRefPanel` still reads the header, deliberately: its credit card
 *   answers "what is governing this order", which is a different question.)
 *
 * This module stays PURE — no React, no store import.
 */
import type { DispatchMasterType, DispatchOrder } from "../types";
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
  /** `select` backed by a fixed code enum. */
  choices?: { value: string; label: string }[];
  /**
   * `select` backed by a live MASTER list instead of `choices` — the modal resolves
   * the active rows from the store. It lives here rather than as a hard-coded array
   * because this module is PURE and must not import the store: the descriptor names
   * the list, the modal fetches it.
   */
  master?: DispatchMasterType;
  /**
   * Render this field ABOVE the item grid instead of below it. For a decision that
   * frames the grid rather than annotates it — the billing company is chosen for the
   * whole consignment, so asking for it under a table of quantities reads as an
   * afterthought and is easy to scroll past.
   */
  beforeLines?: boolean;
  placeholder?: string;
  /**
   * ⚠ THERE IS NO `hint` HERE, AND ONE MUST NOT BE ADDED BACK.
   *
   * Explanatory copy beside a label renders in the narrow gap next to it, wraps
   * to four or five lines, and shoves the control it describes down the cell —
   * on a two-field step it was more of the dialog than the form. What a step
   * does belongs in the step's own `description`, on the queue page, where there
   * is room to say it once. The field asks for a value and nothing else.
   */
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
  /**
   * The order AS RAISED — item · quantity · unit · line remark. For steps that run
   * BEFORE anything has been picked, where `showLines`' dispatch columns would be a
   * row of dashes and the intake line remark — the one thing the raiser wrote per
   * item — would not be shown at all.
   */
  showOrderLines?: boolean;
  /*
   * ⚠ There is no `showCompany`. It was opt-in while the company was decided
   *   mid-flow, so the steps before the stock check had nothing to show. The
   *   order now carries it from the moment it is raised, along with the customer
   *   location and PO — so OrderRefPanel prints all three unconditionally and
   *   there is no flag to forget.
   */
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
  /**
   * Renders the linked percentage / quantity control for a partial credit
   * release. A flag rather than a field descriptor for the same reason `lines`
   * is one: the modal holds its values as `Record<string, string>` and posts
   * them verbatim, so a pair of inputs that write each other has nowhere to live
   * in a single-key descriptor.
   */
  approvedQty?: boolean;
  /** The one column the Completed tab shows. */
  captured: CapturedColumn;
}

/**
 * Sheet dropdown: the credit decision.
 *
 * Ordered release-everything → release-some → release-nothing, so the list reads
 * as one scale rather than three unrelated buttons.
 */
export const CREDIT_STATUS_OPTIONS = [
  { value: "approved", label: CREDIT_STATUS_LABEL.approved },
  { value: "partial", label: CREDIT_STATUS_LABEL.partial },
  { value: "credit_hold", label: CREDIT_STATUS_LABEL.credit_hold },
];

/** Delivery outcome. Two values — a part-return is corrected afterwards. */
export const DELIVERY_STATUS_OPTIONS = [
  { value: "delivered", label: DELIVERY_STATUS_LABEL.delivered },
  { value: "returned", label: DELIVERY_STATUS_LABEL.returned },
];

/**
 * A yes/no, as a two-value select.
 *
 * ⚠ `StepFieldKind` has no boolean and this is deliberate: `StepModal` holds its
 *   values as `Record<string, string>` and posts them verbatim, so a tick box
 *   would need a new kind, a new renderer AND a string encoding anyway. The RPC
 *   normalises "yes"/"no" (and an empty string, meaning unanswered) into the
 *   boolean column.
 */
export const YES_NO_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

const s = (v: string | null | undefined): string => v ?? "";
const day = (v: string | null | undefined): string => (v ? v.slice(0, 10) : "");

export const STEP_CONFIG: Record<QueueStep, StepConfig> = {
  credit_check: {
    stepKey: "credit_check",
    title: "Confirm Credit Limit",
    actionLabel: "Record credit decision",
    description:
      "Orders waiting on the collection team to approve the customer's credit, release part of it, or hold the order until payment lands.",
    completedBlurb: "Decisions you record appear here, and stay revisable until the stock check is recorded.",
    // Credit is judged against what is actually being asked for, so the whole order
    // — header plus every item line — opens above the decision.
    context: { showOrderLines: true },
    fields: [
      {
        key: "cc_status", label: "Credit outcome", kind: "select", required: true,
        choices: CREDIT_STATUS_OPTIONS, get: (_o, v) => s(v.ccStatus),
      },
      {
        key: "cc_remarks", label: "Remarks", kind: "textarea", get: (_o, v) => s(v.ccRemarks),
        // A hold and a part-release are both judgements someone downstream has
        // to act on, so both owe a reason. A full approval does not.
        requiredWhen: (v) => v.cc_status === "credit_hold" || v.cc_status === "partial",
        placeholder: "why the order is being held, or how much is released and why",
      },
    ],
    approvedQty: true,
    captured: {
      key: "ccStatus", header: "Credit outcome",
      get: (o, v) => {
        if (!v.ccStatus) return "—";
        const label = CREDIT_STATUS_LABEL[v.ccStatus];
        if (v.ccStatus !== "partial" || v.ccApprovedQty == null) return label;
        // The figure IS the decision on a partial, so the column shows it rather
        // than a word that could mean anything from 1 kg to 69.
        const ordered = o.lines.reduce((a, l) => a + (Number(l.quantity) || 0), 0);
        return `${label} · ${v.ccApprovedQty} of ${ordered}`;
      },
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
      /*
        THE COMPANY IS NO LONGER ASKED HERE. It moved to the intake form: the
        person raising the order knows which entity bills it, and asking it per
        round let one order that shipped in two goes bill two different entities.
        What the store keeper genuinely knows at this moment is how the material
        is leaving — hence the two fields below.

        Both are OPTIONAL. A consignment can be recorded before the vehicle is
        arranged, and blocking the stock check on a tempo number would stop the
        order over a fact that changes later anyway.
      */
      {
        key: "ms_tempo_no", label: "Transport tempo no.", kind: "text", beforeLines: true,
        get: (_o, v) => s(v.msTempoNo), placeholder: "vehicle carrying this consignment",
      },
      {
        key: "ms_porter", label: "Porter", kind: "select", choices: YES_NO_OPTIONS, beforeLines: true,
        get: (_o, v) => (v.msPorter === null ? "" : v.msPorter ? "yes" : "no"),
        placeholder: "did this go by porter",
      },
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
export const stepActualDate = (step: QueueStep, _o: DispatchOrder, v: RoundView): string => {
  if (step === "credit_check") {
    // cc_actual_date was dropped with the rest of the credit capture; the
    // completion stamp is a TIMESTAMP, so slice it before it reaches a
    // date-only formatter — feeding it whole yields "NaN" in the export.
    return dmy(v.ccAt ? v.ccAt.slice(0, 10) : null);
  }
  const raw =
    step === "material_status" ? v.msActualDate
    : step === "sales_bill" ? v.sbActualDate
    : step === "gate_out" ? v.goActualDate
    : v.dcActualDate;
  return dmy(raw);
};

export { numOrDash };
