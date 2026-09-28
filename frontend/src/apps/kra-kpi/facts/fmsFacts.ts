/**
 * The FMS half of the KRA / KPI facts (KPI-1) — CC-1's scored steps, window-free.
 *
 * CC-1's ranking (apps/fms-control-center/ranking/) already asks every FMS the two
 * questions this report needs, with each module's OWN code:
 *   `closed(data)`       every step the module reports as closed, ever, with its due
 *                        date, its closer and its original completion time;
 *   `openFor(data, uid)` the open steps My Work Today lists for that person.
 * The ranking then files them by MONTH. This file files them by nothing — one fact
 * per (person, step) — so the report can place each by its due date in any week,
 * month or range. No due date is derived here; every one arrives from a scorer.
 *
 * Credit and blame are CC-1's (decided 18-09-2026): a closed step counts for the
 * person who closed it — an admin who closes someone's step gets the credit — and an
 * open step counts for EVERYONE whose My Work lists it, so a team step with five
 * owners is on five reports until someone closes it, then only on the closer's.
 *
 * Counted for nobody, and counted in the run log instead: a step the scorer marks
 * with a `drop` reason (test records, held, excluded step types), a step with no due
 * date, and a closed step with no closer or no readable completion time. The same
 * reasons, in the same words, as the ranking's.
 *
 * Pure: bundled into the `kpi-facts` edge function.
 */
import { istDateOf } from "@/apps/fms-control-center/ranking/month";
import type { ClosedStep, DropReason, OpenStep } from "@/apps/fms-control-center/ranking/types";
import { bump, emptyStats, type KpiFact, type KpiModuleStats } from "./types";

export interface FmsFactsInput {
  /** CC-1's module key. */
  module: string;
  moduleName: string;
  closed: ClosedStep[];
  /** user id → the open steps My Work Today lists for them (CC-1's `openFor`). */
  open: Map<string, OpenStep[]>;
}

export function fmsFacts({ module, moduleName, closed, open }: FmsFactsInput): {
  facts: KpiFact[];
  stats: KpiModuleStats;
} {
  const stats = emptyStats("fms");
  const facts: KpiFact[] = [];

  /*
   * One fact per (person, step). A scorer that reported the same step twice for one
   * person — closed and open, or twice on one My Work list — must not fail the night's
   * write on the table's key. The first reading wins and the closed half is read first,
   * exactly as the ranking's computeMonth does.
   */
  const seen = new Set<string>();
  const push = (f: KpiFact) => {
    const k = `${f.user_id}|${f.item_id}`;
    if (seen.has(k)) return;
    seen.add(k);
    facts.push(f);
  };

  const base = (s: ClosedStep | OpenStep) => ({
    source: "fms" as const,
    module,
    module_name: moduleName,
    row_key: s.stepKey,
    row_label: s.stepLabel,
    item_id: s.stepId,
    entity_id: s.entityId,
    ref: s.ref,
    round_no: s.roundNo,
    revised: false,
    excluded: null,
  });

  // ── Closed: credited to the closer ──────────────────────────────────────────
  for (const c of closed) {
    const doneDate = istDateOf(c.doneAtIso);
    const why: DropReason | undefined =
      c.drop ?? (!c.dueIso ? "untimed" : !c.actorId ? "no_actor" : !doneDate ? "no_time" : undefined);
    if (why) {
      bump(stats.dropped, why);
      continue;
    }
    stats.closed++;
    push({
      ...base(c),
      user_id: c.actorId!,
      due_date: c.dueIso!,
      done_at: c.doneAtIso,
      done_date_ist: doneDate,
      basis: "closed",
    });
  }

  // ── Open: charged to everyone whose My Work lists it ─────────────────────────
  const counted = new Set<string>();
  for (const [uid, steps] of open) {
    for (const o of steps) {
      const isNew = !counted.has(o.stepId);
      counted.add(o.stepId);
      if (o.drop || !o.dueIso) {
        // Count each dropped step once, not once per owner.
        if (isNew) bump(stats.dropped, o.drop ?? "untimed");
        continue;
      }
      if (isNew) stats.open++;
      push({
        ...base(o),
        user_id: uid,
        due_date: o.dueIso,
        done_at: null,
        done_date_ist: null,
        basis: "open",
      });
    }
  }

  stats.facts = facts.length;
  return { facts, stats };
}
