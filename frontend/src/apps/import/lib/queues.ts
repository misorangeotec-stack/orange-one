/**
 * The single source of truth for Purchase FMS **queue membership** and **due
 * dates**.
 *
 * Everything here is pure: it takes a `ImportData` snapshot and returns
 * plain data. In particular it knows nothing about the signed-in user, so it
 * never owner-filters. That matters — `store.approvalQueue` narrows the approval
 * queue to lines the current user may approve, but a coordinator's Control
 * Center must count *all* of them. Callers that want owner scoping compose their
 * own `.filter(...)` on top.
 *
 * Both the per-step queue pages (PoQueues / SourcingQueue / ApprovalsQueue) and
 * the cross-FMS Control Center consume these predicates, so their counts cannot
 * drift apart.
 *
 * A "queue entry" is a **(step, entity) work-item**, not an entity. The same PO
 * can legitimately sit in two queues at once — e.g. a PO at `advance_payment`
 * that still has no PI is in both the Advance and the Collect-PI queue — so the
 * sum of the per-step counts can exceed the number of open POs. That is the
 * number a process coordinator wants: units of step-work due.
 */
import type { ImportData } from "../data/importFetch";
import type { QueueEntryBase } from "@/shared/lib/fmsQueue";
import type { StepKey } from "./steps";
import { DEFAULT_STEP_SLA, addWorkingDays, localDateIso, type StepSla } from "./sla";
import type { Followup, Grn, GrnItem, Payment, Pi, PiItem, PoItem, PurchaseOrder, RequestItem, TallyBooking } from "../types";

/**
 * The slice of `ImportData` these rules actually read. A structural subset
 * so the store can pass its own loose arrays and the Control Center adapter can
 * pass a full `ImportData` — both satisfy it.
 */
export type ImportSnapshot = Pick<
  ImportData,
  | "requests"
  | "requestItems"
  | "pos"
  | "poItems"
  | "pis"
  | "piItems"
  | "grns"
  | "grnItems"
  | "tallyBookings"
  | "payments"
  | "followups"
  | "activity"
  | "config"
>;

/**
 * Purchase's queue atom. Extends the shared shape (`stepKey`, `entityId`, `ref`,
 * `dueIso` — all the Control Center reads) with the fields the Purchase queue
 * tables need: which entity it is, the company to group by, and the order value.
 *
 * `dueIso` is `null` only for a follow-up with no promised dispatch date, and for
 * `inward`, which is untimed by design.
 */
export interface QueueEntry extends QueueEntryBase<StepKey> {
  /**
   * Note the asymmetry: sourcing and approval are still per LINE here, but the
   * PO desk is per REQUISITION — a PO never spans two requisitions, so a
   * requisition is one piece of PO work however many vendors it needs.
   */
  entityType: "line" | "po" | "request";
  companyId: string | null;
  value: number | null;
}

/* -------------------------------------------------------------------------- */
/*  Index — the O(1) lookups the predicates need, built once per snapshot.     */
/* -------------------------------------------------------------------------- */

export interface ImportIndex {
  poItemsByPo: Map<string, PoItem[]>;
  pisByPo: Map<string, Pi[]>;
  piItemsByPi: Map<string, PiItem[]>;
  grnsByPo: Map<string, Grn[]>;
  grnItemsByGrn: Map<string, GrnItem[]>;
  tallyByPo: Map<string, TallyBooking[]>;
  bookedGrnIds: Set<string>;
  paymentsByPo: Map<string, Payment[]>;
  followupsByPo: Map<string, Followup[]>;
  /** Latest activity `created_at` seen for a PO id or a PI id. */
  latestActivityByEntity: Map<string, string>;
  requestById: Map<string, { companyId: string; requestNo: string }>;
  /** Needed to resolve a PO-scope step anchored on a request-scope step. */
  requestItemById: Map<string, RequestItem>;
}

const push = <T,>(m: Map<string, T[]>, k: string, v: T) => {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
};

export function buildImportIndex(data: ImportSnapshot): ImportIndex {
  const idx: ImportIndex = {
    poItemsByPo: new Map(),
    pisByPo: new Map(),
    piItemsByPi: new Map(),
    grnsByPo: new Map(),
    grnItemsByGrn: new Map(),
    tallyByPo: new Map(),
    bookedGrnIds: new Set(),
    paymentsByPo: new Map(),
    followupsByPo: new Map(),
    latestActivityByEntity: new Map(),
    requestById: new Map(),
    requestItemById: new Map(),
  };

  for (const it of data.poItems) push(idx.poItemsByPo, it.poId, it);
  for (const pi of data.pis) push(idx.pisByPo, pi.poId, pi);
  for (const pii of data.piItems) push(idx.piItemsByPi, pii.piId, pii);
  for (const g of data.grns) push(idx.grnsByPo, g.poId, g);
  for (const gi of data.grnItems) push(idx.grnItemsByGrn, gi.grnId, gi);
  for (const t of data.tallyBookings) {
    push(idx.tallyByPo, t.poId, t);
    if (t.grnId) idx.bookedGrnIds.add(t.grnId);
  }
  for (const p of data.payments) push(idx.paymentsByPo, p.poId, p);
  for (const f of data.followups) push(idx.followupsByPo, f.poId, f);
  for (const r of data.requests) idx.requestById.set(r.id, { companyId: r.companyId, requestNo: r.requestNo });
  for (const l of data.requestItems) idx.requestItemById.set(l.id, l);

  // Only `po` / `pi` activity feeds the stage-entry timestamp (see sinceIso).
  for (const a of data.activity) {
    if (a.entityType !== "po" && a.entityType !== "pi") continue;
    const prev = idx.latestActivityByEntity.get(a.entityId);
    if (!prev || a.createdAt > prev) idx.latestActivityByEntity.set(a.entityId, a.createdAt);
  }
  return idx;
}

/* -------------------------------------------------------------------------- */
/*  Primitives                                                                 */
/* -------------------------------------------------------------------------- */

export const isOpenPo = (p: PurchaseOrder): boolean => p.currentStage !== "closed" && p.currentStage !== "cancelled";

/**
 * When the PO entered its CURRENT stage — the latest activity on the PO (or on
 * any of its PIs); falls back to PO creation for entries with no activity yet.
 * This, not the original creation date, is what the SLA due date keys off.
 */
export function sinceIso(idx: ImportIndex, p: PurchaseOrder): string {
  let latest = idx.latestActivityByEntity.get(p.id) ?? p.createdAt;
  if (latest < p.createdAt) latest = p.createdAt;
  for (const pi of idx.pisByPo.get(p.id) ?? []) {
    const a = idx.latestActivityByEntity.get(pi.id);
    if (a && a > latest) latest = a;
  }
  return latest;
}

/** All PO lines fully received (and there is at least one line). */
export function allReceived(idx: ImportIndex, p: PurchaseOrder): boolean {
  const items = idx.poItemsByPo.get(p.id) ?? [];
  return items.length > 0 && items.every((it) => it.receivedQty >= it.qty);
}

/**
 * Goods quantities summed across a PO's lines. `pending` is what the Inward queue
 * is still waiting on — the 400 of a 500-qty order when 100 has arrived.
 */
export function poQty(idx: ImportIndex, p: PurchaseOrder): { ordered: number; received: number; pending: number } {
  const items = idx.poItemsByPo.get(p.id) ?? [];
  const ordered = items.reduce((a, it) => a + it.qty, 0);
  const received = items.reduce((a, it) => a + it.receivedQty, 0);
  return { ordered, received, pending: Math.max(0, ordered - received) };
}

/** Quantity received on this GRN (summed across its lines). */
export function grnQty(idx: ImportIndex, grnId: string): number {
  return (idx.grnItemsByGrn.get(grnId) ?? []).reduce((a, x) => a + x.receivedQty, 0);
}

/**
 * Quantity sitting in goods receipts that have no Tally invoice yet — the 100 the
 * Tally queue must book. Pairs with `poQty(...).received` on the Inward screen.
 */
export function unbookedQty(idx: ImportIndex, poId: string): number {
  return unbookedGrnsForPo(idx, poId).reduce((a, g) => a + grnQty(idx, g.id), 0);
}

/** Any goods received at all (at least one line has a receipt). */
export function anyReceived(idx: ImportIndex, p: PurchaseOrder): boolean {
  return (idx.poItemsByPo.get(p.id) ?? []).some((it) => it.receivedQty > 0);
}

/** The vendor has dispatched — from a PO-level follow-up, or a legacy PI snapshot. */
export function isDispatched(idx: ImportIndex, p: PurchaseOrder): boolean {
  return (
    (idx.followupsByPo.get(p.id) ?? []).some((f) => f.dispatchStatus === "dispatched") ||
    (idx.pisByPo.get(p.id) ?? []).some((pi) => pi.dispatchStatus === "dispatched")
  );
}

/**
 * How much of a PO's lines are covered by collected PI(s). A PO line is
 * "covered" once the PI-item qty booked against it reaches the ordered qty.
 * Keeps a PO in the Collect-PI queue until EVERY line has a PI.
 */
export function piCoverage(idx: ImportIndex, p: PurchaseOrder): { total: number; full: number; hasPi: boolean } {
  const items = idx.poItemsByPo.get(p.id) ?? [];
  const pis = idx.pisByPo.get(p.id) ?? [];
  const covered = new Map<string, number>();
  for (const pi of pis)
    for (const pii of idx.piItemsByPi.get(pi.id) ?? []) covered.set(pii.poItemId, (covered.get(pii.poItemId) ?? 0) + pii.qty);
  let full = 0;
  for (const it of items) if ((covered.get(it.id) ?? 0) >= it.qty) full++;
  return { total: items.length, full, hasPi: pis.length > 0 };
}

export function needsPi(idx: ImportIndex, p: PurchaseOrder): boolean {
  const c = piCoverage(idx, p);
  return c.total > 0 && c.full < c.total;
}

/** Goods receipts on this PO with no Tally invoice booked yet. */
export function unbookedGrnsForPo(idx: ImportIndex, poId: string): Grn[] {
  return (idx.grnsByPo.get(poId) ?? []).filter((g) => !idx.bookedGrnIds.has(g.id));
}

export function pendingAmount(idx: ImportIndex, p: PurchaseOrder): number {
  const paid = (idx.paymentsByPo.get(p.id) ?? []).reduce((a, x) => a + x.amount, 0);
  return Math.max(0, p.totalValue - paid);
}

/**
 * The dispatch date currently promised for a PO: the most recent revised date
 * from its follow-ups, else the PO's expected dispatch date (set at Share PO),
 * else the legacy first-PI date for POs shared before it moved onto the PO.
 */
export function dispatchDueForPo(idx: ImportIndex, data: ImportSnapshot, poId: string): string | null {
  const revised = (idx.followupsByPo.get(poId) ?? [])
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .find((f) => f.revisedDispatchDate)?.revisedDispatchDate;
  if (revised) return revised;
  const po = data.pos.find((p) => p.id === poId);
  if (po?.dispatchDate) return po.dispatchDate;
  const pi = (idx.pisByPo.get(poId) ?? []).slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  return pi?.revisedDispatchDate ?? pi?.dispatchDate ?? null;
}

/* -------------------------------------------------------------------------- */
/*  Step completion timestamps → configurable due dates                        */
/* -------------------------------------------------------------------------- */

/** Latest of a list of ISO timestamps, ignoring nulls. */
const maxIso = (xs: (string | null | undefined)[]): string | null =>
  xs.filter((x): x is string => !!x).sort().pop() ?? null;

/** Earliest of a list of ISO timestamps, ignoring nulls. (ISO sorts lexicographically.) */
const minIso = (xs: (string | null | undefined)[]): string | null =>
  xs.filter((x): x is string => !!x).sort()[0] ?? null;

/**
 * When `step` completed for one request LINE, or `null` if it hasn't.
 * `sourced_at` / `approved_at` are stamped inside the RPCs (not the best-effort
 * activity trail), so they're authoritative.
 */
export function lineStepCompletedIso(line: RequestItem, step: StepKey): string | null {
  switch (step) {
    case "request":
      return line.createdAt;
    case "sourcing":
      return line.sourcedAt;
    case "approval":
      return line.approvedAt;
    default:
      return null; // `po` and every PO-scope step are not line milestones
  }
}

/** When `step` completed for one PO, or `null` if it hasn't. */
export function poStepCompletedIso(idx: ImportIndex, po: PurchaseOrder, step: StepKey): string | null {
  switch (step) {
    // A request-scope anchor resolves through the PO's lines: the PO could not
    // proceed until the LAST of its lines cleared that step, so take the max.
    case "request":
    case "sourcing":
    case "approval": {
      const lines = (idx.poItemsByPo.get(po.id) ?? [])
        .map((it) => idx.requestItemById.get(it.requestItemId))
        .filter((l): l is RequestItem => !!l);
      if (lines.length === 0) return null;
      const stamps = lines.map((l) => lineStepCompletedIso(l, step));
      // Not complete until every line has cleared it.
      return stamps.every(Boolean) ? maxIso(stamps) : null;
    }
    case "po":
      return po.createdAt; // the PO row exists ⇒ "Generate PO" is done
    case "share_po":
      return po.sharedAt;
    case "collect_pi":
      return needsPi(idx, po) ? null : maxIso((idx.pisByPo.get(po.id) ?? []).map((p) => p.createdAt));
    case "advance_payment":
      return (idx.paymentsByPo.get(po.id) ?? [])
        .slice()
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]?.createdAt ?? null;
    case "follow_up":
      return (idx.followupsByPo.get(po.id) ?? [])
        .filter((f) => f.dispatchStatus === "dispatched")
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]?.createdAt ?? null;
    case "inward":
      return allReceived(idx, po) ? maxIso((idx.grnsByPo.get(po.id) ?? []).map((g) => g.createdAt)) : null;
    case "tally":
      return unbookedGrnsForPo(idx, po.id).length > 0
        ? null
        : maxIso((idx.tallyByPo.get(po.id) ?? []).map((t) => t.createdAt));
    default:
      return null;
  }
}

/**
 * The final `?? {…}` is load-bearing: `step` reaches here from a raw DB
 * `current_stage` string (cast in PoQueues), so a PO parked on a retired stage —
 * e.g. `final_payment` before its migration runs — would otherwise destructure
 * `undefined` and white-screen the queue page.
 */
const slaFor = (data: ImportSnapshot, step: StepKey): StepSla =>
  data.config?.stepSla?.[step] ?? DEFAULT_STEP_SLA[step] ?? { anchor: step, days: 1 };

/**
 * A line's due date for `step` = its anchor step's completion + N working days.
 * Falls back to the line's own `createdAt` when the anchor never completed, so a
 * row never silently loses its due date.
 */
export function lineDueIso(data: ImportSnapshot, line: RequestItem, step: StepKey): string {
  const { anchor, days } = slaFor(data, step);
  const from = lineStepCompletedIso(line, anchor) ?? line.createdAt;
  return localDateIso(addWorkingDays(new Date(from), days));
}

/**
 * A PO's due date for `step`, or null when the step has no clock yet.
 *
 * Three steps do not use the anchor rule:
 *   • `follow_up` — the vendor's promised dispatch date, never an SLA.
 *   • `inward` — untimed. The transporter controls when the goods turn up, so
 *     receiving can never be "late": the step has no due date at any point.
 *   • `tally` — trigger-anchored on the oldest unbooked GRN (see TRIGGER_STEPS).
 *     It gets NO `po.createdAt` fallback: a PO raised two months ago must not show
 *     its Tally invoice 60 days overdue the instant the first box arrives.
 */
export function poDueIso(idx: ImportIndex, data: ImportSnapshot, po: PurchaseOrder, step: StepKey): string | null {
  if (step === "follow_up") return dispatchDueForPo(idx, data, po.id);
  if (step === "inward") return null;
  const { days } = slaFor(data, step);
  const after = (iso: string | null) => (iso ? localDateIso(addWorkingDays(new Date(iso), days)) : null);

  if (step === "tally") return after(minIso(unbookedGrnsForPo(idx, po.id).map((g) => g.createdAt)));

  const { anchor } = slaFor(data, step);
  return after(poStepCompletedIso(idx, po, anchor) ?? po.createdAt);
}

/* -------------------------------------------------------------------------- */
/*  Per-step predicates                                                        */
/* -------------------------------------------------------------------------- */

/** The three request-line queues, owner-agnostic (see the file header). */
export const lineInSourcing = (l: RequestItem) => l.status === "sourcing";
export const lineInApproval = (l: RequestItem) => l.status === "approval" || l.status === "on_hold";
export const lineInPoDesk = (l: RequestItem) => l.status === "approved_pending_po";

/** The six PO queues. Each takes the index so it stays O(1). */
export const poInSharePo = (_idx: ImportIndex, p: PurchaseOrder) => isOpenPo(p) && p.currentStage === "share_po";
export const poInCollectPi = (idx: ImportIndex, p: PurchaseOrder) => isOpenPo(p) && p.currentStage !== "share_po" && needsPi(idx, p);
export const poInAdvance = (_idx: ImportIndex, p: PurchaseOrder) => isOpenPo(p) && p.currentStage === "advance_payment";
export const poInFollowUp = (_idx: ImportIndex, p: PurchaseOrder) => isOpenPo(p) && p.currentStage === "follow_up";
/**
 * Goods still to be received. Deliberately NOT keyed on `currentStage`: a partial
 * receipt moves the PO to the `tally` stage (its 100 needs an invoice) while the
 * remaining 400 is still owed, so the PO must stay in the Inward queue too. It
 * leaves only once every line is fully received.
 */
export const poInInward = (idx: ImportIndex, p: PurchaseOrder) =>
  isOpenPo(p) &&
  (idx.poItemsByPo.get(p.id) ?? []).length > 0 &&
  !allReceived(idx, p) &&
  (anyReceived(idx, p) || isDispatched(idx, p) || p.currentStage === "inward");
/** Each GRN becomes its own Tally invoice, so a partial receipt qualifies. */
export const poInTally = (idx: ImportIndex, p: PurchaseOrder) => isOpenPo(p) && unbookedGrnsForPo(idx, p.id).length > 0;

const PO_STEPS: { stepKey: StepKey; match: (idx: ImportIndex, p: PurchaseOrder) => boolean }[] = [
  { stepKey: "share_po", match: poInSharePo },
  { stepKey: "collect_pi", match: poInCollectPi },
  { stepKey: "advance_payment", match: poInAdvance },
  { stepKey: "follow_up", match: poInFollowUp },
  { stepKey: "inward", match: poInInward },
  { stepKey: "tally", match: poInTally },
];

/** Sourcing and approval only — the PO desk is requisition-scoped (see below). */
const LINE_STEPS: { stepKey: StepKey; match: (l: RequestItem) => boolean }[] = [
  { stepKey: "sourcing", match: lineInSourcing },
  { stepKey: "approval", match: lineInApproval },
];

/** The lines the PO workbench may act on — exactly what the RPC accepts. */
export const poDeskLinesOf = (lines: RequestItem[]): RequestItem[] => lines.filter(lineInPoDesk);

/**
 * A requisition's PO due date: the EARLIEST of its pool lines' due dates. On a
 * legacy requisition with divergent stamps the minimum is the conservative
 * choice.
 */
export const requestPoDueIso = (data: ImportSnapshot, poolLines: RequestItem[]): string | null =>
  poolLines.map((l) => lineDueIso(data, l, "po")).reduce<string | null>((a, b) => (a === null || b <= a ? b : a), null);

/* -------------------------------------------------------------------------- */
/*  Completed entries — the "what I did here" side of a stage                  */
/* -------------------------------------------------------------------------- */

/**
 * One piece of work a user COMPLETED at a step — the counterpart to a queue
 * entry, which is work still owed.
 *
 * Note what this is NOT: `poStepCompletedIso` answers "has this PO cleared this
 * step, and when", collapsing N rows to one timestamp and returning null while
 * any sibling line is outstanding. Both behaviours are correct for an SLA anchor
 * and useless here — a PO with three PIs has three entries, and a PI collected
 * yesterday is done even if line 3 is still open.
 *
 * `companyId` is resolved at BUILD time, not in the table's `groupBy.idOf`.
 * QueueTable calls `idOf` from inside its sort comparator, so a `pos.find(...)`
 * there would be O(n·m) — measured in seconds once this list is a year deep.
 *
 * Like every predicate in this file, this is owner-agnostic: it returns
 * everyone's entries and the caller filters to "mine". The Control Center needs
 * the unscoped set.
 *
 * NO SOURCING ENTRIES: Import has no Sourcing step (the vendor and rate come
 * from the price master, so a line is born at `approval`). Its SourcingQueue.tsx
 * is unrouted dead code, so a `completedSourcingEntries` here would build a list
 * nothing can render.
 */
export interface StageEntry<T> {
  /** The underlying row's id — the PO for `share_po`, the PI row for `collect_pi`, … */
  id: string;
  stepKey: StepKey;
  poId: string;
  /** Human reference, for display and search. */
  ref: string;
  companyId: string | null;
  /** Who completed the step. Null = unknown: the row pre-dates its actor column. */
  actorId: string | null;
  /** When the step completed. */
  atIso: string;
  /** When it was last corrected, if ever. */
  editedAtIso: string | null;
  editedById: string | null;
  /** Null when the entry may still be corrected; otherwise why it cannot be. */
  lockReason: string | null;
  /** The row itself, so the page can render its own columns without a second lookup. */
  row: T;
}

/**
 * Why a Share PO entry can no longer be corrected, or null while it still can.
 *
 * Mirrors `fms_import_share_po_editable()` in the DB. The server is the gate —
 * this exists so the UI can disable the button and say why, and the two rules
 * are deliberately written to the same shape so a drift is easy to spot.
 *
 * "The next step" is not merely `collect_pi`: the flow can legitimately skip
 * ahead (an advance paid, or goods landing, before any PI), and each of those is
 * downstream work that a changed PO document would invalidate. So the rule is
 * "no downstream artifact of any kind exists yet".
 */
export function poShareLockReason(idx: ImportIndex, p: PurchaseOrder): string | null {
  if (p.currentStage === "closed" || p.currentStage === "cancelled") {
    // Terminal is absorbing: refresh_po short-circuits on these, so an edit here
    // would silently skip every derived recompute and drift the data.
    return `This PO is ${p.currentStage} — its share details can no longer be edited.`;
  }
  if ((idx.pisByPo.get(p.id) ?? []).length > 0) return "A PI has already been collected against this PO.";
  if ((idx.paymentsByPo.get(p.id) ?? []).length > 0) return "A payment has already been recorded against this PO.";
  if ((idx.followupsByPo.get(p.id) ?? []).length > 0) return "A follow-up has already been recorded against this PO.";
  if ((idx.grnsByPo.get(p.id) ?? []).length > 0) return "Goods have already been received against this PO.";
  return null;
}

/**
 * Every Share PO step completed across the book — the PO rows that carry a
 * `sharedAt`. The entry IS the PO here, because the share details live on the PO
 * row rather than on a child of their own.
 *
 * Includes closed and cancelled POs on purpose: "what I did" must not evaporate
 * when the order later completes or is abandoned. They come back locked.
 */
export function completedShareEntries(data: ImportSnapshot, idx: ImportIndex): StageEntry<PurchaseOrder>[] {
  const out: StageEntry<PurchaseOrder>[] = [];
  for (const p of data.pos) {
    if (!p.sharedAt) continue; // the step isn't done, so there is nothing to show
    out.push({
      id: p.id,
      stepKey: "share_po",
      poId: p.id,
      ref: p.poNo,
      companyId: p.companyId,
      actorId: p.sharedBy,
      atIso: p.sharedAt,
      editedAtIso: p.editedAt,
      editedById: p.editedBy,
      lockReason: poShareLockReason(idx, p),
      row: p,
    });
  }
  return out;
}

/* ----- The remaining PO-scope stages ------------------------------------- */

/**
 * Every rule below mirrors its `fms_import_<step>_editable()` counterpart in the
 * DB. The server is the gate; these exist so the UI can grey a button and SAY
 * WHY, and are written to the same shape so a drift is easy to spot.
 *
 * All of them start from the same bar: a closed or cancelled PO is never
 * editable. `refresh_po` short-circuits on terminal POs, so an edit there would
 * silently skip every derived recompute — that's mechanical, not policy.
 */
const terminalReason = (p: PurchaseOrder | undefined, what: string): string | null =>
  p && (p.currentStage === "closed" || p.currentStage === "cancelled")
    ? `This PO is ${p.currentStage} — its ${what} can no longer be edited.`
    : null;

const poOf = (data: ImportSnapshot, poId: string) => data.pos.find((p) => p.id === poId);

export function piLockReason(data: ImportSnapshot, idx: ImportIndex, pi: Pi): string | null {
  const t = terminalReason(poOf(data, pi.poId), "PI");
  if (t) return t;
  if ((idx.grnsByPo.get(pi.poId) ?? []).length > 0) return "Goods have already been received against this PO.";
  if ((idx.paymentsByPo.get(pi.poId) ?? []).some((x) => x.piId === pi.id)) return "A payment has already been recorded against this PI.";
  return null;
}

export function paymentLockReason(data: ImportSnapshot, idx: ImportIndex, pay: Payment): string | null {
  const t = terminalReason(poOf(data, pay.poId), "payment");
  if (t) return t;
  if ((idx.followupsByPo.get(pay.poId) ?? []).length > 0) return "A follow-up has already been recorded against this PO.";
  return null;
}

export function followupLockReason(data: ImportSnapshot, idx: ImportIndex, f: Followup): string | null {
  const t = terminalReason(poOf(data, f.poId), "follow-up");
  if (t) return t;
  if ((idx.grnsByPo.get(f.poId) ?? []).length > 0) return "Goods have already been received against this PO.";
  return null;
}

export function grnLockReason(data: ImportSnapshot, idx: ImportIndex, g: Grn): string | null {
  const t = terminalReason(poOf(data, g.poId), "goods receipt");
  if (t) return t;
  if (idx.bookedGrnIds.has(g.id)) return "This receipt has already been booked in Tally.";
  return null;
}

export function tallyLockReason(data: ImportSnapshot, t: TallyBooking): string | null {
  return terminalReason(poOf(data, t.poId), "Tally booking");
}

/** Shared shape for the five child-row stages: same fields, different row type. */
function poChildEntry<T>(
  data: ImportSnapshot,
  stepKey: StepKey,
  row: T & { id: string; poId: string; createdAt: string; editedAt?: string | null; editedBy?: string | null },
  actorId: string | null,
  lockReason: string | null,
): StageEntry<T> {
  const po = poOf(data, row.poId);
  return {
    id: row.id,
    stepKey,
    poId: row.poId,
    ref: po?.poNo ?? "—",
    companyId: po?.companyId ?? null,
    actorId,
    atIso: row.createdAt,
    editedAtIso: row.editedAt ?? null,
    editedById: row.editedBy ?? null,
    lockReason,
    row,
  };
}

export const completedPiEntries = (data: ImportSnapshot, idx: ImportIndex): StageEntry<Pi>[] =>
  data.pis.map((pi) => poChildEntry(data, "collect_pi", pi, pi.createdBy, piLockReason(data, idx, pi)));

/**
 * Advance only — not every payment. A balance payment is recordable from PoDetail
 * but no step chases it (see 20260716122600), so it is not stage work and does
 * not belong in this stage's history.
 */
export const completedAdvanceEntries = (data: ImportSnapshot, idx: ImportIndex): StageEntry<Payment>[] =>
  data.payments
    .filter((p) => p.kind === "advance")
    .map((p) => poChildEntry(data, "advance_payment", p, p.createdBy, paymentLockReason(data, idx, p)));

export const completedFollowupEntries = (data: ImportSnapshot, idx: ImportIndex): StageEntry<Followup>[] =>
  data.followups.map((f) => poChildEntry(data, "follow_up", f, f.createdBy, followupLockReason(data, idx, f)));

export const completedGrnEntries = (data: ImportSnapshot, idx: ImportIndex): StageEntry<Grn>[] =>
  data.grns.map((g) => poChildEntry(data, "inward", g, g.receivedBy, grnLockReason(data, idx, g)));

export const completedTallyEntries = (data: ImportSnapshot): StageEntry<TallyBooking>[] =>
  data.tallyBookings.map((t) => poChildEntry(data, "tally", t, t.bookedBy, tallyLockReason(data, t)));

/* ----- The request-scope stages ------------------------------------------ */

/**
 * An approval decision is editable while the line is approved but has no PO yet.
 *
 * Note what this is NOT: "locked once `approvedAt` is set" would lock the
 * decision the moment it was made, and "locked once a PO exists" would leave a
 * REJECTED line editable forever — a rejected line never gets a PO. Rejected and
 * cancelled are terminal: the app has no un-reject path and this does not add one.
 */
export function approvalLockReason(line: RequestItem): string | null {
  if (line.status === "po") return "The PO has already been generated — this approval can no longer be changed.";
  if (line.status === "rejected" || line.status === "cancelled") return `This line was ${line.status} — its approval can no longer be changed.`;
  return null;
}

/** The generated PO is amendable (its number only) until it goes to the vendor. */
export function poGenLockReason(p: PurchaseOrder): string | null {
  if (p.currentStage === "closed" || p.currentStage === "cancelled") return `This PO is ${p.currentStage} — it can no longer be edited.`;
  if (p.sharedAt) return "This PO has already been shared with the vendor — its number can no longer be changed.";
  return null;
}

function lineEntry(idx: ImportIndex, stepKey: StepKey, line: RequestItem, actorId: string | null, atIso: string, lockReason: string | null): StageEntry<RequestItem> {
  const req = idx.requestById.get(line.requestId);
  return {
    id: line.id,
    stepKey,
    poId: "", // request-scope: no PO yet. Callers link to the request, not a PO.
    ref: req?.requestNo ?? "—",
    companyId: req?.companyId ?? null,
    actorId,
    atIso,
    editedAtIso: line.editedAt,
    editedById: line.editedBy,
    lockReason,
    row: line,
  };
}

/**
 * Decided lines. A rejection is a completed decision too — it is exactly the kind
 * of thing an approver wants to look back at — so `rejected` is included, locked.
 * It carries no `approvedAt` (reject never stamps one), so fall back to the line's
 * own timestamp rather than dropping the row.
 */
export const completedApprovalEntries = (data: ImportSnapshot, idx: ImportIndex): StageEntry<RequestItem>[] =>
  data.requestItems
    .filter((l) => !!l.approvedAt || l.status === "rejected")
    .map((l) => lineEntry(idx, "approval", l, l.approverId, l.approvedAt ?? l.createdAt, approvalLockReason(l)));

/** Generated POs. The entry is the PO; `po.createdAt` is the step's completion. */
export const completedPoGenEntries = (data: ImportSnapshot): StageEntry<PurchaseOrder>[] =>
  data.pos.map((p) => ({
    id: p.id,
    stepKey: "po" as StepKey,
    poId: p.id,
    ref: p.poNo,
    companyId: p.companyId,
    actorId: p.createdBy,
    atIso: p.createdAt,
    editedAtIso: p.editedAt,
    editedById: p.editedBy,
    lockReason: poGenLockReason(p),
    row: p,
  }));

/* -------------------------------------------------------------------------- */
/*  The aggregator                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Every open work-item across the whole Purchase FMS, one per (step, entity).
 *
 * Due dates come from the admin-configured per-step rule (anchor step's
 * completion + N working days, Mon–Sat) — see `lineDueIso` / `poDueIso`.
 * `follow_up` is the exception: its due date is the promised dispatch date,
 * which may be null.
 */
export function buildQueueEntries(data: ImportSnapshot, idx: ImportIndex = buildImportIndex(data)): QueueEntry[] {
  const out: QueueEntry[] = [];

  for (const l of data.requestItems) {
    const step = LINE_STEPS.find((s) => s.match(l));
    if (!step) continue;
    const req = idx.requestById.get(l.requestId);
    if (!req) continue;
    out.push({
      stepKey: step.stepKey,
      entityType: "line",
      entityId: l.id,
      ref: req.requestNo,
      dueIso: lineDueIso(data, l, step.stepKey),
      companyId: req.companyId,
      value: l.lineValue,
    });
  }

  // The PO desk is REQUISITION-scoped: a PO never spans two requisitions, so a
  // requisition is one piece of PO work however many vendors it needs.
  const poolByRequest = new Map<string, RequestItem[]>();
  for (const l of data.requestItems) if (lineInPoDesk(l)) push(poolByRequest, l.requestId, l);
  for (const r of data.requests) {
    const pool = poolByRequest.get(r.id);
    if (!pool?.length) continue;
    out.push({
      stepKey: "po",
      entityType: "request",
      entityId: r.id,
      ref: r.requestNo,
      dueIso: requestPoDueIso(data, pool),
      companyId: r.companyId,
      value: pool.reduce((sum, l) => sum + (l.lineValue ?? 0), 0),
    });
  }

  for (const p of data.pos) {
    if (!isOpenPo(p)) continue;
    for (const step of PO_STEPS) {
      if (!step.match(idx, p)) continue;
      out.push({
        stepKey: step.stepKey,
        entityType: "po",
        entityId: p.id,
        ref: p.poNo,
        dueIso: poDueIso(idx, data, p, step.stepKey),
        companyId: p.companyId,
        value: p.totalValue,
      });
    }
  }

  return out;
}
