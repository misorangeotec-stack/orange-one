/**
 * THE planned-vs-actual row model — one row per workflow step for one order.
 *
 * This is the source sheet rendered as data. Two consumers read it and nothing
 * else computes it: `components/PlannedVsActualTable.tsx` (the on-screen panel)
 * and `lib/exportOrderRegister.ts` (the .xlsx that replaces the spreadsheet). One
 * model means the screen and the export can never disagree about whether a step
 * ran late.
 */
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { STEPS, type StepKey } from "./steps";
import { dispatchDueIso, stepDoneAt, stepDoneBy, type DispatchSnapshot, type QueueStep } from "./queues";
import {
  CREDIT_STATUS_LABEL,
  DELIVERY_STATUS_LABEL,
  MATERIAL_STATUS_LABEL,
  dmy,
} from "./format";
import type { DispatchOrder } from "../types";

export interface StepRow {
  stepKey: StepKey;
  index: number;
  title: string;
  short: string;
  /** Resolved owner names for the step. Empty when nobody is configured. */
  ownerNames: string[];
  /** The SLA-derived date this step was due. Null for the origin step. */
  plannedIso: string | null;
  /** The date the actor recorded (the sheet's "Actual Date" column). */
  actualIso: string | null;
  /** The step's own completion timestamp — the audit truth, not the typed date. */
  doneAtIso: string | null;
  doneById: string | null;
  /** The step's own status value, already turned into words. */
  statusLabel: string;
  remarks: string | null;
  /** A document produced by this step, if any. */
  doc: { path: string; name: string } | null;
  state: "done" | "current" | "pending";
  /** Whole days late (actual − planned). Null when it can't be known yet. */
  lateDays: number | null;
  /** Open, undone and already past its due date. */
  overdue: boolean;
}

const dayDiff = (aIso: string, bIso: string): number => {
  const a = new Date(`${aIso}T00:00:00`);
  const b = new Date(`${bIso}T00:00:00`);
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
};

/** The status value each step records, as words. */
function statusLabelFor(step: StepKey, o: DispatchOrder): string {
  switch (step) {
    case "sales_order":
      return "Raised";
    case "credit_check":
      return o.ccStatus ? CREDIT_STATUS_LABEL[o.ccStatus] : "—";
    case "material_status":
      return o.msStatus ? MATERIAL_STATUS_LABEL[o.msStatus] : "—";
    case "lot_confirm":
      return o.lcStatus ?? "—";
    case "sales_bill":
      return o.sbStatus ?? (o.sbInvoiceNo ? `Invoice ${o.sbInvoiceNo}` : "—");
    case "gate_out":
      return o.goStatus ?? (o.goGatePassNo ?? "—");
    case "dispatch_confirm":
      return o.dcStatus ? DELIVERY_STATUS_LABEL[o.dcStatus] : "—";
    default:
      return "—";
  }
}

function remarksFor(step: StepKey, o: DispatchOrder): string | null {
  switch (step) {
    case "sales_order": return o.orderRemarks;
    case "credit_check": return o.ccRemarks;
    case "material_status": return o.msRemarks;
    case "lot_confirm": return o.lcRemarks;
    case "sales_bill": return o.sbRemarks;
    case "gate_out": return o.goRemarks;
    case "dispatch_confirm": return o.dcRemarks;
    default: return null;
  }
}

function actualIsoFor(step: StepKey, o: DispatchOrder): string | null {
  switch (step) {
    // The origin step's "actual" is the order date the customer's order arrived.
    case "sales_order": return o.orderDate;
    case "credit_check": return o.ccActualDate;
    case "material_status": return o.msActualDate;
    case "lot_confirm": return o.lcActualDate;
    case "sales_bill": return o.sbActualDate;
    case "gate_out": return o.goActualDate;
    case "dispatch_confirm": return o.dcActualDate;
    default: return null;
  }
}

function docFor(step: StepKey, o: DispatchOrder): { path: string; name: string } | null {
  if (step === "sales_bill" && o.sbAttachmentPath) {
    return { path: o.sbAttachmentPath, name: o.sbAttachmentName ?? "Sales invoice" };
  }
  if (step === "dispatch_confirm" && o.dcAttachmentPath) {
    return { path: o.dcAttachmentPath, name: o.dcAttachmentName ?? "Receiver copy" };
  }
  return null;
}

export interface OrderVmDeps {
  snap: DispatchSnapshot;
  /** Resolves a step's configured owners to display names. */
  ownerNamesFor: (stepKey: StepKey) => string[];
  todayIso?: string;
}

/** The seven step rows for one order, in workflow order. */
export function orderStepRows(o: DispatchOrder, deps: OrderVmDeps): StepRow[] {
  const today = deps.todayIso ?? todayLocalIso();

  return STEPS.map((st) => {
    const isOrigin = st.key === "sales_order";
    const doneAtIso = isOrigin ? o.submittedAt : stepDoneAt(st.key as QueueStep, o);
    const doneById = isOrigin ? o.raisedBy : stepDoneBy(st.key as QueueStep, o);
    const plannedIso = isOrigin ? null : dispatchDueIso(deps.snap, o, st.key as QueueStep);
    const actualIso = actualIsoFor(st.key, o);

    const state: StepRow["state"] =
      doneAtIso ? "done" : o.currentStep === st.key ? "current" : "pending";

    // Late is measured against what was DUE and what was RECORDED. Both have to
    // exist — an undone step is "overdue", which is a different thing.
    const lateDays =
      plannedIso && actualIso && doneAtIso ? Math.max(0, dayDiff(actualIso, plannedIso)) : null;

    const overdue =
      state !== "done" &&
      !!plannedIso &&
      plannedIso < today &&
      o.status !== "closed" &&
      o.status !== "cancelled";

    return {
      stepKey: st.key,
      index: st.index,
      title: st.title,
      short: st.short,
      ownerNames: isOrigin ? [o.requesterName].filter(Boolean) : deps.ownerNamesFor(st.key),
      plannedIso,
      actualIso,
      doneAtIso,
      doneById,
      statusLabel: statusLabelFor(st.key, o),
      remarks: remarksFor(st.key, o),
      doc: docFor(st.key, o),
      state,
      lateDays,
      overdue,
    };
  });
}

/** Formatted for display — used directly by the table and the export. */
export const plannedText = (r: StepRow): string => (r.plannedIso ? dmy(r.plannedIso) : "—");
export const actualText = (r: StepRow): string => (r.actualIso ? dmy(r.actualIso) : "—");

/**
 * Mean days late per step over a set of orders — the Control Center's variance
 * card. Only steps that both completed AND had a due date count; an order still
 * in flight contributes nothing, which is why this reads closed orders.
 */
export function stepVariance(
  orders: DispatchOrder[],
  deps: OrderVmDeps,
): { stepKey: StepKey; short: string; samples: number; meanLate: number }[] {
  const acc = new Map<StepKey, { total: number; n: number; short: string }>();
  for (const o of orders) {
    for (const r of orderStepRows(o, deps)) {
      if (r.lateDays === null) continue;
      const cur = acc.get(r.stepKey) ?? { total: 0, n: 0, short: r.short };
      cur.total += r.lateDays;
      cur.n += 1;
      acc.set(r.stepKey, cur);
    }
  }
  return STEPS.filter((s) => acc.has(s.key)).map((s) => {
    const a = acc.get(s.key)!;
    return { stepKey: s.key, short: s.short, samples: a.n, meanLate: a.n ? a.total / a.n : 0 };
  });
}
