/**
 * THE planned-vs-actual row model — one row per workflow step, FOR ONE ROUND.
 *
 * This is the source sheet rendered as data. Its consumers are the Control
 * Centre's variance card and `lib/exportOrderRegister.ts` (the .xlsx that
 * replaces the spreadsheet). One model means every screen agrees about whether a
 * step ran late.
 *
 * ⚠ ROUND-SCOPED. An order that shipped in three goes has three sets of these
 *   rows, and each must read its own round: its own planned dates, its own
 *   invoice, its own outcome.
 */
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { STEPS, type StepKey } from "./steps";
import { dispatchDueIso, type DispatchSnapshot, type QueueStep } from "./queues";
import { allRoundViews, archivedRoundView, currentRoundView, type RoundView } from "./rounds";
import {
  CREDIT_STATUS_LABEL,
  DELIVERY_STATUS_LABEL,
  dmy,
} from "./format";
import type { DispatchOrder } from "../types";

/**
 * A round's own completion stamps.
 *
 * ⚠ CREDIT IS IN HERE NOW. It used to be read off the order header because it
 *   was decided once and survived every round; a partial approval sends an
 *   order back for a fresh decision once its released quantity has gone out, so
 *   round 1's rail must show round 1's credit stamp, not today's.
 */
const roundDoneAt = (step: QueueStep, v: RoundView): string | null =>
  step === "credit_check" ? v.ccAt
  : step === "material_status" ? v.msAt
  : step === "sales_bill" ? v.sbAt
  : step === "gate_out" ? v.goAt
  : step === "dispatch_confirm" ? v.dcAt
  : null;

const roundDoneBy = (step: QueueStep, v: RoundView): string | null =>
  step === "credit_check" ? v.ccBy
  : step === "material_status" ? v.msBy
  : step === "sales_bill" ? v.sbBy
  : step === "gate_out" ? v.goBy
  : step === "dispatch_confirm" ? v.dcBy
  : null;

/**
 * A closed/cancelled order has no live round; fall back to its last archived one.
 *
 * The archived branch defers to `archivedRoundView` — this used to restate all
 * thirty-odd fields by hand, which meant every new column on a round had to be
 * remembered in two places or one of them silently returned undefined.
 */
const archivedFallback = (o: DispatchOrder): RoundView => {
  const last = o.rounds[o.rounds.length - 1];
  return last
    ? archivedRoundView(last)
    : {
        roundNo: o.roundNo, isArchived: true, roundId: null, roundStartedAt: o.roundStartedAt,
        companyId: o.companyId, locationId: o.locationId,
        ccStatus: null, ccApprovedQty: null, ccRemarks: null, ccAt: null, ccBy: null,
        msActualDate: null, msTempoNo: null, msPorter: null, msRemarks: null, msAt: null, msBy: null,
        sbActualDate: null, sbInvoiceNo: null, sbAttachmentPath: null, sbAttachmentName: null,
        sbEwayPath: null, sbEwayName: null,
        sbRemarks: null, sbAt: null, sbBy: null, gpNo: null,
        goActualDate: null, goOutwardNo: null, goRemarks: null, goAt: null, goBy: null,
        dcActualDate: null, dcStatus: null, dcAttachmentPath: null, dcAttachmentName: null,
        dcAttachmentPages: [], dcRemarks: null, dcAt: null, dcBy: null,
        editedAt: null, editedBy: null, amendedAt: null, amendReason: null, items: [],
      };
};

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

/** The status value each step records, as words. Round-scoped past credit. */
function statusLabelFor(step: StepKey, o: DispatchOrder, v: RoundView): string {
  switch (step) {
    case "sales_order":
      return "Raised";
    case "credit_check": {
      if (!v.ccStatus) return "—";
      const label = CREDIT_STATUS_LABEL[v.ccStatus];
      // On a partial the figure IS the decision — "Partially approved" alone
      // could mean 1 of 70 or 69 of 70.
      return v.ccStatus === "partial" && v.ccApprovedQty != null
        ? `${label} · ${v.ccApprovedQty}`
        : label;
    }
    case "material_status": {
      const total = v.items.reduce((a, i) => a + (Number(i.shipQty) || 0), 0);
      return total ? `${total} going out` : "—";
    }
    case "sales_bill":
      return v.sbInvoiceNo ? `Invoice ${v.sbInvoiceNo}` : "—";
    case "gate_out":
      return v.goOutwardNo ?? "—";
    case "dispatch_confirm":
      return v.dcStatus ? DELIVERY_STATUS_LABEL[v.dcStatus] : "—";
    default:
      return "—";
  }
}

function remarksFor(step: StepKey, o: DispatchOrder, v: RoundView): string | null {
  switch (step) {
    case "sales_order": return o.orderRemarks;
    case "credit_check": return v.ccRemarks;
    case "material_status": return v.msRemarks;
    case "sales_bill": return v.sbRemarks;
    case "gate_out": return v.goRemarks;
    case "dispatch_confirm": return v.dcRemarks;
    default: return null;
  }
}

function actualIsoFor(step: StepKey, o: DispatchOrder, v: RoundView): string | null {
  switch (step) {
    // The origin step's "actual" is the order date the customer's order arrived.
    case "sales_order": return o.orderDate;
    // ⚠ cc_actual_date was dropped with the rest of the credit capture, so this
    //   falls back to the completion stamp — which is a TIMESTAMP. It must be
    //   sliced to a date before it reaches dayDiff, or lateDays computes NaN and
    //   the register exports the literal text "NaN".
    case "credit_check": return v.ccAt ? v.ccAt.slice(0, 10) : null;
    case "material_status": return v.msActualDate;
    case "sales_bill": return v.sbActualDate;
    case "gate_out": return v.goActualDate;
    case "dispatch_confirm": return v.dcActualDate;
    default: return null;
  }
}

function docFor(step: StepKey, v: RoundView): { path: string; name: string } | null {
  if (step === "sales_bill" && v.sbAttachmentPath) {
    return { path: v.sbAttachmentPath, name: v.sbAttachmentName ?? "Sales invoice" };
  }
  if (step === "dispatch_confirm" && v.dcAttachmentPath) {
    return { path: v.dcAttachmentPath, name: v.dcAttachmentName ?? "Receiver copy" };
  }
  return null;
}

export interface OrderVmDeps {
  snap: DispatchSnapshot;
  /**
   * Resolves a step's configured owners to display names.
   *
   * ⚠ TAKES THE ORDER'S LOCATION. Ownership is per site, so the owners of
   *   gate-out depend on where the consignment leaves from; passing only the
   *   step would name everyone who owns it anywhere, most of whom cannot even
   *   see this order.
   */
  ownerNamesFor: (stepKey: StepKey, locationId: string | null) => string[];
  todayIso?: string;
}

/**
 * The six step rows for one ROUND of an order, in workflow order.
 *
 * ⚠ Pass the round explicitly for anything historical. Defaulting to the live
 *   header would make round 1's row report round 3's planned dates — every
 *   historic row would then show "0 days late", which is the opposite of what
 *   the register exists to show.
 */
export function orderStepRows(o: DispatchOrder, deps: OrderVmDeps, view?: RoundView): StepRow[] {
  const today = deps.todayIso ?? todayLocalIso();
  const v = view ?? currentRoundView(o) ?? { ...(archivedFallback(o)) };

  return STEPS.map((st) => {
    const isOrigin = st.key === "sales_order";
    const doneAtIso = isOrigin ? o.submittedAt : roundDoneAt(st.key as QueueStep, v);
    const doneById = isOrigin ? o.raisedBy : roundDoneBy(st.key as QueueStep, v);
    const plannedIso = isOrigin ? null : dispatchDueIso(deps.snap, o, st.key as QueueStep, v);
    const actualIso = actualIsoFor(st.key, o, v);

    const state: StepRow["state"] =
      doneAtIso ? "done" : o.currentStep === st.key ? "current" : "pending";

    // Late is measured against what was DUE and what was RECORDED. Both have to
    // exist — an undone step is "overdue", which is a different thing.
    const lateDays =
      plannedIso && actualIso && doneAtIso ? Math.max(0, dayDiff(actualIso, plannedIso)) : null;

    // `awaiting_sales_return` counts as finished for this purpose: the order is
    // cancelled in intent and nobody is expected to work its remaining steps.
    // Without it, every incomplete step goes red the moment the cancellation is
    // raised, and stays red for as long as accounts take to unwind the invoice.
    const overdue =
      state !== "done" &&
      !!plannedIso &&
      plannedIso < today &&
      o.status !== "closed" &&
      o.status !== "cancelled" &&
      o.status !== "awaiting_sales_return";

    return {
      stepKey: st.key,
      index: st.index,
      title: st.title,
      short: st.short,
      ownerNames: isOrigin
        ? [o.requesterName].filter(Boolean)
        : deps.ownerNamesFor(st.key, v.locationId ?? o.locationId),
      plannedIso,
      actualIso,
      doneAtIso,
      doneById,
      statusLabel: statusLabelFor(st.key, o, v),
      remarks: remarksFor(st.key, o, v),
      doc: docFor(st.key, v),
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
 *
 * ⚠ EVERY ROUND IS A SAMPLE. An order that shipped in three goes raised three
 *   invoices, and all three are real evidence about how long billing takes.
 *   Reading only the live header would silently discard the first two and
 *   compute the mean from a third of the data.
 */
export function stepVariance(
  orders: DispatchOrder[],
  deps: OrderVmDeps,
): { stepKey: StepKey; short: string; samples: number; meanLate: number }[] {
  const acc = new Map<StepKey, { total: number; n: number; short: string }>();
  for (const o of orders) {
    for (const v of allRoundViews(o)) {
      for (const r of orderStepRows(o, deps, v)) {
        // Credit is decided once per ORDER — counting it once per round would
        // weight a three-round order three times on that step alone.
        if (r.stepKey === "credit_check" && v.roundNo !== (o.rounds[0]?.roundNo ?? o.roundNo)) continue;
        if (r.lateDays === null) continue;
        const cur = acc.get(r.stepKey) ?? { total: 0, n: 0, short: r.short };
        cur.total += r.lateDays;
        cur.n += 1;
        acc.set(r.stepKey, cur);
      }
    }
  }
  return STEPS.filter((s) => acc.has(s.key)).map((s) => {
    const a = acc.get(s.key)!;
    return { stepKey: s.key, short: s.short, samples: a.n, meanLate: a.n ? a.total / a.n : 0 };
  });
}
