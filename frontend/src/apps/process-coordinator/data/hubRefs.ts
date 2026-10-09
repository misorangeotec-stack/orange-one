import type { ProcurementData } from "@/apps/procurement/data/procFetch";
import type { ImportData } from "@/apps/import/data/importFetch";
import type { HrData } from "@/apps/hr-recruitment/data/hrFetch";
import type { ExitData } from "@/apps/hr-exit/data/exitFetch";
import type { SuppliesData } from "@/apps/office-supplies/data/suppliesFetch";
import type { SamplingData } from "@/apps/sampling/data/samplingFetch";
import type { ProductionData } from "@/apps/production-entry/data/productionFetch";
import type { DispatchData } from "@/apps/order-to-dispatch/data/dispatchFetch";
import type { AssetData } from "@/apps/asset-maintenance/data/assetFetch";
import type { TravelData } from "@/apps/travel-desk/data/travelFetch";
import type { LdData } from "@/apps/learning-development/data/ldFetch";
import type { HelpData } from "@/apps/help-desk/data/helpFetch";
import type { CustomerSnapshot } from "@hub/data/customerOnboarding/customerFetch";
import type { ComplaintData } from "@/apps/complaint/data/complaintFetch";
import type { OcpiData } from "@/apps/ocpi/data/ocpiFetch";

/**
 * EVERY NUMBER THE HUB KNOWS FOR A RECORD, keyed by the entity id inside a
 * WorkItem's id (`${source}:${entityId}:${stepKey}`).
 *
 * A pending row's `ref` is only the number of the step it sits at: a Purchase
 * request shows its PR no. at approval and its PO no. from Share PO onwards. The
 * coordinator gets rung with whichever number the caller has in hand, so each
 * record is indexed under its whole FAMILY of numbers — the PR, its POs, their
 * Tally PO no., vendor PI, LR, gate register, Tally voucher, return voucher and
 * payment UTR — and the search finds the row from any of them.
 *
 * `all` is every number in the dataset, open or not. It lets the search say "PO-231
 * exists and has no open step" instead of the ambiguous "nothing found".
 *
 * ⚠ READ-ONLY over data the module already fetched. Nothing here decides whose
 *   work a row is (that stays in core/workspace/mywork/items/) — it only labels
 *   rows that rule already produced. A field missing here makes a number
 *   unsearchable, never a count wrong.
 */

export interface RefIndex {
  byEntity: Map<string, string[]>;
  all: string[];
}

type Val = string | null | undefined;

/** Collects numbers per entity, dropping blanks and repeats. */
class Book {
  private m = new Map<string, Set<string>>();
  add(id: string, ...vals: Val[]) {
    let s = this.m.get(id);
    if (!s) this.m.set(id, (s = new Set()));
    for (const v of vals) {
      const t = v?.trim();
      if (t) s.add(t);
    }
  }
  get(id: string): string[] {
    return [...(this.m.get(id) ?? [])];
  }
  done(): RefIndex {
    const byEntity = new Map<string, string[]>();
    const all = new Set<string>();
    for (const [id, s] of this.m) {
      byEntity.set(id, [...s]);
      for (const v of s) all.add(v);
    }
    return { byEntity, all: [...all] };
  }
}

const groupBy = <T>(rows: T[] | undefined, key: (r: T) => string | null | undefined) => {
  const m = new Map<string, T[]>();
  for (const r of rows ?? []) {
    const k = key(r);
    if (!k) continue;
    const a = m.get(k);
    if (a) a.push(r);
    else m.set(k, [r]);
  }
  return m;
};

/* ---- Purchase + Import: request ⇄ PO families ----------------------------------- */

/**
 * Both FMS share the table shape. A request's lines are ordered onto POs, a PO
 * never spans two requests — so request + its POs + everything hung off those POs
 * is one family, and every member id (request, line, PO) gets the whole family.
 */
interface PurchaseShape {
  requests: { id: string; requestNo: Val }[];
  requestItems: { id: string; requestId: string }[];
  poItems: { requestItemId: string; poId: string }[];
  pos: { id: string; poNo: Val; tallyPoNo: Val }[];
  pis: { poId: string; vendorPiNo: Val; lrNo: Val }[];
  followups: { poId: string; lrNo: Val }[];
  grns: { poId: string; gateRegisterNo: Val; poRef: Val; piRef: Val }[];
  tallyBookings: { poId: string; tallyPiNo: Val }[];
  qcInspections: { poId: string; returnTallyRef: Val; gateRegisterNo: Val }[];
  payments: { poId: string; utrRef: Val }[];
  poCancelRequests: { poId: string; vendorRef: Val }[];
}

// Both datasets must keep fitting the shape — a renamed field fails the build here.
const _shapes: [PurchaseShape, PurchaseShape] = [null as unknown as ProcurementData, null as unknown as ImportData];
void _shapes;

function purchaseLike(d: PurchaseShape): RefIndex {
  const book = new Book();
  const linesByReq = groupBy(d.requestItems, (l) => l.requestId);
  const reqOfLine = new Map(d.requestItems.map((l) => [l.id, l.requestId]));
  const posByReq = new Map<string, Set<string>>();
  for (const pi of d.poItems) {
    const req = reqOfLine.get(pi.requestItemId);
    if (!req) continue;
    let s = posByReq.get(req);
    if (!s) posByReq.set(req, (s = new Set()));
    s.add(pi.poId);
  }
  const pis = groupBy(d.pis, (r) => r.poId);
  const followups = groupBy(d.followups, (r) => r.poId);
  const grns = groupBy(d.grns, (r) => r.poId);
  const tally = groupBy(d.tallyBookings, (r) => r.poId);
  const qc = groupBy(d.qcInspections, (r) => r.poId);
  const pays = groupBy(d.payments, (r) => r.poId);
  const cancels = groupBy(d.poCancelRequests, (r) => r.poId);
  const poById = new Map(d.pos.map((p) => [p.id, p]));

  const poNumbers = (poId: string): Val[] => {
    const p = poById.get(poId);
    return [
      p?.poNo,
      p?.tallyPoNo,
      ...(pis.get(poId) ?? []).flatMap((x) => [x.vendorPiNo, x.lrNo]),
      ...(followups.get(poId) ?? []).map((x) => x.lrNo),
      ...(grns.get(poId) ?? []).flatMap((x) => [x.gateRegisterNo, x.poRef, x.piRef]),
      ...(tally.get(poId) ?? []).map((x) => x.tallyPiNo),
      ...(qc.get(poId) ?? []).flatMap((x) => [x.returnTallyRef, x.gateRegisterNo]),
      ...(pays.get(poId) ?? []).map((x) => x.utrRef),
      ...(cancels.get(poId) ?? []).map((x) => x.vendorRef),
    ];
  };

  const placed = new Set<string>();
  for (const r of d.requests) {
    const poIds = [...(posByReq.get(r.id) ?? [])];
    const family: Val[] = [r.requestNo, ...poIds.flatMap(poNumbers)];
    book.add(r.id, ...family);
    for (const l of linesByReq.get(r.id) ?? []) book.add(l.id, ...family);
    for (const id of poIds) {
      book.add(id, ...family);
      placed.add(id);
    }
  }
  // A PO with no line back to a request still answers to its own numbers.
  for (const p of d.pos) if (!placed.has(p.id)) book.add(p.id, ...poNumbers(p.id));
  return book.done();
}

/* ---- the rest: one record, its own numbers (plus its parent's) ------------------ */

function hr(d: HrData): RefIndex {
  const book = new Book();
  const mrf = new Map(d.requisitions.map((r) => [r.id, r.mrfNo]));
  const cand = new Map(d.candidates.map((c) => [c.id, c]));
  for (const r of d.requisitions) book.add(r.id, r.mrfNo);
  const candNos = (id: string | null | undefined): Val[] => {
    const c = id ? cand.get(id) : undefined;
    return c ? [c.candidateNo, mrf.get(c.requisitionId)] : [];
  };
  for (const c of d.candidates) book.add(c.id, ...candNos(c.id));
  for (const o of d.onboardings) book.add(o.id, o.employeeCode, ...candNos(o.candidateId), mrf.get(o.requisitionId));
  for (const p of d.probations) book.add(p.id, p.employeeCode, ...candNos(p.candidateId), mrf.get(p.requisitionId));
  return book.done();
}

function hrExit(d: ExitData): RefIndex {
  const book = new Book();
  const fnf = groupBy(d.settlements, (s) => s.caseId);
  const caseNos = new Map<string, Val[]>();
  for (const c of d.cases) {
    const nos = [c.exitNo, c.employeeCode, ...(fnf.get(c.id) ?? []).map((s) => s.fnfPaymentRef)];
    caseNos.set(c.id, nos);
    book.add(c.id, ...nos);
  }
  for (const k of d.clearanceChecks) book.add(k.id, ...(caseNos.get(k.caseId) ?? []));
  return book.done();
}

function supplies(d: SuppliesData): RefIndex {
  const book = new Book();
  for (const r of d.requests) book.add(r.id, r.reqNo);
  return book.done();
}

function sampling(d: SamplingData): RefIndex {
  const book = new Book();
  for (const r of d.requests) book.add(r.id, r.reqNo, r.gateEntryNo, r.internalRef);
  return book.done();
}

function production(d: ProductionData): RefIndex {
  const book = new Book();
  const coas = groupBy(d.coas, (c) => c.requestId);
  for (const r of d.requests) {
    book.add(
      r.id,
      r.reqNo,
      r.jobcardNo,
      r.fgLotNo,
      r.rmBookNo,
      r.rmtTallyEntry,
      r.peTallyEntry,
      r.transferSlipNo,
      r.batchCardNo,
      r.lotNo,
      r.pmhBatchNo,
      ...(r.mhBomLines ?? []).map((l) => l.lotNo),
      ...(r.tsBomLines ?? []).map((l) => l.lotNo),
      ...(r.aisRounds ?? []).flatMap((a) => [a.rmtTally, ...(a.mhLines ?? []).map((l) => l.lotNo)]),
      ...(coas.get(r.id) ?? []).map((c) => c.lotNo),
    );
  }
  return book.done();
}

function dispatch(d: DispatchData): RefIndex {
  const book = new Book();
  for (const o of d.orders) {
    book.add(
      o.id,
      o.orderNo,
      o.customerPoNo,
      o.sbInvoiceNo,
      o.gpNo,
      o.goOutwardNo,
      o.msTempoNo,
      o.srInvoiceNo,
      o.srReferenceNo,
      ...(o.rounds ?? []).flatMap((r) => [r.sbInvoiceNo, r.gpNo, r.goOutwardNo, r.msTempoNo, ...(r.items ?? []).map((i) => i.lotNo)]),
      ...(o.lines ?? []).flatMap((l) => [l.lotNo, ...(l.lots ?? []).map((x) => x.lotNo)]),
    );
  }
  return book.done();
}

function customer(d: CustomerSnapshot): RefIndex {
  const book = new Book();
  for (const r of d.requests) book.add(r.id, r.reqNo, r.customerCode, r.tallyLedgerName, r.gstNumber, r.panNumber);
  return book.done();
}

function ocpi(d: OcpiData): RefIndex {
  const book = new Book();
  for (const r of d.deals) book.add(r.id, r.quotationNo, r.ocNo, r.refNo);
  return book.done();
}

function complaint(d: ComplaintData): RefIndex {
  const book = new Book();
  for (const r of d.requests) book.add(r.id, r.complaintNo, r.lotNo, r.invoiceNo, r.resReference);
  return book.done();
}

function asset(d: AssetData): RefIndex {
  const book = new Book();
  const assets = new Map(d.assets.map((a) => [a.id, a]));
  for (const j of d.jobs) {
    const a = assets.get(j.assetId);
    const sch = a?.schedules?.find((s) => s.id === j.scheduleId);
    book.add(j.id, j.jobNo, j.sdBillNo, j.vcNewRefNo, a?.assetNo, a?.serialNo, a?.invoiceNo, sch?.refNo);
  }
  return book.done();
}

function travel(d: TravelData): RefIndex {
  const book = new Book();
  const legs = groupBy(d.legs, (l) => l.tripId);
  const claims = groupBy(d.claimLines, (c) => c.tripId);
  for (const t of d.trips) {
    book.add(
      t.id,
      t.tripNo,
      t.advancePaidRef,
      t.advanceRecoveredRef,
      t.settledRef,
      ...(legs.get(t.id) ?? []).map((l) => l.bookingRef),
      ...(claims.get(t.id) ?? []).map((c) => c.invoiceNo),
    );
  }
  return book.done();
}

/** L&D rows are keyed on whichever row the step is about — request, session, nomination, submission, effectiveness. */
function ld(d: LdData): RefIndex {
  const book = new Book();
  const reqCode = new Map(d.requests.map((r) => [r.id, r.code]));
  const sessNos = new Map<string, Val[]>();
  for (const r of d.requests) book.add(r.id, r.code);
  for (const s of d.sessions) {
    const nos = [s.code, s.requestId ? reqCode.get(s.requestId) : null];
    sessNos.set(s.id, nos);
    book.add(s.id, ...nos);
  }
  const sessOfAssignment = new Map(d.assignments.map((a) => [a.id, a.sessionId]));
  for (const n of d.nominations) book.add(n.id, ...(sessNos.get(n.sessionId) ?? []));
  for (const s of d.submissions) book.add(s.id, ...(sessNos.get(sessOfAssignment.get(s.assignmentId) ?? "") ?? []));
  for (const e of d.effectiveness) book.add(e.id, ...(sessNos.get(e.sessionId) ?? []));
  return book.done();
}

function help(d: HelpData): RefIndex {
  const book = new Book();
  for (const t of d.tickets) book.add(t.id, t.ticketNo, t.externalRef, t.handoffRef);
  return book.done();
}

/** appId → index builder. Ink Stabilisation is absent: its only number is the lot, already the row's ref. */
export const REF_INDEXERS: Record<string, (data: never) => RefIndex> = {
  procurement: purchaseLike as (d: never) => RefIndex,
  import: purchaseLike as (d: never) => RefIndex,
  "hr-recruitment": hr as (d: never) => RefIndex,
  "hr-exit": hrExit as (d: never) => RefIndex,
  "office-supplies": supplies as (d: never) => RefIndex,
  sampling: sampling as (d: never) => RefIndex,
  "production-entry": production as (d: never) => RefIndex,
  "order-to-dispatch": dispatch as (d: never) => RefIndex,
  "customer-onboarding": customer as (d: never) => RefIndex,
  ocpi: ocpi as (d: never) => RefIndex,
  complaint: complaint as (d: never) => RefIndex,
  "asset-maintenance": asset as (d: never) => RefIndex,
  "travel-desk": travel as (d: never) => RefIndex,
  "learning-development": ld as (d: never) => RefIndex,
  "help-desk": help as (d: never) => RefIndex,
};

const indexCache = new WeakMap<object, RefIndex>();

/** Built once per dataset object — a refetch of Purchase rebuilds Purchase only. */
export function refIndexOf(appId: string, data: object): RefIndex | null {
  const build = REF_INDEXERS[appId];
  if (!build) return null;
  let hit = indexCache.get(data);
  if (!hit) {
    try {
      hit = build(data as never);
    } catch (e) {
      // A shape surprise in one module must not take the search down for all.
      console.error(`[call-list] ${appId} ref index failed`, e);
      hit = { byEntity: new Map(), all: [] };
    }
    indexCache.set(data, hit);
  }
  return hit;
}

/** The entity id inside `${source}:${entityId}:${stepKey}` — first and last colon, ids never contain one. */
export function entityIdOf(itemId: string): string {
  const a = itemId.indexOf(":");
  const b = itemId.lastIndexOf(":");
  return a >= 0 && b > a ? itemId.slice(a + 1, b) : itemId;
}
