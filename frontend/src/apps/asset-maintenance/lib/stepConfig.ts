/**
 * What each queue step ASKS FOR — one descriptor per step, consumed by the single
 * generic StepModal. Pure module: no React, no store import.
 *
 * This is what replaces a per-step modal component. Three steps here is small, but
 * the descriptor still earns its place: the record RPC, the update RPC, the queue
 * "Completed" column and the form all read from ONE list, so they cannot drift.
 *
 * ⚠ WIRE CONTRACT: the `key` of every field is the jsonb payload key read VERBATIM
 *   by the matching fms_asset_record_* / fms_asset_update_* RPC
 *   (20260805120200 / 20260805120500). Rename one here without renaming it in the
 *   migration and the value is silently dropped.
 */
import type { QueueStep } from "./queues";
import { dmy } from "./format";
import type { ServiceJob } from "../types";

/** Which master list backs a `select` field. Resolved by StepModal from the store. */
export type OptionSource = "vendor" | "cost_head";

/**
 * Context the form needs but the job row does not carry: whether this job's track
 * is a RENEWAL, which is what decides if the new expiry date is asked for.
 */
export interface StepFieldCtx {
  isRenewal: boolean;
  scheduleTypeName: string;
}

export interface StepField {
  /** ⚠ = the jsonb key the RPC reads verbatim. */
  key: string;
  label: string;
  kind: "date" | "text" | "number" | "textarea" | "select";
  /** Prefill / edit value; always a string. */
  get: (j: ServiceJob) => string;
  optionsFrom?: OptionSource;
  /** Fixed code enum (a branch condition), not a master. */
  choices?: { value: string; label: string }[];
  required?: boolean;
  hint?: string;
  placeholder?: string;
  showWhen?: (values: Record<string, string>, job: ServiceJob | null, ctx: StepFieldCtx) => boolean;
  /** Required only in some branch — evaluated after showWhen. */
  requiredWhen?: (values: Record<string, string>, job: ServiceJob | null, ctx: StepFieldCtx) => boolean;
}

export interface CapturedColumn {
  key: string;
  header: string;
  get: (j: ServiceJob) => string;
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
  attachment?: { label: string; folder: string; pathKey: string; nameKey: string; required?: boolean };
  /** The ONE column the Completed tab shows beyond the generic ones. */
  captured: CapturedColumn;
}

const s = (v: string | number | null | undefined): string =>
  v === null || v === undefined ? "" : String(v);

const isSatisfactory = (v: Record<string, string>) => v.vc_outcome === "satisfactory";
const isRework = (v: Record<string, string>) => v.vc_outcome === "rework_needed";

export const STEP_CONFIG: Record<QueueStep, StepConfig> = {
  schedule: {
    stepKey: "schedule",
    title: "Schedule Service",
    actionLabel: "Schedule",
    description:
      "Book the service or renewal with a vendor and record the date it is planned for. The asset's custodian can do this as well as the step owners.",
    completedBlurb: "Services and renewals already booked, awaiting the work itself.",
    fields: [
      {
        key: "sc_actual_date", label: "Scheduled on", kind: "date",
        get: (j) => s(j.scActualDate),
        hint: "When the booking was made. Defaults to today.",
      },
      {
        key: "sc_planned_date", label: "Planned for", kind: "date", required: true,
        get: (j) => s(j.scPlannedDate),
        hint: "The date the vendor will actually do it. Book before the due date, not after.",
      },
      {
        key: "sc_vendor_id", label: "Vendor / provider", kind: "select", optionsFrom: "vendor",
        get: (j) => s(j.scVendorId),
        hint: "The garage, agency or insurer handling it. Optional — some work is done in house.",
      },
      { key: "sc_remarks", label: "Remarks", kind: "textarea", get: (j) => s(j.scRemarks) },
    ],
    captured: {
      key: "plannedFor", header: "Planned for", isDate: true,
      get: (j) => dmy(j.scPlannedDate),
    },
  },

  service_done: {
    stepKey: "service_done",
    title: "Record Service",
    actionLabel: "Record service",
    description:
      "Record what was actually done, what it cost, and attach the bill. For a renewal, this is the day the new policy or contract was taken.",
    completedBlurb: "Work recorded, awaiting verification.",
    fields: [
      {
        key: "sd_actual_date", label: "Carried out on", kind: "date", required: true,
        get: (j) => s(j.sdActualDate),
        hint: "The real date the work was done — this is what the next due date is counted from.",
      },
      {
        key: "sd_vendor_id", label: "Vendor / provider", kind: "select", optionsFrom: "vendor",
        get: (j) => s(j.sdVendorId),
      },
      { key: "sd_cost", label: "Cost (₹)", kind: "number", get: (j) => s(j.sdCost), placeholder: "0.00" },
      {
        key: "sd_cost_head_id", label: "Cost head", kind: "select", optionsFrom: "cost_head",
        get: (j) => s(j.sdCostHeadId),
        hint: "What the spend was for — drives the service-cost report.",
      },
      { key: "sd_bill_no", label: "Bill / invoice no.", kind: "text", get: (j) => s(j.sdBillNo) },
      {
        key: "sd_meter_reading", label: "Meter reading", kind: "number",
        get: (j) => s(j.sdMeterReading),
        hint: "Odometer or running hours, if this asset is metered. Also updates the asset's current reading.",
      },
      { key: "sd_remarks", label: "What was done", kind: "textarea", get: (j) => s(j.sdRemarks) },
    ],
    attachment: {
      label: "Service bill / renewed document",
      folder: "bill",
      pathKey: "sd_bill_path",
      nameKey: "sd_bill_name",
    },
    captured: {
      key: "servicedOn", header: "Carried out on", isDate: true,
      get: (j) => dmy(j.sdActualDate),
    },
  },

  verify_close: {
    stepKey: "verify_close",
    title: "Verify & Close",
    actionLabel: "Verify & close",
    description:
      "Confirm the work was done properly. Closing is what moves the asset's next due date forward — until this step, nothing is rescheduled.",
    completedBlurb: "Closed jobs. The asset's schedule has been advanced.",
    fields: [
      { key: "vc_actual_date", label: "Verified on", kind: "date", get: (j) => s(j.vcActualDate) },
      {
        key: "vc_outcome", label: "Outcome", kind: "select", required: true,
        get: (j) => s(j.vcOutcome),
        choices: [
          { value: "satisfactory", label: "Satisfactory — close the job" },
          { value: "rework_needed", label: "Rework needed — send it back" },
        ],
        hint: "Sending it back returns the job to Record Service and does NOT move the next due date.",
      },
      {
        key: "vc_new_due_date", label: "New expiry date", kind: "date",
        get: (j) => s(j.vcNewDueDate),
        // The gap the audit caught: a policy renewed today may run to 31-03-2028,
        // or be a two-year policy. Computing last-done + frequency is right only by
        // luck, and the error compounds at every renewal until a cover lapses.
        showWhen: (v, _j, ctx) => ctx.isRenewal && isSatisfactory(v),
        requiredWhen: (v, _j, ctx) => ctx.isRenewal && isSatisfactory(v),
        hint: "Copy this off the RENEWED document — it is what the next reminder counts back from, and it is often not exactly a year away.",
      },
      {
        key: "vc_new_ref_no", label: "New policy / contract no.", kind: "text",
        get: (j) => s(j.vcNewRefNo),
        showWhen: (v, _j, ctx) => ctx.isRenewal && isSatisfactory(v),
      },
      {
        key: "vc_new_amount", label: "Premium / fee (₹)", kind: "number",
        get: (j) => s(j.vcNewAmount),
        showWhen: (v, _j, ctx) => ctx.isRenewal && isSatisfactory(v),
      },
      {
        key: "vc_remarks", label: "Remarks", kind: "textarea",
        get: (j) => s(j.vcRemarks),
        requiredWhen: (v) => isRework(v),
        hint: "Required when sending the job back — say what needs redoing.",
      },
    ],
    captured: {
      key: "outcome", header: "Outcome",
      get: (j) => (j.vcOutcome === "satisfactory" ? "Satisfactory" : j.vcOutcome === "rework_needed" ? "Rework needed" : "—"),
    },
  },
};

/** The fields actually on screen, given the current values. */
export function visibleFields(
  cfg: StepConfig,
  values: Record<string, string>,
  job: ServiceJob | null,
  ctx: StepFieldCtx,
): StepField[] {
  return cfg.fields.filter((f) => !f.showWhen || f.showWhen(values, job, ctx));
}

/**
 * Which visible, required fields are still blank. Courtesy only — the RPC is the
 * gate, and it raises the same conditions as human sentences.
 */
export function missingRequired(
  cfg: StepConfig,
  values: Record<string, string>,
  job: ServiceJob | null,
  ctx: StepFieldCtx,
): string[] {
  return visibleFields(cfg, values, job, ctx)
    .filter((f) => {
      const need = f.required || (f.requiredWhen ? f.requiredWhen(values, job, ctx) : false);
      return need && !(values[f.key] ?? "").trim();
    })
    .map((f) => f.label);
}

/** The date a step actually happened — for the progress rail. */
export function stepActualDate(step: QueueStep, j: ServiceJob): string | null {
  if (step === "schedule") return j.scActualDate;
  if (step === "service_done") return j.sdActualDate;
  return j.vcActualDate;
}
