import type { QueueEntryBase } from "@/shared/lib/fmsQueue";
import type { StepKey } from "./steps";
import { dueIsoFrom, type StepSlaMap } from "./sla";
import type { OcpiDeal } from "../types";
import { STATUS_STEP } from "../types";

/**
 * Who owes what, derived PURELY from the deal rows.
 *
 * ⚠ THIS MODULE IS PURE — no React, no store import, no Supabase. The queue
 *   pages, the dashboard tiles, the cross-FMS Control Center and My Work all
 *   consume this one builder, which is what stops their counts from drifting
 *   apart. "Mine vs All" is applied by the PAGE, never here.
 *
 * ⚠ MEMBERSHIP READS `status`, NOT `currentStep`. A held, closed, cancelled or
 *   still-draft deal owes nobody, and falls out of every queue by having no
 *   entry in STATUS_STEP.
 */
export type QueueStep = Exclude<StepKey, "quotation">;

export interface QueueEntry extends QueueEntryBase<QueueStep> {
  dealId: string;
  customerName: string;
  machineId: string | null;
  raisedBy: string | null;
  salespersonName: string | null;
  companyId: string | null;
  /** Rupee value where known, else the quoted amount. Ranking only, never printed. */
  value: number | null;
  status: OcpiDeal["status"];
}

/**
 * The human reference for a deal.
 *
 * A draft has no number at all — an abandoned draft must not burn one from a
 * series customers already hold — so it falls back to the customer's name rather
 * than rendering an empty cell that reads as a bug.
 */
export function dealRef(d: OcpiDeal): string {
  return d.ocNo ?? d.quotationNo ?? (d.customerName || "Untitled deal");
}

/**
 * When each step was finished, as a timestamp another step can be measured from.
 *
 * ⚠ EVERY ONE OF THESE IS A REAL STAMP ON THE ROW, not a guess. `quotation`
 *   resolves to `qs_at` — the moment it was SENT for approval, re-stamped on
 *   every re-submission — and NOT to `createdAt`, which would count the days a
 *   salesperson spent negotiating against the approver who has just received it.
 *   The fallback to `createdAt` is only for rows that predate that column.
 */
export function stepCompletedIso(d: OcpiDeal, step: StepKey): string | null {
  switch (step) {
    case "quotation":          return d.qsAt ?? d.createdAt;
    case "quotation_approval": return d.qaAt;
    case "order_confirmation": return d.ocAt;
    case "oc_approval":        return d.ocaAt;
    case "customer_signoff":   return d.csAt;
    case "management_signoff": return d.msAt;
    case "finance_handover":   return d.fhAt;
    case "finance_receipt":    return d.frAt;
    default:                   return null;
  }
}

/**
 * WHO actually did each step — the counterpart to `stepCompletedIso`, which says
 * when.
 *
 * ⚠ THIS IS THE ACTOR, NOT THE OWNER, and the difference matters on a contract.
 *   Settings names who is *supposed* to approve a quotation; this says who did.
 *   A coordinator or an admin can act on any step, so the two routinely differ,
 *   and after the fact only one of them is a fact. The stepper shows this for a
 *   finished step and the owner list for one still to come.
 *
 * ⚠ `quotation` RESOLVES TO `raisedBy` — the deal's author. It is the only step
 *   whose actor is not stamped by a decision RPC, because writing the quotation
 *   IS raising the deal.
 *
 * Kept beside `stepCompletedIso` rather than in the component that reads it: the
 * two answer the same question about the same row, and a step added to one and
 * forgotten in the other is a step the stepper would date without naming.
 */
export function stepActorId(d: OcpiDeal, step: StepKey): string | null {
  switch (step) {
    case "quotation":          return d.raisedBy;
    case "quotation_approval": return d.qaBy;
    case "order_confirmation": return d.ocBy;
    case "oc_approval":        return d.ocaBy;
    case "customer_signoff":   return d.csBy;
    case "management_signoff": return d.msBy;
    case "finance_handover":   return d.fhBy;
    case "finance_receipt":    return d.frBy;
    default:                   return null;
  }
}

/**
 * When one deal's current step falls due, or null if it cannot be known.
 *
 * The fallback to `createdAt` matters for the same reason it does in the other
 * FMS modules: a step whose anchor never completed — because the deal reached
 * here down a path that skipped it — must not be born with no due date at all,
 * and must not be born overdue either.
 */
export function dueIsoFor(
  d: OcpiDeal,
  step: QueueStep,
  stepSla: StepSlaMap | null | undefined,
): string | null {
  const sla = stepSla?.[step];
  if (!sla) return null;
  return dueIsoFrom(stepCompletedIso(d, sla.anchor) ?? d.createdAt, sla);
}

/**
 * Every open work-item, one per deal that is waiting at a queue step.
 *
 * ⚠ `stepSla` IS OPTIONAL, AND OMITTING IT MEANS "UNTIMED", NOT "ON TIME".
 *   Every entry then carries `dueIso: null`, which buckets as "no date"
 *   everywhere downstream rather than being quietly reported as met. A caller
 *   that has not loaded the config yet must not make the module look punctual.
 */
export function buildQueueEntries(deals: OcpiDeal[], stepSla?: StepSlaMap | null): QueueEntry[] {
  const out: QueueEntry[] = [];
  for (const d of deals) {
    const stepKey = STATUS_STEP[d.status];
    if (!stepKey || stepKey === "quotation") continue;
    const step = stepKey as QueueStep;
    out.push({
      stepKey: step,
      entityId: d.id,
      dealId: d.id,
      ref: dealRef(d),
      dueIso: stepSla ? dueIsoFor(d, step, stepSla) : null,
      customerName: d.customerName ?? "",
      machineId: d.machineId,
      raisedBy: d.raisedBy,
      salespersonName: d.salespersonName,
      companyId: d.companyId,
      value: d.machineValueInr ?? d.dealValueAmount,
      status: d.status,
    });
  }
  return out;
}

/** The entries sitting at one step. */
export const entriesForStep = (entries: QueueEntry[], step: QueueStep): QueueEntry[] =>
  entries.filter((e) => e.stepKey === step);

/** Is this deal still owed by somebody? */
export const isOpen = (d: OcpiDeal): boolean => STATUS_STEP[d.status] !== undefined;
