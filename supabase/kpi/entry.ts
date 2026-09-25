/**
 * THE KRA / KPI FACTS, COMPUTED ON THE SERVER — by the modules' own code (KPI-1).
 *
 * ── Why this file exists ───────────────────────────────────────────────────────
 * Every employee's KRA / KPI scorecard counts their FMS steps and their Task
 * Management tasks, each against its due date. No FMS due date is stored anywhere —
 * each is derived in TypeScript by its own module — and a HOD's report covers other
 * people's steps, which that HOD's browser cannot read. So, exactly like the monthly
 * ranking (supabase/ranking/entry.ts, CC-1) and the morning mail before it, the facts
 * are computed here, on the server, by the app's own modules compiled unchanged by
 * supabase/ranking/build.mjs (`kpi` target), with the service-role client and the IST
 * clock substituted at the module boundary.
 *
 * ── NOTHING HERE IS A RULE ────────────────────────────────────────────────────
 * The FMS half reuses the RANKING's loaders and scorers as they are — this file
 * imports them, it does not wrap or copy them. Which steps closed, when, by whom and
 * against what due date is each scorer's answer; which of them count is
 * `apps/kra-kpi/facts/fmsFacts.ts`. Which tasks count is Task Management's own
 * `countsTowardMetrics`, applied in `apps/kra-kpi/facts/taskFacts.ts`. Which period a
 * fact lands in is decided in SQL, by `kpi_report`, from the due date. This file only
 * loads, asks and hands back rows.
 *
 * ── Timezone ──────────────────────────────────────────────────────────────────
 * The edge runtime is UTC and cannot be moved. Due dates are corrected by the
 * istWorkingDays / istStepSla substitutions; completions are reduced to IST days with
 * an explicit offset (`istDateOf`). `assertIstClock()` — the ranking's own — proves the
 * substitution is live before anything is written.
 */
import { appName } from "@/apps/appInfo";
import { fmsFacts } from "@/apps/kra-kpi/facts/fmsFacts";
import { assertSheetArithmetic } from "@/apps/kra-kpi/facts/score";
import { TASK_MODULE, taskFacts } from "@/apps/kra-kpi/facts/taskFacts";
import { loadTaskFactsInput } from "@/apps/kra-kpi/facts/taskSource";
import type { KpiFact, KpiModuleStats } from "@/apps/kra-kpi/facts/types";
import { RANKED_MODULES, NOT_SCORED, assertIstClock, closedSteps, loadDatasets, openSteps, todayIso } from "../ranking/entry";

export { RANKED_MODULES, NOT_SCORED, TASK_MODULE, assertIstClock, assertSheetArithmetic, todayIso };
export type { KpiFact, KpiModuleStats };

/** Display name for a module key: CC-1's scorer names its app; Task Management is itself. */
export const moduleNameOf = (module: string): string =>
  module === TASK_MODULE ? appName(TASK_MODULE) : appName(RANKED_MODULES[module]?.appId ?? module);

export interface ModuleFacts {
  facts: KpiFact[];
  stats: KpiModuleStats;
  /** Wall-clock phases, and the CPU-bound compute measured on its own. */
  ms: { load: number; compute: number };
}

/**
 * Every fact one module contributes: load it once, then build its facts.
 *
 * ONE MODULE PER CALL, for the same reason as the ranking: the edge runtime allows
 * about two seconds of CPU per request, and loading every module in one request
 * measured 2.3 s on 18-09-2026. The conductor in functions/kpi-facts fans out.
 *
 * `staffIds` are the people My Work is asked about for the FMS open half — staff only,
 * never an external (customer) login, exactly as the ranking asks.
 */
export async function moduleFacts(module: string, staffIds: readonly string[]): Promise<ModuleFacts> {
  const t0 = Date.now();
  if (module === TASK_MODULE) {
    const input = await loadTaskFactsInput();
    const t1 = Date.now();
    const out = taskFacts(input);
    return { ...out, ms: { load: t1 - t0, compute: Date.now() - t1 } };
  }
  if (!RANKED_MODULES[module]) throw new Error(`kpi-facts: no scorer for module "${module}"`);
  const data = await loadDatasets([module]);
  const t1 = Date.now();
  const closed = closedSteps(data).get(module) ?? [];
  const open = openSteps(data, staffIds).get(module) ?? new Map();
  const out = fmsFacts({ module, moduleName: moduleNameOf(module), closed, open });
  return { ...out, ms: { load: t1 - t0, compute: Date.now() - t1 } };
}
