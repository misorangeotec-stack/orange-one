/**
 * THE MONTHLY RANKING, COMPUTED ON THE SERVER — by the modules' own code (CC-1).
 *
 * ── Why this file exists ───────────────────────────────────────────────────────
 * The ranking scores FMS steps against their due dates, and no due date is stored
 * anywhere: each is derived in TypeScript by its own module. A company-wide ladder
 * also cannot be built in a browser, whose reads are scoped to one person by RLS.
 * So it runs here, on the server, exactly as the morning mail does
 * (supabase/worksnapshot/entry.ts): the app's own modules, compiled unchanged by
 * build.mjs, with the service-role client and the IST clock substituted at the
 * module boundary.
 *
 * ── NOTHING HERE IS A RULE ────────────────────────────────────────────────────
 * Which steps closed, when, by whom and against what due date comes from each
 * module's scorer in `apps/fms-control-center/ranking/modules/`, which only
 * composes that module's own functions. Which month a step lands in and how it
 * ended is `ranking/month.ts`. This file is assembly: load, ask, hand back rows.
 *
 * ── Timezone ──────────────────────────────────────────────────────────────────
 * The edge runtime is UTC and cannot be moved. Due dates are corrected by the
 * istWorkingDays / istStepSla substitutions; completions are reduced to IST days
 * by month.ts with an explicit offset. `assertIstClock()` proves the substitution
 * is live before any figure is written.
 */
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { toIst } from "../worksnapshot/istWorkingDays";
import { dueIsoFrom } from "../worksnapshot/istStepSla";
import { RANKED_MODULES, NOT_SCORED } from "@/apps/fms-control-center/ranking/registry";
import {
  computeMonth,
  istDateOf,
  lastDayOf,
  monthOf,
  nextMonth,
  type MonthResult,
} from "@/apps/fms-control-center/ranking/month";
import type { ClosedStep, OpenStep } from "@/apps/fms-control-center/ranking/types";

export { RANKED_MODULES, NOT_SCORED, computeMonth, istDateOf, lastDayOf, monthOf, nextMonth };
export type { MonthResult };

// ── Clock ─────────────────────────────────────────────────────────────────────

/** Today in India, in the same local form every due date is written in. */
export const todayIso = (): string => todayLocalIso(toIst(new Date()));

/**
 * Prove the clock correction is wired rather than assuming it — the same two
 * checks work-snapshot runs. If either fails, every due date would be judged on a
 * UTC clock and a step closed at 00:15 IST the day after its due date would read
 * as on time.
 */
export function assertIstClock(): void {
  const viaIntl = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  if (todayIso() !== viaIntl) {
    throw new Error(
      `fms-ranking clock is wrong: computed ${todayIso()}, India is on ${viaIntl}. ` +
        `The istWorkingDays alias in supabase/ranking/build.mjs is not taking effect.`,
    );
  }
  // 12:00 IST exactly = 06:30 UTC, a Monday. At the default noon cut-off this rolls
  // to the next working day; on a UTC clock it reads 06:30 and would not.
  const rolled = dueIsoFrom("2026-08-17T06:30:00Z", { unit: "same_day_cutoff", days: 0 } as never);
  const sameDay = dueIsoFrom("2026-08-17T06:30:00Z", { unit: "working_days", days: 0 } as never);
  if (rolled === sameDay) {
    throw new Error("fms-ranking: the IST-aware dueIsoFrom is not active — cut-off steps would be judged in UTC.");
  }
}

// ── Loading ───────────────────────────────────────────────────────────────────

export type Datasets = Map<string, unknown>;

/** Load each wanted module's whole dataset once. Everyone's rows are computed from it. */
export async function loadDatasets(keys: readonly string[]): Promise<Datasets> {
  const out: Datasets = new Map();
  await Promise.all(
    keys.map(async (k) => {
      const s = RANKED_MODULES[k];
      if (!s) throw new Error(`fms-ranking: no scorer for module "${k}"`);
      out.set(k, await s.load());
    }),
  );
  return out;
}

/** Every closure each module reports, ever. Month filtering happens in computeMonth. */
export function closedSteps(data: Datasets): Map<string, ClosedStep[]> {
  const out = new Map<string, ClosedStep[]>();
  for (const [k, d] of data) out.set(k, RANKED_MODULES[k].closed(d));
  return out;
}

/**
 * What My Work Today lists for each person, per module, right now.
 *
 * One call per person per module, as the home screen makes it — that is what
 * "charged to everyone whose My Work Today lists it" means, literally.
 */
export function openSteps(data: Datasets, userIds: readonly string[]): Map<string, Map<string, OpenStep[]>> {
  const out = new Map<string, Map<string, OpenStep[]>>();
  for (const [k, d] of data) {
    const byUser = new Map<string, OpenStep[]>();
    for (const uid of userIds) {
      const steps = RANKED_MODULES[k].openFor(d, uid);
      if (steps.length) byUser.set(uid, steps);
    }
    out.set(k, byUser);
  }
  return out;
}

// ── One module, every month the run needs ─────────────────────────────────────

/** Who exists: every profile, with when their account was made. */
export interface Person {
  id: string;
  createdAt: string;
  external: boolean;
}

export interface ModuleMonth extends MonthResult {
  month: string;
  final: boolean;
}

/**
 * Everything one module contributes to a run: load its data once, then produce its
 * rows for each month asked for (a finished month being frozen, and the running one).
 *
 * ONE MODULE PER CALL, on purpose. The edge runtime allows about two seconds of CPU
 * per request, and loading every module in one request measured 2.3 s on 18-09-2026 —
 * mostly parsing. One request per module keeps each well inside its own budget; the
 * per-step table is what lets the pieces be written separately and added up after.
 *
 * External accounts (customers — OD-13) are never charged: the open half only asks
 * My Work about staff.
 */
export async function runModule(
  module: string,
  months: { month: string; final: boolean }[],
  today: string,
  people: Person[],
): Promise<{ months: ModuleMonth[]; ms: { load: number; compute: number } }> {
  const t0 = Date.now();
  const data = await loadDatasets([module]);
  const t1 = Date.now();
  const closed = closedSteps(data);
  const open = openSteps(data, people.filter((p) => !p.external).map((p) => p.id));
  const accountFrom = new Map(people.map((p) => [p.id, istDateOf(p.createdAt) ?? "0000-00-00"]));
  const out = months.map((m) => ({
    month: m.month,
    final: m.final,
    ...computeMonth({ month: m.month, todayIso: today, final: m.final, closed, open, accountFrom }),
  }));
  return { months: out, ms: { load: t1 - t0, compute: Date.now() - t1 } };
}
