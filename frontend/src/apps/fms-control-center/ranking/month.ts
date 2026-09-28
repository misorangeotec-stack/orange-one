/**
 * Turning modules' steps into one month's scored rows (CC-1).
 *
 * Pure date arithmetic and bookkeeping. Every due date and every "closed" fact
 * arrives from the module scorers; this file only decides WHICH MONTH a step
 * counts in and HOW it ended, by the rules the user set on 18-09-2026:
 *
 *  1. A month scores every step CLOSED in it, plus every step STILL OVERDUE at its
 *     end. A step left open is 0 again next month; closing it late then earns ½.
 *     (Not "the month it fell due": that makes old backlog worthless once the month
 *     turns, and nobody would ever clear it.)
 *  2. The closer gets the credit. An overdue open step is charged to everyone whose
 *     My Work Today lists it — five owners, five charges.
 *
 * ── IST, on any host ──────────────────────────────────────────────────────────
 * "On time" and the month boundary are Indian calendar days, and the edge runtime
 * is UTC. A step closed at 00:15 IST on the day after its due date is LATE, yet in
 * UTC it is still the due date. So a completion is reduced to its IST date here
 * with an explicit +5:30, not with the host clock — correct in a browser in India,
 * in Node, and on a UTC edge worker alike. (India has never had daylight saving.)
 */
import type { ClosedStep, DropReason, OpenStep, Outcome } from "./types";

const IST_MS = 330 * 60_000;

/** The IST calendar day a timestamp falls on, whatever the host's zone. */
export function istDateOf(iso: string): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t + IST_MS).toISOString().slice(0, 10);
}

/** First day of the month a yyyy-mm-dd falls in. */
export const monthOf = (dateIso: string): string => `${dateIso.slice(0, 7)}-01`;

/** Last day of a month given as its first day. */
export function lastDayOf(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** The month after `month`. */
export function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
}

/** Whole calendar days from `a` to `b` (both yyyy-mm-dd); positive when b is later. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** On time = closed on or before the due DATE — the due day itself is on time. */
export const outcomeOf = (doneDate: string, dueIso: string): Outcome =>
  doneDate <= dueIso ? "on_time" : "late";

/** One scored row, exactly as `fms_rank_steps` stores it. */
export interface RankRow {
  user_id: string;
  module: string;
  step_id: string;
  entity_id: string;
  ref: string;
  step_key: string;
  step_label: string;
  round_no: number;
  /** `upcoming` is not scored: the viewer's own open steps not yet due, for the what-if. */
  outcome: Outcome | "upcoming";
  due_date: string | null;
  done_at: string | null;
  days_late: number | null;
  /**
   * How the row arose. `closed` and `open` are the two halves of rule 1;
   * `closed_after` is an overdue step that was open at the month's end and has
   * since been closed — only possible for a month frozen after the fact.
   */
  basis: "closed" | "open" | "closed_after";
}

/** Per-module bookkeeping for one month, stored with the month so drops are never silent. */
export interface ModuleStats {
  closedInMonth: number;
  scoredClosed: number;
  missedCharges: number;
  closedAfterCharges: number;
  /** Charges to a finished month skipped because that person's account did not exist yet. */
  notYetJoined: number;
  upcoming: number;
  dropped: Partial<Record<DropReason, number>>;
}

export interface MonthInput {
  /** First day of the month, yyyy-mm-dd. */
  month: string;
  /**
   * Today in IST. For the running month, "overdue" means due before today — the
   * screen's own rule (`bucketOf`: due < today is delayed).
   */
  todayIso: string;
  /** True when freezing a finished month: overdue then means due on or before its last day. */
  final: boolean;
  /** module key → every closure that module reports. */
  closed: Map<string, ClosedStep[]>;
  /** module key → user id → what My Work Today lists for them right now. */
  open: Map<string, Map<string, OpenStep[]>>;
  /**
   * user id → the IST day their account was created. A finished month is only ever
   * charged to people who existed on its last day (see computeMonth).
   */
  accountFrom: Map<string, string>;
}

export interface MonthResult {
  rows: RankRow[];
  stats: Record<string, ModuleStats>;
}

const emptyStats = (): ModuleStats => ({
  closedInMonth: 0,
  scoredClosed: 0,
  missedCharges: 0,
  closedAfterCharges: 0,
  notYetJoined: 0,
  upcoming: 0,
  dropped: {},
});

const bump = (s: ModuleStats, why: DropReason) => {
  s.dropped[why] = (s.dropped[why] ?? 0) + 1;
};

/**
 * One month's scored rows, for everyone, from every module's closed and open steps.
 *
 * Who is RANKED is not decided here. Rows are written for everyone the modules
 * name — admins included — and SQL applies the admin / exclusion / external rules
 * when it adds them up, so an exclusion added mid-month re-scores without a re-run.
 */
export function computeMonth(input: MonthInput): MonthResult {
  const { month, todayIso, final, accountFrom } = input;
  const first = month;
  const last = lastDayOf(month);
  const out: RankRow[] = [];
  const stats: Record<string, ModuleStats> = {};

  /*
   * One row per (person, step). A module that ever reported the same step as both
   * closed and open, or listed one step twice on someone's My Work, must not fail
   * the night's write on the table's unique key — the first reading wins, and the
   * closed half is read first.
   */
  const seen = new Set<string>();

  /*
   * ⚠ A FINISHED MONTH IS CHARGED ONLY TO PEOPLE WHO EXISTED IN IT. Both of its
   *   charges are read from today's state — who closed a step since, whose My Work
   *   lists it now — and without this a person who joined on the 1st was charged
   *   for the previous month's backlog: 14 August misses for an account created on
   *   1 September, found by the first dry run on 18-09-2026.
   */
  const existedBy = (uid: string, day: string) => (accountFrom.get(uid) ?? "0000-00-00") <= day;
  const rows = {
    push(r: RankRow) {
      const k = `${r.user_id}|${r.module}|${r.step_id}`;
      if (seen.has(k)) return;
      seen.add(k);
      out.push(r);
    },
  };

  // ── The closed half ─────────────────────────────────────────────────────────
  for (const [module, closed] of input.closed) {
    const s = (stats[module] ??= emptyStats());
    for (const c of closed) {
      const doneDate = istDateOf(c.doneAtIso);
      if (!doneDate) continue;

      if (doneDate >= first && doneDate <= last) {
        s.closedInMonth++;
        const why: DropReason | undefined =
          c.drop ?? (!c.dueIso ? "untimed" : !c.actorId ? "no_actor" : undefined);
        if (why) {
          bump(s, why);
          continue;
        }
        const outcome = outcomeOf(doneDate, c.dueIso!);
        rows.push(rowOf(module, c, c.actorId!, outcome, c.doneAtIso, "closed", doneDate));
        s.scoredClosed++;
        continue;
      }

      /*
       * Closed AFTER a finished month, but already overdue by its last day: it was
       * open and late at the month's end, so that month charges it — rule 1.
       *
       * Its My Work owners at that moment are not recoverable (the ownership rules
       * read the entity as it stands today), so the charge falls on the person who
       * eventually closed it. On a run made on time — 00:52 IST on the 1st — this
       * is a handful of steps; it matters when a missed night is caught up later.
       */
      if (final && doneDate > last && c.dueIso && c.dueIso <= last && !c.drop && c.actorId) {
        if (!existedBy(c.actorId, last)) {
          s.notYetJoined++;
          continue;
        }
        rows.push(rowOf(module, c, c.actorId, "missed", null, "closed_after", null));
        s.closedAfterCharges++;
      }
    }
  }

  // ── The open half ───────────────────────────────────────────────────────────
  for (const [module, byUser] of input.open) {
    const s = (stats[module] ??= emptyStats());
    const counted = new Set<string>();
    for (const [uid, steps] of byUser) {
      for (const o of steps) {
        const isNew = !counted.has(o.stepId);
        counted.add(o.stepId);
        if (o.drop || !o.dueIso) {
          // Count each dropped step once, not once per owner.
          if (isNew) bump(s, o.drop ?? "untimed");
          continue;
        }
        const overdue = final ? o.dueIso <= last : o.dueIso < todayIso;
        if (overdue) {
          if (final && !existedBy(uid, last)) {
            s.notYetJoined++;
            continue;
          }
          rows.push(rowOf(module, o, uid, "missed", null, "open", null));
          s.missedCharges++;
        } else if (!final && o.dueIso <= last) {
          // Not scored. The viewer's own "close these on time" list.
          rows.push(rowOf(module, o, uid, "upcoming", null, "open", null));
          s.upcoming++;
        }
      }
    }
  }

  return { rows: out, stats };
}

function rowOf(
  module: string,
  s: ClosedStep | OpenStep,
  userId: string,
  outcome: RankRow["outcome"],
  doneAt: string | null,
  basis: RankRow["basis"],
  doneDate: string | null,
): RankRow {
  return {
    user_id: userId,
    module,
    step_id: s.stepId,
    entity_id: s.entityId,
    ref: s.ref,
    step_key: s.stepKey,
    step_label: s.stepLabel,
    round_no: s.roundNo,
    outcome,
    due_date: s.dueIso,
    done_at: doneAt,
    days_late: doneDate && s.dueIso ? Math.max(0, daysBetween(s.dueIso, doneDate)) : null,
    basis,
  };
}
