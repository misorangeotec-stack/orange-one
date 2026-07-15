/**
 * The HR Exit reporting model — every number the dashboard shows, computed here as
 * pure functions over plain data.
 *
 * Three rules run through all of it.
 *
 * 1. **Every metric reads an authoritative timestamp column on the case HEADER** —
 *    `submitted_at`, `lwd`, `fnf_paid_at`, `archived_at`. NEVER the activity trail
 *    (`announce` swallows its own failures, so the trail is decoration, not a source),
 *    and never a satellite.
 *
 * 2. **⚠ NOTHING HERE TOUCHES AN RLS-GATED SATELLITE.** The exit interview
 *    (`fms_exit_interviews`) and the settlement (`fms_exit_settlements`) return **ZERO
 *    ROWS** to a viewer who may not read them — a reporting manager, an IT clearance
 *    owner, the employee before approval. Zero rows means "not visible", it does **NOT**
 *    mean "zero rupees" and it does **NOT** mean "no interview was held". A total summed
 *    over "the rows RLS happened to hand me" is a number that changes depending on who
 *    is looking at it, and it announces itself as a fact. So there is no F&F total on
 *    this dashboard and no interview aggregate: every figure below is derived from the
 *    WIDE-READ header, whose rows are already the ones this user is entitled to.
 *
 *    The one thing the header knows about the money is `fnfPaidAt` — the FACT of a
 *    payment, with no amount attached. That is enough to time the settlement, and it is
 *    all this file uses.
 *
 * 3. **Every average carries its denominator.** A mean over two exits is noise and the
 *    reader cannot tell that from the number alone, so `n` travels with it and the
 *    screen prints it.
 *
 * Nothing here knows about React, the signed-in user or RLS. A user only ever receives
 * the rows RLS let them read, so these aggregates scope themselves.
 */
import { bucketOf, todayLocalIso } from "@/shared/lib/dueBuckets";
import { isOpenCase, type QueueEntry } from "./queues";
import { STAGES, STEPS, type StepKey } from "./steps";
import type { ExitCase, ExitReason } from "../types";

/* -------------------------------------------------------------------------- */
/*  Date helpers — local midnight, never UTC (see shared/lib/dueBuckets).       */
/* -------------------------------------------------------------------------- */

/** A timestamptz or yyyy-mm-dd → local midnight, so day arithmetic is honest. */
function localMidnight(input: string | null): Date | null {
  if (!input) return null;
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (ymd) return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Whole calendar days between two dates. Null if either is unusable. */
function daysBetween(from: string | null, to: string | null): number | null {
  const a = localMidnight(from);
  const b = localMidnight(to);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** yyyy-mm of a timestamp/date, in LOCAL time. `null` for anything unusable. */
export function monthKey(input: string | null): string | null {
  const d = localMidnight(input);
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` : null;
}

/** "Jul 2026" — the label a month bar wears. */
export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-GB", { month: "short", year: "numeric" });
}

const avg = (xs: number[]): number => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

/* -------------------------------------------------------------------------- */
/*  1 · The headline case counts                                                */
/* -------------------------------------------------------------------------- */

export interface CaseSummary {
  /**
   * ⭐ DISTINCT CASES, never queue entries.
   *
   * A queue entry is a (step, case) work-item, and one case in the parallel block owes
   * clearance AND assets AND handover AND the interview AND leave AND payroll — six
   * entries, one person leaving. Counting entries here would report six exits and put a
   * number on the board that no one in the company recognises.
   */
  openExits: number;
  /** Parked on purpose. NOT open, NOT late — surfaced so nobody is forgotten for a month. */
  onHold: number;
  /** Open cases whose last working day falls in the current calendar month. */
  dueThisMonth: number;
  /** Open cases with no confirmed last working day yet — nothing downstream can be dated. */
  noLwd: number;
  archived: number;
}

export function caseSummary(cases: ExitCase[], today: string = todayLocalIso()): CaseSummary {
  const open = cases.filter(isOpenCase);
  const thisMonth = today.slice(0, 7);
  return {
    openExits: open.length,
    onHold: cases.filter((c) => c.status === "on_hold").length,
    dueThisMonth: open.filter((c) => monthKey(c.lwd) === thisMonth).length,
    noLwd: open.filter((c) => !c.lwd).length,
    archived: cases.filter((c) => c.status === "archived").length,
  };
}

/* -------------------------------------------------------------------------- */
/*  2 · What is overdue right now — by step, by stage, by owner                 */
/* -------------------------------------------------------------------------- */

export interface OverdueByStep {
  stepKey: StepKey;
  label: string;
  overdue: number;
  dueToday: number;
  total: number;
}

export interface OverdueByStage {
  label: string;
  overdue: number;
  dueToday: number;
  total: number;
}

export interface OverdueByOwner {
  ownerId: string | null; // null = nobody owns it
  overdue: number;
  dueToday: number;
  total: number;
}

/**
 * Roll the queue up by step, by stage and by owner.
 *
 * `entries` MUST be `store.queueEntries` — i.e. `buildQueueEntries(exitSnapshotFrom(…))`
 * output, the same list the queue pages narrow, the Control Center strips and the
 * cross-FMS scoreboard counts. Working "what's late" out a second, independent way is
 * exactly how a dashboard starts lying about the queue it links to.
 *
 * `ownerIdsOf` is injected because ownership is not a property of the entry: a clearance
 * row carries its OWN owners (the IT / Admin / Travel-Desk people, who own no workflow
 * step at all), a MANAGER step belongs to the case's own reporting managers, and
 * everything else to the global step-owner table. Only the caller — which has the store
 * — can resolve that.
 */
export function overdueRollup(
  entries: QueueEntry[],
  ownerIdsOf: (e: QueueEntry) => string[],
  today: string = todayLocalIso(),
): {
  byStep: OverdueByStep[];
  byStage: OverdueByStage[];
  byOwner: OverdueByOwner[];
  totalOverdue: number;
  totalDueToday: number;
  totalOpen: number;
} {
  const steps = new Map<StepKey, OverdueByStep>();
  const owners = new Map<string | null, OverdueByOwner>();
  let totalOverdue = 0;
  let totalDueToday = 0;

  const touchOwner = (id: string | null) => {
    let rec = owners.get(id);
    if (!rec) {
      rec = { ownerId: id, overdue: 0, dueToday: 0, total: 0 };
      owners.set(id, rec);
    }
    return rec;
  };

  for (const e of entries) {
    const bucket = bucketOf(e.dueIso, today);
    const isOverdue = bucket === "delayed";
    const isToday = bucket === "today";
    if (isOverdue) totalOverdue++;
    if (isToday) totalDueToday++;

    const def = STEPS.find((s) => s.key === e.stepKey);
    let step = steps.get(e.stepKey);
    if (!step) {
      step = { stepKey: e.stepKey, label: def?.short ?? e.stepKey, overdue: 0, dueToday: 0, total: 0 };
      steps.set(e.stepKey, step);
    }
    // `total` counts EVERY entry whatever its date — including the ones due next week and
    // the ones with no date at all. It is what makes "this step is clear" an honest claim
    // rather than "nothing here is due in the next 24 hours".
    step.total++;
    if (isOverdue) step.overdue++;
    if (isToday) step.dueToday++;

    const ids = ownerIdsOf(e);
    // Unowned work is the POINT of this table, not an edge case: a step with no owner is
    // work nobody has been told about, and it must show up as such.
    for (const id of ids.length ? ids : [null]) {
      const rec = touchOwner(id);
      rec.total++;
      if (isOverdue) rec.overdue++;
      if (isToday) rec.dueToday++;
    }
  }

  const byStep = [...steps.values()].sort(
    (a, b) =>
      (STEPS.find((s) => s.key === a.stepKey)?.index ?? 0) - (STEPS.find((s) => s.key === b.stepKey)?.index ?? 0),
  );

  // The same four stages the Control Center strip and the scoreboard row use, from the
  // same list in lib/steps.ts. Two hand-kept groupings is how two screens come to
  // describe one workflow differently.
  const byStage: OverdueByStage[] = STAGES.map((stage) => {
    const members = byStep.filter((s) => (stage.keys as StepKey[]).includes(s.stepKey));
    return {
      label: stage.label,
      overdue: members.reduce((n, s) => n + s.overdue, 0),
      dueToday: members.reduce((n, s) => n + s.dueToday, 0),
      total: members.reduce((n, s) => n + s.total, 0),
    };
  });

  return {
    byStep,
    byStage,
    byOwner: [...owners.values()].sort((a, b) => b.overdue - a.overdue || b.total - a.total),
    totalOverdue,
    totalDueToday,
    totalOpen: entries.length,
  };
}

/* -------------------------------------------------------------------------- */
/*  3 · How long the settlement actually takes — LWD → F&F PAID                 */
/* -------------------------------------------------------------------------- */

export interface SettlementSpeed {
  avgDays: number;
  medianDays: number;
  /** THE denominator. An average over two settlements is noise; the screen says so. */
  settled: number;
  fastestDays: number | null;
  slowestDays: number | null;
  /** Left, F&F not yet paid — the people still owed money. NOT in the average. */
  awaitingPayment: number;
}

/**
 * Calendar days from the last working day to the day the F&F was actually PAID.
 *
 * ⚠ **BOTH DATES COME OFF THE WIDE-READ HEADER** (`lwd`, `fnfPaidAt`). The settlement
 * satellite — where the *amount* lives — is RLS-gated and returns zero rows to most
 * viewers, so timing the settlement off it would silently produce a different average
 * per viewer. The header carries the FACT of payment with no figure attached, which is
 * exactly what this measures and all it needs.
 *
 * Counts ONLY exits where the money has actually moved. A case whose F&F is generated
 * but unpaid is not a fast settlement, it is an unfinished one — it is counted in
 * `awaitingPayment` instead, so the number cannot be flattered by excluding its own
 * worst cases.
 */
export function settlementSpeed(cases: ExitCase[]): SettlementSpeed {
  const days: number[] = [];
  let awaitingPayment = 0;

  for (const c of cases) {
    if (!c.lwd) continue;
    if (c.status === "withdrawn" || c.status === "rejected") continue;
    if (!c.fnfPaidAt) {
      // Already left, still not paid. The people this metric exists for.
      if (c.lwd <= todayLocalIso()) awaitingPayment++;
      continue;
    }
    const d = daysBetween(c.lwd, c.fnfPaidAt);
    // A payment dated before the last working day is a data error, not a −3 day settlement.
    if (d !== null && d >= 0) days.push(d);
  }

  if (!days.length) {
    return { avgDays: 0, medianDays: 0, settled: 0, fastestDays: null, slowestDays: null, awaitingPayment };
  }
  const sorted = [...days].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return {
    avgDays: Math.round(avg(sorted)),
    medianDays: sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid],
    settled: sorted.length,
    fastestDays: sorted[0],
    slowestDays: sorted[sorted.length - 1],
    awaitingPayment,
  };
}

/* -------------------------------------------------------------------------- */
/*  4 · Attrition — people who ACTUALLY LEFT                                    */
/* -------------------------------------------------------------------------- */

export interface MonthCount {
  key: string; // yyyy-mm
  label: string; // "Jul 2026"
  count: number;
}

/**
 * Did this case end in somebody leaving?
 *
 * Keyed on the CONFIRMED last working day — not on when the resignation was raised, and
 * not on when HR finished the paperwork. A withdrawn or rejected case is somebody who
 * STAYED, and counting it as attrition is how a retention win gets reported as a loss.
 * A case still mid-process with a confirmed LWD in the past is attrition: they have
 * gone, whatever the F&F says.
 */
const isDeparture = (c: ExitCase): boolean =>
  !!c.lwd && c.status !== "withdrawn" && c.status !== "rejected";

/** Departures whose LWD has already passed, in the current calendar month. */
export function attritionMtd(cases: ExitCase[], today: string = todayLocalIso()): number {
  const thisMonth = today.slice(0, 7);
  return cases.filter((c) => isDeparture(c) && monthKey(c.lwd) === thisMonth && c.lwd! <= today).length;
}

/**
 * Departures per month over a rolling window, ending with the current month.
 *
 * EVERY month in the window appears, including the empty ones — a bar chart that quietly
 * drops January makes February look like a continuation of December.
 */
export function exitsByMonth(cases: ExitCase[], months = 12, today: string = todayLocalIso()): MonthCount[] {
  const counts = new Map<string, number>();
  for (const c of cases) {
    if (!isDeparture(c)) continue;
    const k = monthKey(c.lwd);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  const [y, m] = today.split("-").map(Number);
  const out: MonthCount[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push({ key, label: monthLabel(key), count: counts.get(key) ?? 0 });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/*  5 · Where people are leaving from, and why                                  */
/* -------------------------------------------------------------------------- */

export interface CountRow {
  id: string | null;
  name: string;
  count: number;
}

/** Departures by department. Counts DEPARTURES, not open cases — this is attrition. */
export function exitsByDepartment(cases: ExitCase[], nameOf: (id: string) => string): CountRow[] {
  const counts = new Map<string, number>();
  for (const c of cases) {
    if (!isDeparture(c)) continue;
    counts.set(c.departmentId, (counts.get(c.departmentId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, name: nameOf(id), count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * ⭐ Departures by REASON — what `fms_exit_reasons` is for.
 *
 * Read from `ExitCase.reasonId` on the WIDE-READ header: the reason given ON THE
 * RESIGNATION. It is deliberately NOT the reason given in the exit interview
 * (`fms_exit_interviews.primary_reason_id`), which is confidential, gated to HR, and
 * very often a different answer — that gap is a finding for HR, not a chart for the
 * dashboard, and aggregating it here would leak it to every viewer RLS handed rows to.
 *
 * A case with no reason recorded lands in "Not recorded" and SAYS SO, rather than being
 * silently dropped: a chart that hides its own missing data is worse than no chart.
 */
export function exitsByReason(cases: ExitCase[], reasons: ExitReason[]): CountRow[] {
  const nameById = new Map(reasons.map((r) => [r.id, r.name]));
  const counts = new Map<string | null, number>();
  for (const c of cases) {
    if (!isDeparture(c)) continue;
    counts.set(c.reasonId, (counts.get(c.reasonId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([id, count]) => ({
      id,
      name: id ? (nameById.get(id) ?? "Unknown reason") : "Not recorded",
      count,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
